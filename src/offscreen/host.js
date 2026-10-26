// Хост ядра: обработчик протокола §5.4 внутри Web Worker offscreen-документа.
// Без chrome.* — тестируется в Node (tests/integration/host.spec.js).
// Настройки приходят ВНУТРИ сообщения (поле `settings`, его добавляет background):
// offscreen-документ не имеет доступа к chrome.storage.
// Импорты — из модулей ядра, а не из core/index.js: так в worker.js не попадает разбор PDF (core/pdf/extract.js, layout.js),
// который воркер грузит отдельным модулем при первом PDF (offscreen/pdf-loader.js; бюджет worker.js, К14, WP12-A).
import { fromText } from '../core/text/model.js';
import { isPdf } from '../core/pdf/sniff.js';
import { analyze } from '../core/detect/runner.js';
import { applyDecisions } from '../core/apply.js';
import { adapterForKind, detectAdapter, loadAdapter } from '../core/adapters.js';
import { attachEmbeddedBooks } from '../core/embedded.js';
import { addFileNameStream } from '../core/file-name.js';
import { mergeDecisions } from '../core/contracts/entity.js';
import { summarizeSession } from '../core/contracts/session.js';
import { deanonymize } from '../core/deanon.js';
import { findOccurrences } from '../core/search.js';
import { getParagraphs, occurrenceContext } from '../core/text-view.js';
import { migrateSettings } from '../core/settings.js';
import { hiddenFlagsFrom } from '../core/ooxml/hidden.js';
import { PlaceholderAllocator, resolvePlaceholderLanguage } from '../core/placeholders.js';
import { registerBuiltinDetectors } from '../core/detect/index.js';
import { CoreError } from '../core/errors.js';
import { MSG, ChunkAssembler, postChunked, errorMessage, sha256Hex } from '../shared/protocol.js';
import { ModelStoreError } from '../shared/model-store.js';
import { loadDicts } from '../core/detect/names/dict/load.js';

/**
 * @param {{post: (clientId: string, msg: object) => void, nerProvider?: any, toolVersion?: string,
 *   createNerProvider?: (settings: import('../core/settings.js').Settings) => import('../core/contracts/ner.js').NerProvider,
 *   extractPdf?: (bytes: Uint8Array, opts: {onProgress?: (percent: number) => void}) => Promise<import('../core/pdf/layout.js').Layout>,
 *   readPackageFile?: (url: string) => Promise<Uint8Array>,
 *   readDictFile?: (name: string) => Promise<Uint8Array | string>,
 *   loadAdapter?: (entry: any) => Promise<import('../core/ooxml/adapter.js').DocumentAdapter>,
 *   modelStore?: {listInstalled: () => Promise<any[]>, inspectPack: (bytes: Uint8Array, opts?: object) => Promise<any>, install: (bytes: Uint8Array, opts?: object) => Promise<any>}}} env
 *   nerProvider — готовый провайдер (тесты; имеет приоритет), createNerProvider — синхронная фабрика по settings.nerModel (worker.js),
 *   extractPdf — извлечение текста PDF (версия 0.3; worker.js — pdf-loader.js, тесты — pdf.js в Node),
 *   readPackageFile и modelStore — установка встроенной модели NER из архива расширения (WP10-C, MODEL_INSTALL; worker.js —
 *   offscreen/package-fetch.js и shared/model-store.js, тесты — фейки),
 *   readDictFile — чтение словаря ФИО vendor/dict/<name>.txt (0.5, WP12-A; worker.js — readPackageFile, Node — диск); без него
 *   анализ идёт на словарях, загруженных раньше (тесты), а если их нет — без словарей с предупреждением DICT_FAILED;
 *   loadAdapter — загрузка модуля формата по требованию (0.5, WP12-B; по умолчанию core/adapters.js, тесты подменяют сбоем)
 */
export function createHost(env) {
  registerBuiltinDetectors();
  // Словари ФИО (WP12-A, К14): загрузка начинается сразу при создании хоста — пока клиент шлёт файл чанками, воркер читает
  // и декодирует словари; анализ её дожидается (ensureDicts). Сбой — анализ без словарей и DICT_FAILED (NFR-13).
  const readDict =
    env.readDictFile ||
    (async () => {
      throw new Error('нет env.readDictFile');
    });
  loadDicts(readDict);
  /** Кэш провайдера NER (WP8): один на модель, сбрасывается MODEL_CHANGED и сменой nerModel. */
  /** @type {{modelId: string, provider: any} | null} */
  let ner = null;
  /** @type {Map<string, {begin: any, assembler: ChunkAssembler}>} */
  const uploads = new Map();
  /** @type {Map<string, any>} docId → Session */
  const sessions = new Map();
  /** @type {Map<string, PlaceholderAllocator>} */
  const batches = new Map();
  let docSeq = 0;
  /** Установки встроенной модели идут строго по очереди: повторный MODEL_INSTALL дождётся первого и ответит `present`. */
  let installChain = Promise.resolve();

  /**
   * @param {string} clientId
   * @param {any} msg
   */
  async function handle(clientId, msg) {
    const post = (m) => env.post(clientId, m);
    const { requestId } = msg;
    const progress = (stage, percent) => post({ type: MSG.PROGRESS, requestId, stage, percent });
    try {
      switch (msg.type) {
        case MSG.FILE_BEGIN: {
          const settings = migrateSettings(msg.settings).settings;
          if (msg.size > settings.maxFileSizeMB * 1024 * 1024) {
            throw new CoreError('TOO_LARGE', `Файл больше ${settings.maxFileSizeMB} МБ`, { limitMB: settings.maxFileSizeMB });
          }
          uploads.set(requestId, { begin: msg, assembler: new ChunkAssembler(msg) });
          progress('receiving', 0);
          return;
        }
        case MSG.FILE_CHUNK: {
          const u = uploads.get(requestId);
          if (!u) throw new CoreError('INTERNAL', 'Чанк без FILE_BEGIN');
          u.assembler.add(msg.index, msg.data);
          progress('receiving', Math.round((u.assembler.received / u.assembler.expected) * 100));
          return;
        }
        case MSG.ANALYZE:
          return await onAnalyze(msg, post, progress);
        case MSG.APPLY:
          return await onApply(msg, post, progress);
        case MSG.GET_TEXT: {
          const s = getSession(msg.docId);
          const r = getParagraphs(s.doc, s.groups, { part: msg.part, from: msg.from, count: msg.count });
          post({ type: MSG.TEXT, requestId, docId: msg.docId, ...r });
          return;
        }
        case MSG.ADD_ENTITY:
          return await onAddEntity(msg, post, progress);
        case MSG.DEANON: {
          const ref = msg.mappingRef;
          const mapping = typeof ref === 'string' ? getSession(ref).lastMapping : ref;
          if (!mapping) throw noMapping();
          // FR-37: склонение ФИО по контексту — только по явной просьбе клиента
          const r = deanonymize(msg.text || '', mapping, { decline: msg.decline === true });
          post({ type: MSG.DEANON_RESULT, requestId, text: r.text, unresolved: r.unresolved, replaced: r.replaced, declined: r.declined });
          return;
        }
        case MSG.GET_MAPPING: {
          // WP10-B (FR-36а): страница восстановления берёт карту сессии и восстанавливает файл у себя
          const mapping = getSession(msg.docId).lastMapping;
          if (!mapping) throw noMapping();
          post({ type: MSG.MAPPING, requestId, docId: msg.docId, mapping });
          return;
        }
        case MSG.DISCARD:
          sessions.delete(msg.docId);
          post({ type: MSG.ACK, requestId });
          return;
        case MSG.LIST_SESSIONS:
          post({ type: MSG.SESSIONS, requestId, sessions: [...sessions.values()].map(summarizeSession) });
          return;
        case MSG.BATCH_BEGIN: {
          const settings = migrateSettings(msg.settings).settings;
          const lang = resolvePlaceholderLanguage(settings.placeholderLanguage, 'ru');
          batches.set(msg.batchId, new PlaceholderAllocator(lang));
          post({ type: MSG.ACK, requestId, batchId: msg.batchId });
          return;
        }
        case MSG.BATCH_END:
          batches.delete(msg.batchId);
          post({ type: MSG.ACK, requestId });
          return;
        case MSG.CANCEL:
          uploads.delete(requestId);
          post({ type: MSG.ACK, requestId });
          return;
        case MSG.CATALOG_CHANGED:
          post({ type: MSG.ACK, requestId });
          return;
        case MSG.MODEL_CHANGED:
          resetNer();
          post({ type: MSG.ACK, requestId });
          return;
        case MSG.MODEL_INSTALL: {
          const job = installChain.then(() => onModelInstall(msg, post));
          installChain = job.catch(() => {});
          return await job;
        }
        default:
          throw new CoreError('INTERNAL', `Неизвестный тип сообщения ${msg.type}`);
      }
    } catch (err) {
      uploads.delete(requestId);
      post(errorMessage(requestId, err));
    }
  }

  async function onAnalyze(msg, post, progress) {
    const { requestId } = msg;
    const u = uploads.get(requestId);
    if (!u) throw new CoreError('INTERNAL', 'ANALYZE без файла');
    uploads.delete(requestId);
    const bytes = u.assembler.result();
    const settings = migrateSettings({ ...(msg.settings || {}), ...(msg.settingsOverride || {}) }).settings;
    const sha256 = u.begin.sha256 || (await sha256Hex(bytes));

    // §3.6: тот же файл в этой сессии браузера → прежние решения. Под другим именем — новый анализ (в имени могут быть данные:
    // «Кравченко_Ольга_Петровна.docx», ревью WP12-B), решения прежней сессии переносятся по ключу (категория + значение)
    let prior = null;
    for (const s of sessions.values()) {
      if (s.sha256 !== sha256) continue;
      if (s.name === u.begin.name) {
        post(entitiesMessage(requestId, s, true));
        return;
      }
      prior = s;
    }
    // Точка ветвления (версия 0.3): PDF — по сигнатуре %PDF- или по имени .pdf; иначе — адаптер формата по сигнатуре и имени
    // (DocumentAdapter, WP12-A). Не распознан: файл без имени — Word, как до 0.5 (разбор ответит NOT_DOCX), иначе NOT_SUPPORTED
    // (WP12-B). Excel, PowerPoint и текстовые форматы — модули по требованию: загрузка перед разбором (FORMAT_LOAD_FAILED при сбое)
    const name = u.begin.name || '';
    const pdf = isPdf(bytes) || /\.pdf$/i.test(name);
    const entry = pdf ? null : detectAdapter(bytes, name) || (name ? null : adapterForKind('docx'));
    if (!pdf && !entry) throw new CoreError('NOT_SUPPORTED', 'Формат файла не поддерживается');
    const kind = entry ? entry.kind : 'pdf';
    let doc;
    let adapter = null;
    if (!entry) doc = await parsePdf(bytes, u.begin.name, progress);
    else {
      progress('unzip', 0);
      adapter = await loadFormat(entry);
      doc = adapter.parse(bytes, name);
      // встроенные книги Excel (данные диаграмм, OLE) — тем же анализом и общей картой меток (core/embedded.js, ревью WP12-B)
      // и диаграммы Word (word/charts) — разметкой диаграммы из того же модуля Excel
      await attachEmbeddedBooks(doc, loadFormat);
      progress('parse', 100);
    }
    // имя файла — тоже данные: найденное в нём заменяется в имени результата (core/file-name.js)
    addFileNameStream(doc, name);
    const allocator = msg.batchId ? batches.get(msg.batchId) : undefined;
    const dictWarnings = await ensureDicts();
    const analysis = await analyze(doc, settings, { nerProvider: providerFor(settings), allocator, onProgress: progress });
    analysis.warnings.push(...dictWarnings, ...formatWarnings(adapter, doc, analysis.groups));
    const docId = `d${++docSeq}`;
    if (prior) {
      const prev = new Map(prior.groups.map((g) => [`${g.category}\u0000${g.normalized}`, g]));
      analysis.groups = analysis.groups.map((g) => {
        const p = prev.get(`${g.category}\u0000${g.normalized}`);
        return p ? { ...g, enabled: p.enabled, replacement: p.replacement } : g;
      });
    }
    const session = {
      docId,
      kind,
      name: u.begin.name,
      sha256,
      size: bytes.length,
      origin: u.begin.origin || undefined,
      batchId: msg.batchId,
      doc,
      analysis,
      groups: analysis.groups,
      settings,
      userEntities: [],
      createdAt: Date.now(),
      lastMapping: null,
    };
    sessions.set(docId, session);
    post(entitiesMessage(requestId, session, !!prior));
  }

  async function onAddEntity(msg, post, progress) {
    const s = getSession(msg.docId);
    const found = msg.replaceAll === false ? [] : findOccurrences(s.doc, msg.text, { wholeWord: true });
    const explicit = msg.streamId != null ? [{ streamId: msg.streamId, start: msg.start, end: msg.end }] : [];
    for (const f of [...explicit, ...found]) {
      s.userEntities.push({ streamId: f.streamId, start: f.start, end: f.end, category: msg.category, confidence: 'labeled', source: 'user' });
    }
    // Переанализ с сохранением решений по ключу (категория + нормализованное значение)
    const prev = new Map(s.groups.map((g) => [`${g.category}\u0000${g.normalized}`, g]));
    const allocator = s.batchId ? batches.get(s.batchId) : undefined;
    const dictWarnings = await ensureDicts();
    const analysis = await analyze(s.doc, s.settings, {
      nerProvider: providerFor(s.settings),
      allocator,
      userEntities: s.userEntities,
      onProgress: progress,
    });
    analysis.warnings.push(...dictWarnings, ...formatWarnings(adapterForKind(s.doc.kind), s.doc, analysis.groups));
    s.analysis = analysis;
    s.groups = analysis.groups.map((g) => {
      const p = prev.get(`${g.category}\u0000${g.normalized}`);
      return p ? { ...g, enabled: p.enabled, replacement: p.replacement } : g;
    });
    post(entitiesMessage(msg.requestId, s, false));
  }

  async function onApply(msg, post, progress) {
    const { requestId } = msg;
    const s = getSession(msg.docId);
    const settings = migrateSettings({ ...(msg.settings || {}), ...(s.settings || {}) }).settings;
    s.groups = mergeDecisions(s.groups, msg.decisions || []);
    progress('apply', 0);
    const opts = msg.options || {};
    // PDF → текст (версия 0.3): .anon.md или .anon.txt по pdfMode настроек сессии
    const textFormat = settings.pdfMode === 'text' ? 'txt' : 'md';
    // книга или презентация без расширения в имени (распознана по содержимому) — расширение формата, а не .docx (WP12-B)
    const ext = s.kind === 'pdf' ? `.${textFormat}` : (s.kind === 'xlsx' || s.kind === 'pptx') && !RESULT_EXT_RE.test(s.name || '') ? `.${s.kind}` : '';
    const document = { name: s.name, sha256: s.sha256, resultName: '' };
    const r = applyDecisions(s.doc, s.groups, {
      mode: msg.mode || settings.mode,
      placeholderLanguage: s.analysis.placeholderLanguage,
      language: s.analysis.language,
      keepMetadata: opts.keepMetadata ?? settings.keepMetadata,
      stripEmbedded: opts.stripEmbedded ?? settings.stripEmbedded,
      // скрытые данные (WP12-D): выбор панели в APPLY.options.hidden, иначе — из настроек (по умолчанию ничего не удаляется)
      hidden: opts.hidden ?? hiddenFlagsFrom(settings),
      document,
      toolVersion: env.toolVersion,
      textFormat,
    });
    // имя результата — по имени файла с метками вместо найденного в нём (если нашлось); карта получает его же
    const resultName = makeResultName(r.fileName || s.name, settings.outputSuffix, ext ? { ext } : {});
    document.resultName = resultName;
    s.lastMapping = r.mapping;
    progress('zip', 100);
    postChunked(post, { requestId, kind: 'RESULT', bytes: r.bytes, meta: { name: resultName, docId: s.docId, mime: r.mime } });
    post({ type: MSG.RESULT_END, requestId, docId: s.docId, mapping: r.mapping, stats: r.stats });
  }

  /**
   * PDF → текстовая модель (версия 0.3): извлечение и разметка в env.extractPdf (pdf.js в воркере), затем fromText.
   * Без сигнатуры %PDF- — PDF_INVALID; без extractPdf (сборка без pdf.js) — INTERNAL.
   */
  async function parsePdf(bytes, name, progress) {
    if (!isPdf(bytes)) throw new CoreError('PDF_INVALID', 'Файл повреждён или не является PDF');
    if (!env.extractPdf) throw new CoreError('INTERNAL', 'PDF недоступен');
    progress('pdf', 0);
    const layout = await env.extractPdf(bytes, { onProgress: (p) => progress('pdf', p) });
    const doc = fromText(layout.blocks, { name, size: bytes.length, format: 'pdf' });
    doc.warnings.push(...(layout.warnings || []));
    progress('parse', 100);
    return doc;
  }

  /**
   * Модуль формата по требованию (Excel, PowerPoint, текстовые форматы — offscreen/chunks/, WP12-B): сбой загрузки — понятная
   * ошибка FORMAT_LOAD_FAILED (панель предлагает повторить; сбой не кэшируется). Word — сразу.
   */
  async function loadFormat(entry) {
    try {
      return await (env.loadAdapter || loadAdapter)(entry);
    } catch {
      throw new CoreError('FORMAT_LOAD_FAILED', 'Не удалось загрузить модуль обработки формата');
    }
  }

  /** Предупреждения формата по найденному (Excel: ячейка в формулах, литералы формул, имя листа; JSON: число станет строкой). */
  function formatWarnings(adapter, doc, groups) {
    try {
      return adapter?.analysisWarnings ? adapter.analysisWarnings(doc, groups) : [];
    } catch {
      return [];
    }
  }

  /**
   * Словари ФИО загружены (или загружаются) — дождаться. Не загрузились (нет файла, битый формат) — анализ идёт без словарного
   * детектора (списки пустые, курируемые имена lexicon.js на месте) и каждый анализ получает предупреждение DICT_FAILED
   * {details: {reason}} (сбой окончательный на жизнь воркера, names/dict/load.js). Значений из словарей и документа в нём нет (NFR-14).
   * @returns {Promise<{code: string, details: {reason: string}}[]>}
   */
  async function ensureDicts() {
    const r = await loadDicts(readDict);
    return r.ok ? [] : [{ code: 'DICT_FAILED', details: { reason: r.reason } }];
  }

  /**
   * Провайдер NER для этих настроек: без включённого NER, выбранной модели или фабрики — нет провайдера (этап пропускается).
   * Фабрика синхронная и не читает модель: загрузка — в provider.init() внутри analyze, её сбой — предупреждение NER_FAILED.
   */
  function providerFor(settings) {
    if (env.nerProvider) return env.nerProvider;
    if (!settings.nerEnabled || !settings.nerModel || !env.createNerProvider) return undefined;
    if (ner?.modelId !== settings.nerModel) {
      resetNer();
      ner = { modelId: settings.nerModel, provider: env.createNerProvider(settings) };
    }
    return ner.provider;
  }

  /**
   * Встроенная модель NER (WP10-C, Ц7, docs/contracts.md §6.8): zip из архива расширения → проверка → OPFS.
   * Ставится только проверенный пакет (sha256 из KNOWN_PACKS) с теми id и sha, что запечены в сборку; чужие пакеты
   * в хранилище не трогаются (выбор пользователя — забота background и страницы настроек). Ответ — MODEL_INSTALLED.
   * Ошибки хранилища/чтения → status 'failed' с кодом ModelStoreError; прочее — ERROR.
   */
  async function onModelInstall(msg, post) {
    const { requestId } = msg;
    if (!env.modelStore || !env.readPackageFile) throw new CoreError('INTERNAL', 'Установка встроенной модели недоступна');
    const base = { type: MSG.MODEL_INSTALLED, requestId, id: msg.id, sha256: msg.sha256, version: msg.version };
    const failed = (code) => post({ ...base, status: 'failed', code });
    const t0 = Date.now();
    try {
      // тот же пакет уже стоит (повторный запуск, ручной импорт того же zip) — файлы не переписываем
      const list = await env.modelStore.listInstalled();
      if (list.some((m) => m.id === msg.id && m.packSha256 === msg.sha256)) {
        post({ ...base, status: 'present' });
        return;
      }
      const bytes = await env.readPackageFile(msg.url);
      const info = await env.modelStore.inspectPack(bytes, { extensionVersion: msg.extensionVersion });
      if (info.verified !== true) return failed('UNVERIFIED');
      if (info.packSha256 !== msg.sha256 || info.manifest?.id !== msg.id) return failed('MISMATCH');
      const rec = await env.modelStore.install(bytes, { verified: true, extensionVersion: msg.extensionVersion });
      resetNer(); // как MODEL_CHANGED: следующий анализ создаст провайдер по новым файлам
      post({ ...base, status: 'installed', version: rec.version ?? msg.version, bytes: rec.bytes, ms: Date.now() - t0 });
    } catch (e) {
      if (e instanceof ModelStoreError) return failed(e.code);
      throw e;
    }
  }

  function resetNer() {
    try {
      ner?.provider?.dispose?.();
    } catch {
      /* освобождение модели не должно ронять хост */
    }
    ner = null;
  }

  function getSession(docId) {
    const s = sessions.get(docId);
    // reason — для клиента (страница восстановления различает случаи по нему, а не по тексту сообщения)
    if (!s) throw Object.assign(new CoreError('INTERNAL', 'Сессия документа не найдена — загрузите файл заново'), { reason: 'NO_SESSION' });
    return s;
  }

  /** Сессия есть, но APPLY ещё не было — карты нет. */
  function noMapping() {
    return Object.assign(new CoreError('INTERNAL', 'Маппинг не найден: сначала примените замены'), { reason: 'NO_MAPPING' });
  }

  function entitiesMessage(requestId, s, restored) {
    return {
      type: MSG.ENTITIES,
      requestId,
      docId: s.docId,
      name: s.name,
      kind: s.kind,
      language: s.analysis.language,
      placeholderLanguage: s.analysis.placeholderLanguage,
      entities: s.groups.map((g) => toProtocolEntity(s.doc, g)),
      warnings: s.analysis.warnings,
      stats: s.analysis.stats,
      restoredDecisions: restored,
      // что скрыто в документе (комментарии, история правок, скрытый текст, листы, строки, слайды — WP12-D); у PDF и текста нет
      ...(s.doc.hidden ? { hidden: s.doc.hidden } : {}),
    };
  }

  return { handle, sessions };
}

/** EntityGroup → сущность сообщения ENTITIES (§5.4). */
export function toProtocolEntity(doc, g) {
  return {
    id: g.id,
    category: g.category,
    value: g.value,
    normalized: g.normalized,
    placeholder: g.placeholder,
    replacement: g.replacement,
    level: g.level,
    source: g.source,
    validated: g.validated,
    enabled: g.enabled,
    occurrences: g.occurrences.map((o) => ({
      id: o.id,
      part: o.part,
      pid: o.pid,
      streamId: o.streamId,
      stream: o.stream,
      start: o.start,
      end: o.end,
      text: o.text,
      context: occurrenceContext(doc, o),
      variantOf: o.variantOf,
    })),
  };
}

/** Расширения файлов, которые обрабатывает расширение (результат — тот же формат, WP12-B). */
const RESULT_EXT_RE = /\.(docx|docm|xlsx|xlsm|pptx|pptm|txt|log|md|csv|json)$/i;

/**
 * 'договор.docx' → 'договор.anon.docx', 'реестр.xlsx' → 'реестр.anon.xlsx'; с `ext` (PDF, версия 0.3): 'договор.pdf' → 'договор.anon.md'.
 * Без известного расширения — '.docx', как до 0.5.
 * @param {string} name @param {string} [suffix] @param {{ext?: string}} [opts]
 */
export function makeResultName(name, suffix = '.anon', opts = {}) {
  if (opts.ext) {
    const base = String(name || 'document').replace(/\.(docx|docm|pdf)$/i, '') || 'document';
    return `${base}${suffix}${opts.ext}`;
  }
  const n = name || 'document.docx';
  const m = RESULT_EXT_RE.exec(n);
  const base = (m ? n.slice(0, m.index) : n) || 'document';
  return `${base}${suffix}${m ? m[0] : '.docx'}`;
}

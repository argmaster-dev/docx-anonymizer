// Конвейер анализа: потоковые детекторы → авторы → NER → документные детекторы (KB)
// → фильтр уровней → пересечения → группировка и плейсхолдеры.
import { buildCatalog, isCategoryEnabled, normalizeValue } from '../categories.js';
import { getDetectors, getDocumentDetectors } from '../contracts/detector.js';
import { NER_LABEL_TO_CATEGORY } from '../contracts/ner.js';
import { createOrgFilterContext, filterOrgSpans } from '../ner/filters.js';
import { filterPersonLocSpans, orgStreetsAsLoc } from '../ner/filters-pl.js';
import { resolveOverlaps } from './overlap.js';
import { tableHeaders } from './tables.js';
import { PlaceholderAllocator, resolvePlaceholderLanguage } from '../placeholders.js';

const BOUNDARY_RE = /[\n\uFFFC]/;
const AUTHOR_KINDS = new Set(['author', 'initials', 'author-id']);
/**
 * Метка-заглушка в двойных квадратных скобках — пример замены в тексте, а не значение: «⟦ORG_1⟧», «⟦ORG_1.ACC⟧», «⟦ФИО_2⟧»,
 * «⟦AMT_1⟧». Только код категории — префикс плейсхолдера каталога (ru/en, и пользовательских категорий) или общий код меток
 * (`LABEL_CODES`) — заглавными, «_», номер и, может быть, «.ПОЛЕ» из закрытого списка `FIELD_CODES` (доработка 0.5 по прогону КП:
 * модель делала из «ORG» и «ACC» организации). «⟦СУММА_1.ИВАНОВ_ПЕТР⟧», «⟦ФИО_1.ПЕТРОВ⟧» — не заглушки (повторное ревью); у кода лица
 * («ФИО», «PER», «PERSON», «NAME») такое «поле» само — ФИО, `labeled` (`personInToken`). «⟦ИВАНОВ⟧», «⟦IVANOV_1⟧», «⟦Петров_2⟧», «⟦А123ВС77⟧» — не заглушки: маскируются (ревью доработки).
 * `text-view.js` оборачивает в «⟦…⟧» само значение в строке контекста — такая строка, вставленная в документ, тоже не заглушка.
 */
const LABEL_CODES = ['ORG', 'PER', 'PERSON', 'LOC', 'ADDR', 'AMT', 'ACC', 'MISC', 'NAME', 'DATE', 'PHONE', 'EMAIL', 'INN', 'KPP'];
/** Поля меток-заглушек («⟦ORG_1.ACC⟧», «⟦ORG_1.INN⟧»): закрытый список кодов реквизитов. */
const FIELD_CODES = [
  ...['INN', 'KPP', 'OGRN', 'OGRNIP', 'ACC', 'ACCOUNT', 'BIK', 'SWIFT', 'IBAN', 'ADDR', 'ADDRESS', 'PHONE', 'EMAIL', 'DATE', 'AMT', 'NAME'],
  ...['ИНН', 'КПП', 'ОГРН', 'ОГРНИП', 'СЧЕТ', 'СЧЁТ', 'БИК', 'АДРЕС', 'ТЕЛ', 'ТЕЛЕФОН', 'ДАТА', 'СУММА'],
];
/** Коды лица: «поле» не из списка внутри такой заглушки — ФИО («⟦ФИО_1.ПЕТРОВ⟧»). */
const PERSON_CODES = ['ФИО', 'PER', 'PERSON', 'NAME'];
const PERSON_FIELD_RE = new RegExp(`⟦(?:${PERSON_CODES.join('|')})_\\d+\\.([\\p{L}][\\p{L}_-]*)⟧`, 'gu');
const FIELD_SET = new Set(FIELD_CODES);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Регулярка меток-заглушек для каталога (кэш на каталог). @type {WeakMap<object, RegExp>} */
const labelTokenRes = new WeakMap();
function labelTokenRe(catalog) {
  let re = labelTokenRes.get(catalog);
  if (!re) {
    const codes = new Set(LABEL_CODES);
    for (const c of catalog.byId.values())
      for (const p of [c.placeholderPrefix?.ru, c.placeholderPrefix?.en]) if (p && /^[\p{Lu}\p{N}_]+$/u.test(p)) codes.add(p);
    const alt = [...codes]
      .sort((x, y) => y.length - x.length)
      .map(escRe)
      .join('|');
    re = new RegExp(`⟦(?:${alt})_\\d+(?:\\.(?:${FIELD_CODES.map(escRe).join('|')}))?⟧`, 'gu');
    labelTokenRes.set(catalog, re);
  }
  return re;
}

/**
 * Кандидаты ФИО из «поля» заглушки лица, которого нет в `FIELD_CODES`: «⟦ФИО_1.ПЕТРОВ⟧» → «ПЕТРОВ» (`labeled`).
 * @param {string} text
 */
function personInToken(text) {
  const out = [];
  for (const m of text.matchAll(PERSON_FIELD_RE)) {
    if (FIELD_SET.has(m[1])) continue;
    const start = /** @type {number} */ (m.index) + m[0].length - 1 - m[1].length;
    out.push({ start, end: start + m[1].length, confidence: 'labeled' });
  }
  return out;
}

/**
 * @typedef {object} AnalyzeOptions
 * @property {import('../contracts/ner.js').NerProvider} [nerProvider]
 * @property {PlaceholderAllocator} [allocator]  общий для партии файлов
 * @property {(stage: string, percent: number) => void} [onProgress]
 * @property {import('../contracts/entity.js').Entity[]} [userEntities]  сущности source='user' (ADD_ENTITY)
 */

/**
 * @typedef {object} AnalyzeResult
 * @property {'ru'|'en'|'both'} language
 * @property {'ru'|'en'} placeholderLanguage
 * @property {import('../contracts/entity.js').Entity[]} entities      после разрешения пересечений
 * @property {import('../contracts/entity.js').EntityGroup[]} groups
 * @property {{code: string, count?: number, details?: object}[]} warnings
 * @property {{streams: number, virtualTextLength: number, entities: number, occurrences: number}} stats
 */

/**
 * @param {import('../docx/model.js').DocModel} doc
 * @param {object} settings эффективные настройки (migrateSettings уже применён)
 * @param {AnalyzeOptions} [opts]
 * @returns {Promise<AnalyzeResult>}
 */
export async function analyze(doc, settings, opts = {}) {
  const progress = opts.onProgress || (() => {});
  const catalog = buildCatalog(settings);
  const language = settings.language && settings.language !== 'auto' ? settings.language : doc.language;
  const isEnabled = (id) => {
    const c = catalog.byId.get(id);
    return !!c && isCategoryEnabled(c, settings);
  };
  const warnings = [...doc.warnings];
  const tokenRe = labelTokenRe(catalog);
  /** @type {Map<string, [number, number][]>} */
  const tokenSpans = new Map();
  /** Кандидат целиком внутри метки-заглушки «⟦…⟧» потока (FR-60, FR-61). */
  const insideLabelToken = (stream, start, end) => {
    let spans = tokenSpans.get(stream.id);
    if (!spans) {
      spans = stream.text.includes('⟦')
        ? [...stream.text.matchAll(tokenRe)].map((m) => [/** @type {number} */ (m.index), /** @type {number} */ (m.index) + m[0].length])
        : [];
      tokenSpans.set(stream.id, spans);
    }
    return spans.some(([a, b]) => start >= a && end <= b);
  };
  /** @type {import('../contracts/entity.js').Entity[]} */
  const raw = [];
  let seq = 0;

  const accept = (cand, category, stream, defaultSource) => {
    const cat = catalog.byId.get(category);
    if (!cat) return;
    const source = cand.source || defaultSource;
    // Политика 0.4 (Ц1, К3): выключенная категория не отбрасывает то, о чём пользователь попросил явно — сущности,
    // добавленные вручную (user), и компании из списка для маскирования (list); уровни для них тоже не проверяются
    const explicit = source === 'user' || source === 'list';
    if (!explicit && !isEnabled(category)) return;
    if (!explicit && !cat.allowedLevels.includes(cand.confidence)) return;
    // находка модели внутри метки-заглушки «⟦ORG_1.ACC⟧» — не сущность (правила идентификаторов не трогаются)
    if (source === 'ner' && insideLabelToken(stream, cand.start, cand.end)) return;
    if (!Number.isInteger(cand.start) || !Number.isInteger(cand.end) || cand.start < 0 || cand.end > stream.text.length || cand.end <= cand.start) return;
    const text = stream.text.slice(cand.start, cand.end);
    if (BOUNDARY_RE.test(text)) return;
    const keepPrefix = cand.keepPrefix || 0;
    const keepSuffix = cand.keepSuffix || 0;
    if (keepPrefix + keepSuffix >= text.length) return;
    const core = text.slice(keepPrefix, text.length - keepSuffix);
    raw.push({
      id: `c${seq++}`,
      category,
      text,
      normalized: cand.canonical ? normalizeValue(cat, cand.canonical) : normalizeValue(cat, core),
      start: cand.start,
      end: cand.end,
      streamId: stream.id,
      source,
      confidence: cand.confidence,
      validator: cand.validator,
      enabled: true,
      keepPrefix,
      keepSuffix,
      canonical: cand.canonical,
      subtype: cand.subtype,
      score: cand.score,
    });
  };

  // 1. Потоковые детекторы
  progress('detect', 0);
  const detectors = getDetectors();
  const total = doc.streams.length || 1;
  // заголовки таблицы для ячеек (detect/tables.js): столбца — «Код ТН ВЭД» над числом — код товара, а не ИНН (WP11-D);
  // строки — ячейка-метка слева: «Дата рождения | 17.11.1993» — значение помечено (WP11-E)
  const headers = tableHeaders(doc);
  doc.streams.forEach((stream, i) => {
    if (stream.type === 'attr' && AUTHOR_KINDS.has(stream.attrKind || '')) return;
    const info = {
      id: stream.id,
      part: stream.part,
      pid: stream.pid,
      type: stream.type,
      attrKind: stream.attrKind,
      columnHeader: headers.column.get(stream.pid),
      rowHeader: headers.row.get(stream.pid),
    };
    for (const [categoryId, list] of detectors) {
      if (!isEnabled(categoryId)) continue;
      const category = /** @type {any} */ (catalog.byId.get(categoryId));
      for (const d of list) {
        let cands;
        try {
          cands = d.fn(stream.text, { stream: info, language, category, catalog, settings }) || [];
        } catch (err) {
          warnings.push({ code: 'DETECTOR_FAILED', details: { detector: d.name } });
          continue;
        }
        for (const c of cands) accept(c, categoryId, stream, 'rule');
      }
    }
    if (i % 200 === 0) progress('detect', Math.round((i / total) * 100));
  });

  // 1б. «Поле» не из списка в заглушке лица: «⟦ФИО_1.ПЕТРОВ⟧» — ФИО (повторное ревью доработки 0.5, fail-closed)
  for (const s of doc.streams) if (s.text?.includes('⟦')) for (const c of personInToken(s.text)) accept(c, 'PERSON', s, 'rule');

  // 2. Авторы правок и комментариев (FR-11)
  if (isEnabled('PERSON')) {
    const personCat = /** @type {any} */ (catalog.byId.get('PERSON'));
    for (const s of doc.streams) {
      if (s.type !== 'attr' || !AUTHOR_KINDS.has(s.attrKind || '')) continue;
      if (s.attrKind === 'author') {
        accept({ start: 0, end: s.text.length, confidence: 'validated', subtype: 'author' }, 'PERSON', s, 'rule');
      } else if (s.linkedTo) {
        const author = doc.streamById.get(s.linkedTo);
        if (author) {
          accept(
            { start: 0, end: s.text.length, confidence: 'validated', subtype: s.attrKind, canonical: normalizeValue(personCat, author.text) },
            'PERSON',
            s,
            'rule',
          );
        }
      }
    }
  }

  // 3. NER (§5.2 NLP): провайдер — из пакета модели (WP8/WP9); сбой не прерывает анализ (NFR-13).
  // Ошибка загрузки модели (CoreError MODEL_LOAD_FAILED) не уходит клиенту как ERROR — только как причина предупреждения.
  if (settings.nerEnabled && opts.nerProvider) {
    progress('ner', 0);
    try {
      await opts.nerProvider.init();
      const live = doc.streams.filter((s) => s.type === 'live');
      // Политика 0.4 (концепция п. 4, К10): у ORG свой порог и фильтр ложных организаций; вид блока (заголовок,
      // пункт списка, ячейка) приходит из paragraph.kind (DOCX: w:pStyle/w:numPr, PDF: разметка)
      const wantOrg = isEnabled('COMPANY');
      // контекст документа — общий для фильтров ORG и PER/LOC (стоп-список, ячейки DOCX), строится один раз
      const nerCtx = createOrgFilterContext(doc, settings);
      const kindByPid = new Map(doc.paragraphs.map((p) => [p.pid, p.kind]));
      const thresholdFor = (label) => (label === 'ORG' ? (settings.nerThresholdOrg ?? 0.85) : (settings.nerThreshold ?? 0.7));
      for (let i = 0; i < live.length; i++) {
        const s = live[i];
        // ORG модели перед номером дома («на Профсоюзную 104») — улица: кандидат LOC → ADDRESS, порог — как у LOC (WP11-D)
        let spans = orgStreetsAsLoc(await opts.nerProvider.detect(s.text, { language }), s.text).filter((sp) => sp.score >= thresholdFor(sp.label));
        const blockKind = kindByPid.get(s.pid);
        if (wantOrg && spans.some((sp) => sp.label === 'ORG')) {
          const others = spans.filter((sp) => sp.label !== 'ORG');
          const orgs = filterOrgSpans(
            spans.filter((sp) => sp.label === 'ORG'),
            { ...nerCtx, text: s.text, blockKind },
          );
          spans = [...others, ...orgs];
        }
        // WP11-D: ложные PER/LOC модели (формулы вежливости, служебные слова, продукты; LOC вне адреса — не ПДн)
        if (spans.some((sp) => sp.label === 'PER' || sp.label === 'LOC'))
          spans = filterPersonLocSpans(spans, { ...nerCtx, text: s.text, blockKind, columnHeader: headers.column.get(s.pid) });
        for (const sp of spans) {
          const cat = NER_LABEL_TO_CATEGORY[sp.label];
          if (cat) accept({ start: sp.start, end: sp.end, confidence: 'ner', source: 'ner', score: sp.score }, cat, s, 'ner');
        }
        if (i % 50 === 49) progress('ner', Math.round(((i + 1) / live.length) * 100));
      }
    } catch (err) {
      const reason = /** @type {any} */ (err)?.code === 'MODEL_LOAD_FAILED' ? 'MODEL_LOAD_FAILED' : 'INFERENCE_FAILED';
      warnings.push({ code: 'NER_FAILED', details: { reason } });
    }
    progress('ner', 100);
  }

  // 4. Документные детекторы (KB сторон, FR-22–23)
  progress('kb', 0);
  for (const d of getDocumentDetectors()) {
    let cands;
    try {
      cands = d.fn(doc, raw.slice(), { language, catalog, settings, isEnabled }) || [];
    } catch (err) {
      warnings.push({ code: 'DETECTOR_FAILED', details: { detector: d.name } });
      continue;
    }
    for (const c of cands) {
      const s = c.streamId ? doc.streamById.get(c.streamId) : null;
      if (s && c.category) accept(c, c.category, s, 'kb');
    }
  }
  // 5. Пользовательские сущности
  for (const u of opts.userEntities || []) {
    const s = doc.streamById.get(u.streamId);
    if (s) accept({ ...u, source: 'user' }, u.category, s, 'user');
  }
  progress('kb', 100);

  // 6. Пересечения
  const entities = resolveOverlaps(raw, catalog);

  // 7. Исключения пользователя (FR-32)
  const excluded = new Set((settings.exclusions || []).map((x) => `${x.category}\u0000${normalizeValue(catalog.byId.get(x.category), x.value || '')}`));
  const kept = entities.filter((e) => !excluded.has(`${e.category}\u0000${e.normalized}`));

  // 8. Группировка
  const phLang = resolvePlaceholderLanguage(settings.placeholderLanguage, language === 'both' ? 'ru' : language);
  const allocator = opts.allocator || new PlaceholderAllocator(phLang);
  const groups = groupEntities(doc, kept, catalog, allocator);

  let vlen = 0;
  for (const s of doc.streams) vlen += s.text.length;
  return {
    language,
    placeholderLanguage: allocator.lang,
    entities: kept,
    groups,
    warnings,
    stats: { streams: doc.streams.length, virtualTextLength: vlen, entities: groups.length, occurrences: kept.length },
  };
}

/**
 * Группирует сущности по (категория, canonical|normalized) в порядке обхода FR-25 и назначает плейсхолдеры.
 * @param {import('../docx/model.js').DocModel} doc
 * @param {import('../contracts/entity.js').Entity[]} entities
 * @param {{byId: Map<string, any>}} catalog
 * @param {PlaceholderAllocator} allocator
 * @returns {import('../contracts/entity.js').EntityGroup[]}
 */
export function groupEntities(doc, entities, catalog, allocator) {
  const ordered = [...entities].sort((a, b) => {
    const sa = /** @type {any} */ (doc.streamById.get(a.streamId)).order;
    const sb = /** @type {any} */ (doc.streamById.get(b.streamId)).order;
    return sa - sb || a.start - b.start;
  });
  /** @type {Map<string, import('../contracts/entity.js').EntityGroup & {_base?: boolean}>} */
  const groups = new Map();
  let occSeq = 0;
  for (const e of ordered) {
    const key = `${e.category}\u0000${e.normalized}`;
    let g = groups.get(key);
    const s = /** @type {any} */ (doc.streamById.get(e.streamId));
    const core = e.text.slice(e.keepPrefix, e.text.length - e.keepSuffix);
    if (!g) {
      const cat = catalog.byId.get(e.category);
      g = {
        id: `e${groups.size + 1}`,
        category: e.category,
        value: core,
        normalized: e.normalized,
        placeholder: allocator.get(cat, e.normalized),
        level: e.confidence,
        source: e.source,
        validated: e.validator || null,
        enabled: true,
        occurrences: [],
        _base: !e.canonical,
      };
      groups.set(key, g);
    } else {
      if (rank(e.confidence) < rank(g.level)) g.level = e.confidence;
      if (!g.validated && e.validator) g.validated = e.validator;
      if (!g._base && !e.canonical) {
        // основная форма — первое вхождение, которое не является вариантом
        g.value = core;
        g.source = e.source;
        g._base = true;
      }
    }
    g.occurrences.push({
      id: `o${++occSeq}`,
      streamId: e.streamId,
      part: s.part,
      pid: s.pid,
      stream: s.type,
      start: e.start,
      end: e.end,
      text: e.text,
      keepPrefix: e.keepPrefix,
      keepSuffix: e.keepSuffix,
      source: e.source,
      confidence: e.confidence,
    });
  }
  const out = [...groups.values()];
  for (const g of out) {
    delete g._base;
    for (const o of g.occurrences) {
      const core = o.text.slice(o.keepPrefix, o.text.length - o.keepSuffix);
      if (core !== g.value) o.variantOf = g.value;
    }
  }
  return out;
}

const RANKS = { validated: 0, labeled: 1, kb: 2, ner: 3, weak: 4 };
function rank(l) {
  return RANKS[l] ?? 9;
}

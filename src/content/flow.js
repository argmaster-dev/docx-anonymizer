// Сценарий одной перехваченной отправки (§3.2, §3.4–3.7): анализ → панель → применение → результат.
// Возвращает решение интерсептору: что передать сайту.
import { Panel } from '../ui/panel/panel.js';
import { buildCatalog } from '../core/categories.js';
import { mergeMappings } from '../core/mapping.js';
import { resolveUiLanguage, createT } from '../ui/i18n/index.js';
import { common } from '../ui/i18n/common.js';
import { panel as panelDict } from '../ui/i18n/panel.js';
import { MSG, ProtocolError, makeRequestId } from '../shared/protocol.js';
import { saveSettingsPatch } from '../shared/settings-store.js';
import {
  isSupported,
  isPdfFile,
  resultType,
  mappingFileName,
  isInvalidatedError,
  makeResultName,
  neutralName,
  uniqueResultName,
  isKeyFileName,
  sniffRecoveryKey,
  extOf,
} from './files.js';
import { Link, contextValid, readOpenShadowFlag } from './runtime.js';
import { exclusionValue } from '../ui/preview/model.js';
import { shouldShowOrgPolicyHint, withMaskedCompany } from '../ui/panel/org-policy.js';
import { HIDDEN_SETTINGS, hiddenFlagsFrom } from '../core/settings.js';

/**
 * @typedef {{action: 'anonymized'|'original'|'cancel', files: File[]}} FlowResult
 */

/** Подсказка «установите модель NER» закрыта крестиком (WP10-C, К16): до перезагрузки страницы больше не показывается. */
let nerHintDismissed = false;
/** Полная сборка (WP10-C): модель ставится сама — подсказку об установке в панели не показываем. define из scripts/build.mjs. */
const BUNDLED = typeof __BUNDLED_MODEL__ !== 'undefined' ? __BUNDLED_MODEL__ : null;

/**
 * @param {{getSettings: () => import('../core/settings.js').Settings, onInvalidated?: () => void}} deps
 */
export function createFlow(deps) {
  let queue = Promise.resolve();
  let busy = 0;

  return {
    get busy() {
      return busy > 0;
    },
    /**
     * Перехваченные файлы → решение. Вызовы выстраиваются в очередь: панель одна.
     * @param {File[]} originals
     * @param {boolean[]} [pass]  pass[i] — файл уходит без панели (наш результат, список «не спрашивать»; интерсептор)
     * @returns {Promise<FlowResult>}
     */
    run(originals, pass = []) {
      busy++;
      const p = queue.then(() => runOnce(originals, deps, pass)).finally(() => busy--);
      queue = p.catch(() => {});
      return p;
    },
  };
}

/** @returns {Promise<FlowResult>} */
async function runOnce(originals, deps, pass) {
  const settings = deps.getSettings();
  const lang = resolveUiLanguage(settings.uiLanguage);
  const tt = createT({ ru: { ...common.ru, ...panelDict.ru }, en: { ...common.en, ...panelDict.en } }, lang);
  const origin = location.origin;
  const catalog = buildCatalog(settings);
  const link = new Link();
  const openShadow = await readOpenShadowFlag();
  // файлы панели — все, кроме pass (0.5.2, FR-04б): обрабатываются DOCX, PDF (если pdfMode не 'off', версия 0.3), Excel, PowerPoint и
  // текстовые (0.5); остальные (unsup) — строка-отказ «Формат не проверяется» с «Загрузить как есть», без выбора не уходят
  const procIdx = originals.map((_, i) => i).filter((i) => !pass[i]);
  const unsup = new Set(procIdx.filter((i) => !isSupported(originals[i], settings)));
  const anaIdx = procIdx.filter((i) => !unsup.has(i));
  const batchId = anaIdx.length > 1 ? makeRequestId('b') : null;

  /** @type {Map<number, {docId: string, k: number}>} */
  const analyzed = new Map();
  // 0.5.1: ключ восстановления (карта замен с настоящими значениями) по содержимому узнаёт хост — код RECOVERY_KEY
  // (core/recovery-key.js). Такой файл не уходит на сайт ни при каком выборе: ни обезличенным, ни «как есть», ни «оригиналом»
  // (в том числе при инвалидации контекста). Файл с именем ключа (*.mapping.json) не уходит, пока хост не разобрал его без отказа.
  const keys = new Set();
  const blocked = (i) => keys.has(i) || (isKeyFileName(originals[i]) && !analyzed.has(i));
  /** что можно отдать сайту: всё, кроме ключей восстановления */
  const sendable = (files) => files.filter((_, i) => !blocked(i));
  // перехват сам, без хоста, проверяет начало каждого текстового и неподдерживаемого файла (те же правила, что у хоста): сбой хоста,
  // инвалидация контекста или лимит размера не откроют переименованному ключу путь «как есть» или «оригиналом»
  for (const i of procIdx) if (await sniffRecoveryKey(originals[i])) keys.add(i);
  let closed = false;
  let finish;
  const result = new Promise((res) => (finish = res));

  const discardAll = () => {
    if (!contextValid()) return;
    try {
      const c = link.get();
      for (const a of analyzed.values()) c.request(MSG.DISCARD, { docId: a.docId }).catch(() => {});
      if (batchId) c.request(MSG.BATCH_END, { batchId }).catch(() => {});
    } catch {
      /* контекст недоступен — сессии уйдут вместе с offscreen */
    }
  };
  const closePanel = () => {
    if (closed) return;
    closed = true;
    panel.destroy();
    link.close();
  };
  const decide = (action, files) => {
    finish({ action, files });
  };

  const handlers = {
    onCancel: () => {
      if (panel.phase !== 'done') {
        discardAll();
        decide('cancel', originals);
      }
      closePanel();
    },
    onOriginal: () => {
      discardAll();
      // ключи восстановления не уходят и «оригиналом»; если загружать нечего — как отмена
      const rest = sendable(originals);
      decide(rest.length ? 'original' : 'cancel', rest.length ? rest : originals);
      closePanel();
    },
    onAnonymize: () => applyAll(),
    onAsIs: () => panel.updateChrome(),
    onRetry: (i) => analyzeOne(i),
    onDisableSite: async () => {
      try {
        const cur = deps.getSettings();
        if (!cur.blocklist.includes(origin)) await saveSettingsPatch({ blocklist: [...cur.blocklist, origin] });
        panel.getPreview(panel.active)?.showToast(tt('siteDisabled', { host: location.host }));
      } catch (err) {
        if (isInvalidatedError(err)) invalidated();
      }
    },
    onPosition: (pos) => {
      try {
        const cur = deps.getSettings();
        saveSettingsPatch({ panelPosition: { ...cur.panelPosition, [origin]: pos } }).catch(() => {});
      } catch {
        /* контекст инвалидирован */
      }
    },
    onDismissNerHint: () => {
      nerHintDismissed = true;
    },
    // WP10-D: подсказка о ключе восстановления показывается один раз — флаг в настройках (localStorage — хранилище сайта)
    onMappingHintShown: () => {
      try {
        saveSettingsPatch({ hintMappingShown: true }).catch(() => {});
      } catch {
        /* контекст инвалидирован */
      }
    },
    // Политика 0.4: «Открыть настройки» из подсказки — вкладку открывает background (MSG.OPEN_OPTIONS)
    onOpenOptions: (section) => {
      try {
        link
          .get()
          .request(MSG.OPEN_OPTIONS, { section })
          .catch(() => {});
      } catch (err) {
        if (isInvalidatedError(err)) invalidated();
      }
    },
    // Политика 0.4: подсказка «организации — по желанию» показывается один раз — флаг снимается при показе
    onOrgPolicyHintShown: () => {
      try {
        saveSettingsPatch({ orgPolicyHintPending: false }).catch(() => {});
      } catch {
        /* контекст инвалидирован */
      }
    },
    // 0.5 (WP12-D, К8): «Сохранить с паролем…» — страницу расширения открывает background (MSG.OPEN_KEY_SAVE): пароль
    // вводится там, а не на сайте (слушатели клавиатуры страницы видели бы его); карту страница берёт у хоста по docId
    onSaveKeyProtected: (done) => {
      try {
        link
          .get()
          .request(MSG.OPEN_KEY_SAVE, { docIds: done.docIds, name: done.mappingName })
          .catch(() => {});
      } catch (err) {
        if (isInvalidatedError(err)) invalidated();
      }
    },
    // 0.5 (WP12-D): переключатели скрытых данных запоминаются в настройках (removeComments, acceptRevisions, …)
    onHiddenPref: (flag, value) => {
      try {
        const key = HIDDEN_SETTINGS[flag];
        if (key) saveSettingsPatch({ [key]: value }).catch(() => {});
      } catch {
        /* контекст инвалидирован */
      }
    },
  };

  // WP10-C: лёгкая сборка и модели нет — закрываемая подсказка в панели (в полной модель ставится сама или есть «Восстановить»)
  const nerHint = !BUNDLED && !settings.nerModel && !nerHintDismissed;
  const orgPolicyHint = shouldShowOrgPolicyHint(settings);
  // скрытые данные (WP12-D): выбор из настроек; по умолчанию всё выключено — документ меняется только по явному действию
  const hiddenPrefs = hiddenFlagsFrom(settings);
  const panel = new Panel({ lang, catalog, origin, position: settings.panelPosition?.[origin], openShadow, handlers, nerHint, orgPolicyHint, hiddenPrefs });
  panel.mount();

  function invalidated() {
    deps.onInvalidated?.();
    link.close();
    panel.showNotice({ title: tt('invalidatedTitle'), text: tt('invalidatedText'), allowOriginal: true });
  }

  function fail(i, err) {
    if (isInvalidatedError(err) || !contextValid()) return invalidated();
    const code = err instanceof ProtocolError ? err.code : 'INTERNAL';
    // ключ восстановления (узнан перехватом или хостом) и файл с именем ключа при любом сбое (и BATCH_BEGIN) — отказ без
    // «загрузить как есть» и «повторить»: иначе сбой хоста предложил бы отправить ключ как есть
    if (keys.has(i) || code === 'RECOVERY_KEY' || isKeyFileName(originals[i])) {
      keys.add(i);
      return failKey(i);
    }
    const limit = settings.maxFileSizeMB;
    // TOO_LARGE от разбора PDF — лимит страниц (details.pages), а не мегабайт (core/pdf/extract.js)
    const pages = code === 'TOO_LARGE' ? err.details?.pages : undefined;
    const known = pages ? tt('err.TOO_LARGE_PAGES', { pages, limit: err.details?.limitPages ?? '' }) : tt(`err.${code}`, { limit });
    panel.setError(procIdx.indexOf(i), {
      code,
      message: known.startsWith('err.') ? err.message : known,
      // модуль формата не загрузился (0.5, WP12-B) — можно повторить: сбой загрузки не кэшируется
      retry: code === 'HOST_UNAVAILABLE' || code === 'INTERNAL' || code === 'FORMAT_LOAD_FAILED',
    });
  }

  /**
   * Неподдерживаемый формат (0.5.2, FR-04б): строка-отказ с «Загрузить как есть», без «Повторить»; PDF при pdfMode 'off' — с указанием
   * на настройку. Текст называет только расширение — имени файла нет (в нём могут быть данные; имя и так видно на вкладке).
   */
  function failUnsupported(i) {
    const f = originals[i];
    const ext = extOf(f);
    const message = isPdfFile(f) ? tt('unsupportedPdfOff') : ext ? tt('unsupportedExt', { ext }) : tt('unsupportedNoExt');
    panel.setError(procIdx.indexOf(i), { code: 'UNSUPPORTED', message, retry: false, note: 'unsupportedNote', optional: true });
  }

  /** Ключ восстановления (0.5.1): отказ без «загрузить как есть» и без «повторить» — по образцу отказа для скана PDF. */
  function failKey(i) {
    panel.setError(procIdx.indexOf(i), { code: 'RECOVERY_KEY', message: tt('err.RECOVERY_KEY'), retry: false, blocked: true });
  }

  async function analyzeOne(i) {
    const k = procIdx.indexOf(i);
    const file = originals[i];
    if (keys.has(i)) return failKey(i); // ключ хосту не отправляется
    if (file.size > settings.maxFileSizeMB * 1024 * 1024) return fail(i, new ProtocolError('TOO_LARGE', 'too large'));
    try {
      panel.setProgress(k, 'receiving', 0);
      const client = link.get();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ent = await client.analyzeFile({
        name: file.name,
        bytes,
        origin,
        batchId: batchId || undefined,
        onProgress: (stage, p) => !closed && panel.setProgress(k, stage, p),
      });
      if (closed) return;
      analyzed.set(i, { docId: ent.docId, k, name: ent.name });
      panel.setReady(k, {
        entities: ent.entities,
        warnings: ent.warnings,
        restored: ent.restoredDecisions,
        kind: ent.kind,
        hidden: ent.hidden,
        ext: settings.pdfMode === 'text' ? '.txt' : '.md',
        api: {
          getText: (from, count) => link.get().request(MSG.GET_TEXT, { docId: ent.docId, from, count }),
          addEntity: async (category, text) => (await link.get().request(MSG.ADD_ENTITY, { docId: ent.docId, category, text, replaceAll: true })).entities,
          ignoreForever: async (item) => {
            try {
              const cur = deps.getSettings();
              // компания из списка (0.4): исключается по canonical записи — все формы и псевдонимы сразу
              const value = exclusionValue(item);
              if (!cur.exclusions.some((e) => e.value === value && e.category === item.category))
                await saveSettingsPatch({ exclusions: [...cur.exclusions, { value, category: item.category }] });
            } catch (err) {
              if (isInvalidatedError(err)) invalidated();
            }
          },
          // Политика 0.4 (Ц3, К3): «Маскировать всегда» в строке организации и «запомнить» на вкладке «Текст» —
          // запись в список компаний для маскирования (settings.maskedCompanies), без повторов по названию
          maskAlways: async (item) => {
            try {
              const next = withMaskedCompany(deps.getSettings().maskedCompanies, item.value);
              if (!next) return;
              const r = await saveSettingsPatch({ maskedCompanies: next });
              if (r.rejected?.length) throw new Error(tt('maskAlwaysFailed'));
            } catch (err) {
              if (isInvalidatedError(err)) return invalidated();
              throw err;
            }
          },
        },
      });
    } catch (err) {
      if (!closed) fail(i, err);
    }
  }

  async function applyAll() {
    if (!panel.canAnonymize) return;
    panel.showApplying();
    try {
      const client = link.get();
      const outFiles = [];
      const mappings = [];
      let replacements = 0;
      const out = originals.slice();
      let stepNo = 0;
      /** сессии отправки — для ключа с паролем на странице расширения (WP12-D) */
      const docIds = [];
      const usedNames = new Set();
      const ready = procIdx.filter((i) => analyzed.has(i) && panel.getPreview(procIdx.indexOf(i)));
      for (const i of ready) {
        const k = procIdx.indexOf(i);
        const res = await client.apply({
          docId: analyzed.get(i).docId,
          decisions: panel.getPreview(k).getDecisions(),
          // скрытые данные: что удалить из результата (выбор панели, WP12-D)
          options: { hidden: panel.hiddenFlags() },
          onProgress: (stage, p) => panel.setApplyProgress(stage, Math.round(((stepNo + p / 100) / ready.length) * 100)),
        });
        stepNo++;
        docIds.push(analyzed.get(i).docId);
        // имя — по исходному файлу (хост при повторе по sha отдаёт имя прежней сессии), расширение и тип — от хоста:
        // PDF уходит текстом .anon.md / .anon.txt (версия 0.3); остальные форматы — тем же форматом (0.5)
        // расширение от хоста — только у PDF: .txt и .md сами по себе (0.5) остаются собой
        // у файла без расширения (распознан хостом по содержимому) — расширение результата хоста
        const own = /\.(docx|docm|xlsx|xlsm|pptx|pptm|txt|text|log|md|markdown|csv|json)$/i.test(originals[i].name || '');
        const ext = isPdfFile(originals[i]) ? /\.(md|txt)$/i.exec(res.name || '')?.[0] : own ? undefined : /\.(xlsx|pptx)$/i.exec(res.name || '')?.[0];
        // имя от хоста — если сессия этого же файла: в нём найденное в имени заменено метками (ревью WP12-B, п. 16);
        // fail-closed: имени хоста нет или оно от другой сессии — нейтральное «document.anon.<расширение>», а не исходное имя;
        // в одной отправке имена не повторяются (два «[ФИО_1].anon.docx» → второй «[ФИО_1] (2).anon.docx»)
        const ownName = analyzed.get(i).name === originals[i].name && res.name;
        const resultName = uniqueResultName(
          ownName ? res.name : makeResultName(neutralName(originals[i].name), settings.outputSuffix, ext ? { ext } : {}),
          usedNames,
          settings.outputSuffix,
        );
        const file = new File([res.bytes], resultName, {
          type: resultType(originals[i], res.mime),
          lastModified: Date.now(),
        });
        out[i] = file;
        outFiles.push(file);
        mappings.push(res.mapping);
        replacements += res.stats?.replacements ?? 0;
      }
      if (batchId) client.request(MSG.BATCH_END, { batchId }).catch(() => {});
      const merged = mappings.length ? mergeMappings(mappings) : null;
      // неподдерживаемый файл без «Загрузить как есть» (0.5.2, FR-04б) не уходит, остальные — уходят
      const result = out.filter((_, i) => !blocked(i) && (!unsup.has(i) || panel.isAsIs(procIdx.indexOf(i))));
      const sent = result.map((f) => f.name);
      panel.showDone({
        replacements,
        names: sent,
        resultFiles: outFiles,
        mappingText: merged ? JSON.stringify(merged, null, 2) : null,
        mappingName: mappingFileName(outFiles[0]?.name),
        hintMappingShown: deps.getSettings().hintMappingShown,
        docIds,
      });
      decide('anonymized', result);
    } catch (err) {
      if (isInvalidatedError(err) || !contextValid()) return invalidated();
      panel.backToReview();
      const msg = err instanceof ProtocolError ? tt(`err.${err.code}`, { limit: settings.maxFileSizeMB }) : String(err?.message || err);
      panel.getPreview(panel.active)?.showToast(msg);
    }
  }

  // Запуск: вкладки по файлам, батч для сквозной нумерации, анализ по очереди
  if (!contextValid()) {
    invalidated();
    return result;
  }
  for (const i of procIdx) panel.addFile(originals[i].name, originals[i].size);
  for (const i of procIdx) if (keys.has(i)) failKey(i); // отказ виден сразу
  for (const i of unsup) if (!keys.has(i)) failUnsupported(i);
  (async () => {
    try {
      if (batchId) await link.get().request(MSG.BATCH_BEGIN, { batchId });
    } catch (err) {
      for (const i of anaIdx) fail(i, err);
      return;
    }
    for (const i of anaIdx) {
      if (closed) return;
      await analyzeOne(i);
    }
  })();

  return result;
}

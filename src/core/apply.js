// applyDecisions: группы с решениями → байты результата + маппинг (FR-25–FR-28).
// Сериализатор — адаптера формата по doc.kind (DocumentAdapter, ТЗ §5.3, с 0.5 — WP12-A, src/core/adapters.js): DOCX → .docx
// (serializeDocx); текстовая модель PDF (версия 0.3, doc.kind === 'text') → Markdown/текст (serializeText); Excel, PowerPoint и
// текстовые форматы (WP12-B) — адаптеры по требованию: к вызову applyDecisions хост уже загрузил их (loadAdapter), иначе INTERNAL.
import { adapterForKind } from './adapters.js';
import { CoreError } from './errors.js';
import { serializeText, TEXT_MIME } from './text/serialize.js';
import { replacementFor } from './placeholders.js';
import { buildMapping } from './mapping.js';

/**
 * @typedef {object} ApplyOptions
 * @property {'placeholder'|'mask'|'delete'} [mode='placeholder']
 * @property {'ru'|'en'} [placeholderLanguage='ru']   язык для «[удалено]/[redacted]»
 * @property {'ru'|'en'|'both'} [language]            язык документа — пишется в маппинг
 * @property {boolean} [keepMetadata=false]
 * @property {boolean} [stripEmbedded=false]
 * @property {{name: string, sha256?: string, resultName?: string}} [document]
 * @property {string} [createdAt]                     ISO-время (для детерминированных тестов)
 * @property {string} [toolVersion]
 * @property {'md'|'txt'} [textFormat='md']           формат результата текстовой модели (PDF, версия 0.3)
 */

export { DOCX_MIME } from './docx/adapter.js';

/**
 * Правки по решениям (FR-26, FR-13) и сводка применённого для маппинга — общая часть DOCX и текста.
 * @param {{streamById: Map<string, any>}} doc
 * @param {import('./contracts/entity.js').EntityGroup[]} groups
 * @param {{mode?: string, placeholderLanguage?: string}} [opts]
 * @returns {{edits: import('./ooxml/serialize.js').TextEdit[], applied: Map<string, {token: string, occurrences: number, parts: Set<string>, firstForm?: string}>}}
 */
export function planEdits(doc, groups, opts = {}) {
  const mode = opts.mode || 'placeholder';
  const lang = opts.placeholderLanguage || 'ru';
  /** @type {import('./ooxml/serialize.js').TextEdit[]} */
  const edits = [];
  /** @type {Map<string, {token: string, occurrences: number, parts: Set<string>, firstForm?: string}>} */
  const applied = new Map();

  for (const g of groups) {
    if (!g.enabled) continue;
    const excluded = new Set(g.excludedOccurrences || []);
    for (const o of g.occurrences) {
      if (excluded.has(o.id)) continue;
      const s = doc.streamById.get(o.streamId);
      if (!s) continue;
      const core = o.text.slice(o.keepPrefix, o.text.length - o.keepSuffix);
      const token = replacementFor(g, core, /** @type {any} */ (mode), /** @type {any} */ (lang));
      let newText = o.text.slice(0, o.keepPrefix) + token + o.text.slice(o.text.length - o.keepSuffix);
      if (s.attrKind === 'rel-target' && g.category === 'URL') {
        // FR-13: внешняя ссылка остаётся кликабельной и никуда не ведёт
        newText = `https://anonymized.invalid/${token}`;
      }
      edits.push({ streamId: o.streamId, start: o.start, end: o.end, newText });
      let a = applied.get(g.id);
      if (!a) applied.set(g.id, (a = { token, occurrences: 0, parts: new Set() }));
      a.occurrences++;
      a.parts.add(o.part);
      if (!a.firstForm && core === g.value) a.firstForm = o.text.slice(0, o.keepPrefix) + token + o.text.slice(o.text.length - o.keepSuffix);
    }
  }
  return { edits, applied };
}

/**
 * @param {import('./docx/model.js').DocModel} doc
 * @param {import('./contracts/entity.js').EntityGroup[]} groups  с решениями (см. mergeDecisions)
 * @param {ApplyOptions} [options]
 * @returns {{bytes: Uint8Array, docxBytes: Uint8Array, mime: string, mapping: object, stats: {replacements: number, entities: number, changedParts: string[], removedParts: string[]}}}
 *   docxBytes — прежнее имя поля (= bytes) для совместимости
 */
export function applyDecisions(doc, groups, options = {}) {
  const mode = options.mode || 'placeholder';
  const { edits, applied } = planEdits(doc, groups, { mode, placeholderLanguage: options.placeholderLanguage || 'ru' });

  let out;
  let mime;
  if (/** @type {any} */ (doc).kind === 'text') {
    const format = options.textFormat === 'txt' ? 'txt' : 'md';
    out = serializeText(/** @type {any} */ (doc), edits, { format });
    mime = TEXT_MIME[format];
  } else {
    const adapter = adapterForKind(/** @type {any} */ (doc).kind);
    if (!adapter) throw new CoreError('INTERNAL', 'Нет адаптера для вида документа');
    out = adapter.serialize(doc, edits, { keepMetadata: options.keepMetadata, stripEmbedded: options.stripEmbedded });
    // MIME — адаптера; сериализатор может уточнить его по документу (книга с макросами, CSV/JSON у текстовых форматов, WP12-B)
    mime = /** @type {any} */ (out).mime || adapter.mime;
  }
  const { bytes, changedParts, removedParts } = out;

  const mapping = buildMapping({
    groups,
    applied,
    mode,
    language: options.language || doc.language,
    documents: options.document ? [options.document] : [],
    createdAt: options.createdAt,
    toolVersion: options.toolVersion,
  });

  return {
    bytes,
    docxBytes: bytes,
    mime,
    mapping,
    stats: { replacements: edits.length, entities: applied.size, changedParts, removedParts },
  };
}

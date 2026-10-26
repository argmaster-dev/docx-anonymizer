// Замена в координатах virtualText с сохранением форматирования (ТЗ §6.3) и сборка результирующего .docx (FR-12, FR-13, FR-15, FR-40).
// С 0.5 (WP12-A) — общий сериализатор пакета OOXML (src/core/ooxml/serialize.js, docs/contracts.md §9); Word задаёт только, какие
// записи — встроенные объекты (stripEmbedded). Разметка ранов — из описания части (WORDML, docx/model.js).
import { serializePackage } from '../ooxml/serialize.js';
import { EMBEDDED_PART_RE } from './model.js';
import { planDocxHidden } from './hidden.js';
import { anyHidden } from '../ooxml/hidden.js';

export { relsBaseDir, resolveTarget } from '../ooxml/opc.js';

/** @typedef {import('../ooxml/serialize.js').TextEdit} TextEdit */
/** @typedef {import('../ooxml/serialize.js').SerializeOptions} SerializeOptions */

/**
 * Применяет правки к модели и возвращает байты нового .docx.
 * Исходная модель не меняется — её можно применять повторно с другими решениями.
 * @param {import('./model.js').DocModel} doc
 * @param {TextEdit[]} edits
 * @param {SerializeOptions} [options]
 * @returns {{bytes: Uint8Array, changedParts: string[], removedParts: string[]}}
 */
export function serializeDocx(doc, edits, options = {}) {
  // скрытые данные (WP12-D): план — только при выборе пользователя; без него сборка прежняя (снимок docx-regression)
  const plan = anyHidden(options.hidden) ? (d, byStream, push, ctx) => planDocxHidden(d, ctx) : undefined;
  return serializePackage(doc, edits, options, { embeddedParts: EMBEDDED_PART_RE, plan });
}

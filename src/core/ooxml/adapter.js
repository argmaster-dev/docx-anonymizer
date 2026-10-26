// Интерфейс адаптера формата документа (ТЗ §5.3 «Расширяемость»; версия 0.5, WP12-A, docs/contracts.md §9).
// Ядро (детекторы, analyze, planEdits, маппинг) работает с DocModel и не знает формата; адаптер распознаёт файл, строит модель
// и собирает результат того же формата. Первый адаптер — Word (src/core/docx/adapter.js); Excel и PowerPoint — WP12-B
// поверх того же общего слоя (ooxml/model.js — каркас пакета, ooxml/flow.js — потоки по описанию разметки,
// ooxml/serialize.js — сборка, ooxml/dml.js — DrawingML), текстовые форматы — core/plain/. Реестр адаптеров — src/core/adapters.js.
import { readZip } from './zip.js';

/**
 * @typedef {object} DocumentAdapter
 * @property {string} kind             вид документа: совпадает с doc.kind модели и полем `kind` сессии/ENTITIES ('docx'; WP12-B — 'xlsx', 'pptx', 'plain')
 * @property {string[]} extensions     расширения имени файла в нижнем регистре ('.docx', '.docm')
 * @property {string} mime             MIME результата (по умолчанию; serialize может уточнить его полем `mime`)
 * @property {(bytes: Uint8Array, name?: string) => boolean} detect  распознавание: сигнатура (ZIP с главной частью) или имя; без имени — только сигнатура
 * @property {(bytes: Uint8Array, name?: string) => import('./model.js').DocModel} parse  модель; ошибки — CoreError (NOT_DOCX/NOT_SUPPORTED/ENCRYPTED/PARSE_FAILED…);
 *   имя нужно текстовым форматам (CSV, JSON — по расширению, WP12-B), OOXML его не читают
 * @property {(doc: import('./model.js').DocModel, edits: import('./serialize.js').TextEdit[], options?: import('./serialize.js').SerializeOptions) => {bytes: Uint8Array, changedParts: string[], removedParts: string[], mime?: string}} serialize
 *   байты результата того же формата; правки — из решений пользователя (core/apply.js planEdits); модель не мутируется;
 *   `mime` — MIME этого результата, если он зависит от документа (книга с макросами, CSV/JSON)
 * @property {(names: string[]) => string[]} parts  части пакета с текстом в порядке обхода FR-25 (из имён записей ZIP)
 * @property {(doc: import('./model.js').DocModel, groups: import('../contracts/entity.js').EntityGroup[]) => {code: string, count?: number}[]} [analysisWarnings]
 *   предупреждения формата по найденному (WP12-B: Excel — ячейка в формулах, литерал формулы, имя листа; JSON — число станет строкой)
 */

/** Сигнатура ZIP (локальный заголовок PK\3\4) — все пакеты OOXML. */
export function isZip(bytes) {
  return !!bytes && bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * Есть ли в ZIP запись с таким именем (читается только центральный каталог). Не ZIP, повреждён, зашифрован — false.
 * @param {Uint8Array} bytes
 * @param {string} name
 */
export function zipHasEntry(bytes, name) {
  if (!isZip(bytes)) return false;
  try {
    return readZip(bytes).some((e) => e.name === name);
  } catch {
    return false;
  }
}

/**
 * Имя файла оканчивается одним из расширений (без учёта регистра).
 * @param {string | undefined} name
 * @param {string[]} extensions
 */
export function hasExtension(name, extensions) {
  const n = String(name || '').toLowerCase();
  return extensions.some((ext) => n.endsWith(ext));
}

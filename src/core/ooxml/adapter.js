// Интерфейс адаптера формата документа (ТЗ §5.3 «Расширяемость»; версия 0.5, WP12-A, docs/contracts.md §9).
// Ядро (детекторы, analyze, planEdits, маппинг) работает с DocModel и не знает формата; адаптер распознаёт файл, строит модель
// и собирает результат того же формата. Первый адаптер — Word (src/core/docx/adapter.js); Excel и PowerPoint — WP12-B
// поверх того же общего слоя (ooxml/model.js — каркас пакета, ooxml/flow.js — потоки по описанию разметки,
// ooxml/serialize.js — сборка). Реестр адаптеров — src/core/adapters.js.
import { readZip } from './zip.js';

/**
 * @typedef {object} DocumentAdapter
 * @property {string} kind             вид документа: совпадает с doc.kind модели и полем `kind` сессии/ENTITIES ('docx'; WP12-B — 'xlsx', 'pptx')
 * @property {string[]} extensions     расширения имени файла в нижнем регистре ('.docx', '.docm')
 * @property {string} mime             MIME результата
 * @property {(bytes: Uint8Array, name?: string) => boolean} detect  распознавание: сигнатура (ZIP с главной частью) или имя
 * @property {(bytes: Uint8Array) => import('./model.js').DocModel} parse  модель; ошибки — CoreError (NOT_DOCX/ENCRYPTED/PARSE_FAILED…)
 * @property {(doc: import('./model.js').DocModel, edits: import('./serialize.js').TextEdit[], options?: import('./serialize.js').SerializeOptions) => {bytes: Uint8Array, changedParts: string[], removedParts: string[]}} serialize
 *   байты результата того же формата; правки — из решений пользователя (core/apply.js planEdits); модель не мутируется
 * @property {(names: string[]) => string[]} parts  части пакета с текстом в порядке обхода FR-25 (из имён записей ZIP)
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

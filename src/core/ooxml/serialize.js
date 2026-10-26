// Сборка результата OOXML (ТЗ §6.3, FR-12, FR-13, FR-15, FR-40; общий слой с 0.5, WP12-A, docs/contracts.md §9):
// правки в координатах virtualText → правки диапазонов XML частей (через раны или целым значением) → ZIP в исходном порядке,
// нетронутые части — исходными сжатыми байтами. Модель не мутируется: применять можно многократно.
import { applyRangeEdits } from './xml.js';
import { writeZip } from './zip.js';
import { planRunEdits, planValueEdits } from './flow.js';
import { cleanupReferences, META_REMOVED_RE } from './opc.js';
import { CoreError } from '../errors.js';

/**
 * Правка текста в координатах потока.
 * @typedef {object} TextEdit
 * @property {string} streamId
 * @property {number} start
 * @property {number} end
 * @property {string} newText   unescaped — экранирование делает ядро (FR-16)
 */

/**
 * @typedef {object} SerializeOptions
 * @property {boolean} [keepMetadata=false]  false → очистка docProps, удаление custom.xml и thumbnail (FR-12)
 * @property {boolean} [stripEmbedded=false] true → удаление встроенных объектов и диаграмм (FR-15)
 */

/**
 * Что сериализатор знает о формате (адаптер).
 * @typedef {object} PackageSerializeDescription
 * @property {RegExp} embeddedParts  записи встроенных объектов и диаграмм, удаляемые при stripEmbedded (Word: word/embeddings|charts)
 * @property {(doc: import('./model.js').DocModel, byStream: Map<string, TextEdit[]>, pushRaw: (part: string, e: {from: number, to: number, text: string}) => void) => void} [plan]
 *   правки, которые адаптер строит сам (WP12-B: числовая ячейка Excel становится строковой, переименование листа во всех
 *   формулах, колонтитулы с кодами «&P»): адаптер удаляет свои потоки из byStream и кладёт правки диапазонов XML через pushRaw;
 *   остальные потоки обрабатываются как обычно (через раны или значением)
 */

/**
 * Применяет правки к модели пакета и возвращает байты нового файла того же формата.
 * @param {import('./model.js').DocModel} doc
 * @param {TextEdit[]} edits
 * @param {SerializeOptions} options
 * @param {PackageSerializeDescription} desc
 * @returns {{bytes: Uint8Array, changedParts: string[], removedParts: string[]}}
 */
export function serializePackage(doc, edits, options, desc) {
  const keepMetadata = !!options.keepMetadata;
  const stripEmbedded = !!options.stripEmbedded;

  /** @type {Map<string, {from: number, to: number, text: string}[]>} */
  const rawByPart = new Map();
  const pushRaw = (part, e) => {
    let arr = rawByPart.get(part);
    if (!arr) rawByPart.set(part, (arr = []));
    arr.push(e);
  };

  // 1. Группируем правки по потокам
  /** @type {Map<string, TextEdit[]>} */
  const byStream = new Map();
  for (const e of edits) {
    const s = doc.streamById.get(e.streamId);
    if (!s) throw new CoreError('INTERNAL', `Неизвестный поток ${e.streamId}`);
    if (e.start < 0 || e.end > s.text.length || e.start > e.end) throw new CoreError('INTERNAL', `Диапазон вне потока ${e.streamId}`);
    let arr = byStream.get(e.streamId);
    if (!arr) byStream.set(e.streamId, (arr = []));
    arr.push(e);
  }

  // 2. Метаданные: очистка всех meta-потоков (правки сущностей в них тогда не нужны)
  if (!keepMetadata) {
    for (const s of doc.streams) {
      if (s.type === 'meta') {
        byStream.delete(s.id);
        pushRaw(s.part, { from: /** @type {number} */ (s.valueStart), to: /** @type {number} */ (s.valueEnd), text: '' });
      }
    }
  }

  for (const [streamId, list] of byStream) {
    list.sort((a, b) => a.start - b.start || a.end - b.end);
    for (let i = 1; i < list.length; i++) {
      if (list[i].start < list[i - 1].end) throw new CoreError('INTERNAL', `Пересекающиеся правки в потоке ${streamId}`);
    }
  }
  // правки, которые адаптер формата строит сам (WP12-B); Word их не задаёт
  if (desc.plan) desc.plan(doc, byStream, pushRaw);
  for (const [streamId, list] of byStream) {
    const s = /** @type {import('./model.js').Stream} */ (doc.streamById.get(streamId));
    if (s.segments) {
      const part = /** @type {import('./model.js').Part} */ (doc.parts.get(s.part));
      planRunEdits(part.xml, s, list, /** @type {import('./flow.js').FlowMarkup} */ (part.markup), (e) => pushRaw(s.part, e));
    } else planValueEdits(s, list, (e) => pushRaw(s.part, e));
  }

  // 3. Удаляемые части
  const removed = new Set();
  if (!keepMetadata) {
    for (const e of doc.entries) if (META_REMOVED_RE.test(e.name)) removed.add(e.name);
  }
  if (stripEmbedded) {
    for (const e of doc.entries) if (desc.embeddedParts.test(e.name)) removed.add(e.name);
    // Раны со встроенными объектами удаляются целиком; правки внутри них отбрасываются
    for (const part of doc.parts.values()) {
      if (!part.embeddedRuns.length) continue;
      const kept = (rawByPart.get(part.name) || []).filter((e) => !part.embeddedRuns.some((r) => e.from >= r.start && e.to <= r.end));
      for (const r of part.embeddedRuns) kept.push({ from: r.start, to: r.end, text: '' });
      rawByPart.set(part.name, kept);
    }
  }

  // 4. Сборка новых строк частей
  /** @type {Map<string, string>} */
  const newXml = new Map();
  for (const [name, list] of rawByPart) {
    const part = doc.parts.get(name);
    if (!part || !list.length) continue;
    const out = applyRangeEdits(part.xml, list);
    if (out !== part.xml) newXml.set(name, out);
  }
  if (removed.size) cleanupReferences(doc, removed, newXml);

  // 5. ZIP: порядок как в исходнике, нетронутые части — сжатые байты как есть
  const enc = new TextEncoder();
  const items = [];
  for (const e of doc.entries) {
    if (removed.has(e.name)) continue;
    const x = newXml.get(e.name);
    items.push(x !== undefined ? { name: e.name, data: enc.encode(x) } : { name: e.name, source: e });
  }
  return { bytes: writeZip(items), changedParts: [...newXml.keys()], removedParts: [...removed] };
}

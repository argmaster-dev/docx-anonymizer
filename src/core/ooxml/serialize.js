// Сборка результата OOXML (ТЗ §6.3, FR-12, FR-13, FR-15, FR-40; общий слой с 0.5, WP12-A, docs/contracts.md §9):
// правки в координатах virtualText → правки диапазонов XML частей (через раны или целым значением) → ZIP в исходном порядке,
// нетронутые части — исходными сжатыми байтами. Модель не мутируется: применять можно многократно.
import { applyRangeEdits } from './xml.js';
import { writeZip } from './zip.js';
import { planRunEdits, planValueEdits } from './flow.js';
import { cleanupReferences, META_REMOVED_RE } from './opc.js';
import { anyHidden, relsPartOf, resolveStrips } from './hidden.js';
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
 * @property {import('./hidden.js').HiddenFlags} [hidden]  скрытые данные, которые удалить (WP12-D, К7); по умолчанию — ничего
 */

/**
 * Что сериализатор знает о формате (адаптер).
 * @typedef {object} PackageSerializeDescription
 * @property {RegExp} embeddedParts  записи встроенных объектов и диаграмм, удаляемые при stripEmbedded (Word: word/embeddings|charts)
 * @property {(doc: import('./model.js').DocModel, byStream: Map<string, TextEdit[]>, pushRaw: (part: string, e: {from: number, to: number, text: string}) => void, ctx: PlanContext) => void} [plan]
 *   правки, которые адаптер строит сам (WP12-B: числовая ячейка Excel становится строковой, переименование листа во всех
 *   формулах, колонтитулы с кодами «&P»): адаптер удаляет свои потоки из byStream и кладёт правки диапазонов XML через pushRaw;
 *   остальные потоки обрабатываются как обычно (через раны или значением)
 */

/**
 * Что получает план адаптера.
 * @typedef {object} PlanContext
 * @property {SerializeOptions} options
 * @property {(name: string) => void} remove  удалить запись пакета (и её файл связей) со ссылками в [Content_Types].xml и *.rels
 * @property {(part: string, e: {from: number, to: number, text?: string}) => void} strip  удалить диапазон XML части (скрытые
 *   данные, WP12-D): удаление важнее правок сущностей внутри него (ooxml/hidden.js resolveStrips)
 * @property {import('./hidden.js').HiddenFlags | null} hidden  что из скрытого удалить; null — ничего (по умолчанию)
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

  /** @type {Map<string, {from: number, to: number, text: string, strip?: boolean}[]>} */
  const rawByPart = new Map();
  const pushRaw = (part, e) => {
    let arr = rawByPart.get(part);
    if (!arr) rawByPart.set(part, (arr = []));
    arr.push(e);
  };

  // 0. Встроенные книги (core/embedded.js, ревью WP12-B): их потоки — в общей модели, правки уходят своему сериализатору
  /** @type {Map<string, any>} */
  const embeddedOf = new Map();
  for (const em of /** @type {any} */ (doc).embedded || []) for (const s of em.doc.streams) embeddedOf.set(s.id, em);
  /** @type {Map<any, TextEdit[]>} */
  const embeddedEdits = new Map();

  // 1. Группируем правки по потокам
  /** @type {Map<string, TextEdit[]>} */
  const byStream = new Map();
  for (const e of edits) {
    const em = embeddedOf.get(e.streamId);
    if (em) {
      if (!embeddedEdits.has(em)) embeddedEdits.set(em, []);
      /** @type {TextEdit[]} */ (embeddedEdits.get(em)).push(e);
      continue;
    }
    const s = doc.streamById.get(e.streamId);
    if (!s) throw new CoreError('INTERNAL', `Неизвестный поток ${e.streamId}`);
    if (e.start < 0 || e.end > s.text.length || e.start > e.end) throw new CoreError('INTERNAL', `Диапазон вне потока ${e.streamId}`);
    let arr = byStream.get(e.streamId);
    if (!arr) byStream.set(e.streamId, (arr = []));
    arr.push(e);
  }

  // 1а. Внешние цели связей, кроме гиперссылок (аудио, видео, рисунки, шаблоны, внешние книги): путь к файлу на чужом компьютере
  // (file:///C:/Users/<логин>/…/<ФИО>.mp3) — нейтральное имя всегда, с прежним расширением (ревью WP12-B)
  let external = 0;
  for (const s of doc.streams) {
    if (s.attrKind !== 'rel-external' || embeddedOf.has(s.id)) continue;
    byStream.delete(s.id);
    const ext = /\.[A-Za-z0-9]{1,5}$/.exec(s.text.replace(/[?#].*$/, ''))?.[0] || '';
    pushRaw(s.part, { from: /** @type {number} */ (s.valueStart), to: /** @type {number} */ (s.valueEnd), text: `external-${++external}${ext}` });
  }

  // 2. Метаданные: очистка всех meta-потоков (правки сущностей в них тогда не нужны)
  if (!keepMetadata) {
    for (const s of doc.streams) {
      if (s.type === 'meta' && !embeddedOf.has(s.id)) {
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
  const removed = new Set();
  const names = new Set(doc.entries.map((e) => e.name));
  // правки, которые адаптер формата строит сам (WP12-B); Word — только скрытые данные (WP12-D). remove — удалить запись
  // (встроенная книга диаграммы при stripEmbedded, скрытый лист или слайд, части комментариев) вместе с её связями и ссылками
  // на неё; strip — удалить диапазон XML (элемент скрытых данных) с приоритетом над правками сущностей внутри
  if (desc.plan) {
    desc.plan(doc, byStream, pushRaw, {
      options,
      remove: (name) => {
        removed.add(name);
        const rels = relsPartOf(name);
        if (names.has(rels)) removed.add(rels);
      },
      strip: (part, e) => pushRaw(part, { from: e.from, to: e.to, text: e.text || '', strip: true }),
      hidden: anyHidden(options.hidden) ? /** @type {import('./hidden.js').HiddenFlags} */ (options.hidden) : null,
    });
  }
  for (const [streamId, list] of byStream) {
    const s = /** @type {import('./model.js').Stream} */ (doc.streamById.get(streamId));
    if (s.segments) {
      const part = /** @type {import('./model.js').Part} */ (doc.parts.get(s.part));
      planRunEdits(part.xml, s, list, /** @type {import('./flow.js').FlowMarkup} */ (part.markup), (e) => pushRaw(s.part, e));
    } else planValueEdits(s, list, (e) => pushRaw(s.part, e));
  }

  // 3. Удаляемые части
  if (!keepMetadata) {
    for (const e of doc.entries) if (META_REMOVED_RE.test(e.name)) removed.add(e.name);
  }
  if (stripEmbedded) {
    for (const e of doc.entries) if (desc.embeddedParts.test(e.name)) removed.add(e.name);
    // Раны со встроенными объектами удаляются целиком; правки внутри них отбрасываются
    for (const part of doc.parts.values()) {
      if (!part.embeddedRuns.length) continue;
      const kept = (rawByPart.get(part.name) || []).filter((e) => !part.embeddedRuns.some((r) => e.from >= r.start && e.to <= r.end));
      for (const r of part.embeddedRuns) kept.push({ from: r.start, to: r.end, text: '', strip: true });
      rawByPart.set(part.name, kept);
    }
  }

  // 4. Сборка новых строк частей
  /** @type {Map<string, string>} */
  const newXml = new Map();
  for (const [name, list] of rawByPart) {
    const part = doc.parts.get(name);
    if (!part || !list.length || removed.has(name)) continue;
    // удаления (скрытые данные, встроенные объекты) важнее правок внутри них (ooxml/hidden.js)
    const out = applyRangeEdits(part.xml, list.some((e) => e.strip) ? resolveStrips(list) : list);
    if (out !== part.xml) newXml.set(name, out);
  }
  if (removed.size) cleanupReferences(doc, removed, newXml);

  // 4а. Встроенные книги: тем же адаптером, с теми же метками (общая карта); удалённые — не собираются
  /** @type {Map<string, Uint8Array>} */
  const replaced = new Map();
  for (const em of /** @type {any} */ (doc).embedded || []) {
    if (removed.has(em.entry)) continue;
    const list = embeddedEdits.get(em) || [];
    if (!list.length && keepMetadata) continue;
    const out = em.serialize(em.doc, list, { keepMetadata, stripEmbedded });
    replaced.set(em.entry, out.bytes);
  }

  // 5. ZIP: порядок как в исходнике, нетронутые части — сжатые байты как есть
  const enc = new TextEncoder();
  const items = [];
  for (const e of doc.entries) {
    if (removed.has(e.name)) continue;
    const x = newXml.get(e.name);
    const b = replaced.get(e.name);
    items.push(x !== undefined ? { name: e.name, data: enc.encode(x) } : b ? { name: e.name, data: b } : { name: e.name, source: e });
  }
  return { bytes: writeZip(items), changedParts: [...newXml.keys(), ...replaced.keys()], removedParts: [...removed] };
}

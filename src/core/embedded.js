// Встроенные книги Excel (ревью WP12-B, п. 4): данные диаграммы PowerPoint, Word и Excel хранят в ppt|word|xl/embeddings/*.xlsx —
// там те же ФИО и номера, что на слайде. Книга разбирается адаптером Excel (модуль по требованию) и её потоки входят в модель
// документа с префиксом id: анализ один на весь документ — одно значение получает одну метку и в документе, и в книге;
// сериализатор пакета (ooxml/serialize.js) отдаёт правки книги её адаптеру и кладёт новую книгу на место старой.
// Без загрузчика или при сбое разбора книга остаётся как есть — предупреждение EMBEDDED_NOT_PROCESSED. Чистый JS (NFR-14).
import { inflateEntry } from './ooxml/zip.js';
import { readXmlEntry } from './ooxml/model.js';

/** Встроенная книга Excel внутри пакета. */
export const EMBEDDED_BOOK_RE = /(?:^|\/)embeddings\/[^/]+\.xls[xm]$/i;
/** Диаграмма Word (word/charts/chartN.xml): заголовки, подписи и кэш строк — те же ФИО, что в тексте. */
const DOCX_CHART_RE = /^word\/charts\/chart[^/]*\.xml$/;

/**
 * Разбирает встроенные книги и добавляет их потоки, абзацы и таблицы в модель (doc.embedded — что и как собрать обратно).
 * Модель документа меняется на месте (до анализа). Вложенные книги в книге — не разбираются.
 * @param {any} doc  модель OOXML (у текстовой модели записей нет — ничего не делает)
 * @param {(kind: string) => Promise<import('./ooxml/adapter.js').DocumentAdapter>} load  загрузка адаптера Excel
 * @returns {Promise<number>}  сколько книг разобрано
 */
export async function attachEmbeddedBooks(doc, load) {
  const entries = doc.entries || [];
  const books = !doc.embedded && entries.some((e) => EMBEDDED_BOOK_RE.test(e.name));
  // диаграммы Word тоже разбирает модуль Excel (разметка диаграммы) — та же загрузка
  const charts = doc.kind === 'docx' && entries.some((e) => DOCX_CHART_RE.test(e.name) && !doc.parts.has(e.name));
  if (!books && !charts) return doc.embedded?.length || 0;
  let adapter;
  try {
    adapter = await load('xlsx');
  } catch {
    return 0;
  }
  if (charts) attachDocxChartsWith(doc, adapter);
  return books ? attachEmbeddedBooksWith(doc, adapter) : doc.embedded?.length || 0;
}

/**
 * То же синхронно, с уже загруженным адаптером Excel (его зовут адаптеры Excel и PowerPoint из своего parse — модель
 * получается полной и при прямом вызове адаптера; Word — через хост, асинхронно).
 * @param {any} doc
 * @param {import('./ooxml/adapter.js').DocumentAdapter} adapter
 * @returns {number}
 */
export function attachEmbeddedBooksWith(doc, adapter) {
  const books = (doc.entries || []).filter((e) => EMBEDDED_BOOK_RE.test(e.name));
  if (!books.length || doc.embedded) return doc.embedded?.length || 0;
  doc.embedded = [];
  let n = 0;
  for (const entry of books) {
    let sub;
    try {
      sub = adapter.parse(inflateEntry(entry));
    } catch {
      continue; // не книга или зашифрована — остаётся как есть (предупреждение)
    }
    const prefix = `e${++n}/`;
    rekey(sub, prefix, entry.name);
    let order = doc.streams.length;
    for (const s of sub.streams) {
      s.order = order++;
      doc.streams.push(s);
      doc.streamById.set(s.id, s);
    }
    doc.paragraphs.push(...sub.paragraphs);
    // таблицы книги — только если у документа уже есть таблицы-блоки (у Word их нет: detect/tables.js читает разметку w:tbl)
    if (Array.isArray(doc.blocks) && Array.isArray(sub.blocks)) doc.blocks.push(...sub.blocks);
    doc.embedded.push({ entry: entry.name, doc: sub, serialize: adapter.serialize });
  }
  // предупреждение о встроенных объектах — без разобранных книг
  const w = (doc.warnings || []).find((x) => x.code === 'EMBEDDED_NOT_PROCESSED');
  if (w && doc.embedded.length) {
    w.count = Math.max(0, (w.count || 0) - doc.embedded.length);
    if (w.details && typeof w.details.embeddings === 'number') w.details.embeddings = Math.max(0, w.details.embeddings - doc.embedded.length);
    if (!w.count) doc.warnings = doc.warnings.filter((x) => x !== w);
  }
  return doc.embedded.length;
}

/**
 * Уникальные id потоков и абзацев книги внутри документа: «e1/p0:live», «e1/a3», таблицы «e1t0»; абзацы — с частью
 * «<запись книги>#<часть>» (вкладка «Текст» документа их не показывает), потоки сохраняют часть книги (её сериализатор).
 */
function rekey(sub, prefix, entryName) {
  const tag = prefix.replace('/', '');
  for (const s of sub.streams) {
    s.id = prefix + s.id;
    if (s.pid) s.pid = prefix + s.pid;
    if (s.linkedTo) s.linkedTo = prefix + s.linkedTo;
  }
  sub.streamById = new Map(sub.streams.map((s) => [s.id, s]));
  for (const p of sub.paragraphs) {
    p.pid = prefix + p.pid;
    p.part = `${entryName}#${p.part}`;
    p.streams = Object.fromEntries(Object.entries(p.streams).map(([k, v]) => [k, prefix + v]));
  }
  for (const b of sub.blocks || []) {
    b.pid = prefix + b.pid;
    if (b.table) b.table = { ...b.table, index: `${tag}t${b.table.index}` };
  }
  const x = sub.xlsx;
  if (x)
    for (const tc of x.tableColumns || [])
      Object.assign(tc, { columnStream: prefix + tc.columnStream, headerStream: tc.headerStream && prefix + tc.headerStream });
  if (x?.pivotItems) x.pivotItems = new Map([...x.pivotItems].map(([k, v]) => [prefix + k, v]));
}

/**
 * Диаграммы Word (ревью WP12-B): части разбираются разметкой диаграммы из модуля Excel и входят в модель документа (id с префиксом
 * «c<N>/»); общий сериализатор пакета правит их как обычные части. Сбой — диаграмма как есть.
 * @param {any} doc  модель Word
 * @param {any} adapter  адаптер Excel (parseChartPart)
 * @returns {number}
 */
function attachDocxChartsWith(doc, adapter) {
  const charts = (doc.entries || []).filter((e) => DOCX_CHART_RE.test(e.name) && !doc.parts.has(e.name));
  if (!charts.length || !adapter.parseChartPart) return 0;
  let n = 0;
  for (const entry of charts) {
    const ctx = { pidCounter: 0, attrCounter: 0, paragraphs: [] };
    let part;
    try {
      part = adapter.parseChartPart(entry.name, readXmlEntry(entry), ctx);
    } catch {
      continue;
    }
    const prefix = `c${++n}/`;
    for (const s of part.streams) {
      s.id = prefix + s.id;
      if (s.pid) s.pid = prefix + s.pid;
      s.order = doc.streams.length;
      doc.streams.push(s);
      doc.streamById.set(s.id, s);
    }
    for (const p of ctx.paragraphs) {
      p.pid = prefix + p.pid;
      p.streams = Object.fromEntries(Object.entries(p.streams).map(([k, v]) => [k, prefix + v]));
      doc.paragraphs.push(p);
    }
    doc.parts.set(entry.name, part);
  }
  const w = (doc.warnings || []).find((x) => x.code === 'EMBEDDED_NOT_PROCESSED');
  if (w && n && w.details && typeof w.details.charts === 'number') {
    const done = Math.min(n, w.details.charts);
    w.details.charts -= done;
    w.count = Math.max(0, (w.count || 0) - done);
    if (!w.count) doc.warnings = doc.warnings.filter((x) => x !== w);
  }
  return n;
}

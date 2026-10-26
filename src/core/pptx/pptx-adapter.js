// Адаптер PowerPoint (DocumentAdapter, ТЗ §5.3; версия 0.5, WP12-B, Ц1, К2, К3; docs/concept-0.5.md п. 3, docs/contracts.md §9.8).
// Модуль по требованию (offscreen/chunks/, core/adapters.js). Поверх общего слоя OOXML: текст фигур DrawingML <a:p>/<a:r>/<a:t>
// на слайдах (надписи, заголовки, группы, таблицы, SmartArt — данные и рисунок диаграммы), в заметках докладчика, современных
// комментариях и диаграммах; обычные комментарии <p:text>; авторы комментариев (FR-11); alt-тексты; макеты и образцы —
// тоже разбираются, но сущность в них бывает редко (обычно пусто); docProps; внешние ссылки. Меняется только содержимое <a:t>
// и значений — число слайдов, фигур и их геометрия не меняются. Ячейки таблиц — `doc.blocks` для заголовков столбцов
// (detect/tables.js без правок). Значения документа в логи не попадают (NFR-14).
import { tokenize, getAttr } from '../ooxml/xml.js';
import { parsePackage, sortParts } from '../ooxml/model.js';
import { parseFlowPart } from '../ooxml/flow.js';
import { parseRelsPart, parseMetaPart, META_PART_RE } from '../ooxml/opc.js';
import { serializePackage } from '../ooxml/serialize.js';
import { zipHasEntry, hasExtension } from '../ooxml/adapter.js';
import { parseDrawingPart, addElementTextStreams, addAttrStreams, linkAuthors, embeddedWarning, DML } from '../ooxml/dml.js';
import { CoreError } from '../errors.js';
import { registerAdapter } from '../adapters.js';
import { tableBlocks } from '../table-blocks.js';

export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const EXTENSIONS = ['.pptx', '.pptm'];

const PRESENTATION = 'ppt/presentation.xml';
const SLIDE_RE = /^ppt\/slides\/[^/]+\.xml$/;
const NOTES_RE = /^ppt\/notesSlides\/[^/]+\.xml$/;
const MODERN_COMMENT_RE = /^ppt\/comments\/modernComment[^/]*\.xml$/;
const COMMENT_RE = /^ppt\/comments\/[^/]+\.xml$/;
const COMMENT_AUTHORS = 'ppt/commentAuthors.xml';
const AUTHORS = 'ppt/authors.xml';
const DIAGRAM_RE = /^ppt\/diagrams\/(?:data|drawing)[^/]*\.xml$/;
const CHART_RE = /^ppt\/charts\/chart[^/]*\.xml$/;
const MASTER_RE = /^ppt\/(?:slideLayouts|slideMasters|notesMasters|handoutMasters)\/[^/]+\.xml$/;
const RELS_RE = /^ppt\/(?:[^/]+\/)*_rels\/[^/]+\.rels$/;

/** Обычный комментарий: текст <p:text> прямо в <p:cm>, без ранов. */
const PML_COMMENT = Object.freeze({
  ...DML,
  paragraph: 'p:cm',
  paragraphs: new Set(['p:cm']),
  run: 'p:none',
  text: { 'p:text': 'live' },
  textParents: new Set(['p:cm']),
  specials: {},
  openSpecials: false,
  specialParents: new Set(),
});

/** Ранг части для порядка обхода (FR-25): слайды → заметки → комментарии → авторы → SmartArt и диаграммы → макеты → связи → свойства. */
export function pptxPartRank(name) {
  if (SLIDE_RE.test(name)) return 0;
  if (NOTES_RE.test(name)) return 1;
  if (COMMENT_RE.test(name)) return 2;
  if (name === COMMENT_AUTHORS || name === AUTHORS) return 3;
  if (DIAGRAM_RE.test(name)) return 4;
  if (CHART_RE.test(name)) return 5;
  if (MASTER_RE.test(name)) return 6;
  if (RELS_RE.test(name)) return 7;
  return 8; // docProps
}

/**
 * Части презентации с текстом в порядке обхода FR-25.
 * @param {string[]} names
 */
export function pptxParts(names) {
  const res = [SLIDE_RE, NOTES_RE, COMMENT_RE, DIAGRAM_RE, CHART_RE, MASTER_RE, RELS_RE, META_PART_RE];
  return sortParts(
    names.filter((n) => n === COMMENT_AUTHORS || n === AUTHORS || res.some((re) => re.test(n))),
    pptxPartRank,
  );
}

/**
 * Разбирает .pptx/.pptm. Бросает CoreError: NOT_SUPPORTED (не ZIP, нет ppt/presentation.xml), ENCRYPTED, PARSE_FAILED.
 * @param {Uint8Array} bytes
 * @returns {import('../ooxml/model.js').DocModel & {blocks: any[], viewParts: string[]}}
 */
export function parsePptx(bytes) {
  /** @type {any[]} */
  const blocks = [];
  let tables = 0;
  let headSeq = 0;
  /** @type {import('../ooxml/model.js').PackageDescription} */
  const desc = {
    kind: 'pptx',
    mainPart: PRESENTATION,
    notFound: { code: 'NOT_SUPPORTED', message: 'В архиве нет ppt/presentation.xml' },
    parts: pptxParts,
    parsePart(name, xml, ctx) {
      if (SLIDE_RE.test(name) || NOTES_RE.test(name) || MASTER_RE.test(name) || DIAGRAM_RE.test(name)) {
        const first = ctx.paragraphs.length;
        const part = parseDrawingPart(name, xml, ctx);
        markShapes(xml, ctx.paragraphs.slice(first), part);
        return part;
      }
      if (MODERN_COMMENT_RE.test(name)) return parseDrawingPart(name, xml, ctx);
      if (COMMENT_RE.test(name)) return parseFlowPart(name, xml, ctx, PML_COMMENT);
      if (name === COMMENT_AUTHORS || name === AUTHORS) {
        const part = { name, kind: 'people', xml, streams: [], embeddedRuns: [] };
        const spec = { name: 'author', initials: 'initials', userId: 'author-id' };
        linkAuthors(addAttrStreams(part, ctx, { 'p:cmAuthor': spec, 'p188:author': spec }));
        return part;
      }
      if (CHART_RE.test(name)) {
        const part = parseDrawingPart(name, xml, ctx);
        addElementTextStreams(part, ctx, (n, stack) => (n === 'c:v' && stack.some((x) => x === 'c:strCache' || x === 'c:lvl') ? 'cell-cache' : null));
        return part;
      }
      if (RELS_RE.test(name)) return parseRelsPart(name, xml, ctx);
      return parseMetaPart(name, xml, ctx);
    },
    warnings: (list) => embeddedWarning(list, 'ppt/'),
    languageStream: (s) => s.type === 'live' && (SLIDE_RE.test(s.part) || NOTES_RE.test(s.part)),
  };
  let doc;
  try {
    doc = parsePackage(bytes, desc);
  } catch (e) {
    if (e instanceof CoreError && e.code === 'NOT_DOCX') throw new CoreError('NOT_SUPPORTED', 'Файл повреждён или не является презентацией PowerPoint');
    throw e;
  }
  const order = slideOrder(doc.entries.map((e) => e.name));
  return Object.assign(doc, { blocks, viewParts: order });

  /**
   * Вид абзаца по фигуре (К10 0.4): текст заголовка (<p:ph type="title|ctrTitle">) — 'heading', ячейка таблицы — 'cell';
   * ячейки таблиц слайда — блоки таблицы для заголовков столбцов (как ячейки PDF и Excel).
   */
  function markShapes(xml, paras, part) {
    if (!paras.length) return;
    const textOf = new Map(part.streams.map((x) => [x.id, x.text]));
    const titles = [];
    const cells = [];
    /** @type {{start: number, title: boolean, depth: number}[]} */
    const sp = [];
    /** @type {{id: number, row: number, col: number, cell: any} | null} */
    let tbl = null;
    tokenize(xml, (t) => {
      const nm = t.name;
      if (t.type === 'open' || t.type === 'selfclose') {
        if (nm === 'p:sp' && t.type === 'open') sp.push({ start: t.start, title: false, depth: sp.length });
        else if (nm === 'p:ph' && sp.length) {
          const type = getAttr(xml, t.attrStart, t.attrEnd, 'type')?.raw;
          if (type === 'title' || type === 'ctrTitle') sp[sp.length - 1].title = true;
        } else if (nm === 'a:tbl' && t.type === 'open') tbl = { id: tables++, row: -1, col: 0, cell: null };
        else if (tbl && nm === 'a:tr' && t.type === 'open') {
          tbl.row++;
          tbl.col = 0;
        } else if (tbl && nm === 'a:tc') {
          const span = Number(getAttr(xml, t.attrStart, t.attrEnd, 'gridSpan')?.raw || 1);
          const merged = getAttr(xml, t.attrStart, t.attrEnd, 'hMerge')?.raw === '1';
          if (t.type === 'open') tbl.cell = { start: t.start, end: xml.length, table: tbl.id, row: tbl.row, col: tbl.col, span: Math.max(1, span), merged };
          else tbl.col++;
        }
      } else if (t.type === 'close') {
        if (nm === 'p:sp') {
          const s = sp.pop();
          if (s?.title) titles.push([s.start, t.end]);
        } else if (nm === 'a:tc' && tbl?.cell) {
          tbl.cell.end = t.end;
          if (!tbl.cell.merged) cells.push(tbl.cell);
          tbl.col += tbl.cell.merged ? 1 : tbl.cell.span;
          tbl.cell = null;
        } else if (nm === 'a:tbl') tbl = null;
      }
    });
    /** @type {Map<number, import('../table-blocks.js').TableCell[]>} */
    const byTable = new Map();
    for (const p of paras) {
      if (titles.some(([a, b]) => p.pos >= a && p.pos < b)) p.kind = 'heading';
      const c = cells.find((x) => p.pos >= x.start && p.pos < x.end);
      if (!c) continue;
      p.kind = 'cell';
      if (!byTable.has(c.table)) byTable.set(c.table, []);
      /** @type {any[]} */ (byTable.get(c.table)).push({ pid: p.pid, text: textOf.get(p.streams.live) ?? '', row: c.row, col: c.col });
    }
    // шапка таблицы — без «метки слева», заголовок над шапкой — отдельно (core/table-blocks.js)
    for (const [index, list] of byTable) blocks.push(...tableBlocks(list, { index, fakePid: () => `h${headSeq++}` }));
  }
}

/** Слайды по номеру файла, затем заметки — части вкладки «Текст». */
function slideOrder(names) {
  const num = (n) => Number(/(\d+)\.xml$/.exec(n)?.[1] || 0);
  const slides = names.filter((n) => SLIDE_RE.test(n)).sort((a, b) => num(a) - num(b));
  const notes = names.filter((n) => NOTES_RE.test(n)).sort((a, b) => num(a) - num(b));
  return [...slides, ...notes];
}

/** @type {import('../ooxml/adapter.js').DocumentAdapter} */
export const PPTX_ADAPTER = Object.freeze({
  kind: 'pptx',
  extensions: EXTENSIONS,
  mime: PPTX_MIME,
  detect: (bytes, name) => zipHasEntry(bytes, PRESENTATION) || hasExtension(name, EXTENSIONS),
  parse: (bytes) => parsePptx(bytes),
  // встроенные объекты (OLE, данные диаграмм в embeddings/) не удаляются: на них ссылаются фигуры слайдов
  serialize: (doc, edits, options = {}) => {
    const out = serializePackage(doc, edits, options, { embeddedParts: /^$/ });
    const macro = doc.entries.some((e) => e.name === 'ppt/vbaProject.bin');
    return { ...out, mime: macro ? 'application/vnd.ms-powerpoint.presentation.macroEnabled.12' : PPTX_MIME };
  },
  parts: pptxParts,
});

registerAdapter(PPTX_ADAPTER);

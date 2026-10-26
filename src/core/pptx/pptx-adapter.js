// Адаптер PowerPoint (DocumentAdapter, ТЗ §5.3; версия 0.5, WP12-B, Ц1, К2, К3; docs/concept-0.5.md п. 3, docs/contracts.md §9.8).
// Модуль по требованию (offscreen/chunks/, core/adapters.js). Поверх общего слоя OOXML: текст фигур DrawingML <a:p>/<a:r>/<a:t>
// на слайдах (надписи, заголовки, группы, таблицы, SmartArt — данные и рисунок диаграммы), в заметках докладчика, современных
// комментариях и диаграммах; обычные комментарии <p:text>; авторы комментариев (FR-11); alt-тексты; макеты и образцы —
// тоже разбираются, но сущность в них бывает редко (обычно пусто); docProps; внешние ссылки. Меняется только содержимое <a:t>
// и значений — число слайдов, фигур и их геометрия не меняются. Ячейки таблиц — `doc.blocks` для заголовков столбцов
// (detect/tables.js без правок). Значения документа в логи не попадают (NFR-14).
import { tokenize, getAttr } from '../ooxml/xml.js';
import { readZip } from '../ooxml/zip.js';
import { parsePackage, sortParts, addAttrStream, readXmlEntry } from '../ooxml/model.js';
import { parseFlowPart } from '../ooxml/flow.js';
import { parseRelsPart, parseMetaPart, META_PART_RE } from '../ooxml/opc.js';
import { serializePackage } from '../ooxml/serialize.js';
import { zipHasEntry, hasExtension } from '../ooxml/adapter.js';
import { parseDrawingPart, addElementTextStreams, addAttrStreams, linkAuthors, embeddedWarning, DML, readRelations, chartExternalData } from '../ooxml/dml.js';
import { CoreError } from '../errors.js';
import { registerAdapter } from '../adapters.js';
import { tableBlocks } from '../table-blocks.js';
import { attachEmbeddedBooksWith } from '../embedded.js';
import { XLSX_ADAPTER } from '../xlsx/xlsx-adapter.js';

export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const EXTENSIONS = ['.pptx', '.pptm'];

const PRESENTATION = 'ppt/presentation.xml';

/** Роль части по типу связи (последнее звено URI типа; ревью WP12-B — не по шаблону пути). */
const ROLE_BY_TYPE = {
  officeDocument: 'presentation',
  slide: 'slide',
  notesSlide: 'notes',
  comments: 'comments',
  commentAuthors: 'authors',
  authors: 'authors',
  diagramData: 'drawing',
  diagramDrawing: 'drawing',
  chart: 'chart',
  chartUserShapes: 'drawing',
  slideLayout: 'master',
  slideMaster: 'master',
  notesMaster: 'master',
  handoutMaster: 'master',
};
/** Запасной вариант — по пути. */
const ROLE_BY_PATH = [
  [/^ppt\/slides\/[^/]+\.xml$/, 'slide'],
  [/^ppt\/notesSlides\/[^/]+\.xml$/, 'notes'],
  [/^ppt\/comments\/[^/]+\.xml$/, 'comments'],
  [/^ppt\/(?:commentAuthors|authors)\.xml$/, 'authors'],
  [/^ppt\/diagrams\/(?:data|drawing)[^/]*\.xml$/, 'drawing'],
  [/^ppt\/charts\/chart[^/]*\.xml$/, 'chart'],
  [/^ppt\/(?:slideLayouts|slideMasters|notesMasters|handoutMasters)\/[^/]+\.xml$/, 'master'],
];
const RELS_RE = /(?:^|\/)_rels\/[^/]+\.rels$/;
const EMBEDDED_RE = /(?:^|\/)embeddings\//;
/** Ранг роли (FR-25): слайды → заметки → комментарии → авторы → SmartArt и диаграммы → макеты → презентация → связи → свойства. */
const RANK = { slide: 0, notes: 1, comments: 2, authors: 3, drawing: 4, chart: 5, master: 6, presentation: 7, rels: 8, meta: 9 };

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

/**
 * Роль части: по связям пакета, иначе по пути; связи — 'rels', docProps — 'meta'; прочее — null.
 * @param {string} name
 * @param {(part: string) => string[]} [typesOf]
 */
export function pptxRole(name, typesOf = () => []) {
  if (EMBEDDED_RE.test(name)) return null;
  if (RELS_RE.test(name)) return 'rels';
  if (META_PART_RE.test(name)) return 'meta';
  for (const t of typesOf(name)) if (ROLE_BY_TYPE[t]) return ROLE_BY_TYPE[t];
  if (name === PRESENTATION) return 'presentation';
  for (const [re, role] of ROLE_BY_PATH) if (/** @type {RegExp} */ (re).test(name)) return /** @type {string} */ (role);
  return null;
}

/** Ранг части для порядка обхода (FR-25). */
export function pptxPartRank(name, typesOf) {
  return RANK[/** @type {string} */ (pptxRole(name, typesOf))] ?? 9;
}

/**
 * Части презентации с текстом в порядке обхода FR-25.
 * @param {string[]} names
 * @param {(part: string) => string[]} [typesOf]
 */
export function pptxParts(names, typesOf) {
  return sortParts(
    names.filter((n) => pptxRole(n, typesOf)),
    (n) => pptxPartRank(n, typesOf),
  );
}

/**
 * Разбирает .pptx/.pptm. Бросает CoreError: NOT_SUPPORTED (не ZIP, нет ppt/presentation.xml), ENCRYPTED, PARSE_FAILED.
 * @param {Uint8Array} bytes
 * @returns {import('../ooxml/model.js').DocModel & {blocks: any[], viewParts: string[]}}
 */
export function parsePptx(bytes) {
  let entries;
  try {
    entries = readZip(bytes);
  } catch (e) {
    throw notSupported(e);
  }
  const names = new Set(entries.map((e) => e.name));
  const rels = readRelations(entries);
  const main = rels.from('').find((r) => r.type === 'officeDocument' && names.has(r.target))?.target || PRESENTATION;
  const mainEntry = entries.find((e) => e.name === main);
  // главная часть — презентация (а не книга или документ Word)
  if (!mainEntry || !/<(?:\w+:)?presentation[\s>]/.test(readXmlEntry(mainEntry).slice(0, 2000)))
    throw new CoreError('NOT_SUPPORTED', 'В архиве нет презентации PowerPoint');
  const typesOf = (n) => (n === main ? ['officeDocument'] : rels.typesOf(n));
  /** @type {any[]} */
  const blocks = [];
  const chartEmbeds = [];
  let tables = 0;
  let headSeq = 0;
  /** @type {import('../ooxml/model.js').PackageDescription} */
  const desc = {
    kind: 'pptx',
    mainPart: main,
    notFound: { code: 'NOT_SUPPORTED', message: 'В архиве нет презентации PowerPoint' },
    parts: (list) => pptxParts(list, typesOf),
    parsePart(name, xml, ctx) {
      const role = pptxRole(name, typesOf);
      if (role === 'slide' || role === 'notes' || role === 'master' || role === 'drawing') {
        const first = ctx.paragraphs.length;
        const part = parseDrawingPart(name, xml, ctx, {
          // название слайда (<p:cSld name="…">) — тоже текст
          onElement(t, parent, para, p) {
            if (t.name !== 'p:cSld') return;
            const a = getAttr(xml, t.attrStart, t.attrEnd, 'name');
            if (a && a.raw) addAttrStream(p, ctx, a, 'alt', 'p:cSld/@name');
          },
        });
        markShapes(xml, ctx.paragraphs.slice(first), part);
        return part;
      }
      // комментарии: современные (p188:cmLst) — абзацы DrawingML, обычные (p:cmLst) — <p:text>
      if (role === 'comments')
        return /<p188:cmLst[\s>]/.test(xml) || !/<p:cmLst[\s>]/.test(xml) ? parseDrawingPart(name, xml, ctx) : parseFlowPart(name, xml, ctx, PML_COMMENT);
      if (role === 'authors') {
        const part = { name, kind: 'people', xml, streams: [], embeddedRuns: [] };
        const spec = { name: 'author', initials: 'initials', userId: 'author-id' };
        linkAuthors(addAttrStreams(part, ctx, { 'p:cmAuthor': spec, 'p188:author': spec }));
        return part;
      }
      if (role === 'chart') {
        const part = parseDrawingPart(name, xml, ctx);
        addElementTextStreams(part, ctx, (n, stack) => (n === 'c:v' && stack.some((x) => x === 'c:strCache' || x === 'c:lvl') ? 'cell-cache' : null));
        const ext = chartExternalData(name, xml, rels.from(name));
        if (ext) chartEmbeds.push(ext);
        return part;
      }
      if (role === 'presentation') {
        // разделы (p14:section/@name) и произвольные показы (p:custShow/@name)
        const part = { name, kind: 'text', xml, streams: [], embeddedRuns: [] };
        addAttrStreams(part, ctx, { 'p14:section': { name: 'alt' }, 'p:custShow': { name: 'alt' } });
        return part;
      }
      if (role === 'rels') return parseRelsPart(name, xml, ctx);
      return parseMetaPart(name, xml, ctx);
    },
    warnings: (list) => embeddedWarning(list, 'ppt/'),
    languageStream: (s) => s.type === 'live' && (pptxRole(s.part, typesOf) === 'slide' || pptxRole(s.part, typesOf) === 'notes'),
  };
  let doc;
  try {
    doc = parsePackage(bytes, desc);
  } catch (e) {
    throw notSupported(e);
  }
  const order = slideOrder(
    doc.entries.map((e) => e.name),
    (n) => pptxRole(n, typesOf),
  );
  return Object.assign(doc, { blocks, viewParts: order, chartEmbeds });

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
    for (const [index, list] of byTable) blocks.push(...tableBlocks(list, { index, minHeader: 2, fakePid: () => `h${headSeq++}` }));
  }
}

/** Слайды по номеру файла, затем заметки — части вкладки «Текст». */
function slideOrder(names, role) {
  const num = (n) => Number(/(\d+)\.xml$/.exec(n)?.[1] || 0);
  const slides = names.filter((n) => role(n) === 'slide').sort((a, b) => num(a) - num(b));
  const notes = names.filter((n) => role(n) === 'notes').sort((a, b) => num(a) - num(b));
  return [...slides, ...notes];
}

/** Не ZIP или не презентация: общий код NOT_SUPPORTED. */
function notSupported(e) {
  if (e instanceof CoreError && e.code === 'NOT_DOCX') return new CoreError('NOT_SUPPORTED', 'Файл повреждён или не является презентацией PowerPoint');
  return e;
}

/** @type {import('../ooxml/adapter.js').DocumentAdapter} */
export const PPTX_ADAPTER = Object.freeze({
  kind: 'pptx',
  extensions: EXTENSIONS,
  mime: PPTX_MIME,
  detect: (bytes, name) => zipHasEntry(bytes, PRESENTATION) || hasExtension(name, EXTENSIONS),
  // книги данных диаграмм (ppt/embeddings/*.xlsx) — адаптером Excel, в той же модели и с той же картой меток (core/embedded.js)
  parse: (bytes) => {
    const doc = parsePptx(bytes);
    attachEmbeddedBooksWith(doc, XLSX_ADAPTER);
    return doc;
  },
  // встроенные OLE-объекты слайдов не удаляются (на них ссылаются фигуры); книга данных диаграммы — при stripEmbedded
  serialize: (doc, edits, options = {}) => {
    const out = serializePackage(doc, edits, options, {
      embeddedParts: /^$/,
      plan: (d, byStream, push, ctx) => {
        if (!ctx.options.stripEmbedded) return;
        for (const e of /** @type {any} */ (d).chartEmbeds || []) {
          ctx.remove(e.embed);
          push(e.chart, { from: e.start, to: e.end, text: '' });
        }
      },
    });
    const macro = doc.entries.some((e) => /(?:^|\/)vbaProject\.bin$/.test(e.name));
    return { ...out, mime: macro ? 'application/vnd.ms-powerpoint.presentation.macroEnabled.12' : PPTX_MIME };
  },
  parts: pptxParts,
});

registerAdapter(PPTX_ADAPTER);

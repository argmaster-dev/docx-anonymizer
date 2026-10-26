// Разбор DOCX в модель потоков (ТЗ §2, §4.2, §6.1–6.2). С 0.5 (WP12-A) Word — первый адаптер общего слоя OOXML
// (src/core/ooxml/, docs/contracts.md §9): здесь — описание разметки WordprocessingML, части пакета Word и их порядок обхода (FR-25),
// авторы правок и комментариев (FR-11), alt-тексты, поля, вид абзаца; ZIP, токенизатор, потоки и charMap — в ooxml/.
import { parseAttrs, getAttr, tokenize } from '../ooxml/xml.js';
import { parsePackage, addAttrStream, sortParts, detectLanguage } from '../ooxml/model.js';
import { parseFlowPart, OBJ } from '../ooxml/flow.js';
import { parseRelsPart, parseMetaPart, META_PART_RE } from '../ooxml/opc.js';
import { countDocxHidden } from './hidden.js';

export { detectLanguage, META_PART_RE };

/** @typedef {import('../ooxml/model.js').Segment} Segment */
/** @typedef {import('../ooxml/model.js').Stream} Stream */
/** @typedef {import('../ooxml/model.js').Paragraph} Paragraph */
/** @typedef {import('../ooxml/model.js').Part} Part */
/** @typedef {import('../ooxml/model.js').DocModel} DocModel */

/** Идентификаторы стилей заголовков: английские Heading1/Title/Subtitle и русские «1»…«9» (Word даёт styleId цифрой). */
const HEADING_STYLE_RE = /^(heading\d*|title|subtitle|\d)$/i;

export const TEXT_PART_RE = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments|commentsExtended|glossary\/document)\.xml$/;
export const PEOPLE_PART_RE = /^word\/people\.xml$/;
export const RELS_PART_RE = /^word\/(glossary\/)?_rels\/[^/]+\.rels$/;

/** Записи встроенных объектов и диаграмм Word (FR-15): предупреждение EMBEDDED_NOT_PROCESSED и удаление при stripEmbedded. */
export const EMBEDDED_PART_RE = /^word\/(embeddings|charts)\//;

/**
 * Разметка WordprocessingML для общего слоя потоков (ooxml/flow.js).
 * @type {import('../ooxml/flow.js').FlowMarkup}
 */
export const WORDML = Object.freeze({
  paragraph: 'w:p',
  paragraphs: new Set(['w:p']),
  run: 'w:r',
  text: { 'w:t': 'live', 'w:delText': 'deleted', 'w:instrText': 'field', 'w:delInstrText': 'field' },
  textParents: new Set(['w:r']),
  specials: {
    'w:tab': '\t',
    'w:ptab': '\t',
    'w:br': '\n',
    'w:cr': '\n',
    'w:sym': OBJ,
    'w:noBreakHyphen': '‑',
    'w:footnoteReference': OBJ,
    'w:endnoteReference': OBJ,
    'w:commentReference': OBJ,
  },
  soft: new Set(['w:softHyphen']),
  containers: new Set(['w:drawing', 'w:pict', 'w:object', 'mc:AlternateContent']),
  specialParents: new Set(['w:r']),
  deleted: new Set(['w:del', 'w:moveFrom']),
  embeddedOpen: new Set(['w:object', 'c:chart']),
  embeddedSelf: new Set(['c:chart']),
  preserveSpace: true,
  specialReplacement: (escaped) => `<w:t xml:space="preserve">${escaped}</w:t>`,
});

const ALT_ATTRS = { 'wp:docPr': ['descr', 'title'], 'pic:cNvPr': ['descr', 'name'], 'v:shape': ['alt'] };
const AUTHOR_ATTRS = new Set(['w:author']);

/** Ранг части для порядка обхода FR-25. */
export function partRank(name) {
  if (name === 'word/document.xml') return 0;
  if (/^word\/header/.test(name)) return 1;
  if (/^word\/footer/.test(name)) return 2;
  if (name === 'word/footnotes.xml') return 3;
  if (name === 'word/endnotes.xml') return 4;
  if (/^word\/comments/.test(name)) return 5;
  if (/^word\/glossary\/document/.test(name)) return 6;
  if (name === 'word/people.xml') return 7;
  if (/_rels\//.test(name)) return 8;
  return 9; // метаданные
}

/**
 * Части пакета Word, по которым ищут детекторы, в порядке обхода FR-25.
 * @param {string[]} names  имена записей ZIP
 * @returns {string[]}
 */
export function docxParts(names) {
  return sortParts(
    names.filter((n) => TEXT_PART_RE.test(n) || PEOPLE_PART_RE.test(n) || RELS_PART_RE.test(n) || META_PART_RE.test(n)),
    partRank,
  );
}

/** Описание пакета Word для каркаса ooxml/model.js. */
/** @type {import('../ooxml/model.js').PackageDescription} */
const DOCX_PACKAGE = {
  kind: 'docx',
  mainPart: 'word/document.xml',
  notFound: { code: 'NOT_DOCX', message: 'В архиве нет word/document.xml' },
  parts: docxParts,
  parsePart(name, xml, ctx) {
    if (TEXT_PART_RE.test(name)) return parseTextPart(name, xml, ctx);
    if (PEOPLE_PART_RE.test(name)) return parsePeoplePart(name, xml, ctx);
    if (RELS_PART_RE.test(name)) return parseRelsPart(name, xml, ctx);
    return parseMetaPart(name, xml, ctx);
  },
  warnings(entries) {
    const counts = { embeddings: 0, charts: 0, media: 0 };
    for (const e of entries) {
      if (/^word\/embeddings\//.test(e.name)) counts.embeddings++;
      else if (/^word\/charts\/[^/]+\.xml$/.test(e.name) && !/\/_rels\//.test(e.name)) counts.charts++;
      else if (/^word\/media\//.test(e.name)) counts.media++;
    }
    const embeddedTotal = counts.embeddings + counts.charts + counts.media;
    // макросы .docm (ревью WP12-B): код VBA не разбирается — предупреждение
    const macros = entries.some((e) => /(?:^|\/)vbaProject\.bin$/i.test(e.name)) ? [{ code: 'MACROS_NOT_PROCESSED', count: 1 }] : [];
    return [...(embeddedTotal ? [{ code: 'EMBEDDED_NOT_PROCESSED', count: embeddedTotal, details: counts }] : []), ...macros];
  },
};

/**
 * Разбирает .docx. Бросает CoreError с кодами NOT_DOCX / ENCRYPTED / PARSE_FAILED.
 * `hidden` — счётчики скрытого (комментарии, история правок, скрытый текст; WP12-D, docx/hidden.js): потоки не меняются.
 * @param {Uint8Array} bytes
 * @returns {DocModel & {hidden: import('../ooxml/hidden.js').HiddenCounts}}
 */
export function parseDocx(bytes) {
  const doc = parsePackage(bytes, DOCX_PACKAGE);
  return Object.assign(doc, { hidden: countDocxHidden(doc) });
}

/* ---------- Текстовые части ---------- */

/**
 * Текстовая часть Word: потоки — общим слоем по `WORDML`; здесь — атрибутные потоки (авторы, инициалы, alt, w:fldSimple/@w:instr)
 * и вид абзаца по w:pPr (0.4, К10).
 */
function parseTextPart(name, xml, ctx) {
  const authorByElement = [];
  const part = parseFlowPart(name, xml, ctx, WORDML, {
    onElement(t, parent, para, part) {
      const nm = t.name;
      // Атрибуты-авторы, alt-тексты, w:instr у fldSimple — в любом месте
      if (t.attrEnd > t.attrStart + 1) scanAttrs(part, nm, t.attrStart, t.attrEnd);
      // Вид абзаца по свойствам (0.4, К10): стиль заголовка или нумерация списка
      if (parent === 'w:pPr' && para) {
        if (nm === 'w:pStyle' && HEADING_STYLE_RE.test(getAttr(xml, t.attrStart, t.attrEnd, 'w:val')?.raw || '')) para.kind = 'heading';
        else if (nm === 'w:numPr' && para.kind === 'p') para.kind = 'li';
      }
    },
  });
  // инициалы без автора на том же элементе — отдельный вид (не привязаны к потоку-автору)
  for (const x of authorByElement) if (!x.s.linkedTo) x.s.attrKind = 'initials';
  return part;

  function scanAttrs(part, nm, from, to) {
    const altNames = ALT_ATTRS[nm];
    if (!altNames && nm !== 'w:fldSimple' && !xml.slice(from, to).includes('w:author')) return;
    const attrs = parseAttrs(xml, from, to);
    let authorStream = null;
    for (const a of attrs) {
      if (!a.raw) continue;
      if (AUTHOR_ATTRS.has(a.name)) {
        authorStream = addAttrStream(part, ctx, a, 'author', `${nm}/@${a.name}`);
      } else if (a.name === 'w:initials') {
        const s = addAttrStream(part, ctx, a, 'initials', `${nm}/@${a.name}`);
        authorByElement.push({ s, el: from });
      } else if (altNames && altNames.includes(a.name)) {
        addAttrStream(part, ctx, a, 'alt', `${nm}/@${a.name}`);
      } else if (nm === 'w:fldSimple' && a.name === 'w:instr') {
        addAttrStream(part, ctx, a, 'field-instr', `${nm}/@${a.name}`);
      }
    }
    if (authorStream) for (const x of authorByElement) if (x.el === from) x.s.linkedTo = authorStream.id;
  }
}

/* ---------- people.xml (FR-11) ---------- */

function parsePeoplePart(name, xml, ctx) {
  /** @type {Part} */
  const part = { name, kind: 'people', xml, streams: [], embeddedRuns: [] };
  let currentAuthor = null;
  tokenize(xml, (t) => {
    if (t.type !== 'open' && t.type !== 'selfclose') return;
    if (t.name === 'w15:person') {
      const a = parseAttrs(xml, t.attrStart, t.attrEnd).find((x) => x.name === 'w15:author');
      currentAuthor = a && a.raw ? addAttrStream(part, ctx, a, 'author', 'w15:person/@w15:author') : null;
    } else if (t.name === 'w15:presenceInfo') {
      const a = parseAttrs(xml, t.attrStart, t.attrEnd).find((x) => x.name === 'w15:userId');
      if (a && a.raw) {
        const s = addAttrStream(part, ctx, a, 'author-id', 'w15:presenceInfo/@w15:userId');
        if (currentAuthor) s.linkedTo = currentAuthor.id;
      }
    }
  });
  return part;
}

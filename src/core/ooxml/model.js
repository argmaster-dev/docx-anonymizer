// Модель документа OOXML: части, параграфы, потоки, virtualText и charMap (ТЗ §2, §4.2, §6.1–6.2; общий слой с 0.5, WP12-A,
// docs/contracts.md §9). Адаптер формата (Word — src/core/docx/, Excel и PowerPoint — WP12-B) описывает, какие части читать
// и в каком порядке (FR-25), и разбирает каждую часть; каркас пакета — здесь.
import { readZip, inflateEntry } from './zip.js';
import { unescapeXml } from './xml.js';
import { CoreError } from '../errors.js';

/**
 * Сегмент потока — кусок virtualText, связанный с элементом XML.
 * @typedef {object} Segment
 * @property {'text'|'special'|'soft'} kind  text = элемент текста (w:t/w:delText/w:instrText); special = w:tab/w:br/… (1 символ); soft = w:softHyphen (0 символов)
 * @property {number} vStart  начало в virtualText
 * @property {number} vEnd    конец в virtualText
 * @property {string} text    unescaped-текст (для text) или символ спецэлемента
 * @property {number} elStart начало элемента в XML-строке части ('<' открывающего тега)
 * @property {number} elEnd   конец элемента (после '>' закрывающего тега)
 * @property {number} [openEnd]       конец открывающего тега (для text)
 * @property {number} [contentStart]  начало экранированного содержимого (для text)
 * @property {number} [contentEnd]    конец экранированного содержимого (для text)
 * @property {string} [elName]        имя элемента
 * @property {boolean} [container]    спецэлемент-контейнер (drawing/pict/…): никогда не удаляется
 */

/**
 * Поток — то, по чему ищут детекторы. Сущность не пересекает границу потока.
 * @typedef {object} Stream
 * @property {string} id          уникален в документе: 'p12:live', 'a3'
 * @property {string} part        имя части: 'word/document.xml'
 * @property {string|null} pid    id параграфа ('p12') или null для атрибутных/метаданных потоков
 * @property {'live'|'deleted'|'field'|'attr'|'meta'} type
 * @property {string} [attrKind]  для attr/meta: 'author'|'initials'|'author-id'|'alt'|'field-instr'|'rel-target'|'meta'
 * @property {string} [linkedTo]  id потока-автора (для initials/author-id)
 * @property {string} [xpath]     человекочитаемая подсказка: 'w:comment/@w:author'
 * @property {string} text        virtualText
 * @property {number} pos         позиция в XML части (для порядка обхода)
 * @property {number} order       глобальный порядок обхода (FR-25)
 * @property {Segment[]} [segments]   только для live/deleted/field
 * @property {Uint32Array} [segIndex] charMap: индекс символа → индекс сегмента
 * @property {Uint32Array} [segOffset] charMap: индекс символа → смещение в тексте сегмента
 * @property {number} [valueStart] для attr/meta: диапазон экранированного значения в XML
 * @property {number} [valueEnd]
 */

/**
 * @typedef {object} Paragraph
 * @property {string} pid
 * @property {string} part
 * @property {number} depth   вложенность (0 — верхний уровень, 1 — в текстовом поле и т.п.)
 * @property {number} pos
 * @property {{live?: string, deleted?: string, field?: string}} streams  id потоков
 * @property {'p'|'heading'|'li'|string} [kind]  вид абзаца (0.4, К10): 'heading' — стиль заголовка (w:pStyle Heading1, Title, «1»…«9»),
 *   'li' — пункт списка (w:numPr); у текстовой модели (PDF) — вид блока разметки (h1/h2/li/cell/…)
 */

/**
 * @typedef {object} Part
 * @property {string} name
 * @property {'text'|'people'|'rels'|'meta'} kind
 * @property {string} xml
 * @property {Stream[]} streams          в порядке позиции в XML
 * @property {{start: number, end: number}[]} embeddedRuns  раны со встроенными объектами (w:object / c:chart, FR-15)
 * @property {import('./flow.js').FlowMarkup} [markup]  описание разметки текстовой части (по нему сериализатор правит раны)
 */

/**
 * @typedef {object} DocModel
 * @property {string} [kind]                          вид документа = DocumentAdapter.kind ('docx'; 'text' — текстовая модель PDF)
 * @property {import('./zip.js').ZipEntry[]} entries  все записи ZIP в исходном порядке
 * @property {Map<string, Part>} parts                разобранные части
 * @property {Stream[]} streams                       все потоки в порядке обхода FR-25
 * @property {Map<string, Stream>} streamById
 * @property {Paragraph[]} paragraphs                 все параграфы в порядке обхода
 * @property {{code: string, count?: number, details?: object}[]} warnings
 * @property {string} language                       'ru'|'en'|'both' — авто-определение FR-19
 * @property {number} size                            размер исходного файла
 */

/**
 * Счётчики идентификаторов, общие для всех частей документа: `p<N>` — параграфы, `a<N>` — атрибутные и метаданные потоки.
 * @typedef {{pidCounter: number, attrCounter: number, paragraphs: Paragraph[]}} ParseContext
 */

/**
 * Описание пакета для каркаса разбора (адаптер формата).
 * @typedef {object} PackageDescription
 * @property {string} kind                          doc.kind
 * @property {string} mainPart                      главная часть ('word/document.xml'): без неё — `notFound`
 * @property {{code: string, message: string}} notFound  ошибка «это не наш формат»
 * @property {(names: string[]) => string[]} parts  какие записи разбирать и в каком порядке обхода (FR-25)
 * @property {(name: string, xml: string, ctx: ParseContext) => Part} parsePart
 * @property {(entries: import('./zip.js').ZipEntry[]) => {code: string, count?: number, details?: object}[]} [warnings]
 * @property {(stream: Stream) => boolean} [languageStream]  потоки для авто-языка FR-19 (по умолчанию live-потоки главной части)
 */

/**
 * Каркас разбора пакета OOXML: ZIP → части (в порядке `desc.parts`) → потоки в порядке обхода → язык.
 * Бросает CoreError: не-ZIP/зашифрованный (zip.js), `desc.notFound`, PARSE_FAILED (не распаковалась часть).
 * @param {Uint8Array} bytes
 * @param {PackageDescription} desc
 * @returns {DocModel}
 */
export function parsePackage(bytes, desc) {
  const entries = readZip(bytes);
  if (!entries.some((e) => e.name === desc.mainPart)) throw new CoreError(desc.notFound.code, desc.notFound.message);
  /** @type {Map<string, Part>} */
  const parts = new Map();
  /** @type {ParseContext} */
  const ctx = { pidCounter: 0, attrCounter: 0, paragraphs: [] };
  const names = desc.parts(entries.map((e) => e.name));
  const byName = new Map(entries.map((e) => [e.name, e]));
  for (const name of names) parts.set(name, desc.parsePart(name, readXmlEntry(/** @type {any} */ (byName.get(name))), ctx));

  /** @type {Stream[]} */
  const streams = [];
  for (const name of names) {
    const p = /** @type {Part} */ (parts.get(name));
    p.streams.sort((a, b) => a.pos - b.pos);
    for (const s of p.streams) {
      s.order = streams.length;
      streams.push(s);
    }
  }
  const languageStream = desc.languageStream || ((s) => s.part === desc.mainPart && s.type === 'live');
  return {
    kind: desc.kind,
    entries,
    parts,
    streams,
    streamById: new Map(streams.map((s) => [s.id, s])),
    paragraphs: ctx.paragraphs,
    warnings: desc.warnings ? desc.warnings(entries) : [],
    language: detectLanguage(streams, languageStream),
    size: bytes.length,
  };
}

/**
 * Текст части пакета (UTF-8, без BOM: запишется без него, только если часть изменится). Сбой распаковки — PARSE_FAILED.
 * @param {import('./zip.js').ZipEntry} entry
 */
export function readXmlEntry(entry) {
  let xml;
  try {
    xml = new TextDecoder('utf-8').decode(inflateEntry(entry));
  } catch {
    throw new CoreError('PARSE_FAILED', `Не удалось распаковать часть ${entry.name}`);
  }
  return xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
}

/**
 * FR-19: доля кириллицы среди букв потоков основного текста (по умолчанию — live-потоки word/document.xml).
 * @param {Stream[]} streams
 * @param {(s: Stream) => boolean} [pick]
 */
export function detectLanguage(streams, pick = (s) => s.part === 'word/document.xml' && s.type === 'live') {
  let cyr = 0;
  let lat = 0;
  for (const s of streams) {
    if (!pick(s)) continue;
    for (const ch of s.text) {
      if (/[А-Яа-яЁё]/.test(ch)) cyr++;
      else if (/[A-Za-z]/.test(ch)) lat++;
    }
  }
  const total = cyr + lat;
  if (!total) return 'ru';
  const share = cyr / total;
  if (share >= 0.7) return 'ru';
  if (share <= 0.3) return 'en';
  return 'both';
}

/** Сортировка имён частей: ранг обхода FR-25, внутри ранга — естественный порядок (header2 < header10). */
export function sortParts(names, rank) {
  return names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'en', { numeric: true }));
}

/**
 * Атрибутный (`attr`) или метаданный (`meta`) поток: значение целиком, правка пересобирает его (§6.3 п.6).
 * @param {Part} part
 * @param {ParseContext} ctx
 * @param {{raw: string, valueStart: number, valueEnd: number}} a  экранированное значение и его диапазон в XML
 * @param {string} attrKind
 * @param {string} xpath
 * @param {'attr'|'meta'} [type]
 * @returns {Stream}
 */
export function addAttrStream(part, ctx, a, attrKind, xpath, type = 'attr') {
  /** @type {Stream} */
  const s = {
    id: `a${ctx.attrCounter++}`,
    part: part.name,
    pid: null,
    type,
    attrKind,
    xpath,
    text: unescapeXml(a.raw),
    pos: a.valueStart,
    order: 0,
    valueStart: a.valueStart,
    valueEnd: a.valueEnd,
  };
  part.streams.push(s);
  return s;
}

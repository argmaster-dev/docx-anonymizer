// Разбор книги Excel (.xlsx/.xlsm) в модель потоков (версия 0.5, WP12-B, Ц1, К1; docs/concept-0.5.md п. 2, docs/contracts.md §9.8).
// Поверх общего слоя OOXML (ooxml/): общие строки <si> и inline-строки <is> — абзацы с ранами <r>/<t> (фонетика <rPh> — не текст),
// числа в ячейках <v> (ИНН, счёт, телефон, СНИЛС числом; показанный текст — по формату ячейки и заголовку столбца, numfmt.js),
// кэш строковых формул (t="str"), строковые литералы формул (только поиск: формулы не меняются), константы имён книги и списки
// проверки данных (заменяются), колонтитулы листов (коды &P, &D… — вне потоков), примечания и комментарии (обычные и цепочки),
// VML примечаний, авторы, имена листов, надписи и диаграммы, умные таблицы (заголовки столбцов — вместе с ячейкой шапки),
// кэш сводных таблиц, внешние книги (кэш значений, путь — заменяется всегда), подключения к данным, пользователи общей книги,
// docProps, внешние ссылки. Части находятся по типам связей пакета (ревью WP12-B), путь — только запасной вариант.
// Листы и ячейки — таблицы `doc.blocks` для заголовков столбцов (detect/tables.js, без правок). Значения в логи не попадают (NFR-14).
import { tokenize, parseAttrs, getAttr, unescapeXml } from '../ooxml/xml.js';
import { readZip } from '../ooxml/zip.js';
import { parsePackage, readXmlEntry, sortParts, addAttrStream } from '../ooxml/model.js';
import { parseFlowPart } from '../ooxml/flow.js';
import { parseRelsPart, parseMetaPart, META_PART_RE } from '../ooxml/opc.js';
import { parseDrawingPart, addElementTextStreams, addAttrStreams, linkAuthors, embeddedWarning, readRelations, chartExternalData } from '../ooxml/dml.js';
import { CoreError } from '../errors.js';
import { parseCell, parseRange, scanFormula, formulaRefs, spreadShared } from './refs.js';
import { intDigits, parseStyles, formatOf, renderDigits, padByHeader } from './numfmt.js';
import { tableBlocks, headerRow } from '../table-blocks.js';

/** Разметка общих и inline-строк SpreadsheetML: текст <t> прямо в <si>/<is> или в ранах <r>; <rPh> (фонетика) — не текст. */
/** @type {import('../ooxml/flow.js').FlowMarkup} */
export const SML = Object.freeze({
  paragraph: 'si',
  paragraphs: new Set(['si', 'is']),
  run: 'r',
  text: { t: 'live' },
  textParents: new Set(['r', 'si', 'is']),
  specials: {},
  soft: new Set(),
  containers: new Set(),
  specialParents: new Set(['r']),
  deleted: new Set(),
  embeddedOpen: new Set(),
  embeddedSelf: new Set(),
  preserveSpace: true,
  specialReplacement: (escaped) => `<t xml:space="preserve">${escaped}</t>`,
});

/** Примечание (legacy comments): <comment><text><r><t>…</t></r></text></comment>. */
const SML_COMMENT = Object.freeze({ ...SML, paragraph: 'text', paragraphs: new Set(['text']), textParents: new Set(['r', 'text']) });

/** Комментарий-цепочка (threaded comments): текст <text> прямо в <threadedComment>, без ранов. */
const SML_THREADED = Object.freeze({
  ...SML,
  paragraph: 'threadedComment',
  paragraphs: new Set(['threadedComment']),
  text: { text: 'live' },
  textParents: new Set(['threadedComment']),
  preserveSpace: false,
});

export const SHARED_STRINGS = 'xl/sharedStrings.xml';
export const WORKBOOK = 'xl/workbook.xml';

/** Роль части по типу связи (последнее звено URI типа). */
const ROLE_BY_TYPE = {
  officeDocument: 'workbook',
  worksheet: 'sheet',
  sharedStrings: 'shared',
  comments: 'comments',
  threadedComment: 'threaded',
  person: 'persons',
  drawing: 'drawing',
  chartUserShapes: 'drawing',
  diagramData: 'drawing',
  diagramDrawing: 'drawing',
  chart: 'chart',
  pivotCacheDefinition: 'pivot',
  pivotCacheRecords: 'pivot',
  pivotTable: 'pivotTable',
  table: 'table',
  externalLink: 'external',
  connections: 'connections',
  usernames: 'usernames',
  vmlDrawing: 'vml',
  styles: 'styles',
};
/** Запасной вариант — по пути (пакет без связей или с нестандартными типами). */
const ROLE_BY_PATH = [
  [/^xl\/worksheets\/[^/]+\.xml$/, 'sheet'],
  [/^xl\/sharedStrings\.xml$/, 'shared'],
  [/^xl\/comments[^/]*\.xml$|^xl\/comments\/[^/]+\.xml$/, 'comments'],
  [/^xl\/threadedComments\/[^/]+\.xml$/, 'threaded'],
  [/^xl\/persons\/[^/]+\.xml$/, 'persons'],
  [/^xl\/drawings\/[^/]+\.xml$/, 'drawing'],
  [/^xl\/drawings\/[^/]+\.vml$/, 'vml'],
  [/^xl\/charts\/chart[^/]*\.xml$/, 'chart'],
  [/^xl\/pivotCache\/pivotCache(?:Definition|Records)[^/]*\.xml$/, 'pivot'],
  [/^xl\/pivotTables\/[^/]+\.xml$/, 'pivotTable'],
  [/^xl\/tables\/[^/]+\.xml$/, 'table'],
  [/^xl\/externalLinks\/[^/]+\.xml$/, 'external'],
  [/^xl\/connections\.xml$/, 'connections'],
  [/^xl\/usernames\.xml$/, 'usernames'],
];
const RELS_RE = /(?:^|\/)_rels\/[^/]+\.rels$/;
/** Встроенные пакеты (книги диаграмм, OLE) — не части текста: их обрабатывает core/embedded.js. */
const EMBEDDED_RE = /(?:^|\/)embeddings\//;

/** Ранг роли для порядка обхода (FR-25): ячейки → примечания → фигуры и диаграммы → книга (имена листов) → кэш → связи → свойства. */
const RANK = {
  shared: 0,
  sheet: 1,
  comments: 2,
  vml: 2,
  threaded: 3,
  persons: 4,
  usernames: 4,
  drawing: 5,
  chart: 6,
  table: 6,
  workbook: 7,
  pivot: 8,
  pivotTable: 8,
  external: 8,
  connections: 8,
  rels: 9,
  meta: 10,
};

/**
 * Роль части: по связям пакета, иначе по пути; связи — 'rels', docProps — 'meta'; прочее (стили, тема, бинарные) — null.
 * @param {string} name
 * @param {(part: string) => string[]} [typesOf]
 */
export function xlsxRole(name, typesOf = () => []) {
  if (EMBEDDED_RE.test(name)) return null;
  if (RELS_RE.test(name)) return 'rels';
  if (META_PART_RE.test(name)) return 'meta';
  for (const t of typesOf(name)) if (ROLE_BY_TYPE[t] && ROLE_BY_TYPE[t] !== 'styles') return ROLE_BY_TYPE[t];
  if (name === WORKBOOK) return 'workbook';
  for (const [re, role] of ROLE_BY_PATH) if (re.test(name)) return role;
  return null;
}

/**
 * Части книги с текстом в порядке обхода FR-25 (без связей пакета — по путям).
 * @param {string[]} names
 * @param {(part: string) => string[]} [typesOf]
 */
export function xlsxParts(names, typesOf) {
  const role = (n) => xlsxRole(n, typesOf);
  return sortParts(
    names.filter((n) => role(n)),
    (n) => RANK[/** @type {string} */ (role(n))] ?? 10,
  );
}

/** Число в ячейке, похожее на идентификатор: целое из 6–15 цифр (ИНН, СНИЛС, телефон, паспорт, ОГРН; даты и суммы — короче или с дробью). */
const ID_DIGITS_RE = /^\d{6,15}$/;
/** Элементы с формулами вне ячеек: условное форматирование и x14 — формулы (не меняются); списки проверки данных — константы. */
const FORMULA_ELEMENTS = new Set(['formula', 'xm:f']);
const DV_FORMULAS = new Set(['formula1', 'formula2']);
const HEADER_FOOTER = new Set(['oddHeader', 'oddFooter', 'evenHeader', 'evenFooter', 'firstHeader', 'firstFooter']);
/** Коды колонтитула Excel: &L &C &R &P &N &D &T &F &A &Z &G &B &I &U &E &S &X &Y &H &K…, &"шрифт", &12 (размер), && — «&». */
const HF_CODE_RE = /&(?:"[^"]*"|K[0-9A-Fa-f]{6}|K\d\d[+-]\d{3}|\d{1,3}|[LCRPNDTFAZGBIUESXYHlcrpndtfazgbiuesxyh&]|$)/g;
/** Подсказки проверки данных — текст для пользователя. */
const DV_ATTRS = new Set(['prompt', 'promptTitle', 'error', 'errorTitle']);

/**
 * Сведения о книге для сериализации и предупреждений (doc.xlsx).
 * @typedef {object} XlsxInfo
 * @property {{name: string, part: string | null, stream: import('../ooxml/model.js').Stream | null}[]} sheets  листы в порядке книги
 * @property {{part: string, start: number, end: number, kind: 'formula'|'location'|'sheet'}[]} sites  места с именами листов: формулы, ссылки «#Лист!A1», источник сводной
 * @property {import('./refs.js').RefArea[]} refAreas  на что ссылаются формулы и диаграммы (граф ссылок, грубо)
 * @property {{at: number, attrEnd: number | null, self: boolean} | null} calc  <calcPr> книги (или место вставки) — пересчёт при открытии
 * @property {string} workbook  главная часть книги
 * @property {{columnStream: string, headerStream: string | null}[]} tableColumns  заголовок столбца умной таблицы ↔ поток ячейки шапки
 * @property {Map<string, {part: string, tagStart: number, tagEnd: number, attrStart: number, attrEnd: number}>} pivotItems  sharedItems сводной по потоку
 * @property {Map<string, {at: number}>} pivotRoots  корень определения сводной (для refreshOnLoad)
 * @property {{part: string, valueStart: number, valueEnd: number, index: number}[]} externalPaths  пути внешних книг (заменяются всегда)
 * @property {number} connections  подключений к данным
 */

/**
 * Разбирает .xlsx/.xlsm. Бросает CoreError: NOT_SUPPORTED (не ZIP, нет книги), ENCRYPTED, PARSE_FAILED.
 * @param {Uint8Array} bytes
 * @returns {import('../ooxml/model.js').DocModel & {xlsx: XlsxInfo, blocks: any[], viewParts: string[]}}
 */
export function parseXlsx(bytes) {
  let entries;
  try {
    entries = readZip(bytes);
  } catch (e) {
    throw notSupported(e);
  }
  const byName = new Map(entries.map((e) => [e.name, e]));
  const rels = readRelations(entries);
  // главная часть — по связи officeDocument корня пакета (обычно xl/workbook.xml)
  const main = rels.from('').find((r) => r.type === 'officeDocument' && byName.has(r.target))?.target || WORKBOOK;
  // главная часть — книга (а не документ Word или презентация с тем же устройством пакета)
  if (!byName.has(main) || !/<(?:\w+:)?workbook[\s>]/.test(readXmlEntry(/** @type {any} */ (byName.get(main))).slice(0, 2000)))
    throw new CoreError('NOT_SUPPORTED', 'В архиве нет книги Excel');
  const typesOf = (n) => (n === main ? ['officeDocument'] : rels.typesOf(n));
  // книга, её связи и стили — заранее: имена листов нужны при разборе листов (ссылки, таблицы), стили — для показа чисел
  const wbRels = rels.from(main);
  const sheets = readSheets(readXmlEntry(/** @type {any} */ (byName.get(main))), wbRels);
  const stylesPart = wbRels.find((r) => r.type === 'styles')?.target;
  const styles = parseStyles(stylesPart && byName.has(stylesPart) ? readXmlEntry(/** @type {any} */ (byName.get(stylesPart))) : '');
  const sheetByPart = new Map(sheets.map((s, i) => [s.part, { ...s, index: i }]).filter(([p]) => p));
  /** @type {XlsxInfo} */
  const info = {
    sheets: sheets.map((s) => ({ name: s.name, part: s.part, stream: null })),
    sites: [],
    refAreas: [],
    calc: null,
    workbook: main,
    tableColumns: [],
    pivotItems: new Map(),
    pivotRoots: new Map(),
    externalPaths: [],
    connections: 0,
  };
  /** книги данных диаграмм (удаляются при stripEmbedded) */
  const chartEmbeds = [];
  /** лист → его ячейки: «лист!A1» → id потока ячейки (для заголовков умных таблиц) */
  const cellStream = new Map();
  /** часть умной таблицы → часть листа (по связям листа) */
  const tableSheet = new Map();
  for (const r of rels.all) if (r.type === 'table' && !r.external) tableSheet.set(r.target, r.source);
  /** части внешних книг — их связи (externalLinkPath) заменяются всегда */
  const externalParts = new Set(entries.map((e) => e.name).filter((n) => xlsxRole(n, typesOf) === 'external'));
  /** @type {any[]} */
  const blocks = [];
  /** @type {(string | null)[]} */
  let siPids = [];
  let headSeq = 0;
  /** имена полей кэша сводной по части определения; номер таблицы заголовков сводной */
  const pivotFields = new Map();
  let pivotSeq = 0;
  /** @type {Map<string, string>} pid → «таблица:строка» первого вхождения */
  const seenData = new Map();
  /** @type {Map<string, string>} pid абзаца → текст его live-потока */
  const textByPid = new Map();
  /** @type {Map<string, string>} pid абзаца → id его live-потока */
  const streamByPid = new Map();
  const rememberTexts = (part) => {
    for (const st of part.streams)
      if (st.type === 'live' && st.pid) {
        textByPid.set(st.pid, st.text);
        streamByPid.set(st.pid, st.id);
      }
  };
  const definedAreas = new Map();
  const formulaCodes = [];

  /** @type {import('../ooxml/model.js').PackageDescription} */
  const desc = {
    kind: 'xlsx',
    mainPart: main,
    notFound: { code: 'NOT_SUPPORTED', message: 'В архиве нет книги Excel' },
    parts: (names) => xlsxParts(names, typesOf),
    parsePart(name, xml, ctx) {
      const role = xlsxRole(name, typesOf);
      if (role === 'shared') {
        const part = parseFlowPart(name, xml, ctx, SML);
        siPids = sharedStringPids(xml, ctx, name);
        for (const p of ctx.paragraphs) if (p.part === name) p.kind = 'cell';
        rememberTexts(part);
        return part;
      }
      if (role === 'sheet') return parseSheet(name, xml, ctx, sheetByPart.get(name));
      if (role === 'comments') {
        const part = parseFlowPart(name, xml, ctx, SML_COMMENT);
        addElementTextStreams(part, ctx, (n) => (n === 'author' ? 'author' : null));
        // заглушка цепочки комментариев: автор «tc={GUID}» — не человек (настоящий автор — в persons/person.xml)
        part.streams = part.streams.filter((x) => !(x.attrKind === 'author' && /^tc=\{/.test(x.text)));
        return part;
      }
      if (role === 'vml') {
        // VML примечаний: Excel обычно не пишет туда текст, но другие инструменты — пишут (<v:textbox><div>…)
        const part = { name, kind: 'text', xml, streams: [], embeddedRuns: [] };
        addElementTextStreams(part, ctx, (n, stack) => (stack.some((x) => /(?:^|:)textbox$/.test(x)) ? 'alt' : null));
        return part;
      }
      if (role === 'threaded') return parseFlowPart(name, xml, ctx, SML_THREADED);
      if (role === 'persons') {
        const part = { name, kind: 'people', xml, streams: [], embeddedRuns: [] };
        linkAuthors(addAttrStreams(part, ctx, { person: { displayName: 'author', userId: 'author-id' } }));
        return part;
      }
      if (role === 'usernames') {
        const part = { name, kind: 'people', xml, streams: [], embeddedRuns: [] };
        addAttrStreams(part, ctx, { userInfo: { name: 'author' } });
        return part;
      }
      if (role === 'drawing') return parseDrawingPart(name, xml, ctx);
      if (role === 'chart') {
        const part = parseDrawingPart(name, xml, ctx);
        // кэш подписей рядов и категорий: <c:strCache><c:pt><c:v>…</c:v>; ссылки <c:f> — в граф и в переименование листов
        addElementTextStreams(part, ctx, (n, stack) => (n === 'c:v' && stack.some((x) => x === 'c:strCache' || x === 'c:lvl') ? 'cell-cache' : null));
        collectSites(
          name,
          xml,
          (n) => n === 'c:f',
          (f) => info.refAreas.push(...formulaRefs(f, '')),
        );
        const ext = chartExternalData(name, xml, rels.from(name));
        if (ext) chartEmbeds.push(ext);
        return part;
      }
      if (role === 'table') return parseTable(name, xml, ctx);
      if (role === 'workbook') return parseWorkbook(name, xml, ctx);
      if (role === 'pivot') return parsePivot(name, xml, ctx);
      if (role === 'pivotTable') return parsePivotTable(name, xml, ctx);
      if (role === 'external') return parseExternal(name, xml, ctx);
      if (role === 'connections') {
        const part = { name, kind: 'text', xml, streams: [], embeddedRuns: [] };
        // строка подключения — 'conn-string': логин и пароль в ней (UID=…;PWD=…) снимаются всегда (план адаптера)
        const spec = { name: 'alt', description: 'alt', connection: 'conn-string', command: 'alt', url: 'alt', sourceFile: 'alt', odcFile: 'alt' };
        const found = addAttrStreams(part, ctx, { connection: spec, dbPr: spec, olapPr: spec, webPr: spec, textPr: spec });
        info.connections += new Set(
          found.filter((x) => x.attr === 'connection' || x.attr === 'command' || x.attr === 'url' || x.attr === 'sourceFile').map((x) => x.el),
        ).size;
        return part;
      }
      if (role === 'rels') {
        const part = parseRelsPart(name, xml, ctx);
        // путь внешней книги (file:///C:/Users/<логин>/…/<ФИО>.xlsx) — не данные ячеек, а след: заменяется всегда
        const source = name.replace(/_rels\/([^/]+)\.rels$/, '$1');
        if (externalParts.has(source)) {
          // путь (`rel-external`) заменяет общий сериализатор пакета; здесь — только счёт для предупреждения
          for (const s of part.streams) {
            info.externalPaths.push({
              part: name,
              valueStart: /** @type {number} */ (s.valueStart),
              valueEnd: /** @type {number} */ (s.valueEnd),
              index: info.externalPaths.length + 1,
            });
          }
        }
        return part;
      }
      return parseMetaPart(name, xml, ctx);
    },
    warnings: (list) => embeddedWarning(list, 'xl/'),
    languageStream: (s) => s.type === 'live' && (s.part === SHARED_STRINGS || xlsxRole(s.part, typesOf) === 'sheet' || xlsxRole(s.part, typesOf) === 'shared'),
  };

  let doc;
  try {
    doc = parsePackage(bytes, desc);
  } catch (e) {
    throw notSupported(e);
  }
  // имена книги, на которые ссылаются формулы, — тоже в граф ссылок
  for (const [nm, areas] of definedAreas) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}_.])${nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_.(])`, 'iu');
    if (formulaCodes.some((c) => re.test(c))) info.refAreas.push(...areas);
  }
  const sharedPart = entries.map((e) => e.name).find((n) => xlsxRole(n, typesOf) === 'shared');
  return Object.assign(doc, {
    xlsx: info,
    chartEmbeds,
    blocks,
    viewParts: [...(sharedPart ? [sharedPart] : []), ...info.sheets.map((s) => s.part).filter(Boolean)],
  });

  /* ---------- общие строки ---------- */

  /** Индекс общей строки → pid её абзаца (пустой <si/> — null: индексы ячеек не сдвигаются). */
  function sharedStringPids(xml, ctx, name) {
    const byPos = new Map(ctx.paragraphs.filter((p) => p.part === name).map((p) => [p.pos, p.pid]));
    const out = [];
    tokenize(xml, (t) => {
      if (t.name !== 'si') return;
      if (t.type === 'open') out.push(byPos.get(t.start) ?? null);
      else if (t.type === 'selfclose') out.push(null);
    });
    return out;
  }

  /* ---------- лист ---------- */

  /**
   * Лист: inline-строки (абзацы), числа-идентификаторы и кэш строковых формул (потоки-значения со своим абзацем),
   * литералы формул (поток без правки), колонтитулы (куски текста между кодами), отображаемый текст ссылок, подсказки и
   * списки проверки данных, значения фильтров; таблица ячеек для заголовков столбцов; формулы — в граф ссылок и в места
   * переименования листов.
   */
  function parseSheet(name, xml, ctx, sheet) {
    const firstPara = ctx.paragraphs.length;
    const part = parseFlowPart(name, xml, ctx, SML);
    rememberTexts(part);
    const sheetName = sheet?.name ?? '';
    // лист без записи в книге (битая связь) — своя таблица после листов книги
    const tableIndex = sheet ? sheet.index : info.sheets.length + blocks.length;
    const isPid = new Map(ctx.paragraphs.slice(firstPara).map((p) => [p.pos, p.pid]));
    for (const p of ctx.paragraphs.slice(firstPara)) p.kind = 'cell';
    /** @type {any[]} */
    const cells = [];
    const merges = [];
    /** @type {any} */
    let cell = null;
    let fOpen = null;
    let vOpen = null;
    let hfOpen = null;
    let otherFormula = null;
    tokenize(xml, (t) => {
      const nm = t.name;
      if (t.type === 'open' || t.type === 'selfclose') {
        if (nm === 'c') {
          const attrs = attrMap(xml, t);
          const pos = parseCell(attrs.r);
          cell = {
            ref: attrs.r,
            row: pos?.row ?? 0,
            col: pos?.col ?? 0,
            t: attrs.t || 'n',
            s: attrs.s,
            openStart: t.start,
            openEnd: t.end,
            attrStart: t.attrStart,
            attrEnd: t.attrEnd,
          };
          if (t.type === 'selfclose') cell = null;
        } else if (cell && nm === 'f') {
          const attrs = attrMap(xml, t);
          cell.f = { attrs, start: t.end, end: t.end };
          if (t.type === 'open') fOpen = cell.f;
        } else if (cell && nm === 'v' && t.type === 'open') vOpen = { elStart: t.start, start: t.end };
        else if (cell && nm === 'is') cell.isPos = t.start;
        else if (nm === 'mergeCell') {
          const r = parseRange(getAttr(xml, t.attrStart, t.attrEnd, 'ref')?.raw);
          if (r) merges.push(r);
        } else if (HEADER_FOOTER.has(nm) && t.type === 'open') hfOpen = { start: t.end, name: nm };
        else if ((FORMULA_ELEMENTS.has(nm) || DV_FORMULAS.has(nm)) && t.type === 'open') otherFormula = { start: t.end, name: nm };
        else if (nm === 'hyperlink') {
          for (const a of parseAttrs(xml, t.attrStart, t.attrEnd)) {
            if (!a.raw) continue;
            if (a.name === 'display' || a.name === 'tooltip') addAttrStream(part, ctx, a, 'alt', `hyperlink/@${a.name}`);
            else if (a.name === 'location') info.sites.push({ part: name, start: a.valueStart, end: a.valueEnd, kind: 'location' });
          }
        } else if (nm === 'dataValidation' || nm === 'x14:dataValidation') {
          for (const a of parseAttrs(xml, t.attrStart, t.attrEnd))
            if (a.raw && DV_ATTRS.has(a.name)) addAttrStream(part, ctx, a, 'alt', `dataValidation/@${a.name}`);
        } else if (nm === 'filter' || nm === 'customFilter') {
          const a = getAttr(xml, t.attrStart, t.attrEnd, 'val');
          if (a && a.raw) addAttrStream(part, ctx, a, 'alt', `${nm}/@val`);
        }
      } else if (t.type === 'close') {
        if (nm === 'f' && fOpen) {
          fOpen.end = t.start;
          fOpen = null;
        } else if (nm === 'v' && vOpen && cell) {
          cell.v = { elStart: vOpen.elStart, elEnd: t.end, start: vOpen.start, end: t.start };
          vOpen = null;
        } else if (nm === 'c' && cell) {
          cells.push(cell);
          cell = null;
        } else if (hfOpen && nm === hfOpen.name) {
          addHeaderFooter(part, ctx, xml, hfOpen.start, t.start);
          hfOpen = null;
        } else if (otherFormula && nm === otherFormula.name) {
          // список проверки данных («"Иванов И.И.,Петров П.П."») — константа: литералы заменяются; условное форматирование — формула
          addFormula(name, xml, otherFormula.start, t.start, sheetName, part, ctx, DV_FORMULAS.has(nm) ? 'name-literal' : 'formula-literal');
          otherFormula = null;
        }
      }
    });

    /** @type {import('../table-blocks.js').TableCell[]} */
    const tableCells = [];
    /** числа-кандидаты: строятся после шапки (ведущие нули по заголовку столбца) */
    const numbers = [];
    for (const c of cells) {
      if (c.f && c.f.end > c.f.start) {
        const refs = addFormula(name, xml, c.f.start, c.f.end, sheetName, part, ctx, 'formula-literal');
        const range = c.f.attrs.t === 'shared' ? parseRange(c.f.attrs.ref) : null;
        if (range) info.refAreas.push(...spreadShared(refs, range));
        else info.refAreas.push(...refs);
      }
      const raw = c.v ? xml.slice(c.v.start, c.v.end) : '';
      let pid = null;
      if (c.t === 's' && c.v) pid = siPids[Number(raw)] ?? null;
      else if (c.t === 'inlineStr' && c.isPos != null) pid = isPid.get(c.isPos) ?? null;
      else if (c.v && c.t === 'n') {
        const digits = intDigits(raw);
        if (digits && digits.length >= 5 && digits.length <= 15) numbers.push({ c, digits });
        continue;
      } else if (c.v && c.t === 'str' && raw.trim()) {
        // кэш строковой формулы: поток-значение со своим абзацем (заголовок столбца, вкладка «Текст»)
        pid = valueStream(part, ctx, name, c, unescapeXml(raw), 'cell-cache').pid;
      }
      if (!pid) continue;
      pushCell(tableCells, merges, { pid, text: textByPid.get(pid) ?? '', row: c.row, col: c.col });
      const sid = streamByPid.get(pid);
      if (sid) cellStream.set(`${name}!${c.row}:${c.col}`, sid);
    }
    // шапка листа — по текстовым ячейкам; числа под ней получают ведущие нули по заголовку столбца
    const head = headerRow(tableCells, 2);
    const headerText = new Map(head === null ? [] : tableCells.filter((x) => x.row === head).map((x) => [x.col, x.text]));
    for (const { c, digits } of numbers) {
      const shown = renderDigits(digits, formatOf(styles, c.s));
      const text = shown ?? (head !== null && c.row > head ? padByHeader(digits, headerText.get(c.col)) : digits);
      if (!ID_DIGITS_RE.test(text.replace(/\D/g, ''))) continue;
      const s = valueStream(part, ctx, name, c, text, 'cell-number');
      s.cell = {
        sheet: sheetName,
        row: c.row,
        col: c.col,
        openStart: c.openStart,
        openEnd: c.openEnd,
        attrStart: c.attrStart,
        attrEnd: c.attrEnd,
        v: c.v,
        formula: !!c.f,
        tag: 'c',
      };
      pushCell(tableCells, merges, { pid: s.pid, text, row: c.row, col: c.col });
      cellStream.set(`${name}!${c.row}:${c.col}`, s.id);
    }
    // таблица листа для заголовков столбцов (core/table-blocks.js): шапка, заголовок листа над ней; общая строка в данных —
    // по первому вхождению (у одной строки в разных столбцах заголовок был бы неоднозначным)
    for (const b of tableBlocks(tableCells, { index: tableIndex, minHeader: 2, fakePid: () => `h${headSeq++}` })) {
      const at = `${b.table.index}:${b.table.row}`;
      const first = seenData.get(b.pid);
      if (first !== undefined && first !== at) continue;
      seenData.set(b.pid, at);
      blocks.push(b);
    }
    // абзацы части — по позиции (inline-строки и числа вперемешку, как в листе)
    const tail = ctx.paragraphs.splice(firstPara).sort((a, b) => a.pos - b.pos);
    ctx.paragraphs.push(...tail);
    return part;
  }

  /** Ячейка в таблицу заголовков; объединённая ячейка (B1:D1) — над каждым столбцом диапазона. */
  function pushCell(list, merges, x) {
    list.push(x);
    const m = merges.find((r) => r.r1 === x.row && r.c1 === x.col && r.c2 > r.c1);
    if (m) for (let col = m.c1 + 1; col <= Math.min(m.c2, m.c1 + 50); col++) list.push({ ...x, col });
  }

  /** Поток-значение ячейки (`<v>`) со своим абзацем: текст — показанный (число — по формату), правка — планом адаптера. */
  function valueStream(part, ctx, name, c, text, kind) {
    /** @type {any} */
    const s = {
      id: `a${ctx.attrCounter++}`,
      part: name,
      pid: null,
      type: 'attr',
      attrKind: kind,
      xpath: 'c/v',
      text,
      pos: c.v.start,
      order: 0,
      valueStart: c.v.start,
      valueEnd: c.v.end,
    };
    part.streams.push(s);
    const para = { pid: `p${ctx.pidCounter++}`, part: name, depth: 0, pos: c.v.start, streams: { live: s.id }, kind: 'cell' };
    ctx.paragraphs.push(para);
    s.pid = para.pid;
    textByPid.set(para.pid, text);
    streamByPid.set(para.pid, s.id);
    return s;
  }

  /** Формулы-ссылки вне листов (<c:f> диаграмм): место переименования листов и граф ссылок. */
  function collectSites(name, xml, pred, onFormula) {
    let open = null;
    tokenize(xml, (t) => {
      if (t.type === 'open' && pred(t.name)) open = { name: t.name, start: t.end };
      else if (t.type === 'close' && open && t.name === open.name) {
        info.sites.push({ part: name, start: open.start, end: t.start, kind: 'formula' });
        onFormula(unescapeXml(xml.slice(open.start, t.start)));
        open = null;
      }
    });
  }

  /**
   * Формула: место переименования листов, ссылки — в граф; строковые литералы длиннее двух символов — потоки:
   * `formula-literal` (формула ячейки или условного формата — не меняется, предупреждение) или `name-literal` (константа имени
   * книги, список проверки данных — литерал заменяется). Возвращает ссылки формулы.
   */
  function addFormula(name, xml, start, end, sheetName, part, ctx, kind) {
    info.sites.push({ part: name, start, end, kind: 'formula' });
    const raw = xml.slice(start, end);
    const { text: f, map } = unescapeWithMap(raw);
    const { strings, code } = scanFormula(f);
    formulaCodes.push(code);
    for (const s of strings) {
      const text = f.slice(s.start, s.end).replace(/""/g, '"');
      if (text.trim().length < 3) continue;
      part.streams.push({
        id: `a${ctx.attrCounter++}`,
        part: name,
        pid: null,
        type: 'attr',
        attrKind: kind,
        xpath: 'f',
        text,
        pos: start + map[s.start],
        order: 0,
        // для константы — сырой диапазон литерала (без кавычек) в XML части
        valueStart: start + map[s.start],
        valueEnd: start + map[s.end],
      });
    }
    return formulaRefs(f, sheetName);
  }

  /** Колонтитул листа: куски текста между кодами — потоки `header-footer` (коды и их порядок не меняются). */
  function addHeaderFooter(part, ctx, xml, start, end) {
    const raw = xml.slice(start, end);
    const { text, map } = unescapeWithMap(raw);
    let pos = 0;
    const pieces = [];
    HF_CODE_RE.lastIndex = 0;
    let m;
    while ((m = HF_CODE_RE.exec(text))) {
      if (m.index > pos) pieces.push([pos, m.index]);
      pos = m.index + m[0].length;
      if (!m[0].length) HF_CODE_RE.lastIndex++;
    }
    if (pos < text.length) pieces.push([pos, text.length]);
    for (const [a, b] of pieces) {
      if (!text.slice(a, b).trim()) continue;
      addAttrStream(part, ctx, { raw: raw.slice(map[a], map[b]), valueStart: start + map[a], valueEnd: start + map[b] }, 'header-footer', 'headerFooter');
    }
  }

  /* ---------- умная таблица ---------- */

  /**
   * Умная таблица (ListObject): заголовок столбца `tableColumn/@name` обязан совпадать с текстом ячейки шапки — поток
   * `table-column`, связанный с потоком ячейки (план адаптера держит их одинаковыми); значения автофильтра — `alt`.
   */
  function parseTable(name, xml, ctx) {
    const part = { name, kind: 'text', xml, streams: [], embeddedRuns: [] };
    const sheetPart = tableSheet.get(name);
    let range = null;
    let col = 0;
    let headerRows = 1;
    tokenize(xml, (t) => {
      if (t.type !== 'open' && t.type !== 'selfclose') return;
      if (t.name === 'table') {
        const a = attrMap(xml, t);
        range = parseRange(a.ref);
        headerRows = a.headerRowCount === '0' ? 0 : 1;
      } else if (t.name === 'tableColumn') {
        const a = getAttr(xml, t.attrStart, t.attrEnd, 'name');
        if (a && a.raw) {
          const s = addAttrStream(part, ctx, a, 'table-column', 'tableColumn/@name');
          const headerStream = range && headerRows && sheetPart ? cellStream.get(`${sheetPart}!${range.r1}:${range.c1 + col}`) || null : null;
          info.tableColumns.push({ columnStream: s.id, headerStream });
        }
        col++;
      } else if (t.name === 'filter' || t.name === 'customFilter') {
        const a = getAttr(xml, t.attrStart, t.attrEnd, 'val');
        if (a && a.raw) addAttrStream(part, ctx, a, 'alt', `${t.name}/@val`);
      }
    });
    return part;
  }

  /* ---------- сводная таблица ---------- */

  /**
   * Кэш сводной таблицы: строки `<s v>` — `cell-cache`; числа-идентификаторы `<n v>` — `pivot-number` (станут строками),
   * `minValue`/`maxValue` — `pivot-minmax` (удаляются вместе с признаками типов набора), `refreshedBy` — автор.
   */
  function parsePivot(name, xml, ctx) {
    const part = { name, kind: 'text', xml, streams: [], embeddedRuns: [] };
    // поля кэша: имена из определения (cacheField/@name) — заголовки чисел (ведущие нули, метка «Телефон» над номером);
    // записи (pivotCacheRecords) — поле по номеру дочернего элемента <r>, имена — из своего определения (по связи)
    const def = rels.all.find((r) => r.type === 'pivotCacheRecords' && r.target === name)?.source;
    const fields = def ? pivotFields.get(def) || [] : [];
    if (!def) pivotFields.set(name, fields);
    const table = `piv${pivotSeq++}`;
    let items = null;
    let field = -1;
    let row = 0;
    let child = 0;
    let inRecord = false;
    const header = new Set();
    const numberStream = (t, a, kind, col) => {
      const digits = /** @type {string} */ (intDigits(a.raw));
      const text = padByHeader(digits, fields[col]);
      /** @type {any} */
      const s = addAttrStream(part, ctx, { ...a, raw: text }, kind, kind === 'pivot-number' ? 'n/@v' : 'sharedItems/@minmax');
      s.text = text;
      const para = { pid: `p${ctx.pidCounter++}`, part: name, depth: 0, pos: a.valueStart, streams: { live: s.id }, kind: 'cell' };
      ctx.paragraphs.push(para);
      s.pid = para.pid;
      // таблица «имя поля | значения» — заголовок столбца для детекторов (detect/tables.js)
      if (fields[col] && !header.has(col)) {
        header.add(col);
        blocks.push({ pid: `h${headSeq++}`, kind: 'cell', text: fields[col], table: { index: table, row: 0, col } });
      }
      blocks.push({ pid: s.pid, kind: 'cell', text, table: { index: table, row: ++row, col } });
      return s;
    };
    let depth = 0;
    tokenize(xml, (t) => {
      if (t.type === 'close') {
        if (t.name === 'sharedItems') items = null;
        if (inRecord && --depth === 0) inRecord = false;
        return;
      }
      if (t.type !== 'open' && t.type !== 'selfclose') return;
      const nm = t.name;
      // в записи <r> номер поля — номер прямого дочернего элемента
      let col = field;
      if (inRecord) {
        if (depth === 1) col = child++;
        if (t.type === 'open') depth++;
      }
      if (nm === 'pivotCacheDefinition') {
        info.pivotRoots.set(name, { at: t.attrEnd });
        const a = getAttr(xml, t.attrStart, t.attrEnd, 'refreshedBy');
        if (a && a.raw) addAttrStream(part, ctx, a, 'author', 'pivotCacheDefinition/@refreshedBy');
      } else if (nm === 'cacheField') {
        field++;
        const a = getAttr(xml, t.attrStart, t.attrEnd, 'name');
        fields[field] = a ? unescapeXml(a.raw) : '';
      } else if (nm === 'r' && t.type === 'open' && !inRecord) {
        inRecord = true;
        depth = 1;
        child = 0;
      } else if (nm === 'worksheetSource') {
        // источник сводной таблицы: <worksheetSource sheet="Лист1"> — имя листа переименовывается вместе с листом
        const a = getAttr(xml, t.attrStart, t.attrEnd, 'sheet');
        if (a) info.sites.push({ part: name, start: a.valueStart, end: a.valueEnd, kind: 'sheet' });
      } else if (nm === 'sharedItems') {
        const tag = { part: name, tagStart: t.start, tagEnd: t.end, attrStart: t.attrStart, attrEnd: t.attrEnd };
        items = t.type === 'open' ? tag : null;
        for (const a of parseAttrs(xml, t.attrStart, t.attrEnd)) {
          if ((a.name === 'minValue' || a.name === 'maxValue') && ID_DIGITS_RE.test(intDigits(a.raw) || '')) {
            const st = numberStream(t, a, 'pivot-minmax', field);
            info.pivotItems.set(st.id, tag);
          }
        }
      } else if (nm === 's') {
        const a = getAttr(xml, t.attrStart, t.attrEnd, 'v');
        if (a && a.raw) addAttrStream(part, ctx, a, 'cell-cache', 's/@v');
      } else if (nm === 'n' && t.type === 'selfclose') {
        const a = getAttr(xml, t.attrStart, t.attrEnd, 'v');
        const digits = a ? intDigits(a.raw) : null;
        if (a && digits && digits.length >= 5 && ID_DIGITS_RE.test(padByHeader(digits, fields[col]))) {
          const st = numberStream(t, a, 'pivot-number', col);
          st.el = { start: t.start, end: t.end, attrStart: t.attrStart, attrEnd: t.attrEnd };
          if (items) info.pivotItems.set(st.id, items);
        }
      }
    });
    return part;
  }

  /** Сводная таблица: её имя, подписи полей и данных, элементы с заданным текстом (item/@n) — `alt`. */
  function parsePivotTable(name, xml, ctx) {
    const part = { name, kind: 'text', xml, streams: [], embeddedRuns: [] };
    addAttrStreams(part, ctx, {
      pivotTableDefinition: { name: 'alt', dataCaption: 'alt', grandTotalCaption: 'alt', rowHeaderCaption: 'alt', colHeaderCaption: 'alt' },
      pivotField: { name: 'alt' },
      dataField: { name: 'alt' },
      item: { n: 'alt' },
    });
    return part;
  }

  /* ---------- внешняя книга ---------- */

  /** Кэш значений внешней книги: имена листов, строки и числа-идентификаторы ячеек (путь к файлу — в связях, заменяется всегда). */
  function parseExternal(name, xml, ctx) {
    const part = { name, kind: 'text', xml, streams: [], embeddedRuns: [] };
    addAttrStreams(part, ctx, { sheetName: { val: 'alt' }, definedName: { name: 'alt' } });
    let cell = null;
    let vOpen = null;
    tokenize(xml, (t) => {
      if ((t.type === 'open' || t.type === 'selfclose') && t.name === 'cell') {
        cell = t.type === 'open' ? { ...attrMap(xml, t), openStart: t.start, openEnd: t.end, attrStart: t.attrStart, attrEnd: t.attrEnd } : null;
      } else if (t.type === 'open' && t.name === 'v' && cell) vOpen = { elStart: t.start, start: t.end };
      else if (t.type === 'close' && t.name === 'v' && cell && vOpen) {
        const v = { elStart: vOpen.elStart, elEnd: t.end, start: vOpen.start, end: t.start };
        const raw = xml.slice(v.start, v.end);
        const digits = !cell.t || cell.t === 'n' ? intDigits(raw) : null;
        if (digits && ID_DIGITS_RE.test(digits)) {
          const s = addAttrStream(part, ctx, { raw: digits, valueStart: v.start, valueEnd: v.end }, 'cell-number', 'cell/v');
          s.cell = {
            sheet: '',
            row: 0,
            col: 0,
            openStart: cell.openStart,
            openEnd: cell.openEnd,
            attrStart: cell.attrStart,
            attrEnd: cell.attrEnd,
            v,
            formula: true,
            tag: 'cell',
          };
        } else if (raw.trim() && cell.t && cell.t !== 'n' && cell.t !== 'b' && cell.t !== 'e') {
          addAttrStream(part, ctx, { raw, valueStart: v.start, valueEnd: v.end }, 'cell-cache', 'cell/v');
        }
        vOpen = null;
      } else if (t.type === 'close' && t.name === 'cell') cell = null;
    });
    return part;
  }

  /* ---------- книга ---------- */

  function parseWorkbook(name, xml, ctx) {
    const part = { name, kind: 'text', xml, streams: [], embeddedRuns: [] };
    let sheetNo = 0;
    let dn = null;
    let lastBlockEnd = -1;
    tokenize(xml, (t) => {
      if (t.type === 'open' || t.type === 'selfclose') {
        if (t.name === 'sheet') {
          const a = getAttr(xml, t.attrStart, t.attrEnd, 'name');
          const s = a && a.raw ? addAttrStream(part, ctx, a, 'sheet-name', 'sheet/@name') : null;
          if (info.sheets[sheetNo]) info.sheets[sheetNo].stream = s;
          sheetNo++;
        } else if (t.name === 'fileSharing') {
          const a = getAttr(xml, t.attrStart, t.attrEnd, 'userName');
          if (a && a.raw) addAttrStream(part, ctx, a, 'author', 'fileSharing/@userName');
        } else if (t.name === 'customWorkbookView') {
          const a = getAttr(xml, t.attrStart, t.attrEnd, 'name');
          if (a && a.raw) addAttrStream(part, ctx, a, 'alt', 'customWorkbookView/@name');
        } else if (t.name === 'definedName' && t.type === 'open') {
          dn = { start: t.end, name: getAttr(xml, t.attrStart, t.attrEnd, 'name')?.raw || '' };
        } else if (t.name === 'calcPr') {
          info.calc = { at: t.start, attrEnd: t.attrEnd, self: t.type === 'selfclose' };
        }
      } else if (t.type === 'close') {
        if (t.name === 'definedName' && dn) {
          // имя книги: ссылки — в граф и переименование листов; строковая константа («"Иванов И.И."») — заменяется
          const areas = addFormula(name, xml, dn.start, t.start, '', part, ctx, 'name-literal');
          if (dn.name && !/^_xlnm\./i.test(dn.name)) definedAreas.set(dn.name, areas);
          dn = null;
        }
        // <calcPr> вставляется после последнего из этих блоков (порядок схемы CT_Workbook)
        if (['sheets', 'functionGroups', 'externalReferences', 'definedNames'].includes(t.name)) lastBlockEnd = t.end;
      }
    });
    if (!info.calc && lastBlockEnd >= 0) info.calc = { at: lastBlockEnd, attrEnd: null, self: true };
    return part;
  }
}

/**
 * Листы книги по порядку: имя и часть листа (по связям книги). Лист-диаграмма и битые связи — без части.
 * @param {string} xml  главная часть книги
 * @param {import('../ooxml/dml.js').Relation[]} rels  связи книги
 */
export function readSheets(xml, rels) {
  const targets = new Map(rels.filter((r) => !r.external).map((r) => [r.id, r]));
  const out = [];
  tokenize(xml, (t) => {
    if ((t.type === 'open' || t.type === 'selfclose') && t.name === 'sheet') {
      const a = attrMap(xml, t);
      const rel = targets.get(a['r:id']);
      out.push({ name: unescapeXml(a.name || ''), part: rel && rel.type === 'worksheet' ? rel.target : null, state: a.state || 'visible' });
    }
  });
  return out;
}

/** Атрибуты тега словарём (сырые значения). */
function attrMap(xml, t) {
  return Object.fromEntries(parseAttrs(xml, t.attrStart, t.attrEnd).map((a) => [a.name, a.raw]));
}

/**
 * XML-unescape с картой позиций: map[i] — позиция в сыром тексте i-го символа результата (map[text.length] — конец).
 * @param {string} raw
 */
export function unescapeWithMap(raw) {
  let text = '';
  const map = [];
  const re = /&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/y;
  for (let i = 0; i < raw.length;) {
    if (raw[i] === '&') {
      re.lastIndex = i;
      const m = re.exec(raw);
      if (m) {
        const ch = unescapeXml(m[0]);
        for (let k = 0; k < ch.length; k++) map.push(i);
        text += ch;
        i += m[0].length;
        continue;
      }
    }
    map.push(i);
    text += raw[i];
    i++;
  }
  map.push(raw.length);
  return { text, map };
}

/** Не ZIP или не книга: общий код NOT_SUPPORTED вместо NOT_DOCX (у Word код прежний). */
function notSupported(e) {
  if (e instanceof CoreError && e.code === 'NOT_DOCX') return new CoreError('NOT_SUPPORTED', 'Файл повреждён или не является книгой Excel');
  return e;
}

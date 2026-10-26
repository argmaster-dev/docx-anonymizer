// Разбор книги Excel (.xlsx/.xlsm) в модель потоков (версия 0.5, WP12-B, Ц1, К1; docs/concept-0.5.md п. 2, docs/contracts.md §9.8).
// Поверх общего слоя OOXML (ooxml/): общие строки <si> и inline-строки <is> — абзацы с ранами <r>/<t> (фонетика <rPh> — не текст),
// числа в ячейках <v> (ИНН, счёт, телефон, СНИЛС числом) — потоки-значения с заголовком столбца, кэш строковых формул (t="str"),
// строковые литералы формул (только поиск: формулы не меняются), колонтитулы листов (коды &P, &D… — вне потоков),
// примечания и комментарии (обычные и цепочки), авторы, имена листов, надписи и диаграммы, кэш сводных таблиц, docProps,
// внешние ссылки. Листы и ячейки — таблицы `doc.blocks` для заголовков столбцов (detect/tables.js, без правок).
// Значения ячеек в логи не попадают (NFR-14).
import { tokenize, parseAttrs, getAttr, unescapeXml } from '../ooxml/xml.js';
import { readZip } from '../ooxml/zip.js';
import { parsePackage, readXmlEntry, sortParts, addAttrStream } from '../ooxml/model.js';
import { parseFlowPart } from '../ooxml/flow.js';
import { parseRelsPart, parseMetaPart, META_PART_RE, resolveTarget } from '../ooxml/opc.js';
import { parseDrawingPart, addElementTextStreams, addAttrStreams, linkAuthors, embeddedWarning } from '../ooxml/dml.js';
import { CoreError } from '../errors.js';
import { parseCell, parseRange, scanFormula, formulaRefs, spreadShared } from './refs.js';
import { tableBlocks } from '../table-blocks.js';

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
const WORKBOOK_RELS = 'xl/_rels/workbook.xml.rels';

const SHEET_RE = /^xl\/worksheets\/[^/]+\.xml$/;
const COMMENTS_RE = /^xl\/comments[^/]*\.xml$/;
const THREADED_RE = /^xl\/threadedComments\/[^/]+\.xml$/;
const PERSONS_RE = /^xl\/persons\/[^/]+\.xml$/;
const DRAWING_RE = /^xl\/drawings\/[^/]+\.xml$/;
const CHART_RE = /^xl\/charts\/chart[^/]*\.xml$/;
const PIVOT_RE = /^xl\/pivotCache\/pivotCache(?:Definition|Records)[^/]*\.xml$/;
const RELS_RE = /^xl\/(?:[^/]+\/)*_rels\/[^/]+\.rels$/;

/** Ранг части для порядка обхода (FR-25): ячейки → примечания → фигуры и диаграммы → книга (имена листов) → кэш → связи → свойства. */
export function xlsxPartRank(name) {
  if (name === SHARED_STRINGS) return 0;
  if (SHEET_RE.test(name)) return 1;
  if (COMMENTS_RE.test(name)) return 2;
  if (THREADED_RE.test(name)) return 3;
  if (PERSONS_RE.test(name)) return 4;
  if (DRAWING_RE.test(name)) return 5;
  if (CHART_RE.test(name)) return 6;
  if (name === WORKBOOK) return 7;
  if (PIVOT_RE.test(name)) return 8;
  if (RELS_RE.test(name)) return 9;
  return 10; // docProps
}

/**
 * Части книги с текстом в порядке обхода FR-25.
 * @param {string[]} names
 */
export function xlsxParts(names) {
  const want = (n) =>
    n === SHARED_STRINGS ||
    n === WORKBOOK ||
    [SHEET_RE, COMMENTS_RE, THREADED_RE, PERSONS_RE, DRAWING_RE, CHART_RE, PIVOT_RE, RELS_RE, META_PART_RE].some((re) => re.test(n));
  return sortParts(names.filter(want), xlsxPartRank);
}

/** Число в ячейке, похожее на идентификатор: целое из 6–15 цифр (ИНН, СНИЛС, телефон, паспорт, ОГРН; даты и суммы — короче или с дробью). */
const ID_NUMBER_RE = /^\d{6,15}$/;
/** Элементы с формулами вне ячеек: условное форматирование, проверка данных (в т.ч. x14), их ссылки на листы переименовываются. */
const FORMULA_ELEMENTS = new Set(['formula', 'formula1', 'formula2', 'xm:f']);
const HEADER_FOOTER = new Set(['oddHeader', 'oddFooter', 'evenHeader', 'evenFooter', 'firstHeader', 'firstFooter']);
/** Коды колонтитула Excel: &L &C &R &P &N &D &T &F &A &Z &G &B &I &U &E &S &X &Y &H &K…, &"шрифт", &12 (размер), && — «&». */
const HF_CODE_RE = /&(?:"[^"]*"|K[0-9A-Fa-f]{6}|K\d\d[+-]\d{3}|\d{1,3}|[LCRPNDTFAZGBIUESXYHlcrpndtfazgbiuesxyh&]|$)/g;

/**
 * Сведения о книге для сериализации и предупреждений (doc.xlsx).
 * @typedef {object} XlsxInfo
 * @property {{name: string, part: string | null, stream: import('../ooxml/model.js').Stream | null}[]} sheets  листы в порядке книги
 * @property {{part: string, start: number, end: number, kind: 'formula'|'location'|'sheet'}[]} sites  места с именами листов: формулы, ссылки «#Лист!A1», источник сводной
 * @property {import('./refs.js').RefArea[]} refAreas  на что ссылаются формулы и диаграммы (граф ссылок, грубо)
 * @property {{at: number, attrEnd: number | null, self: boolean} | null} calc  <calcPr> книги (или место вставки) — пересчёт при открытии
 */

/**
 * Разбирает .xlsx/.xlsm. Бросает CoreError: NOT_SUPPORTED (не ZIP, нет xl/workbook.xml), ENCRYPTED, PARSE_FAILED.
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
  if (!byName.has(WORKBOOK)) throw new CoreError('NOT_SUPPORTED', 'В архиве нет xl/workbook.xml');
  // книга и её связи — заранее: имена листов нужны при разборе листов (ссылки без имени листа, таблицы для заголовков)
  const sheets = readSheets(
    readXmlEntry(/** @type {any} */ (byName.get(WORKBOOK))),
    byName.has(WORKBOOK_RELS) ? readXmlEntry(/** @type {any} */ (byName.get(WORKBOOK_RELS))) : '',
  );
  const sheetByPart = new Map(sheets.map((s, i) => [s.part, { ...s, index: i }]).filter(([p]) => p));
  /** @type {XlsxInfo} */
  const info = { sheets: sheets.map((s) => ({ name: s.name, part: s.part, stream: null })), sites: [], refAreas: [], calc: null };
  /** @type {any[]} */
  const blocks = [];
  /** @type {(string | null)[]} */
  let siPids = [];
  /** ячейки шапок листов — без потока (core/table-blocks.js); общие строки, уже попавшие в данные таблицы */
  let headSeq = 0;
  /** @type {Map<string, string>} pid → «таблица:строка» первого вхождения */
  const seenData = new Map();
  /** pid абзаца → текст его live-потока (общие и inline-строки) — текст ячейки для таблицы заголовков */
  /** @type {Map<string, string>} */
  const textByPid = new Map();
  const rememberTexts = (part) => {
    for (const st of part.streams) if (st.type === 'live' && st.pid) textByPid.set(st.pid, st.text);
  };
  /** имена, определённые в книге (кроме служебных _xlnm), и их прямоугольники — для графа ссылок */
  const definedAreas = new Map();
  /** все формулы (код без литералов) — чтобы понять, какие имена используются */
  const formulaCodes = [];

  /** @type {import('../ooxml/model.js').PackageDescription} */
  const desc = {
    kind: 'xlsx',
    mainPart: WORKBOOK,
    notFound: { code: 'NOT_SUPPORTED', message: 'В архиве нет xl/workbook.xml' },
    parts: xlsxParts,
    parsePart(name, xml, ctx) {
      if (name === SHARED_STRINGS) {
        const part = parseFlowPart(name, xml, ctx, SML);
        siPids = sharedStringPids(xml, ctx, name);
        markCells(ctx, name);
        rememberTexts(part);
        return part;
      }
      if (SHEET_RE.test(name)) return parseSheet(name, xml, ctx, sheetByPart.get(name));
      if (COMMENTS_RE.test(name)) {
        const part = parseFlowPart(name, xml, ctx, SML_COMMENT);
        addElementTextStreams(part, ctx, (n) => (n === 'author' ? 'author' : null));
        // заглушка цепочки комментариев: автор «tc={GUID}» — не человек (настоящий автор — в persons/person.xml)
        part.streams = part.streams.filter((x) => !(x.attrKind === 'author' && /^tc=\{/.test(x.text)));
        return part;
      }
      if (THREADED_RE.test(name)) return parseFlowPart(name, xml, ctx, SML_THREADED);
      if (PERSONS_RE.test(name)) {
        const part = { name, kind: 'people', xml, streams: [], embeddedRuns: [] };
        linkAuthors(addAttrStreams(part, ctx, { person: { displayName: 'author', userId: 'author-id' } }));
        return part;
      }
      if (DRAWING_RE.test(name)) return parseDrawingPart(name, xml, ctx);
      if (CHART_RE.test(name)) {
        const part = parseDrawingPart(name, xml, ctx);
        // кэш подписей рядов и категорий: <c:strCache><c:pt><c:v>…</c:v>; ссылки <c:f> — в граф и в переименование листов
        addElementTextStreams(part, ctx, (n, stack) => (n === 'c:v' && stack.some((x) => x === 'c:strCache' || x === 'c:lvl') ? 'cell-cache' : null));
        collectSites(
          name,
          xml,
          (n) => n === 'c:f',
          (f) => info.refAreas.push(...formulaRefs(f, '')),
        );
        return part;
      }
      if (name === WORKBOOK) return parseWorkbook(name, xml, ctx);
      if (PIVOT_RE.test(name)) {
        const part = { name, kind: 'text', xml, streams: [], embeddedRuns: [] };
        addAttrStreams(part, ctx, { s: { v: 'cell-cache' } });
        // источник сводной таблицы: <worksheetSource sheet="Лист1"> — имя листа переименовывается вместе с листом
        tokenize(xml, (t) => {
          if ((t.type === 'open' || t.type === 'selfclose') && t.name === 'worksheetSource') {
            const a = getAttr(xml, t.attrStart, t.attrEnd, 'sheet');
            if (a) info.sites.push({ part: name, start: a.valueStart, end: a.valueEnd, kind: 'sheet' });
          }
        });
        return part;
      }
      if (RELS_RE.test(name)) return parseRelsPart(name, xml, ctx);
      return parseMetaPart(name, xml, ctx);
    },
    warnings: (list) => embeddedWarning(list, 'xl/'),
    languageStream: (s) => s.type === 'live' && (s.part === SHARED_STRINGS || SHEET_RE.test(s.part)),
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
  return Object.assign(doc, {
    xlsx: info,
    blocks,
    viewParts: [SHARED_STRINGS, ...info.sheets.map((s) => s.part).filter(Boolean)],
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
   * литералы формул (поток без правки), колонтитулы (куски текста между кодами), отображаемый текст ссылок; таблица ячеек
   * для заголовков столбцов; формулы — в граф ссылок и в места переименования листов.
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
    /** @type {import('../table-blocks.js').TableCell[]} */
    const tableCells = [];
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
        else if (FORMULA_ELEMENTS.has(nm) && t.type === 'open') otherFormula = { start: t.end, name: nm };
        else if (nm === 'hyperlink') {
          for (const a of parseAttrs(xml, t.attrStart, t.attrEnd)) {
            if (!a.raw) continue;
            if (a.name === 'display' || a.name === 'tooltip') addAttrStream(part, ctx, a, 'alt', `hyperlink/@${a.name}`);
            else if (a.name === 'location') info.sites.push({ part: name, start: a.valueStart, end: a.valueEnd, kind: 'location' });
          }
        }
      } else if (t.type === 'close') {
        if (nm === 'f' && fOpen) {
          fOpen.end = t.start;
          fOpen = null;
        } else if (nm === 'v' && vOpen && cell) {
          cell.v = { elStart: vOpen.elStart, elEnd: t.end, start: vOpen.start, end: t.start };
          vOpen = null;
        } else if (nm === 'c' && cell) {
          cell.closeEnd = t.end;
          cells.push(cell);
          cell = null;
        } else if (hfOpen && nm === hfOpen.name) {
          addHeaderFooter(part, ctx, xml, hfOpen.start, t.start);
          hfOpen = null;
        } else if (otherFormula && nm === otherFormula.name) {
          addFormula(name, xml, otherFormula.start, t.start, sheetName, null);
          otherFormula = null;
        }
      }
    });

    for (const c of cells) {
      if (c.f && c.f.end > c.f.start) {
        const refs = addFormula(name, xml, c.f.start, c.f.end, sheetName, part, ctx);
        const range = c.f.attrs.t === 'shared' ? parseRange(c.f.attrs.ref) : null;
        if (range) info.refAreas.push(...spreadShared(refs, range));
        else info.refAreas.push(...refs);
      }
      const raw = c.v ? xml.slice(c.v.start, c.v.end) : '';
      let pid = null;
      let text = '';
      if (c.t === 's' && c.v) {
        pid = siPids[Number(raw)] ?? null;
      } else if (c.t === 'inlineStr' && c.isPos != null) {
        pid = isPid.get(c.isPos) ?? null;
      } else if (c.v && ((c.t === 'n' && ID_NUMBER_RE.test(raw)) || (c.t === 'str' && raw.trim()))) {
        // число-идентификатор или кэш строковой формулы: поток-значение со своим абзацем (заголовок столбца, вкладка «Текст»)
        const kind = c.t === 'n' ? 'cell-number' : 'cell-cache';
        const s = addAttrStream(part, ctx, { raw, valueStart: c.v.start, valueEnd: c.v.end }, kind, 'c/v');
        const para = { pid: `p${ctx.pidCounter++}`, part: name, depth: 0, pos: c.v.start, streams: { live: s.id }, kind: 'cell' };
        ctx.paragraphs.push(para);
        s.pid = para.pid;
        if (kind === 'cell-number')
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
          };
        pid = para.pid;
        text = s.text;
      }
      if (!pid) continue;
      if (!text) text = textByPid.get(pid) ?? '';
      tableCells.push({ pid, text, row: c.row, col: c.col });
      // объединённая ячейка (B1:D1) — тот же текст над каждым столбцом диапазона (заголовок над несколькими столбцами)
      const m = merges.find((r) => r.r1 === c.row && r.c1 === c.col && r.c2 > r.c1);
      if (m) for (let col = m.c1 + 1; col <= Math.min(m.c2, m.c1 + 50); col++) tableCells.push({ pid, text, row: c.row, col });
    }
    // таблица листа для заголовков столбцов (core/table-blocks.js): шапка, заголовок листа над ней; общая строка в данных —
    // по первому вхождению (у одной строки в разных столбцах заголовок был бы неоднозначным)
    for (const b of tableBlocks(tableCells, { index: tableIndex, fakePid: () => `h${headSeq++}` })) {
      const at = `${b.table.index}:${b.table.row}`;
      const first = seenData.get(b.pid);
      if (first !== undefined && first !== at) continue; // та же строка ниже — уже есть (повтор в объединённой ячейке — та же строка)
      seenData.set(b.pid, at);
      blocks.push(b);
    }
    // абзацы части — по позиции (inline-строки и числа вперемешку, как в листе)
    const tail = ctx.paragraphs.splice(firstPara).sort((a, b) => a.pos - b.pos);
    ctx.paragraphs.push(...tail);
    return part;
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
   * Формула: место переименования листов, ссылки — в граф; строковые литералы длиннее двух символов — потоки `formula-literal`
   * (поиск сущностей; сама формула не меняется — предупреждение). Возвращает ссылки формулы.
   */
  function addFormula(name, xml, start, end, sheetName, part, ctx) {
    info.sites.push({ part: name, start, end, kind: 'formula' });
    const f = unescapeXml(xml.slice(start, end));
    const { strings, code } = scanFormula(f);
    formulaCodes.push(code);
    if (part && ctx) {
      for (const s of strings) {
        const text = f.slice(s.start, s.end).replace(/""/g, '"');
        if (text.trim().length < 3) continue;
        part.streams.push({
          id: `a${ctx.attrCounter++}`,
          part: name,
          pid: null,
          type: 'attr',
          attrKind: 'formula-literal',
          xpath: 'c/f',
          text,
          pos: start,
          order: 0,
          valueStart: start,
          valueEnd: end,
        });
      }
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

  /** Отметить абзацы общих строк как ячейки (вид блока для фильтров NER, К10 0.4). */
  function markCells(ctx, name) {
    for (const p of ctx.paragraphs) if (p.part === name) p.kind = 'cell';
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
        } else if (t.name === 'definedName' && t.type === 'open') {
          dn = { start: t.end, name: getAttr(xml, t.attrStart, t.attrEnd, 'name')?.raw || '' };
        } else if (t.name === 'calcPr') {
          info.calc = { at: t.start, attrEnd: t.attrEnd, self: t.type === 'selfclose' };
        }
      } else if (t.type === 'close') {
        if (t.name === 'definedName' && dn) {
          info.sites.push({ part: name, start: dn.start, end: t.start, kind: 'formula' });
          if (dn.name && !/^_xlnm\./i.test(dn.name)) definedAreas.set(dn.name, formulaRefs(unescapeXml(xml.slice(dn.start, t.start)), ''));
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
 * @param {string} xml  xl/workbook.xml
 * @param {string} rels xl/_rels/workbook.xml.rels
 */
export function readSheets(xml, rels) {
  const targets = new Map();
  tokenize(rels, (t) => {
    if ((t.type === 'open' || t.type === 'selfclose') && t.name === 'Relationship') {
      const a = attrMap(rels, t);
      if (a.Id && a.Target && a.TargetMode !== 'External') targets.set(a.Id, resolveTarget('xl/', a.Target));
    }
  });
  const out = [];
  tokenize(xml, (t) => {
    if ((t.type === 'open' || t.type === 'selfclose') && t.name === 'sheet') {
      const a = attrMap(xml, t);
      const target = targets.get(a['r:id']) || null;
      out.push({ name: unescapeXml(a.name || ''), part: target && SHEET_RE.test(target) ? target : null, state: a.state || 'visible' });
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

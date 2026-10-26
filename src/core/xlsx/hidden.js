// Скрытые данные Excel (версия 0.5, WP12-D, Ц4, К7; docs/concept-0.5.md п. 6, docs/contracts.md §9.9): скрытые листы
// (state="hidden|veryHidden"), скрытые строки (<row hidden="1">) и столбцы (<col hidden="1">), примечания (legacy comments + VML)
// и цепочки комментариев (threadedComments + persons). При разборе — счётчики (doc.hidden); при сборке — по выбору пользователя
// (план адаптера xlsx-adapter.js, общий сериализатор ooxml/serialize.js):
//   «Удалить комментарии» — части примечаний и цепочек, люди цепочек, VML примечаний (если в нём только примечания — часть и
//     <legacyDrawing> листа; иначе — только фигуры примечаний);
//   «Удалить скрытые листы, строки и столбцы» — скрытые листы (элемент <sheet>, часть листа, его связи и всё, на что ссылался
//     только он: рисунки, диаграммы, примечания, таблицы), локальные имена книги этих листов (localSheetId остальных — со
//     сдвигом), ссылки на них в формулах и диаграммах → #REF! (так делает сам Excel при удалении листа), активный лист окна —
//     со сдвигом, calcChain.xml (Excel пересоберёт); в скрытых строках и столбцах — ячейки (строки и столбцы остаются на месте:
//     адреса и формулы не сдвигаются; у ячейки-владельца общей или массивной формулы остаётся формула, уходит значение);
//     общие строки, на которые больше никто не ссылается, — пустые (индексы прочих не меняются).
// Найденное в скрытом маскируется в любом случае. Значений документа здесь нет (NFR-14).
import { tokenize, getAttr, parseAttrs, unescapeXml } from '../ooxml/xml.js';
import { readXmlEntry } from '../ooxml/model.js';
import { readRelations } from '../ooxml/dml.js';
import { collectOrphans, onOff } from '../ooxml/hidden.js';
import { colNumber } from './refs.js';

/** Имя-заглушка удалённого листа в переименовании формул (ссылки на него становятся #REF!). */
export const REMOVED_SHEET = '\uE000REF';
/** «'<заглушка U+E000>'!A1:B2», «'<заглушка>'!A:A», «'<заглушка>'!3:5» и имя листа без диапазона → «#REF!». */
const REMOVED_REF_RE = /'\uE000REF'!(?:\$?[A-Za-z]{1,3}\$?\d+|\$?[A-Za-z]{1,3}|\$?\d+)?(?::(?:\$?[A-Za-z]{1,3}\$?\d+|\$?[A-Za-z]{1,3}|\$?\d+))?/g;

/**
 * Ссылки на удалённые листы → «#REF!» (после renameSheets с заглушкой REMOVED_SHEET).
 * @param {string} f
 */
export function dropRemovedRefs(f) {
  return f.includes('\uE000') ? f.replace(REMOVED_REF_RE, '#REF!') : f;
}

const isHiddenState = (s) => s === 'hidden' || s === 'veryHidden';
const attrOn = (xml, t, name) => {
  const a = getAttr(xml, t.attrStart, t.attrEnd, name);
  return !!a && onOff(a.raw);
};

/**
 * Счётчики скрытого в книге (doc.hidden).
 * @param {import('../ooxml/model.js').DocModel} doc
 * @param {(name: string) => string | null} roleOf  роль части (xlsxRole по связям пакета)
 * @param {{state: string}[]} sheets  листы книги (readSheets)
 * @returns {import('../ooxml/hidden.js').HiddenCounts}
 */
export function countXlsxHidden(doc, roleOf, sheets) {
  let hiddenRows = 0;
  let hiddenCols = 0;
  let legacy = 0;
  let threads = 0;
  for (const part of doc.parts.values()) {
    const role = roleOf(part.name);
    if (role === 'sheet') {
      hiddenRows += part.xml.match(/<row\b[^>]*?\shidden\s*=\s*["'](?:1|true)["']/g)?.length || 0;
      for (const m of part.xml.matchAll(/<col\b[^>]*>/g)) {
        if (!/\shidden\s*=\s*["'](?:1|true)["']/.test(m[0])) continue;
        const min = Number(/\smin\s*=\s*["'](\d+)/.exec(m[0])?.[1] || 0);
        const max = Number(/\smax\s*=\s*["'](\d+)/.exec(m[0])?.[1] || min);
        if (min > 0 && max >= min) hiddenCols += Math.min(max, 16384) - min + 1;
      }
    } else if (role === 'comments') legacy += part.xml.match(/<comment[\s>]/g)?.length || 0;
    // цепочка — корневой комментарий (ответы — с parentId)
    else if (role === 'threaded') threads += (part.xml.match(/<threadedComment\b[^>]*>/g) || []).filter((x) => !/\sparentId\s*=/.test(x)).length;
  }
  // Excel пишет к каждой цепочке примечание-заглушку: одна цепочка — одно примечание
  return { comments: Math.max(legacy, threads), hiddenSheets: sheets.filter((s) => isHiddenState(s.state)).length, hiddenRows, hiddenCols };
}

/**
 * Подготовка: какие листы удаляются (до переименования листов в формулах — ссылки на них станут #REF!).
 * @param {any} doc  модель книги (doc.xlsx)
 * @param {import('../ooxml/hidden.js').HiddenFlags} flags
 */
export function prepareXlsxHidden(doc, flags) {
  const rels = readRelations(doc.entries);
  const wb = doc.xlsx.workbook;
  const xml = /** @type {any} */ (doc.parts.get(wb)).xml;
  const wbRels = new Map(rels.from(wb).map((r) => [r.id, r]));
  /** @type {{name: string, state: string, part: string | null, start: number, end: number, index: number}[]} */
  const sheets = [];
  let open = null;
  tokenize(xml, (t) => {
    if (t.name !== 'sheet') return;
    if (t.type === 'open' || t.type === 'selfclose') {
      const a = Object.fromEntries(parseAttrs(xml, t.attrStart, t.attrEnd).map((x) => [x.name, x.raw]));
      const rel = wbRels.get(a['r:id']);
      const s = {
        name: unescapeXml(a.name || ''),
        state: a.state || 'visible',
        part: rel && !rel.external ? rel.target : null,
        start: t.start,
        end: t.end,
        index: sheets.length,
      };
      sheets.push(s);
      if (t.type === 'open') open = s;
    } else if (t.type === 'close' && open) {
      open.end = t.end;
      open = null;
    }
  });
  const removed = flags.hiddenSheets ? sheets.filter((s) => isHiddenState(s.state)) : [];
  // все листы скрыты не бывают (Excel требует видимый лист); на всякий случай книгу без листов не делаем
  if (removed.length === sheets.length) removed.length = 0;
  return { rels, wb, sheets, removed, flags };
}

/**
 * Удаление скрытого по выбору (план адаптера Excel). Возвращает true, если менялись ячейки или листы (нужен пересчёт при открытии).
 * @param {any} doc
 * @param {ReturnType<typeof prepareXlsxHidden>} S
 * @param {import('../ooxml/serialize.js').PlanContext} ctx
 * @param {(part: string, e: {from: number, to: number, text: string}) => void} push
 */
export function applyXlsxHidden(doc, S, ctx, push) {
  const { rels, wb, sheets, removed, flags } = S;
  const names = new Set(doc.entries.map((e) => e.name));
  const gone = new Set();
  const remove = (n) => {
    if (!n || gone.has(n) || !names.has(n)) return;
    gone.add(n);
    ctx.remove(n);
  };
  const xmlOf = (n) => {
    if (doc.parts.has(n)) return doc.parts.get(n).xml;
    const e = doc.entries.find((x) => x.name === n);
    return e ? readXmlEntry(e) : '';
  };
  const removedIdx = new Set(removed.map((s) => s.index));
  let changed = false;

  // 1. Скрытые листы
  if (removed.length) {
    changed = true;
    for (const s of removed) {
      ctx.strip(wb, { from: s.start, to: s.end });
      remove(s.part);
    }
    shiftWorkbook(/** @type {any} */ (doc.parts.get(wb)).xml, removedIdx, sheets.length, wb, ctx, push);
  }

  // 2. Примечания и цепочки комментариев
  if (flags.comments) {
    for (const s of sheets) {
      if (!s.part || removedIdx.has(s.index)) continue;
      for (const r of rels.from(s.part)) {
        if (r.external) continue;
        if (r.type === 'comments' || r.type === 'threadedComment') remove(r.target);
        else if (r.type === 'vmlDrawing') stripNotes(s.part, r);
      }
    }
    for (const r of rels.from(wb)) if (r.type === 'person') remove(r.target);
  }

  // 3. Скрытые строки и столбцы; общие строки, на которые никто не ссылается
  if (flags.hiddenSheets) {
    /** @type {Set<number>} */
    const refs = new Set();
    let cells = false;
    for (const s of sheets) {
      if (!s.part || removedIdx.has(s.index) || !doc.parts.has(s.part)) continue;
      const r = scanCells(doc.parts.get(s.part).xml);
      for (const i of r.refs) refs.add(i);
      for (const e of r.strips) ctx.strip(s.part, e);
      if (r.strips.length) cells = true;
    }
    if (cells || removed.length) {
      changed = true;
      const sst = rels.from(wb).find((r) => r.type === 'sharedStrings')?.target;
      if (sst && doc.parts.has(sst)) blankStrings(doc.parts.get(sst).xml, refs, sst, ctx);
    }
    if (cells) for (const r of rels.from(wb)) if (r.type === 'calcChain') remove(r.target);
  }
  if (removed.length) for (const r of rels.from(wb)) if (r.type === 'calcChain') remove(r.target);

  // 4. Всё, на что ссылались только удалённые части (рисунки, диаграммы, таблицы и картинки скрытого листа)
  if (gone.size) for (const n of collectOrphans(rels.all, gone, names)) ctx.remove(n);
  return changed;

  /** VML примечаний листа: только примечания — удалить часть и <legacyDrawing>; есть другие фигуры — только фигуры примечаний. */
  function stripNotes(sheetPart, rel) {
    const vml = xmlOf(rel.target);
    const shapes = [...vml.matchAll(/<v:shape\b[\s\S]*?<\/v:shape>/g)];
    const notes = shapes.filter((m) => /ObjectType\s*=\s*["']Note["']/.test(m[0]));
    if (!notes.length) return;
    if (notes.length === shapes.length) {
      remove(rel.target);
      const sx = doc.parts.get(sheetPart)?.xml || '';
      for (const m of sx.matchAll(/<legacyDrawing\b[^>]*?\/>|<legacyDrawing\b[^>]*>[\s\S]*?<\/legacyDrawing>/g)) {
        const id = /\sr:id\s*=\s*["']([^"']*)["']/.exec(m[0])?.[1];
        if (id === rel.id) ctx.strip(sheetPart, { from: /** @type {number} */ (m.index), to: /** @type {number} */ (m.index) + m[0].length });
      }
    } else if (doc.parts.has(rel.target)) {
      for (const m of notes) ctx.strip(rel.target, { from: /** @type {number} */ (m.index), to: /** @type {number} */ (m.index) + m[0].length });
    }
  }
}

/**
 * Книга после удаления листов: локальные имена удалённых листов — удаляются, localSheetId остальных и активный/первый лист
 * окна книги — со сдвигом на число удалённых листов перед ними.
 */
function shiftWorkbook(xml, removedIdx, total, wb, ctx, push) {
  const shift = (i) => {
    let n = 0;
    for (const k of removedIdx) if (k < i) n++;
    return i - n;
  };
  const kept = total - removedIdx.size;
  let dn = null;
  tokenize(xml, (t) => {
    if ((t.type === 'open' || t.type === 'selfclose') && t.name === 'definedName') {
      const a = getAttr(xml, t.attrStart, t.attrEnd, 'localSheetId');
      const id = a ? Number(a.raw) : NaN;
      if (Number.isInteger(id) && removedIdx.has(id)) {
        if (t.type === 'selfclose') ctx.strip(wb, { from: t.start, to: t.end });
        else dn = { start: t.start };
      } else if (a && Number.isInteger(id) && shift(id) !== id) push(wb, { from: a.valueStart, to: a.valueEnd, text: String(shift(id)) });
    } else if (t.type === 'close' && t.name === 'definedName' && dn) {
      ctx.strip(wb, { from: dn.start, to: t.end });
      dn = null;
    } else if ((t.type === 'open' || t.type === 'selfclose') && t.name === 'workbookView') {
      for (const name of ['activeTab', 'firstSheet']) {
        const a = getAttr(xml, t.attrStart, t.attrEnd, name);
        if (!a || !/^\d+$/.test(a.raw)) continue;
        const v = Math.max(0, Math.min(kept - 1, shift(Number(a.raw))));
        if (v !== Number(a.raw)) push(wb, { from: a.valueStart, to: a.valueEnd, text: String(v) });
      }
    }
  });
}

/**
 * Ячейки листа: что удалить в скрытых строках и столбцах и на какие общие строки ссылаются оставшиеся.
 * @param {string} xml
 * @returns {{strips: {from: number, to: number}[], refs: Set<number>}}
 */
export function scanCells(xml) {
  /** @type {[number, number][]} */
  const hiddenCols = [];
  const strips = [];
  const refs = new Set();
  let rowHidden = false;
  let rowNo = 0;
  let colNo = 0;
  /** @type {any} */
  let cell = null;
  let vOpen = -1;
  tokenize(xml, (t) => {
    const nm = t.name;
    if (t.type === 'open' || t.type === 'selfclose') {
      if (nm === 'col' && attrOn(xml, t, 'hidden')) {
        const min = Number(getAttr(xml, t.attrStart, t.attrEnd, 'min')?.raw || 0);
        const max = Number(getAttr(xml, t.attrStart, t.attrEnd, 'max')?.raw || min);
        if (min > 0) hiddenCols.push([min, max]);
      } else if (nm === 'row') {
        const r = Number(getAttr(xml, t.attrStart, t.attrEnd, 'r')?.raw || 0);
        rowNo = r > 0 ? r : rowNo + 1;
        colNo = 0;
        rowHidden = attrOn(xml, t, 'hidden');
      } else if (nm === 'c') {
        const ref = getAttr(xml, t.attrStart, t.attrEnd, 'r')?.raw || '';
        const m = /^\$?([A-Za-z]{1,3})\$?\d+$/.exec(ref);
        colNo = m ? colNumber(m[1]) : colNo + 1;
        cell = { start: t.start, col: colNo, t: getAttr(xml, t.attrStart, t.attrEnd, 't')?.raw || 'n', master: false, v: null, value: '' };
        if (t.type === 'selfclose') {
          finish(t.end);
          cell = null;
        }
      } else if (cell && nm === 'f') {
        const ft = getAttr(xml, t.attrStart, t.attrEnd, 't')?.raw;
        if ((ft === 'shared' && getAttr(xml, t.attrStart, t.attrEnd, 'ref')) || ft === 'array' || ft === 'dataTable') cell.master = true;
      } else if (cell && nm === 'v' && t.type === 'open') {
        cell.v = { start: t.start, end: -1 };
        vOpen = t.end;
      }
    } else if (t.type === 'close') {
      if (nm === 'v' && cell?.v && vOpen >= 0) {
        cell.v.end = t.end;
        cell.value = xml.slice(vOpen, t.start);
        vOpen = -1;
      } else if (nm === 'c' && cell) {
        finish(t.end);
        cell = null;
      } else if (nm === 'row') rowHidden = false;
    }
  });
  return { strips, refs };

  function finish(end) {
    const hidden = rowHidden || hiddenCols.some(([a, b]) => cell.col >= a && cell.col <= b);
    if (hidden) {
      // владелец общей или массивной формулы: зависимые ячейки ссылаются на его формулу — остаётся формула без значения
      if (!cell.master) strips.push({ from: cell.start, to: end });
      else if (cell.v && cell.v.end > 0) strips.push({ from: cell.v.start, to: cell.v.end });
    } else if (cell.t === 's' && /^\s*\d+\s*$/.test(cell.value)) refs.add(Number(cell.value));
  }
}

/** Общие строки без ссылок из оставшихся ячеек → пустые <si> (индексы остальных не сдвигаются). */
function blankStrings(xml, refs, part, ctx) {
  let i = -1;
  let start = -1;
  tokenize(xml, (t) => {
    if (t.name !== 'si') return;
    if (t.type === 'selfclose') i++;
    else if (t.type === 'open') {
      i++;
      start = t.start;
    } else if (t.type === 'close' && start >= 0) {
      if (!refs.has(i) && xml.slice(start, t.end) !== '<si><t></t></si>') ctx.strip(part, { from: start, to: t.end, text: '<si><t></t></si>' });
      start = -1;
    }
  });
}

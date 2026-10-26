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
import { colNumber, parseRange, formulaRefs, spreadShared, scanFormula } from './refs.js';

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

  // 3. Скрытые строки и столбцы; кэш формул, которые ссылаются на удалённое; общие строки, на которые никто не ссылается
  if (flags.hiddenSheets) {
    /** @type {Set<number>} */
    const refs = new Set();
    let cells = false;
    /** что очищено: лист (нижний регистр) → скрытые строки и столбцы */
    const cleared = new Map();
    const scans = [];
    for (const s of sheets) {
      if (!s.part || removedIdx.has(s.index) || !doc.parts.has(s.part)) continue;
      const xml = doc.parts.get(s.part).xml;
      const r = scanCells(xml);
      scans.push({ sheet: s, xml, r });
      for (const i of r.refs) refs.add(i);
      for (const e of r.strips) ctx.strip(s.part, e);
      if (r.strips.length) {
        cells = true;
        cleared.set(s.name.toLowerCase(), { rows: r.hiddenRows, cols: r.hiddenCols });
      }
    }
    if (cells || removed.length) {
      changed = true;
      fixFormulaCaches(scans, new Set(removed.map((s) => s.name.toLowerCase())), cleared, definedNameAreas(xmlOf(wb)), ctx, push);
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
 * Ячейки листа: что удалить в скрытых строках и столбцах, на какие общие строки ссылаются оставшиеся, формулы оставшихся ячеек.
 * Левая верхняя ячейка объединения, которое заходит на видимые строки и столбцы, не очищается: её текст виден (ревью WP12-D).
 * @param {string} xml
 * @returns {{strips: {from: number, to: number}[], refs: Set<number>, hiddenRows: Set<number>, hiddenCols: [number, number][], formulas: any[]}}
 */
export function scanCells(xml) {
  /** @type {[number, number][]} */
  const hiddenCols = [];
  const hiddenRows = new Set();
  const strips = [];
  const refs = new Set();
  const formulas = [];
  // объединения идут после sheetData — заранее
  const merges = [...xml.matchAll(/<mergeCell\b[^>]*?\sref\s*=\s*["']([^"']+)["']/g)].map((m) => parseRange(m[1])).filter(Boolean);
  // строки и столбцы — тоже заранее (видимость объединения считается по всем)
  tokenize(xml, (t) => {
    if ((t.type !== 'open' && t.type !== 'selfclose') || (t.name !== 'row' && t.name !== 'col')) return;
    if (!attrOn(xml, t, 'hidden')) return;
    if (t.name === 'col') {
      const min = Number(getAttr(xml, t.attrStart, t.attrEnd, 'min')?.raw || 0);
      const max = Number(getAttr(xml, t.attrStart, t.attrEnd, 'max')?.raw || min);
      if (min > 0) hiddenCols.push([min, max]);
    } else {
      const r = Number(getAttr(xml, t.attrStart, t.attrEnd, 'r')?.raw || 0);
      if (r > 0) hiddenRows.add(r);
    }
  });
  const colHidden = (c) => hiddenCols.some(([a, b]) => c >= a && c <= b);
  /** объединение с якорем в ячейке, где есть видимая ячейка */
  const visibleAnchor = (row, col) =>
    merges.some((m) => {
      if (m.r1 !== row || m.c1 !== col) return false;
      let rowOk = false;
      for (let r = m.r1; r <= m.r2 && !rowOk; r++) rowOk = !hiddenRows.has(r);
      let colOk = false;
      for (let c = m.c1; c <= m.c2 && !colOk; c++) colOk = !colHidden(c);
      return rowOk && colOk;
    });
  let rowHidden = false;
  let rowNo = 0;
  let colNo = 0;
  /** @type {any} */
  let cell = null;
  let vOpen = -1;
  let fOpen = -1;
  tokenize(xml, (t) => {
    const nm = t.name;
    if (t.type === 'open' || t.type === 'selfclose') {
      if (nm === 'row') {
        const r = Number(getAttr(xml, t.attrStart, t.attrEnd, 'r')?.raw || 0);
        rowNo = r > 0 ? r : rowNo + 1;
        colNo = 0;
        rowHidden = attrOn(xml, t, 'hidden');
      } else if (nm === 'c') {
        const ref = getAttr(xml, t.attrStart, t.attrEnd, 'r')?.raw || '';
        const m = /^\$?([A-Za-z]{1,3})\$?\d+$/.exec(ref);
        colNo = m ? colNumber(m[1]) : colNo + 1;
        cell = {
          start: t.start,
          openEnd: t.end,
          attrStart: t.attrStart,
          attrEnd: t.attrEnd,
          row: rowNo,
          col: colNo,
          t: getAttr(xml, t.attrStart, t.attrEnd, 't')?.raw || 'n',
          master: false,
          f: null,
          v: null,
          value: '',
        };
        if (t.type === 'selfclose') {
          finish(t.end);
          cell = null;
        }
      } else if (cell && nm === 'f') {
        const ft = getAttr(xml, t.attrStart, t.attrEnd, 't')?.raw;
        const ref = getAttr(xml, t.attrStart, t.attrEnd, 'ref')?.raw;
        if ((ft === 'shared' && ref) || ft === 'array' || ft === 'dataTable') cell.master = true;
        cell.f = { text: '', end: t.end, shared: ft === 'shared' ? (getAttr(xml, t.attrStart, t.attrEnd, 'si')?.raw ?? null) : null, ref: ref || null };
        if (t.type === 'open') fOpen = t.end;
      } else if (cell && nm === 'v' && t.type === 'open') {
        cell.v = { start: t.start, end: -1 };
        vOpen = t.end;
      }
    } else if (t.type === 'close') {
      if (nm === 'f' && cell?.f && fOpen >= 0) {
        cell.f.text = unescapeXml(xml.slice(fOpen, t.start));
        cell.f.end = t.end;
        fOpen = -1;
      } else if (nm === 'v' && cell?.v && vOpen >= 0) {
        cell.v.end = t.end;
        cell.value = xml.slice(vOpen, t.start);
        vOpen = -1;
      } else if (nm === 'c' && cell) {
        finish(t.end);
        cell = null;
      } else if (nm === 'row') rowHidden = false;
    }
  });
  return { strips, refs, hiddenRows, hiddenCols, formulas };

  function finish(end) {
    const hidden = (rowHidden || colHidden(cell.col)) && !visibleAnchor(cell.row, cell.col);
    if (hidden) {
      // владелец общей или массивной формулы: зависимые ячейки ссылаются на его формулу — остаётся формула без значения
      if (!cell.master) strips.push({ from: cell.start, to: end });
      else if (cell.v && cell.v.end > 0) strips.push({ from: cell.v.start, to: cell.v.end });
      return;
    }
    if (cell.t === 's' && /^\s*\d+\s*$/.test(cell.value)) refs.add(Number(cell.value));
    if (cell.f) formulas.push(cell);
  }
}

/** Имена книги → прямоугольники их ссылок (для формул, которые ссылаются на удалённое через имя). */
function definedNameAreas(xml) {
  const out = new Map();
  let dn = null;
  tokenize(xml, (t) => {
    if (t.type === 'open' && t.name === 'definedName') dn = { name: getAttr(xml, t.attrStart, t.attrEnd, 'name')?.raw || '', start: t.end };
    else if (t.type === 'close' && t.name === 'definedName' && dn) {
      if (dn.name && !/^_xlnm\./i.test(dn.name)) out.set(unescapeXml(dn.name), formulaRefs(unescapeXml(xml.slice(dn.start, t.start)), ''));
      dn = null;
    }
  });
  return out;
}

/**
 * Кэш формул, которые ссылаются на удалённое (ревью WP12-D): кэш <v> — тоже данные (его читают ИИ и парсеры).
 * Ссылка на удалённый лист (прямо или через имя книги) — ячейка-ошибка t="e" с <v>#REF!</v> (формула сама становится #REF!);
 * ссылка на очищенные ячейки скрытых строк и столбцов — кэш снимается (книга пересчитается при открытии: fullCalcOnLoad).
 * Общая формула — по владельцу и его диапазону: решение для всех ячеек группы.
 */
function fixFormulaCaches(scans, removedNames, cleared, nameAreas, ctx, push) {
  /** ячейки, чей кэш снят (зависящие от них формулы — тоже, транзитивно): лист → «строка:столбец» */
  const dropped = new Map();
  const hitsCleared = (a) => {
    const key = a.sheet.toLowerCase();
    const c = cleared.get(key);
    if (c) {
      for (let r = a.r1; r <= Math.min(a.r2, a.r1 + 100000); r++) if (c.rows.has(r)) return true;
      if (c.cols.some(([x, y]) => a.c1 <= y && a.c2 >= x)) return true;
    }
    for (const rc of dropped.get(key) || []) {
      const [r, col] = rc.split(':').map(Number);
      if (r >= a.r1 && r <= a.r2 && col >= a.c1 && col <= a.c2) return true;
    }
    return false;
  };
  // ссылки каждой формулы — один раз; общая формула — по владельцу и его диапазону, решение — для всей группы
  const items = [];
  for (const { sheet, xml, r } of scans) {
    const owners = new Map();
    for (const c of r.formulas) {
      if (c.f.shared != null && !c.f.ref) continue;
      let areas = formulaRefs(c.f.text, sheet.name);
      if (c.f.ref && c.f.shared != null) {
        const range = parseRange(c.f.ref);
        if (range) areas = spreadShared(areas, range);
      }
      const { code } = scanFormula(c.f.text);
      for (const [nm, list] of nameAreas) {
        const re = new RegExp(`(?<![\\p{L}\\p{N}_.])${nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_.(])`, 'iu');
        if (re.test(code)) areas = [...areas, ...list];
      }
      const ref = areas.some((a) => removedNames.has(a.sheet.toLowerCase())) || refersRemoved(code, removedNames);
      const item = { sheet, xml, areas, verdict: ref ? 'ref' : null, cells: [c] };
      items.push(item);
      if (c.f.shared != null) owners.set(c.f.shared, item);
    }
    for (const c of r.formulas) if (c.f.shared != null && !c.f.ref) owners.get(c.f.shared)?.cells.push(c);
  }
  // снятый кэш распространяется на формулы, которые на него ссылаются (=Данные!B4, где B4 = SUM по скрытой строке)
  const mark = (item) => {
    const key = item.sheet.name.toLowerCase();
    if (!dropped.has(key)) dropped.set(key, new Set());
    for (const c of item.cells) dropped.get(key).add(`${c.row}:${c.col}`);
  };
  for (const it of items) if (it.verdict) mark(it);
  for (let changed = true; changed;) {
    changed = false;
    for (const it of items) {
      if (it.verdict || !it.areas.some(hitsCleared)) continue;
      it.verdict = 'clear';
      mark(it);
      changed = true;
    }
  }
  for (const it of items) {
    for (const c of it.cells) {
      if (it.verdict === 'ref') {
        const attrs = it.xml
          .slice(c.attrStart, c.attrEnd)
          .replace(/\s+t\s*=\s*("[^"]*"|'[^']*')/, '')
          .replace(/\s*\/$/, '');
        ctx.strip(it.sheet.part, { from: c.start, to: c.openEnd, text: `<c${attrs} t="e">` });
        if (c.v && c.v.end > 0) ctx.strip(it.sheet.part, { from: c.v.start, to: c.v.end, text: '<v>#REF!</v>' });
        else push(it.sheet.part, { from: c.f.end, to: c.f.end, text: '<v>#REF!</v>' });
      } else if (it.verdict === 'clear' && c.v && c.v.end > 0) ctx.strip(it.sheet.part, { from: c.v.start, to: c.v.end });
    }
  }
}

/** Имя удалённого листа в коде формулы (ссылка без диапазона A1, например на имя листа): «'Лист'!» или «Лист!». */
function refersRemoved(code, removedNames) {
  for (const m of code.matchAll(/'((?:[^']|'')+)'!|([\p{L}\p{N}_.]+)!/gu)) {
    const nm = (m[1] ? m[1].replace(/''/g, "'") : m[2]).toLowerCase();
    if (removedNames.has(nm)) return true;
  }
  return false;
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

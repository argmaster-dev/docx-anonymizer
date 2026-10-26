// Ссылки A1 и имена листов в формулах Excel (версия 0.5, WP12-B, docs/contracts.md §9.8; концепция 0.5, «Риски»: числа и типы ячеек).
// Формулы не меняются (кроме согласованного переименования листа, в имени которого найдена сущность); отсюда — граф ссылок
// для предупреждения «на ячейку ссылаются формулы» (грубо: диапазоны и общие формулы — прямоугольниками) и строковые
// литералы внутри формул (их содержимое — поток для поиска, но формула не правится: предупреждение).
// Чистый JS; значения ячеек и формул в логи не попадают (NFR-14).

/**
 * Прямоугольник ссылок на листе: строки и столбцы с 1, включительно.
 * @typedef {{sheet: string, r1: number, c1: number, r2: number, c2: number}} RefArea
 */

const MAX_ROW = 1048576;
const MAX_COL = 16384;

/** 'A' → 1, 'AB' → 28. */
export function colNumber(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** 1 → 'A', 28 → 'AB'. */
export function colLetters(n) {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

/** 'B12' → {row: 12, col: 2}; не ссылка — null. */
export function parseCell(ref) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(String(ref || ''));
  return m ? { row: Number(m[2]), col: colNumber(m[1]) } : null;
}

/** 'A1:C3' → прямоугольник без имени листа; одиночная ячейка — 1×1. */
export function parseRange(ref) {
  const [a, b = a] = String(ref || '').split(':');
  const p = parseCell(a);
  const q = parseCell(b);
  if (!p || !q) return null;
  return { r1: Math.min(p.row, q.row), c1: Math.min(p.col, q.col), r2: Math.max(p.row, q.row), c2: Math.max(p.col, q.col) };
}

/**
 * Разметка формулы: диапазоны строковых литералов "…" (содержимое, без кавычек; "" внутри — одна кавычка) и имён листов
 * в апострофах '…'. Остальное — код формулы.
 * @param {string} f  формула без «=» (как в <f>)
 * @returns {{strings: {start: number, end: number}[], code: string}}  code — формула, где литералы и имена в апострофах
 *   заменены пробелами той же длины (позиции сохраняются), а '…' — символами «'»
 */
export function scanFormula(f) {
  const strings = [];
  let code = '';
  for (let i = 0; i < f.length; i++) {
    const ch = f[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      for (; j < f.length; j++) {
        if (f[j] === ch) {
          if (f[j + 1] === ch) j++;
          else break;
        }
      }
      if (ch === '"') {
        strings.push({ start: i + 1, end: Math.min(j, f.length) });
        code += ' '.repeat(Math.min(j, f.length - 1) - i + 1);
      } else code += f.slice(i, j + 1); // имя листа в апострофах — часть кода (до «!»)
      i = j;
    } else code += ch;
  }
  return { strings, code: code.slice(0, f.length) };
}

// [лист!]ссылка: имя листа в апострофах или простое (буквы, цифры, «_», «.»); ссылка — ячейка, диапазон ячеек,
// столбцы «A:C» или строки «2:5»
const SHEET_SRC = "(?:'(?:[^']|'')+'|[\\p{L}_][\\p{L}\\p{N}_.]*)";
const CELL_SRC = '\\$?[A-Z]{1,3}\\$?\\d+';
const REF_RE = new RegExp(
  `(?<![\\p{L}\\p{N}_.$\\]])(?:(${SHEET_SRC})(?::${SHEET_SRC})?!)?(${CELL_SRC}(?::${CELL_SRC})?|\\$?[A-Z]{1,3}:\\$?[A-Z]{1,3}|\\$?\\d+:\\$?\\d+)(?![\\p{L}\\p{N}_(!])`,
  'gu',
);

/** Имя листа из ссылки: «'Лист 1'» → «Лист 1». */
export function unquoteSheet(s) {
  return s.startsWith("'") ? s.slice(1, -1).replace(/''/g, "'") : s;
}

/**
 * Прямоугольники ссылок формулы (вне строковых литералов). Без имени листа — текущий лист.
 * @param {string} f
 * @param {string} sheet  лист, на котором стоит формула
 * @returns {RefArea[]}
 */
export function formulaRefs(f, sheet) {
  const { code } = scanFormula(f);
  const out = [];
  REF_RE.lastIndex = 0;
  let m;
  while ((m = REF_RE.exec(code))) {
    const target = m[1] ? unquoteSheet(m[1]) : sheet;
    const [a, b = a] = m[2].split(':');
    const p = cellOrLine(a, 'start');
    const q = cellOrLine(b, 'end');
    if (!p || !q) continue;
    out.push({ sheet: target, r1: Math.min(p.row, q.row), c1: Math.min(p.col, q.col), r2: Math.max(p.row, q.row), c2: Math.max(p.col, q.col) });
  }
  return out;
}

/** Ячейка, столбец («C» — все строки) или строка («5» — все столбцы). */
function cellOrLine(s, edge) {
  const c = parseCell(s);
  if (c) return c;
  const t = s.replace(/\$/g, '');
  if (/^[A-Z]{1,3}$/.test(t)) return { row: edge === 'start' ? 1 : MAX_ROW, col: colNumber(t) };
  if (/^\d+$/.test(t)) return { row: Number(t), col: edge === 'start' ? 1 : MAX_COL };
  return null;
}

/**
 * Общая формула (`<f t="shared" ref="B2:B10">A2*2</f>`) действует на весь диапазон: относительные ссылки сдвигаются вместе
 * с ячейкой. Грубо: прямоугольник ссылки расширяется на размер диапазона (абсолютные части — тоже; лишнее предупреждение
 * безопаснее пропущенного).
 * @param {RefArea[]} refs  ссылки формулы ведущей ячейки
 * @param {{r1: number, c1: number, r2: number, c2: number}} range  диапазон общей формулы
 */
export function spreadShared(refs, range) {
  const dr = range.r2 - range.r1;
  const dc = range.c2 - range.c1;
  return refs.map((r) => ({ ...r, r2: Math.min(MAX_ROW, r.r2 + dr), c2: Math.min(MAX_COL, r.c2 + dc) }));
}

/**
 * Переименование листа в формуле: каждое «Старое!» / «'Старое'!» вне литералов → «'Новое'!» (всегда в апострофах —
 * так Excel принимает любое имя). Ссылки на другие книги («[1]Лист!A1») и литералы не трогаются. Имена листов
 * сравниваются без учёта регистра, как в Excel.
 * @param {string} f
 * @param {Map<string, string>} renames  старое имя в нижнем регистре → новое
 * @returns {string}
 */
export function renameSheets(f, renames) {
  if (!renames.size || !f.includes('!')) return f;
  const { code } = scanFormula(f);
  const re = new RegExp(`(?<![\\p{L}\\p{N}_.$\\]])(${SHEET_SRC})(?=!)`, 'gu');
  const edits = [];
  let m;
  while ((m = re.exec(code))) {
    const nw = renames.get(unquoteSheet(m[1]).toLowerCase());
    if (nw !== undefined) edits.push({ start: m.index, end: m.index + m[1].length, text: quoteSheet(nw) });
  }
  let out = f;
  for (const e of edits.reverse()) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** Имя листа для формулы: в апострофах, апостроф внутри удваивается. */
export function quoteSheet(name) {
  return `'${name.replace(/'/g, "''")}'`;
}

/**
 * Имя листа после замены (метка, маска): без символов, запрещённых Excel ([ ] : * ? / \), без апострофа по краям,
 * не длиннее 31 символа и не пустое; совпадение с другим листом (без учёта регистра) — суффикс « (2)», « (3)»…
 * @param {string} name
 * @param {Set<string>} taken  имена листов в нижнем регистре (дополняется)
 */
export function safeSheetName(name, taken) {
  let base = name
    .replace(/[[\]:*?/\\]/g, '')
    .replace(/^'+|'+$/g, '')
    .trim();
  if (!base) base = 'Sheet';
  base = base.slice(0, 31);
  let out = base;
  for (let k = 2; taken.has(out.toLowerCase()); k++) {
    const sfx = ` (${k})`;
    out = base.slice(0, 31 - sfx.length) + sfx;
  }
  taken.add(out.toLowerCase());
  return out;
}

/**
 * Попадает ли ячейка в какой-либо прямоугольник ссылок.
 * @param {RefArea[]} areas
 * @param {string} sheet
 * @param {number} row
 * @param {number} col
 */
export function isReferenced(areas, sheet, row, col) {
  const s = sheet.toLowerCase();
  return areas.some((a) => a.sheet.toLowerCase() === s && row >= a.r1 && row <= a.r2 && col >= a.c1 && col <= a.c2);
}

// Ячейки таблиц форматов 0.5 (Excel, PowerPoint, CSV; WP12-B) → блоки `doc.blocks` для заголовков столбцов и строк
// (detect/tables.js читает `blocks[].table {index, row, col}` — как у текстовой модели PDF, без правок). Здесь — то, чего нет
// у PDF: строка шапки ищется явно (первая строка из ≥ minHeader ячеек без цифр), заголовок листа над шапкой («Реестр договоров
// за октябрь 2026») уходит в свою таблицу и не становится заголовком столбцов, а ячейки шапки не получают «метку слева»
// (иначе «Телефон» справа от «ФИО» стал бы ФИО по правилу анкеты). Чистый JS, значения в логи не попадают.

/**
 * @typedef {{pid: string, text: string, row: number, col: number}} TableCell
 * @typedef {{pid: string, kind: 'cell', text: string, table: {index: number|string, row: number, col: number}}} TableBlock
 */

/**
 * @param {TableCell[]} cells  ячейки одной таблицы (лист, таблица слайда, CSV); одна ячейка может повторяться в нескольких
 *   столбцах (объединённая ячейка шапки)
 * @param {{index: number|string, minHeader?: number, scanRows?: number, fakePid: () => string}} o
 *   fakePid — идентификатор для ячейки шапки в таблице заголовков (без потока: метка слева ей не назначается)
 * @returns {TableBlock[]}
 */
export function tableBlocks(cells, o) {
  const header = headerRow(cells, o.minHeader ?? 3, o.scanRows ?? 10);
  const block = (c, index, pid = c.pid) => ({ pid, kind: /** @type {const} */ ('cell'), text: c.text, table: { index, row: c.row, col: c.col } });
  return cells.map((c) => {
    if (header === null || c.row > header) return block(c, o.index);
    if (c.row < header) return block(c, `title${o.index}`); // без «:» — detect/tables.js делит ключ «таблица:столбец» по нему
    return block(c, o.index, o.fakePid());
  });
}

/**
 * Строка шапки: первая (из первых `scanRows`) строка, где ≥ `minHeader` столбцов с текстом и ни в одной ячейке нет цифр; нет — null.
 * @param {{text: string, row: number, col: number}[]} cells
 * @param {number} [minHeader]
 * @param {number} [scanRows]
 * @returns {number | null}
 */
export function headerRow(cells, minHeader = 3, scanRows = 10) {
  const rows = [...new Set(cells.map((c) => c.row))].sort((a, b) => a - b);
  for (const r of rows.slice(0, scanRows)) {
    const rc = cells.filter((c) => c.row === r && c.text.trim());
    if (new Set(rc.map((c) => c.col)).size >= minHeader && rc.every((c) => !/\d/.test(c.text))) return r;
  }
  return null;
}

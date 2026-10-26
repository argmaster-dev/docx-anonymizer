// Ссылки A1, имена листов в формулах и таблицы заголовков форматов 0.5 (WP12-B; src/core/xlsx/refs.js, src/core/table-blocks.js).
import { describe, it, expect } from 'vitest';
import {
  colNumber,
  colLetters,
  parseCell,
  parseRange,
  scanFormula,
  formulaRefs,
  spreadShared,
  renameSheets,
  safeSheetName,
  isReferenced,
  quoteSheet,
} from '../../src/core/xlsx/refs.js';
import { tableBlocks } from '../../src/core/table-blocks.js';
import { unescapeWithMap } from '../../src/core/xlsx/model.js';

describe('ссылки A1', () => {
  it('столбцы, ячейки, диапазоны', () => {
    expect([colNumber('A'), colNumber('Z'), colNumber('AA'), colNumber('XFD')]).toEqual([1, 26, 27, 16384]);
    expect([1, 26, 27, 16384].map(colLetters)).toEqual(['A', 'Z', 'AA', 'XFD']);
    expect(parseCell('$B$12')).toEqual({ row: 12, col: 2 });
    expect(parseCell('Лист1')).toBeNull();
    expect(parseRange('C3:A1')).toEqual({ r1: 1, c1: 1, r2: 3, c2: 3 });
  });

  it('литералы и имена листов в апострофах; ссылки вне литералов, с листом и без, столбцы и строки целиком', () => {
    const f = `SUM('Мой лист'!B2:B5)+Лист2!$C$1*LOG10(A1)&"B7 не ссылка"+COUNTA(D:D)+SUM(3:4)+[1]Чужой!A1`;
    expect(scanFormula(f).strings.map((s) => f.slice(s.start, s.end))).toEqual(['B7 не ссылка']);
    expect(formulaRefs(f, 'Текущий')).toEqual([
      { sheet: 'Мой лист', r1: 2, c1: 2, r2: 5, c2: 2 },
      { sheet: 'Лист2', r1: 1, c1: 3, r2: 1, c2: 3 },
      { sheet: 'Текущий', r1: 1, c1: 1, r2: 1, c2: 1 },
      { sheet: 'Текущий', r1: 1, c1: 4, r2: 1048576, c2: 4 },
      { sheet: 'Текущий', r1: 3, c1: 1, r2: 4, c2: 16384 },
      { sheet: 'Текущий', r1: 1, c1: 1, r2: 1, c2: 1 }, // ссылка на другую книгу — без имени листа (грубо: лишнее предупреждение безопаснее)
    ]);
    expect(spreadShared([{ sheet: 'Л', r1: 2, c1: 1, r2: 2, c2: 1 }], { r1: 2, c1: 2, r2: 10, c2: 2 })).toEqual([{ sheet: 'Л', r1: 2, c1: 1, r2: 10, c2: 1 }]);
    expect(isReferenced([{ sheet: 'Лист', r1: 2, c1: 1, r2: 10, c2: 1 }], 'ЛИСТ', 5, 1)).toBe(true);
    expect(isReferenced([{ sheet: 'Лист', r1: 2, c1: 1, r2: 10, c2: 1 }], 'Лист', 5, 2)).toBe(false);
  });

  it('переименование листа: простое и в апострофах, без учёта регистра; литералы и другие книги — нет', () => {
    const renames = new Map([
      ['гаврилов е.с.', 'ФИО_1'],
      ['итоги', "О'Нил"],
    ]);
    expect(renameSheets(`COUNTA('Гаврилов Е.С.'!A2:A4)&"'Гаврилов Е.С.'!A1"`, renames)).toBe(`COUNTA('ФИО_1'!A2:A4)&"'Гаврилов Е.С.'!A1"`);
    expect(renameSheets('ИТОГИ!B2+[2]Итоги!B2+Итоги2!A1', renames)).toBe(`'О''Нил'!B2+[2]Итоги!B2+Итоги2!A1`);
    expect(quoteSheet("О'Нил")).toBe("'О''Нил'");
  });

  it('безопасное имя листа: без [ ] : * ? / \\, ≤ 31 символа, не пустое, без повторов', () => {
    const taken = new Set(['сводка']);
    expect(safeSheetName('[ФИО_1]', taken)).toBe('ФИО_1');
    expect(safeSheetName('Сводка', taken)).toBe('Сводка (2)');
    expect(safeSheetName('[удалено]', taken)).toBe('удалено');
    expect(safeSheetName('[удалено]', taken)).toBe('удалено (2)');
    expect(safeSheetName('a/b\\c?d*e:f', taken)).toBe('abcdef');
    expect(safeSheetName('[]', taken)).toBe('Sheet');
    expect(safeSheetName('Х'.repeat(40), taken)).toHaveLength(31);
  });

  it('XML-unescape с картой позиций (колонтитулы)', () => {
    const { text, map } = unescapeWithMap('&amp;LИП &quot;А&quot;&amp;R');
    expect(text).toBe('&LИП "А"&R');
    expect(map[2]).toBe(6); // «И» после «&amp;L»
    expect(map[text.length]).toBe('&amp;LИП &quot;А&quot;&amp;R'.length);
  });
});

describe('таблицы заголовков (core/table-blocks.js)', () => {
  const cells = [
    { pid: 'p0', text: 'Реестр за октябрь 2026', row: 1, col: 1 },
    { pid: 'p0', text: 'Реестр за октябрь 2026', row: 1, col: 2 },
    { pid: 'p0', text: 'Реестр за октябрь 2026', row: 1, col: 3 },
    { pid: 'p1', text: 'ФИО', row: 2, col: 1 },
    { pid: 'p2', text: 'Телефон', row: 2, col: 2 },
    { pid: 'p3', text: 'ИНН', row: 2, col: 3 },
    { pid: 'p4', text: 'Ершова Алина', row: 3, col: 1 },
    { pid: 'p5', text: '9162043117', row: 3, col: 2 },
  ];
  it('шапка — первая строка из ≥ 3 ячеек без цифр: её ячейки без потока, заголовок листа над ней — отдельная таблица', () => {
    let n = 0;
    const b = tableBlocks(cells, { index: 0, fakePid: () => `h${n++}` });
    expect(b.filter((x) => x.table.index === 'title0').map((x) => x.pid)).toEqual(['p0', 'p0', 'p0']);
    expect(b.filter((x) => x.table.row === 2).map((x) => x.pid)).toEqual(['h0', 'h1', 'h2']);
    expect(b.filter((x) => x.table.row === 3).map((x) => [x.pid, x.table.index])).toEqual([
      ['p4', 0],
      ['p5', 0],
    ]);
  });
  it('нет шапки (анкета «поле | значение» из двух столбцов) — как есть', () => {
    const b = tableBlocks(
      [
        { pid: 'a', text: 'ФИО', row: 1, col: 1 },
        { pid: 'b', text: 'Ершова Алина', row: 1, col: 2 },
      ],
      { index: 7, fakePid: () => 'x' },
    );
    expect(b.map((x) => [x.pid, x.table.index])).toEqual([
      ['a', 7],
      ['b', 7],
    ]);
  });
});

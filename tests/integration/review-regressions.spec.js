// Регрессии второго ревью WP12-C (версия 0.5): ни одна утечка, которой не было в 0.4 и первой версии пакета. Каждая строка
// прогоняется полным анализом (все детекторы, без модели) текстом (PDF → текстовая модель) и в DOCX — абзацем и таблицей
// «метка | значение» в четыре столбца (первая строка таблицы — данные, а не заголовок). Проверяется результат applyDecisions:
// секретов в нём нет. Принцип: лишнее маскирование дешевле утечки. Данные вымышленные.
import { describe, it, expect, beforeAll } from 'vitest';
import { parseDocx, fromText, analyze, applyDecisions, defaultSettings, registerBuiltinDetectors, clearDetectors } from '../../src/core/index.js';
import { makeDocx, para, run, unzipText } from '../helpers/docx.js';

/** [текст, секреты, которых не должно остаться] */
const LINES = [
  ['Сервер доступен по адресу 192.168.10.25', ['192.168.10.25']],
  ['Подключение по RDP к 10.20.30.40 разрешено', ['10.20.30.40']],
  ['Заходил по VPN с 10.8.0.14 в 23:00', ['10.8.0.14']],
  ['Иванов П. заходил с 192.168.1.15 ночью', ['192.168.1.15']],
  ['Сервер Windows 192.168.1.20 перезагружен', ['192.168.1.20']],
  ['Сервер в прил. 2: 95.31.18.119', ['95.31.18.119']],
  ['Табл. доступа: 95.31.18.119 разрешён', ['95.31.18.119']],
  ['код ТС XTA21099071234567', ['XTA21099071234567']],
  ['Идентификационный код автомобиля WVWZZZ1JZXW000001', ['WVWZZZ1JZXW000001']],
  ['партия автомобилей: XTA219010K0123456 и XTA219010K0123457', ['XTA219010K0123456', 'XTA219010K0123457']],
  ['VIN: XTA-21099-071234567', ['XTA-21099-071234567']],
  ['Диагноз: J45.0, основное заболевание: бронхиальная астма', ['J45.0', 'бронхиальная астма']],
  ['Диагноз: Остеохондроз Поясничного отдела: Обострение', ['Остеохондроз', 'Обострение']],
  ['Диагноз: рак молочной железы T2N0M0, Стадия: IIA', ['T2N0M0', 'IIA']],
  ['Диагноз основной: J45.0 Бронхиальная астма; сопутствующий: I10 Гипертоническая болезнь', ['J45.0', 'Бронхиальная', 'I10', 'Гипертоническая']],
  ['Диагноз: Гипертоническая болезнь II ст. Риск 4. ХСН IIА', ['Гипертоническая', 'Риск 4', 'ХСН']],
  ['Диагноз: Сахарный диабет 2 типа. Ожирение 2 ст.', ['диабет', 'Ожирение']],
  ['Вероисповедание (при желании): православие', ['православие']],
  ['Диагноз: J45.0, ИНН 7707083893', ['J45.0', '7707083893']],
  ['Диагноз — J45.0 тел. +7 999 123-45-67', ['J45.0', '123-45-67']],
  ['Вероисповедание: православие, паспорт 4506 123456', ['православие', '4506 123456']],
  ['дело № А40‑12345/2026', ['12345/2026']],
  ['Дело № 2–1545/2026', ['1545/2026']],
  ['паспорт 4506 123456, выдан: «12» марта 2006 г. ОВД Тверского района', ['4506 123456', 'марта 2006', 'ОВД Тверского']],
];
/** Таблицы «метка | значение | метка | значение», первая строка — данные (не заголовок). */
const TABLES = [
  [
    ['Фамилия', 'Чернышева', 'Имя', 'Ангелина'],
    ['Паспорт', '4506 123456', 'Дата рождения', '17.11.1993'],
    ['Диагноз', 'бронхит', 'Национальность', 'русская'],
  ],
  [
    ['Паспорт', '4506 123456', 'Дата рождения', '17.11.1993'],
    ['Фамилия', 'Чернышева', 'Имя', 'Ангелина'],
  ],
  [
    ['Диагноз', 'бронхит', 'Вероисповедание', 'ислам'],
    ['Водительское удостоверение', '77 12 345678', 'Полис ОМС', '7700000012345672'],
  ],
];
const TABLE_SECRETS = ['Чернышева', 'Ангелина', '4506 123456', '17.11.1993', 'бронхит', 'русская', 'ислам', '77 12 345678', '7700000012345672'];

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const docxTable = (rows) => `<w:tbl>${rows.map((r) => `<w:tr>${r.map((c) => `<w:tc>${para(run(esc(c)))}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
const outText = (doc, groups) => {
  const res = applyDecisions(doc, groups, { placeholderLanguage: 'ru', textFormat: 'md', createdAt: '2026-10-26T00:00:00Z' });
  if (doc.kind === 'text') return new TextDecoder().decode(res.bytes);
  return Object.values(unzipText(res.bytes))
    .join('\n')
    .replace(/<[^>]+>/g, '');
};
const leaks = (out, secrets) => secrets.filter((v) => out.includes(v));

beforeAll(() => {
  clearDetectors();
  registerBuiltinDetectors();
});

describe('ревью WP12-C: строки ревью — без утечек', () => {
  it.each(LINES)('текст и DOCX: %j', async (text, secrets) => {
    const t = fromText([{ kind: 'p', text, page: 1 }], { name: 'a.pdf', size: 1 });
    expect(leaks(outText(t, (await analyze(t, defaultSettings())).groups), secrets), 'текст').toEqual([]);
    const d = parseDocx(makeDocx(para(run(esc(text)))));
    expect(leaks(outText(d, (await analyze(d, defaultSettings())).groups), secrets), 'DOCX').toEqual([]);
  });

  it('таблицы «метка | значение» в четыре столбца: первая строка — данные — в DOCX и текстом', async () => {
    const d = parseDocx(makeDocx(TABLES.map((rows) => para(run('Анкета')) + docxTable(rows)).join('')));
    expect(leaks(outText(d, (await analyze(d, defaultSettings())).groups), TABLE_SECRETS), 'DOCX').toEqual([]);
    const blocks = [];
    TABLES.forEach((rows, index) => {
      blocks.push({ kind: 'p', text: 'Анкета', page: 1 });
      rows.forEach((row, r) => row.forEach((text, c) => blocks.push({ kind: 'cell', text, page: 1, table: { index, row: r, col: c, cols: row.length } })));
    });
    const t = fromText(blocks, { name: 'a.pdf', size: 1 });
    expect(leaks(outText(t, (await analyze(t, defaultSettings())).groups), TABLE_SECRETS), 'текст').toEqual([]);
  });
});

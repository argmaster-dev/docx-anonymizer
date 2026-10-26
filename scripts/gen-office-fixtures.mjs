#!/usr/bin/env node
// Фикстуры форматов версии 0.5 (WP12-B, К1–К4; docs/concept-0.5.md п. 2–4, 10): книги Excel, презентации PowerPoint, CSV и JSON
// с gold — в tests/fixtures/office/, и жанры корпуса (xlsx-crm, xlsx-statement, pptx-deck, csv-export, json-export) —
// в tests/fixtures/genres/<жанр>/ (оценка — scripts/eval-genres.mjs, tests/integration/genres.spec.js). Детерминированно:
// идентификаторы — с верными контрольными суммами из номера, ZIP — с фиксированной датой (scripts/office-writer.mjs).
// Все люди, компании, номера и адреса вымышленные. Без сети.
//
//   npm run gen-office-fixtures            — записать
//   npm run gen-office-fixtures -- --check — сверить с репозиторием (код 1 при расхождении)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildXlsx, buildPptx } from './office-writer.mjs';
import { encodeText } from '../src/core/plain/plain-adapter.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OFFICE_DIR = join(root, 'tests/fixtures/office');
export const GENRES_DIR = join(root, 'tests/fixtures/genres');
/** Жанры корпуса 0.5 из этого генератора (DOCX/PDF-жанры 0.5 — scripts/gen-genre-fixtures.mjs). */
export const OFFICE_GENRES = ['xlsx-crm', 'xlsx-statement', 'pptx-deck', 'csv-export', 'json-export'];

/* ---------------- идентификаторы с контрольными суммами ---------------- */

const digits = (n, len) => String(n).padStart(len, '0').slice(-len);
const wsum = (d, w) => w.reduce((s, x, i) => s + x * d[i], 0);

/** ИНН юрлица (10 цифр) из 9-значного номера. */
export function inn10(n) {
  const d = digits(n, 9).split('').map(Number);
  return d.join('') + ((wsum(d, [2, 4, 10, 3, 5, 9, 4, 6, 8]) % 11) % 10);
}
/** ИНН физлица (12 цифр) из 10-значного номера. */
export function inn12(n) {
  const d = digits(n, 10).split('').map(Number);
  const c1 = (wsum(d, [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) % 11) % 10;
  const c2 = (wsum([...d, c1], [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) % 11) % 10;
  return d.join('') + c1 + c2;
}
/** СНИЛС «XXX-XXX-XXX YY» из 9-значного номера (> 001-001-998). */
export function snils(n) {
  const s = digits(n, 9);
  const sum = s.split('').reduce((a, x, i) => a + Number(x) * (9 - i), 0);
  const c = sum < 100 ? sum : sum === 100 || sum === 101 ? 0 : sum % 101 === 100 ? 0 : sum % 101;
  return `${s.slice(0, 3)}-${s.slice(3, 6)}-${s.slice(6)} ${String(c).padStart(2, '0')}`;
}
/** Расчётный счёт (20 цифр) с ключом по БИК. */
export function account(bik, n) {
  const prefix = bik.slice(6, 9);
  const body = `40702810${digits(n, 11)}`; // ключ — 9-я цифра (индекс 8)
  for (let k = 0; k < 10; k++) {
    const a = body.slice(0, 8) + k + body.slice(8);
    const s = (prefix + a).split('').reduce((acc, x, i) => acc + ((Number(x) * [7, 1, 3][i % 3]) % 10), 0);
    if (s % 10 === 0) return a;
  }
  throw new Error('нет ключа счёта');
}
/** Номер карты (16 цифр, Луна) из 15-значного номера, группами по 4. */
export function card(n) {
  const s = digits(n, 15);
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let x = Number(s[14 - i]);
    if (i % 2 === 0) {
      x *= 2;
      if (x > 9) x -= 9;
    }
    sum += x;
  }
  const full = s + ((10 - (sum % 10)) % 10);
  return full.match(/\d{4}/g).join(' ');
}

const BIK = '044525225';

/* ---------------- люди и компании (вымышленные) ---------------- */

const PEOPLE = [
  { fio: 'Гаврилов Евгений Сергеевич', short: 'Гаврилов Е.С.', surname: 'Гаврилов', email: 'e.gavrilov@example.com', phone: '+7 916 204-31-17' },
  { fio: 'Ершова Алина Петровна', short: 'Ершова А.П.', surname: 'Ершова', email: 'alina.ershova@example.org', phone: '+7 903 118-42-65' },
  { fio: 'Белоусов Максим Андреевич', short: 'Белоусов М.А.', surname: 'Белоусов', email: 'm.belousov@example.net', phone: '+7 925 610-77-08' },
  { fio: 'Кравцова Дарья Олеговна', short: 'Кравцова Д.О.', surname: 'Кравцова', email: 'darya.kravtsova@example.com', phone: '+7 915 342-19-90' },
  { fio: 'Тимофеев Роман Ильич', short: 'Тимофеев Р.И.', surname: 'Тимофеев', email: 'r.timofeev@example.org', phone: '+7 926 455-03-21' },
  { fio: 'Соболева Виктория Игоревна', short: 'Соболева В.И.', surname: 'Соболева', email: 'v.soboleva@example.net', phone: '+7 977 801-62-34' },
  { fio: 'Лаптев Артём Николаевич', short: 'Лаптев А.Н.', surname: 'Лаптев', email: 'a.laptev@example.com', phone: '+7 905 733-28-46' },
  { fio: 'Федотова Ксения Андреевна', short: 'Федотова К.А.', surname: 'Федотова', email: 'k.fedotova@example.org', phone: '+7 916 950-14-72' },
];
const COMPANIES = ['ООО «Альтаир»', 'АО «Гранит-Строй»', 'ООО «Северный ветер»', 'ООО «Медиана»'];
/** Организация в gold — ядро названия без ОПФ и кавычек (как в корпусе 0.4). */
const orgCore = (c) => c.replace(/^\S+\s+«(.*)»$/, '$1');

/** gold-запись. */
const ent = (key, category, value, extra = {}) => ({ key, category, value, ...extra });
const person = (key, p) => ent(key, 'PERSON', p.fio, { surname: p.surname });

/* ---------------- Excel ---------------- */

/** Выгрузка из CRM: ФИО, телефон (текстом и числом), почта, ИНН числом, компания; скрытая строка; примечание. */
function xlsxCrm() {
  const rows = [
    [
      { s: 'ФИО', style: 1 },
      { s: 'Телефон', style: 1 },
      { s: 'E-mail', style: 1 },
      { s: 'ИНН', style: 1 },
      { s: 'Компания', style: 1 },
      { s: 'Статус', style: 1 },
    ],
  ];
  const gold = [];
  PEOPLE.slice(0, 6).forEach((p, i) => {
    const innP = inn12(7701000000 + i * 1371);
    // телефоны: чётные строки — текстом, нечётные — числом (как выгружают CRM)
    const phone = i % 2 ? Number(`7${p.phone.replace(/\D/g, '').slice(1)}`) : p.phone;
    rows.push([p.fio, phone, p.email, Number(innP), COMPANIES[i % 4], i % 3 ? 'Клиент' : 'Партнёр']);
    gold.push(person(`p${i}`, p), ent(`tel${i}`, 'PHONE', String(phone)), ent(`mail${i}`, 'EMAIL', p.email), ent(`inn${i}`, 'INN', innP));
  });
  return {
    spec: {
      sheets: [
        {
          name: 'Контакты',
          cols: [32, 18, 30, 16, 24, 12],
          rows,
          hiddenRows: [4],
          comments: [{ ref: 'A3', author: 'Зуев Павел', text: 'Перезвонить до пятницы' }],
          header: '&LВыгрузка CRM&RСтр. &P из &N',
          footer: '&CОтветственный: Мельникова О.В.&R&D',
        },
      ],
      core: { creator: 'Зуев Павел', title: 'Выгрузка контактов' },
      app: { company: 'ООО «Альтаир»' },
    },
    gold: {
      entities: [
        ...gold,
        ent('author', 'PERSON', 'Зуев Павел', { surname: 'Зуев', meta: true }),
        ent('footer', 'PERSON', 'Мельникова О.В.', { surname: 'Мельникова' }),
        ...COMPANIES.map((c, i) => ent(`org${i}`, 'COMPANY', orgCore(c), { opf: true })),
      ],
      negatives: [
        { value: 'Клиент', category: 'PERSON' },
        { value: 'Партнёр', category: 'PERSON' },
      ],
    },
  };
}

/** Реестр договоров: объединённый заголовок, номера, контрагент, ИНН юрлица числом, счёт текстом, суммы, итог формулой, колонтитул. */
function xlsxRegistry() {
  const rows = [
    [{ s: 'Реестр договоров за октябрь 2026', style: 1 }, null, null, null, null, null],
    [
      { s: '№', style: 1 },
      { s: 'Контрагент', style: 1 },
      { s: 'ИНН', style: 1 },
      { s: 'Расчётный счёт', style: 1 },
      { s: 'Сумма', style: 1 },
      { s: 'Ответственный', style: 1 },
    ],
  ];
  const gold = [];
  for (let i = 0; i < 4; i++) {
    const inn = inn10(770100100 + i * 7919);
    const acc = account(BIK, 5000 + i * 37);
    const p = PEOPLE[i + 2];
    rows.push([`Д-${101 + i}/26`, COMPANIES[i], Number(inn), acc, { n: 150000 + i * 25000, style: 3 }, p.short]);
    gold.push(ent(`inn${i}`, 'INN', inn), ent(`acc${i}`, 'ACCOUNT', acc), ent(`p${i}`, 'PERSON', p.short, { surname: p.surname }));
  }
  rows.push([null, { s: 'Итого', style: 1 }, null, null, { f: 'SUM(E3:E6)', v: 690000, style: 3 }, null]);
  return {
    spec: {
      sheets: [
        {
          name: 'Реестр',
          cols: [12, 26, 16, 26, 14, 18],
          rows,
          merges: ['A1:F1'],
          header: '&C&"Calibri,Bold"Реестр договоров&R&P',
          footer: '&LСоставил: Лаптев А.Н.',
        },
      ],
      definedNames: [{ name: 'Итого_реестр', ref: 'Реестр!$E$7' }],
      core: { creator: 'Лаптев Артём Николаевич', title: 'Реестр договоров' },
    },
    gold: {
      entities: [
        ...gold,
        ...COMPANIES.map((c, i) => ent(`org${i}`, 'COMPANY', orgCore(c), { opf: true })),
        ent('maker', 'PERSON', 'Лаптев А.Н.', { surname: 'Лаптев' }),
        ent('author', 'PERSON', 'Лаптев Артём Николаевич', { surname: 'Лаптев', meta: true }),
      ],
      negatives: [{ value: 'Итого', category: 'PERSON' }],
    },
  };
}

/** Ведомость: СНИЛС и ИНН числом, счёт, карта, суммы; формулы ссылаются на заменяемые ячейки; второй лист — сводка по ведомости. */
function xlsxStatement() {
  const rows = [
    [
      { s: 'ФИО', style: 1 },
      { s: 'СНИЛС', style: 1 },
      { s: 'ИНН', style: 1 },
      { s: 'Номер карты', style: 1 },
      { s: 'Начислено', style: 1 },
      { s: 'Контроль ИНН', style: 1 },
    ],
  ];
  const gold = [];
  PEOPLE.slice(0, 5).forEach((p, i) => {
    const sn = snils(112233000 + i * 1111);
    const inn = inn12(5001000000 + i * 2213);
    const cd = card(427638001234560 + i * 97);
    const r = i + 2;
    rows.push([p.fio, Number(sn.replace(/\D/g, '')), Number(inn), cd, { n: 45000 + i * 3500, style: 3 }, { f: `LEN(C${r})`, v: 12 }]);
    gold.push(person(`p${i}`, p), ent(`snils${i}`, 'SNILS', sn.replace(/\D/g, '')), ent(`inn${i}`, 'INN', inn), ent(`card${i}`, 'CARD', cd));
  });
  rows.push([{ s: 'Итого', style: 1 }, null, null, null, { f: 'SUM(E2:E6)', v: 260000, style: 3 }, null]);
  return {
    spec: {
      sheets: [
        { name: 'Ведомость', cols: [32, 16, 16, 22, 14, 14], rows },
        {
          name: 'Сводка',
          rows: [
            [
              { s: 'Всего начислено', style: 1 },
              { f: 'Ведомость!E7', v: 260000, style: 3 },
            ],
            [
              { s: 'Первый ИНН', style: 1 },
              { f: 'Ведомость!C2', v: Number(inn12(5001000000)) },
            ],
          ],
        },
      ],
      core: { creator: 'Бухгалтерия', title: 'Ведомость' },
    },
    gold: { entities: gold, negatives: [{ value: 'Итого', category: 'PERSON' }] },
  };
}

/** Несколько листов: лист с ФИО в названии (переименование и ссылки на него), скрытый лист, именованный диапазон, ссылка «#лист». */
function xlsxSheets() {
  const p = PEOPLE[0];
  const q = PEOPLE[1];
  return {
    spec: {
      sheets: [
        {
          name: 'Сводка',
          rows: [
            [
              { s: 'Показатель', style: 1 },
              { s: 'Значение', style: 1 },
            ],
            ['Сделок у менеджера', { f: `COUNTA('${p.short}'!A2:A4)`, v: 3 }],
            ['Сумма сделок', { f: `SUM('${p.short}'!B2:B4)`, v: 270000, style: 3 }],
            ['Резерв', { f: 'SUM(Резерв!B2:B3)', v: 2 }],
          ],
          hyperlinks: [{ ref: 'A2', location: `'${p.short}'!A1`, display: 'Сделок у менеджера' }],
        },
        {
          name: p.short,
          rows: [
            [
              { s: 'Клиент', style: 1 },
              { s: 'Сумма', style: 1 },
              { s: 'Телефон клиента', style: 1 },
            ],
            [q.fio, { n: 90000, style: 3 }, q.phone],
            [PEOPLE[3].fio, { n: 80000, style: 3 }, PEOPLE[3].phone],
            [PEOPLE[4].fio, { n: 100000, style: 3 }, PEOPLE[4].phone],
          ],
        },
        {
          name: 'Резерв',
          hidden: true,
          rows: [
            [
              { s: 'Паспорт', style: 1 },
              { s: 'Кол-во', style: 1 },
            ],
            ['4510 381246', 1],
            ['4511 902735', 1],
          ],
        },
      ],
      definedNames: [{ name: 'Сделки_менеджера', ref: `'${p.short}'!$B$2:$B$4` }],
      core: { creator: 'Ершова Алина Петровна' },
    },
    gold: {
      entities: [
        ent('sheet', 'PERSON', p.short, { surname: p.surname }),
        person('q', q),
        person('c3', PEOPLE[3]),
        person('c4', PEOPLE[4]),
        ent('t1', 'PHONE', q.phone),
        ent('t3', 'PHONE', PEOPLE[3].phone),
        ent('t4', 'PHONE', PEOPLE[4].phone),
        ent('pass1', 'PASSPORT', '4510 381246'),
        ent('pass2', 'PASSPORT', '4511 902735'),
        ent('author', 'PERSON', 'Ершова Алина Петровна', { surname: 'Ершова', meta: true }),
      ],
      negatives: [{ value: 'Показатель', category: 'PERSON' }],
    },
  };
}

/** Примечания и комментарии: обычные примечания, цепочка комментариев с людьми, надпись на листе. */
function xlsxComments() {
  const persons = [{ name: 'Соболева Виктория', userId: 'v.soboleva@example.net' }];
  return {
    spec: {
      sheets: [
        {
          name: 'Задачи',
          cols: [36, 20, 24],
          rows: [
            [
              { s: 'Задача', style: 1 },
              { s: 'Срок', style: 1 },
              { s: 'Исполнитель', style: 1 },
            ],
            ['Подготовить акт сверки', '30.10.2026', PEOPLE[6].short],
            ['Согласовать договор', '05.11.2026', PEOPLE[7].short],
          ],
          comments: [{ ref: 'A2', author: 'Тимофеев Роман', text: `Контакт клиента: ${PEOPLE[2].phone}, ${PEOPLE[2].email}` }],
          threaded: [{ ref: 'A3', person: 'Соболева Виктория', text: `Паспорт подписанта 4512 563019, звонить ${PEOPLE[3].fio}` }],
          drawingText: [`Куратор проекта: ${PEOPLE[5].fio}`],
        },
      ],
      persons,
      core: { creator: 'Тимофеев Роман' },
    },
    gold: {
      entities: [
        ent('ex1', 'PERSON', PEOPLE[6].short, { surname: PEOPLE[6].surname }),
        ent('ex2', 'PERSON', PEOPLE[7].short, { surname: PEOPLE[7].surname }),
        ent('author', 'PERSON', 'Тимофеев Роман', { surname: 'Тимофеев' }),
        ent('tel', 'PHONE', PEOPLE[2].phone),
        ent('mail', 'EMAIL', PEOPLE[2].email),
        ent('pass', 'PASSPORT', '4512 563019'),
        person('call', PEOPLE[3]),
        ent('tc', 'PERSON', 'Соболева Виктория', { surname: 'Соболева' }),
        // идентификатор автора цепочки получает метку своего автора (FR-11)
        ent('tcmail', 'PERSON', 'v.soboleva@example.net'),
        person('box', PEOPLE[5]),
      ],
      negatives: [],
    },
  };
}

/** Inline-строки и форматированный текст: имя разбито на раны, колонтитул, внешняя ссылка-почта, СНИЛС текстом. */
function xlsxInline() {
  const p = PEOPLE[4];
  return {
    spec: {
      sheets: [
        {
          name: 'Анкета',
          cols: [24, 40],
          rows: [
            [
              { s: 'Поле', style: 1, inline: true },
              { s: 'Значение', style: 1, inline: true },
            ],
            [
              { s: 'ФИО', inline: true },
              {
                rich: [
                  [p.surname, true],
                  [' Роман Ильич', false],
                ],
                inline: true,
              },
            ],
            [
              { s: 'СНИЛС', inline: true },
              { s: snils(203117450), inline: true },
            ],
            [
              { s: 'Адрес', inline: true },
              { s: 'г. Тверь, ул. Озёрная, д. 14, кв. 52', inline: true },
            ],
            [
              { s: 'Почта', inline: true },
              { s: p.email, inline: true },
            ],
            [
              { s: 'Дата рождения', inline: true },
              { s: '14.03.1988', inline: true },
            ],
          ],
          hyperlinks: [{ ref: 'B5', url: `mailto:${p.email}` }],
          header: `&L${p.short}&RАнкета`,
        },
      ],
      core: { creator: 'Отдел кадров' },
    },
    gold: {
      entities: [
        person('p', p),
        ent('short', 'PERSON', p.short, { surname: p.surname }),
        ent('snils', 'SNILS', snils(203117450)),
        ent('addr', 'ADDRESS', 'г. Тверь, ул. Озёрная, д. 14, кв. 52'),
        ent('mail', 'EMAIL', p.email),
        ent('bd', 'BIRTHDATE', '14.03.1988'),
      ],
      negatives: [{ value: 'Анкета', category: 'PERSON' }],
    },
  };
}

/* ---------------- PowerPoint ---------------- */

const AUTHORS = [
  { name: 'Котов Игорь', initials: 'КИ', userId: 'i.kotov@example.com' },
  { name: 'Мельникова Ольга', initials: 'МО', userId: 'o.melnikova@example.org' },
];

/** Продажи: заголовок, группа контактов, заметки докладчика. */
function pptxSales() {
  const p = PEOPLE[0];
  return {
    spec: {
      slides: [
        {
          shapes: [
            { type: 'text', x: 40, y: 30, w: 880, h: 70, title: true, paras: ['Итоги квартала: отдел продаж'] },
            { type: 'text', x: 40, y: 120, w: 880, h: 100, paras: [`Руководитель направления — ${p.fio}`, `Связь: ${p.phone}`] },
            {
              type: 'group',
              items: [
                {
                  type: 'text',
                  x: 40,
                  y: 260,
                  w: 420,
                  h: 60,
                  paras: [
                    [
                      ['Почта: ', false],
                      [p.email, true],
                    ],
                  ],
                },
                { type: 'text', x: 480, y: 260, w: 420, h: 60, paras: [`Клиент: ${COMPANIES[1]}, ИНН ${inn10(770100500)}`] },
              ],
            },
          ],
          notes: [`Сказать, что ${PEOPLE[1].fio} подтвердила объём. Её телефон ${PEOPLE[1].phone}`],
        },
        { shapes: [{ type: 'text', x: 40, y: 30, w: 880, h: 70, title: true, paras: ['План на ноябрь'] }], notes: ['Без персональных данных'] },
      ],
      core: { creator: 'Котов Игорь', title: 'Итоги квартала' },
    },
    gold: {
      entities: [
        person('p', p),
        ent('tel', 'PHONE', p.phone),
        ent('mail', 'EMAIL', p.email),
        ent('inn', 'INN', inn10(770100500)),
        ent('org', 'COMPANY', orgCore(COMPANIES[1]), { opf: true }),
        person('n', PEOPLE[1]),
        ent('ntel', 'PHONE', PEOPLE[1].phone),
        ent('author', 'PERSON', 'Котов Игорь', { surname: 'Котов', meta: true }),
      ],
      negatives: [{ value: 'План на ноябрь', category: 'PERSON' }],
    },
  };
}

/** Таблица на слайде (заголовки столбцов — метки для чисел без «+7» и ИНН), скрытый слайд. */
function pptxTable() {
  const rows = [['ФИО', 'Телефон', 'ИНН']];
  const gold = [];
  PEOPLE.slice(2, 6).forEach((p, i) => {
    const phone = p.phone.replace(/^\+7 /, '');
    const inn = inn12(7702000000 + i * 3001);
    rows.push([p.fio, phone, inn]);
    gold.push(person(`p${i}`, p), ent(`tel${i}`, 'PHONE', phone), ent(`inn${i}`, 'INN', inn));
  });
  return {
    spec: {
      slides: [
        {
          shapes: [
            { type: 'text', x: 40, y: 20, w: 880, h: 60, title: true, paras: ['Ключевые контакты'] },
            { type: 'table', x: 40, y: 100, w: 880, rows },
          ],
        },
        { hidden: true, shapes: [{ type: 'text', x: 40, y: 20, w: 880, h: 200, paras: [`Резерв: ${PEOPLE[7].fio}, паспорт 4513 774021`] }] },
      ],
    },
    gold: {
      entities: [...gold, person('hidden', PEOPLE[7]), ent('pass', 'PASSPORT', '4513 774021')],
      negatives: [{ value: 'Ключевые контакты', category: 'PERSON' }],
    },
  };
}

/** Комментарии: обычные и современные (с ответом), авторы. */
function pptxComments() {
  return {
    spec: {
      authors: AUTHORS,
      slides: [
        {
          shapes: [{ type: 'text', x: 40, y: 30, w: 880, h: 80, paras: ['Проект «Маяк»: статус', 'Сроки сдвигаются на неделю'] }],
          comments: [{ author: 'Котов Игорь', text: `Уточнить у ${PEOPLE[6].fio}, телефон ${PEOPLE[6].phone}` }],
          modernComments: [
            {
              author: 'Мельникова Ольга',
              text: `Паспорт подрядчика 4514 116288`,
              replies: [{ author: 'Котов Игорь', text: `Почта для акта: ${PEOPLE[6].email}` }],
            },
          ],
        },
      ],
    },
    gold: {
      entities: [
        ent('a1', 'PERSON', 'Котов Игорь', { surname: 'Котов' }),
        ent('a2', 'PERSON', 'Мельникова Ольга', { surname: 'Мельникова' }),
        person('p', PEOPLE[6]),
        ent('tel', 'PHONE', PEOPLE[6].phone),
        ent('pass', 'PASSPORT', '4514 116288'),
        ent('mail', 'EMAIL', PEOPLE[6].email),
        // идентификаторы авторов получают метку своего автора (FR-11); инициалы — тоже (проверяет pptx.spec.js: две буквы
        // в gold дали бы ложные «утечки» подстрокой)
        ent('uid1', 'PERSON', 'i.kotov@example.com'),
        ent('uid2', 'PERSON', 'o.melnikova@example.org'),
      ],
      negatives: [],
    },
  };
}

/** Заметки и alt-текст, макет с именем в нижнем колонтитуле (макеты — только если там сущность). */
function pptxNotes() {
  const p = PEOPLE[7];
  return {
    spec: {
      layoutText: `Подготовила ${p.short}`,
      slides: [
        {
          shapes: [
            { type: 'text', x: 40, y: 30, w: 880, h: 70, title: true, paras: ['Кадровый резерв'] },
            { type: 'text', x: 40, y: 120, w: 880, h: 120, alt: `Фото: ${PEOPLE[5].fio}`, paras: ['Кандидат на позицию руководителя склада'] },
          ],
          notes: [`Кандидат: ${PEOPLE[5].fio}, дата рождения 02.11.1990`, `СНИЛС ${snils(345612789)}, почта ${PEOPLE[5].email}`],
        },
      ],
      core: { creator: p.fio },
    },
    gold: {
      entities: [
        ent('layout', 'PERSON', p.short, { surname: p.surname }),
        person('cand', PEOPLE[5]),
        ent('bd', 'BIRTHDATE', '02.11.1990'),
        ent('snils', 'SNILS', snils(345612789)),
        ent('mail', 'EMAIL', PEOPLE[5].email),
        ent('author', 'PERSON', p.fio, { surname: p.surname, meta: true }),
      ],
      negatives: [{ value: 'Кадровый резерв', category: 'PERSON' }],
    },
  };
}

/* ---------------- CSV и JSON ---------------- */

const CSV_HEAD = ['ФИО', 'Телефон', 'E-mail', 'ИНН', 'Комментарий'];
function csvRows(n, from = 0) {
  return PEOPLE.slice(from, from + n).map((p, i) => [
    p.fio,
    p.phone.replace(/^\+7 /, '8 '),
    p.email,
    inn12(7703000000 + i * 4111),
    i === 1 ? 'звонить после 18:00; "срочно"' : 'нет',
  ]);
}
const csvGold = (rows) =>
  rows.flatMap((r, i) => [
    ent(`p${i}`, 'PERSON', r[0], { surname: r[0].split(' ')[0] }),
    ent(`tel${i}`, 'PHONE', r[1]),
    ent(`mail${i}`, 'EMAIL', r[2]),
    ent(`inn${i}`, 'INN', r[3]),
  ]);
/** CSV по RFC 4180: поле в кавычках, если в нём разделитель, кавычка или перевод строки. */
function toCsv(rows, d, eol = '\r\n') {
  const q = (v) => (v.includes(d) || /["\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(q).join(d)).join(eol) + eol;
}

function jsonExport() {
  const items = PEOPLE.slice(0, 4).map((p, i) => ({
    id: 1000 + i,
    fio: p.fio,
    inn: Number(inn12(7704000000 + i * 5113)),
    phone: p.phone,
    contacts: { email: p.email, telegram: null },
    passport: i === 0 ? '4515 220871' : null,
    note: i === 2 ? `Заменяет ${PEOPLE[6].short} в отпуске` : 'нет',
    tags: ['vip', 'b2b'],
  }));
  const gold = items.flatMap((x, i) => [
    ent(`p${i}`, 'PERSON', x.fio, { surname: x.fio.split(' ')[0] }),
    ent(`inn${i}`, 'INN', String(x.inn)),
    ent(`tel${i}`, 'PHONE', x.phone),
    ent(`mail${i}`, 'EMAIL', x.contacts.email),
  ]);
  gold.push(ent('pass', 'PASSPORT', '4515 220871'), ent('sub', 'PERSON', PEOPLE[6].short, { surname: PEOPLE[6].surname }));
  return {
    text: JSON.stringify({ exported: '2026-10-26', total: items.length, clients: items }, null, 2) + '\n',
    gold: { entities: gold, negatives: [{ value: 'vip', category: 'PERSON' }] },
  };
}

/* ---------------- сборка ---------------- */

/**
 * Фикстуры tests/fixtures/office/: книги, презентации, CSV и JSON с gold.
 * @returns {{name: string, format: 'xlsx'|'pptx'|'csv'|'json', bytes: Uint8Array, gold: any, spec?: any, encoding?: string}[]}
 */
export function buildOfficeFixtures() {
  const out = [];
  for (const [name, f] of Object.entries({
    'crm-export': xlsxCrm,
    registry: xlsxRegistry,
    statement: xlsxStatement,
    sheets: xlsxSheets,
    comments: xlsxComments,
    inline: xlsxInline,
  })) {
    const { spec, gold } = f();
    out.push({ name, format: 'xlsx', bytes: buildXlsx(spec), gold, spec });
  }
  for (const [name, f] of Object.entries({ 'deck-sales': pptxSales, 'deck-table': pptxTable, 'deck-comments': pptxComments, 'deck-notes': pptxNotes })) {
    const { spec, gold } = f();
    out.push({ name, format: 'pptx', bytes: buildPptx(spec), gold, spec });
  }
  const rows = csvRows(4);
  const csvGoldAll = { entities: csvGold(rows), negatives: [] };
  out.push({
    name: 'clients-semicolon-cp1251',
    format: 'csv',
    encoding: 'windows-1251',
    delimiter: ';',
    bytes: encodeText(toCsv([CSV_HEAD, ...rows], ';'), { encoding: 'windows-1251', bom: false }),
    gold: csvGoldAll,
  });
  out.push({
    name: 'clients-comma-utf8bom',
    format: 'csv',
    encoding: 'utf-8',
    bom: true,
    delimiter: ',',
    bytes: encodeText(toCsv([CSV_HEAD, ...rows], ','), { encoding: 'utf-8', bom: true }),
    gold: csvGoldAll,
  });
  out.push({
    name: 'clients-tab-utf8',
    format: 'csv',
    encoding: 'utf-8',
    delimiter: '\t',
    bytes: encodeText(toCsv([CSV_HEAD, ...rows], '\t', '\n'), { encoding: 'utf-8', bom: false }),
    gold: csvGoldAll,
  });
  const js = jsonExport();
  out.push({ name: 'crm-export', format: 'json', bytes: new TextEncoder().encode(js.text), gold: js.gold });
  return out;
}

/**
 * Жанры корпуса 0.5 из этого генератора: tests/fixtures/genres/<жанр>/<имя>.<формат> + <имя>.gold.json.
 * @returns {{genre: string, name: string, format: string, bytes: Uint8Array, gold: any}[]}
 */
export function buildOfficeGenres() {
  const fx = new Map(buildOfficeFixtures().map((f) => [`${f.name}.${f.format}`, f]));
  const pick = (genre, key, name) => {
    const f = /** @type {any} */ (fx.get(key));
    return { genre, name, format: f.format, bytes: f.bytes, gold: f.gold };
  };
  return [
    pick('xlsx-crm', 'crm-export.xlsx', 'crm-contacts'),
    pick('xlsx-crm', 'registry.xlsx', 'contract-registry'),
    pick('xlsx-statement', 'statement.xlsx', 'payroll-statement'),
    pick('xlsx-statement', 'sheets.xlsx', 'manager-deals'),
    pick('pptx-deck', 'deck-sales.pptx', 'deck-quarter'),
    pick('pptx-deck', 'deck-table.pptx', 'deck-contacts'),
    pick('pptx-deck', 'deck-notes.pptx', 'deck-reserve'),
    pick('csv-export', 'clients-semicolon-cp1251.csv', 'clients-cp1251'),
    pick('csv-export', 'clients-comma-utf8bom.csv', 'clients-utf8'),
    pick('json-export', 'crm-export.json', 'crm-clients'),
  ];
}

/** Записать (или сверить) фикстуры и жанры. */
function main() {
  const check = process.argv.includes('--check');
  const bad = [];
  const put = (path, data) => {
    const buf = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
    if (check) {
      if (!existsSync(path) || !readFileSync(path).equals(buf)) bad.push(path);
      return;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, buf);
  };
  const gold = (g) => JSON.stringify(g, null, 2) + '\n';
  for (const f of buildOfficeFixtures()) {
    put(join(OFFICE_DIR, `${f.name}.${f.format}`), f.bytes);
    put(join(OFFICE_DIR, `${f.name}.${f.format}.gold.json`), gold(f.gold));
  }
  for (const d of buildOfficeGenres()) {
    put(join(GENRES_DIR, d.genre, `${d.name}.${d.format}`), d.bytes);
    put(join(GENRES_DIR, d.genre, `${d.name}.gold.json`), gold(d.gold));
  }
  if (check) {
    if (bad.length) {
      console.error(`Устарели (npm run gen-office-fixtures):\n${bad.join('\n')}`);
      process.exit(1);
    }
    console.log('фикстуры форматов 0.5 совпадают с генератором');
  } else console.log(`записано: ${OFFICE_DIR}, жанры ${OFFICE_GENRES.join(', ')}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

// Текстовые форматы (версия 0.5, WP12-B, Ц2, К4; docs/concept-0.5.md п. 4, docs/contracts.md §9.8): .txt/.log/.md — как есть,
// .csv — разделитель, кавычки RFC 4180, кодировка (UTF-8 с BOM и без, Windows-1251) и число строк/столбцов сохраняются,
// ячейки — таблица с шапкой; .json — валиден, ключи и структура те же, строковые значения обезличены, число-идентификатор
// под ключом «inn»/«phone»/… — строкой с предупреждением. Фикстуры — tests/fixtures/office/*.{csv,json} (gen-office-fixtures.mjs).
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeText, encodeText, detectDelimiter, parseCsv, scanJson, keyLabel, parsePlain, PLAIN_ADAPTER } from '../../src/core/plain/plain-adapter.js';
import { analyze, applyDecisions, defaultSettings, registerBuiltinDetectors, clearDetectors, adapterForKind, detectAdapter } from '../../src/core/index.js';
import { CATEGORY_GROUPS } from '../../src/core/categories.js';
import { tableHeaders } from '../../src/core/detect/tables.js';
import { getParagraphs } from '../../src/core/text-view.js';
import { buildOfficeFixtures } from '../../scripts/gen-office-fixtures.mjs';

const DIR = 'tests/fixtures/office';
const ALWAYS = new Set([...CATEGORY_GROUPS.pii, ...CATEGORY_GROUPS.ids]);
const enc = (s) => new TextEncoder().encode(s);

beforeAll(() => {
  clearDetectors();
  registerBuiltinDetectors();
});

async function run(bytes, name, settings = defaultSettings()) {
  const doc = parsePlain(bytes, name);
  const analysis = await analyze(doc, settings);
  const result = applyDecisions(doc, analysis.groups, { createdAt: '2026-10-26T00:00:00Z' });
  return { doc, analysis, result, out: decodeText(result.bytes) };
}

describe('кодировки', () => {
  it('UTF-8 без BOM и с BOM, UTF-16 с BOM, иначе Windows-1251 — определяются и сохраняются при записи', () => {
    const text = 'Иванов Пётр — №5, «кавычки» и €';
    for (const e of [
      { encoding: 'utf-8', bom: false },
      { encoding: 'utf-8', bom: true },
      { encoding: 'utf-16le', bom: true },
      { encoding: 'utf-16be', bom: true },
    ]) {
      const bytes = encodeText(text, e);
      expect(decodeText(bytes)).toEqual({ text, ...e });
    }
    // UTF-16 без BOM (ревью WP12-B): по доле нулевых байтов; записывается так же, без BOM
    for (const encoding of ['utf-16le', 'utf-16be']) {
      const raw = encodeText(text, { encoding, bom: false });
      expect(raw.length).toBe(text.length * 2);
      expect(decodeText(raw)).toEqual({ text, encoding, bom: false });
    }
    const cp = encodeText('Иванов Пётр — №5, «кавычки»', { encoding: 'windows-1251', bom: false });
    expect(cp[0]).toBe(0xc8); // «И» в Windows-1251
    expect(decodeText(cp)).toEqual({ text: 'Иванов Пётр — №5, «кавычки»', encoding: 'windows-1251', bom: false });
    // символа нет в Windows-1251 — «?», остальное на месте
    expect(decodeText(encodeText('Цена ≈ 5', { encoding: 'windows-1251', bom: false })).text).toBe('Цена ? 5');
  });
});

describe('CSV (К4)', () => {
  it('разделитель: «;», «,», табуляция; кавычки RFC 4180 (разделитель, "" и перевод строки внутри поля)', () => {
    expect(detectDelimiter('a;b;c\n1;2;3\n')).toBe(';');
    expect(detectDelimiter('a,b,c\r\n"1,5",2,3\r\n')).toBe(',');
    expect(detectDelimiter('a\tb\n1\t2\n')).toBe('\t');
    expect(detectDelimiter('просто строка текста\nещё одна\n')).toBeNull();
    const rows = parseCsv('ФИО;Комментарий\r\n"Ершова Алина";"звонить; ""срочно""\nпосле 18"\r\nКотов;\r\n', ';');
    expect(rows.map((r) => r.map((c) => c.text))).toEqual([
      ['ФИО', 'Комментарий'],
      ['Ершова Алина', 'звонить; "срочно"\nпосле 18'],
      ['Котов', ''],
    ]);
    expect(rows[1][1]).toMatchObject({ quoted: true });
  });

  for (const name of ['clients-semicolon-cp1251', 'clients-comma-utf8bom', 'clients-tab-utf8']) {
    it(`${name}: gold закрыт; число строк и столбцов, разделитель, кавычки и кодировка — как в исходнике`, async () => {
      const bytes = new Uint8Array(readFileSync(join(DIR, `${name}.csv`)));
      const gold = JSON.parse(readFileSync(join(DIR, `${name}.csv.gold.json`), 'utf8'));
      const src = decodeText(bytes);
      const { doc, out, result } = await run(bytes, `${name}.csv`);
      expect(result.mime).toBe('text/csv');
      expect({ encoding: out.encoding, bom: out.bom }).toEqual({ encoding: src.encoding, bom: src.bom });
      const d = doc.plain.delimiter;
      expect(d).toBe(name.includes('semicolon') ? ';' : name.includes('comma') ? ',' : '\t');
      const a = parseCsv(src.text, d);
      const b = parseCsv(out.text, d);
      expect(b.length).toBe(a.length);
      expect(b.map((r) => r.length)).toEqual(a.map((r) => r.length));
      expect(b[0].map((c) => c.text)).toEqual(a[0].map((c) => c.text)); // шапка
      expect(b.map((r) => r.map((c) => c.quoted))).toEqual(a.map((r) => r.map((c) => c.quoted)));
      expect(out.text.split(/\r?\n/).length).toBe(src.text.split(/\r?\n/).length);
      for (const e of gold.entities) if (ALWAYS.has(e.category)) expect(out.text.toLowerCase(), e.key).not.toContain(e.value.toLowerCase());
      expect(out.text).toContain('звонить после 18:00; ""срочно""'); // поле в кавычках без сущностей — символ в символ
    });
  }

  it('шапка — заголовки столбцов; ячейки шапки без «метки слева» (не ФИО под «ФИО»)', async () => {
    const doc = parsePlain(enc('ФИО;Телефон;ИНН\nЕршова Алина Петровна;916 204-31-17;500100732259\n'), 'a.csv');
    const h = tableHeaders(doc);
    const byText = new Map(doc.streams.map((s) => [s.text, s.pid]));
    expect(h.column.get(byText.get('916 204-31-17'))).toBe('Телефон');
    expect(h.row.get(byText.get('Телефон'))).toBeUndefined();
    const { analysis } = await run(enc('ФИО;Телефон;ИНН\nЕршова Алина Петровна;916 204-31-17;500100732259\n'), 'a.csv');
    expect(analysis.groups.map((g) => g.category).sort()).toEqual(['INN', 'PERSON', 'PHONE']);
  });

  it('значение с разделителем после замены попадает в кавычки; неизменённые поля — как были', async () => {
    const bytes = enc('Контакт,Примечание\nЕршова Алина Петровна,"тел. +7 916 204-31-17, после обеда"\n');
    const { out } = await run(bytes, 'b.csv');
    expect(out.text).toBe('Контакт,Примечание\n[ФИО_1],"тел. [ТЕЛ_1], после обеда"\n');
  });
});

describe('JSON (К4)', () => {
  it('scanJson: строки и числа с позициями и ключом; ключи — не значения; битый JSON — исключение', () => {
    const t = '{"fio":"Ершова \\"Аля\\"","inn":500100732259,"a":[{"phone":"+7 916"}],"ok":true,"n":null}';
    const v = scanJson(t);
    // ключи — тоже (ревью WP12-B: сущность в ключе заменяется), с номером объекта
    expect(v.map((x) => [x.kind, x.key, x.value])).toEqual([
      ['key', 'fio', 'fio'],
      ['string', 'fio', 'Ершова "Аля"'],
      ['key', 'inn', 'inn'],
      ['number', 'inn', '500100732259'],
      ['key', 'a', 'a'],
      ['key', 'phone', 'phone'],
      ['string', 'phone', '+7 916'],
      ['key', 'ok', 'ok'],
      ['key', 'n', 'n'],
    ]);
    expect(v.filter((x) => x.kind === 'key').map((x) => x.obj)).toEqual([0, 0, 0, 1, 0, 0]);
    expect(t.slice(v[1].start, v[1].end)).toBe('"Ершова \\"Аля\\""');
    expect(() => scanJson('{"a": 1,}')).toThrow();
    expect(() => scanJson('[1] 2')).toThrow();
  });

  it('метки ключей по словам (ревью WP12-B): clientInn, contactPhone, snils_number, phone_mobile, ИНН_клиента', () => {
    expect(keyLabel('clientInn').label).toBe('ИНН');
    expect(keyLabel('contactPhone').label).toBe('Телефон');
    expect(keyLabel('snils_number').label).toBe('СНИЛС');
    expect(keyLabel('phone_mobile').label).toBe('Телефон');
    expect(keyLabel('ИНН_клиента').label).toBe('ИНН');
    expect(keyLabel('inn_org').label).toBe('ИНН');
  });

  it('ключ с ФИО заменяется меткой; два ключа с одной меткой в объекте — без дубля («(2)»); число из 6–20 цифр под любым ключом — поток', async () => {
    const json = '{"Ершова Алина Петровна": 1, "[ФИО_1]": 2, "id": 7707083893, "n": 12345}';
    const { out, doc } = await run(enc(json), 'k.json');
    const j = JSON.parse(out.text);
    expect(Object.keys(j)).toEqual(['[ФИО_1] (2)', '[ФИО_1]', 'id', 'n']);
    expect(j.id).toBe('[ИНН_1]');
    expect(j.n).toBe(12345);
    expect(doc.language).toBe('ru');
  });

  it('метки ключей: inn, phone_number, snils, ФИО; прочие — как есть', () => {
    expect(keyLabel('inn')).toEqual({ label: 'ИНН', numeric: true });
    expect(keyLabel('phone_number')).toEqual({ label: 'Телефон', numeric: true });
    expect(keyLabel('SNILS')).toEqual({ label: 'СНИЛС', numeric: true });
    expect(keyLabel('fullName')).toEqual({ label: 'ФИО', numeric: false });
    expect(keyLabel('comment')).toEqual({ label: 'comment', numeric: false });
  });

  it('crm-export.json: валиден, те же ключи и структура, gold закрыт; ИНН числом → строка с меткой, предупреждение', async () => {
    const bytes = new Uint8Array(readFileSync(join(DIR, 'crm-export.json')));
    const gold = JSON.parse(readFileSync(join(DIR, 'crm-export.json.gold.json'), 'utf8'));
    const { doc, analysis, result, out } = await run(bytes, 'crm-export.json');
    expect(result.mime).toBe('application/json');
    const a = JSON.parse(decodeText(bytes).text);
    const b = JSON.parse(out.text);
    const shape = (x) =>
      Array.isArray(x) ? x.map(shape) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).map((k) => [k, shape(x[k])])) : typeof x;
    const sb = shape(b);
    // типы те же, кроме ИНН: число → строка
    for (const c of sb.clients) c.inn = 'number';
    expect(sb).toEqual(shape(a));
    expect(b.clients.every((c) => /^\[ИНН_\d+\]$/.test(c.inn))).toBe(true);
    expect(b.clients.map((c) => c.id)).toEqual(a.clients.map((c) => c.id)); // числа-не-идентификаторы на месте
    expect(b.exported).toBe('2026-10-26');
    for (const e of gold.entities) if (ALWAYS.has(e.category)) expect(out.text, e.key).not.toContain(e.value);
    expect(PLAIN_ADAPTER.analysisWarnings(doc, analysis.groups)).toEqual([{ code: 'JSON_NUMBER_AS_STRING', count: 4 }]);
    // отступы и порядок строк файла сохранены
    expect(out.text.split('\n').length).toBe(decodeText(bytes).text.split('\n').length);
  });

  it('битый JSON — разбирается как текст по строкам, предупреждение JSON_INVALID; результат — тот же текст с метками', async () => {
    const { doc, out } = await run(enc('{"fio": "Ершова Алина Петровна",\n'), 'broken.json');
    expect(doc.warnings).toEqual([{ code: 'JSON_INVALID' }]);
    expect(out.text).toBe('{"fio": "[ФИО_1]",\n');
  });
});

describe('.txt, .log, .md — как есть', () => {
  it('строки и переводы строк (CRLF), разметка Markdown — символ в символ, меняются только сущности', async () => {
    const md = '# Отчёт\r\n\r\n- менеджер: Ершова Алина Петровна\r\n- почта: alina.ershova@example.org\r\n\r\n| a | b |\r\n';
    const { out, result } = await run(enc(md), 'notes.md');
    expect(result.mime).toBe('text/markdown');
    expect(out.text).toBe('# Отчёт\r\n\r\n- менеджер: [ФИО_1]\r\n- почта: [EMAIL_1]\r\n\r\n| a | b |\r\n');
    const log = '2026-10-26 10:00:01 INFO login user=a.laptev@example.com ip=10.0.0.1\n2026-10-26 10:00:02 INFO ok\n';
    const r = await run(enc(log), 'app.log');
    expect(r.out.text).toBe('2026-10-26 10:00:01 INFO login user=[EMAIL_1] ip=[IP_1]\n2026-10-26 10:00:02 INFO ok\n');
    expect(r.result.mime).toBe('text/plain');
  });

  it('модель — потоки-абзацы основной части: вкладка «Текст», база знаний и поиск работают как с PDF', async () => {
    const doc = parsePlain(enc('Первая строка\n\nВторая строка\n'), 'a.txt');
    expect(doc.kind).toBe('plain');
    expect(getParagraphs(doc, []).paragraphs.map((p) => p.text)).toEqual(['Первая строка', 'Вторая строка']);
    expect(doc.streams.every((s) => s.part === 'word/document.xml')).toBe(true);
  });
});

describe('адаптер и реестр', () => {
  it('распознавание по имени (.txt .log .md .csv .json), формат без имени — по содержимому; applyDecisions по kind', () => {
    for (const n of ['a.txt', 'a.LOG', 'a.md', 'a.csv', 'a.json']) expect(detectAdapter(enc('x'), n)?.kind).toBe('plain');
    expect(parsePlain(enc('{"a": "b"}')).format).toBe('json');
    expect(parsePlain(enc('a;b;c\n1;2;3\n')).format).toBe('csv');
    expect(parsePlain(enc('просто текст')).format).toBe('txt');
    expect(adapterForKind('plain')).toBe(PLAIN_ADAPTER);
  });

  it('фикстуры CSV и JSON совпадают с генератором (npm run gen-office-fixtures)', () => {
    for (const f of buildOfficeFixtures().filter((x) => x.format === 'csv' || x.format === 'json')) {
      expect(Buffer.from(readFileSync(join(DIR, `${f.name}.${f.format}`))).equals(Buffer.from(f.bytes)), f.name).toBe(true);
      expect(JSON.parse(readFileSync(join(DIR, `${f.name}.${f.format}.gold.json`), 'utf8'))).toEqual(f.gold);
    }
  });
});

// Восстановление файла от ИИ в форматах 0.5 (WP12-B, К3; FR-36а): .xlsx, .pptx, .csv, .json — через адаптер формата
// (core/restore-doc.js restoreDocument) по тем же строгим правилам, что DOCX: метки в ячейках, на слайдах, в заметках,
// комментариях и колонтитулах заменяются настоящими значениями, форматирование сохраняется; «Счет 1», «Договор 1» и текст без
// меток не трогаются (0 ложных замен); литералы формул — никогда.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  analyze,
  applyDecisions,
  defaultSettings,
  registerBuiltinDetectors,
  clearDetectors,
  loadAdapter,
  detectAdapter,
  restoreDocument,
  restoreDocx,
} from '../../src/core/index.js';
import { CATEGORY_GROUPS } from '../../src/core/categories.js';
import { buildXlsx, buildPptx } from '../../scripts/office-writer.mjs';
import { decodeText, encodeText } from '../../src/core/plain/plain-adapter.js';
import { unzipText } from '../helpers/docx.js';
import { unescapeXml } from '../../src/core/ooxml/xml.js';

const DIR = 'tests/fixtures/office';
const ALWAYS = new Set([...CATEGORY_GROUPS.pii, ...CATEGORY_GROUPS.ids]);
const TOKEN_RE = /\[[A-ZА-ЯЁ_]+_\d+\]/u;
const plainOf = (bytes, kind) =>
  kind === 'plain'
    ? decodeText(bytes).text
    : Object.entries(unzipText(bytes))
        .filter(([n]) => /\.xml$/.test(n))
        // с атрибутами (авторы комментариев, имена листов, alt): теги остаются, значения раскрыты
        .map(([, x]) => unescapeXml(x))
        .join('\n');

beforeAll(() => {
  clearDetectors();
  registerBuiltinDetectors();
});

/** Обезличить (метки, метаданные сохраняются — их тоже восстанавливаем) и вернуть адаптер, результат и карту. */
async function anonymize(bytes, name) {
  const adapter = await loadAdapter(detectAdapter(bytes, name));
  const doc = adapter.parse(bytes, name);
  const analysis = await analyze(doc, defaultSettings());
  const r = applyDecisions(doc, analysis.groups, { keepMetadata: true, createdAt: '2026-10-26T00:00:00Z' });
  return { adapter, doc, analysis, bytes: r.bytes, mapping: r.mapping };
}

const FILES = [
  'crm-export.xlsx',
  'registry.xlsx',
  'statement.xlsx',
  'sheets.xlsx',
  'comments.xlsx',
  'inline.xlsx',
  'deck-sales.pptx',
  'deck-table.pptx',
  'deck-comments.pptx',
  'deck-notes.pptx',
  'clients-semicolon-cp1251.csv',
  'clients-comma-utf8bom.csv',
  'crm-export.json',
];

describe('К3: восстановление файлов от ИИ — .xlsx, .pptx, .csv, .json', () => {
  it.each(FILES)('%s: все метки восстановлены, gold-значения вернулись, нераспознанных нет', async (name) => {
    const src = new Uint8Array(readFileSync(join(DIR, name)));
    const gold = JSON.parse(readFileSync(join(DIR, `${name}.gold.json`), 'utf8'));
    const a = await anonymize(src, name);
    const anonText = plainOf(a.bytes, a.adapter.kind);
    expect(anonText).toMatch(TOKEN_RE);
    const r = restoreDocument(a.bytes, a.mapping, { adapter: a.adapter, name });
    expect(r.unresolved).toEqual([]);
    expect(r.replaced).toBeGreaterThan(0);
    const back = plainOf(r.bytes, a.adapter.kind);
    // ни одной метки карты не осталось (литералы формул меток не содержат)
    for (const e of a.mapping.entries) expect(back, e.token).not.toContain(e.token);
    for (const e of gold.entities.filter((x) => ALWAYS.has(x.category) && !x.meta)) {
      // ФИО: варианты (инициалы, падежи) получают значение метки из карты — проверяется фамилия; идентификатор автора
      // получает имя автора (FR-11) — без фамилии не проверяется. Число-идентификатор возвращается текстом — значение то же.
      if (e.category === 'PERSON') {
        if (e.surname) expect(back.toLowerCase(), `${name}: ${e.key}`).toContain(e.surname.toLowerCase());
      } else expect(back.toLowerCase(), `${name}: ${e.key}`).toContain(e.value.toLowerCase());
    }
    expect(r.mime).toBe(a.adapter.kind === 'plain' ? (name.endsWith('.json') ? 'application/json' : 'text/csv') : a.adapter.mime);
  });

  it('форматирование сохраняется: восстановленные общие строки, комментарии и слайды — байт в байт как в исходнике', async () => {
    for (const [name, parts] of [
      ['crm-export.xlsx', ['xl/sharedStrings.xml', 'xl/comments1.xml', 'xl/styles.xml']],
      ['comments.xlsx', ['xl/threadedComments/threadedComment1.xml', 'xl/drawings/drawing1.xml']],
      ['deck-sales.pptx', ['ppt/slides/slide1.xml', 'ppt/notesSlides/notesSlide1.xml']],
      // commentAuthors.xml — нет: инициалы автора восстанавливаются полным именем (ограничение FR-36а, как w:initials в DOCX)
      ['deck-comments.pptx', ['ppt/comments/comment1.xml']],
    ]) {
      const src = new Uint8Array(readFileSync(join(DIR, name)));
      const a = await anonymize(src, name);
      const r = restoreDocument(a.bytes, a.mapping, { adapter: a.adapter, name });
      const x = unzipText(src);
      const y = unzipText(r.bytes);
      for (const p of parts) expect(y[p], `${name} ${p}`).toBe(x[p]);
    }
  });

  it('лист, переименованный при анонимизации, получает исходное имя; ссылки в формулах — тоже', async () => {
    const src = new Uint8Array(readFileSync(join(DIR, 'sheets.xlsx')));
    const a = await anonymize(src, 'sheets.xlsx');
    expect(unzipText(a.bytes)['xl/workbook.xml']).toMatch(/<sheet name="ФИО_\d+"/);
    const r = restoreDocument(a.bytes, a.mapping, { adapter: a.adapter, name: 'sheets.xlsx' });
    const out = unzipText(r.bytes);
    // KB объединил «Гаврилов Е.С.» с полным ФИО (одна метка): лист получает значение метки из карты
    const sheet = /<sheet name="([^"]+)" sheetId="2"/.exec(out['xl/workbook.xml'])?.[1];
    const entry = a.mapping.entries.find((e) => out['xl/workbook.xml'].includes(e.value));
    expect(sheet).toBe(entry?.value);
    expect(out['xl/worksheets/sheet1.xml']).toContain(`<f>COUNTA('${sheet}'!A2:A4)</f>`);
  });

  it('0 ложных замен на тексте без меток: «Счет 1», «Договор 1», «ФИО» — книга и презентация не меняются', async () => {
    const mapping = {
      entries: [
        {
          token: '[СЧЕТ_1]',
          placeholder: '[СЧЕТ_1]',
          category: 'ACCOUNT',
          value: '40702810400000005000',
          original: '40702810400000005000',
          variants: [],
          parts: [],
          occurrences: 1,
        },
        {
          token: '[ДОГОВОР_1]',
          placeholder: '[ДОГОВОР_1]',
          category: 'CONTRACT',
          value: 'Д-101/26',
          original: 'Д-101/26',
          variants: [],
          parts: [],
          occurrences: 1,
        },
        {
          token: '[ФИО_1]',
          placeholder: '[ФИО_1]',
          category: 'PERSON',
          value: 'Ершова Алина Петровна',
          original: 'Ершова Алина Петровна',
          variants: [],
          parts: [],
          occurrences: 1,
        },
      ],
    };
    const xlsx = buildXlsx({
      sheets: [
        {
          name: 'Счет 1',
          rows: [
            ['ФИО', 'Счет 1'],
            ['Договор 1 от 01.01', 'Счет 1 оплачен'],
            [{ f: '"Счет 1"&A1', v: 'Счет 1ФИО', str: true }, null],
          ],
        },
      ],
    });
    const xa = await loadAdapter('xlsx');
    const rx = restoreDocument(xlsx, /** @type {any} */ (mapping), { adapter: xa });
    expect(rx.replaced).toBe(0);
    expect(Buffer.from(rx.bytes).equals(Buffer.from(xlsx))).toBe(true);
    const pptx = buildPptx({
      slides: [{ shapes: [{ type: 'text', x: 10, y: 10, w: 400, h: 60, paras: ['Счет 1 и Договор 1', 'ФИО — в заметках'] }], notes: ['ФИО 1 не метка'] }],
    });
    const pa = await loadAdapter('pptx');
    const rp = restoreDocument(pptx, /** @type {any} */ (mapping), { adapter: pa });
    expect(rp.replaced).toBe(0);
    expect(Buffer.from(rp.bytes).equals(Buffer.from(pptx))).toBe(true);
  });

  it('строгое распознавание: «ФИО_1» без скобок и «[ФИО_1]» в ячейке и на слайде — заменяются, «ФИО 1» — нет; литерал формулы — никогда', async () => {
    const mapping = {
      entries: [
        {
          token: '[ФИО_1]',
          placeholder: '[ФИО_1]',
          category: 'PERSON',
          value: 'Ершова Алина Петровна',
          original: 'Ершова Алина Петровна',
          variants: [],
          parts: [],
          occurrences: 1,
        },
      ],
    };
    const xlsx = buildXlsx({
      sheets: [
        {
          name: 'Ответ',
          rows: [
            ['Менеджер ФИО_1', 'См. [ФИО_1]', 'ФИО 1'],
            [{ f: '"[ФИО_1]"&A1', v: 'x', str: true }, null, null],
          ],
        },
      ],
    });
    const r = restoreDocument(xlsx, /** @type {any} */ (mapping), { adapter: await loadAdapter('xlsx') });
    const out = unzipText(r.bytes);
    expect(out['xl/sharedStrings.xml']).toContain('Менеджер Ершова Алина Петровна');
    expect(out['xl/sharedStrings.xml']).toContain('См. Ершова Алина Петровна');
    expect(out['xl/sharedStrings.xml']).toContain('ФИО 1');
    expect(out['xl/worksheets/sheet1.xml']).toContain('<f>&quot;[ФИО_1]&quot;&amp;A1</f>');
    const pptx = buildPptx({
      slides: [{ shapes: [{ type: 'text', x: 10, y: 10, w: 400, h: 60, paras: ['Докладчик: [ФИО_1]'] }], notes: ['Позвонить ФИО_1'] }],
    });
    const rp = restoreDocument(pptx, /** @type {any} */ (mapping), { adapter: await loadAdapter('pptx') });
    const op = unzipText(rp.bytes);
    expect(op['ppt/slides/slide1.xml']).toContain('<a:t>Докладчик: Ершова Алина Петровна</a:t>');
    expect(op['ppt/notesSlides/notesSlide1.xml']).toContain('<a:t>Позвонить Ершова Алина Петровна</a:t>');
  });

  it('CSV в Windows-1251 и JSON: структура, кодировка и валидность сохраняются; значение с кавычкой экранируется', async () => {
    const mapping = {
      entries: [
        {
          token: '[КОМПАНИЯ_1]',
          placeholder: '[КОМПАНИЯ_1]',
          category: 'COMPANY',
          value: 'ООО "Альтаир"',
          original: 'ООО "Альтаир"',
          variants: [],
          parts: [],
          occurrences: 1,
        },
      ],
    };
    const plain = await loadAdapter('plain');
    const csv = encodeText('Клиент;Сумма\r\n[КОМПАНИЯ_1];100\r\n', { encoding: 'windows-1251', bom: false });
    const rc = restoreDocument(csv, /** @type {any} */ (mapping), { adapter: plain, name: 'ответ.csv' });
    expect(decodeText(rc.bytes)).toEqual({ text: 'Клиент;Сумма\r\n"ООО ""Альтаир""";100\r\n', encoding: 'windows-1251', bom: false });
    const json = new TextEncoder().encode('{"client": "[КОМПАНИЯ_1]", "sum": 100}\n');
    const rj = restoreDocument(json, /** @type {any} */ (mapping), { adapter: plain, name: 'ответ.json' });
    expect(JSON.parse(decodeText(rj.bytes).text)).toEqual({ client: 'ООО "Альтаир"', sum: 100 });
  });

  it('склонение (decline) — в тексте ячеек и слайдов; DOCX по-прежнему через restoreDocx', async () => {
    const mapping = {
      entries: [
        {
          token: '[ФИО_1]',
          placeholder: '[ФИО_1]',
          category: 'PERSON',
          value: 'Ершова Алина Петровна',
          original: 'Ершова Алина Петровна',
          variants: [],
          parts: [],
          occurrences: 1,
        },
      ],
    };
    const pptx = buildPptx({ slides: [{ shapes: [{ type: 'text', x: 10, y: 10, w: 400, h: 60, paras: ['Письмо от [ФИО_1]'] }] }] });
    const r = restoreDocument(pptx, /** @type {any} */ (mapping), { adapter: await loadAdapter('pptx'), decline: true });
    expect(unzipText(r.bytes)['ppt/slides/slide1.xml']).toContain('<a:t>Письмо от Ершовой Алины Петровны</a:t>');
    expect(r.declined).toHaveLength(1);
    expect(typeof restoreDocx).toBe('function');
  });

  it('не тот формат — ошибка адаптера (NOT_SUPPORTED), не исключение разбора', async () => {
    const xa = await loadAdapter('xlsx');
    expect(() => restoreDocument(new TextEncoder().encode('не zip'), { entries: [] }, { adapter: xa })).toThrow(
      expect.objectContaining({ code: 'NOT_SUPPORTED' }),
    );
  });
});

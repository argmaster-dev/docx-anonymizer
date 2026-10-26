// Excel (версия 0.5, WP12-B, Ц1, К1; docs/concept-0.5.md п. 2, «Риски»; docs/contracts.md §9.8): книги tests/fixtures/office/*.xlsx
// (scripts/gen-office-fixtures.mjs) — все gold pii/ids закрыты; формулы, стили, ширины столбцов, объединения, колонтитулы (коды),
// имена листов (кроме содержащих сущность) — как в исходнике; числа-идентификаторы становятся строковыми ячейками со стилем;
// предупреждения о формулах; одна сущность — одна метка во всей книге; LibreOffice открывает результат без восстановления
// и пересчитывает формулы без #REF! (локально, SKIP_LIBREOFFICE — пропуск).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOfficeFixtures } from '../../scripts/gen-office-fixtures.mjs';
import { buildXlsx } from '../../scripts/office-writer.mjs';
import { partialLeaks } from '../../scripts/eval-genres.mjs';
import { unzipText } from '../helpers/docx.js';
import { assertWellFormed } from '../helpers/wellformed.js';
import { readZip } from '../../src/core/ooxml/zip.js';
import { unescapeXml } from '../../src/core/ooxml/xml.js';
import { defaultSettings } from '../../src/core/index.js';
import { CATEGORY_GROUPS } from '../../src/core/categories.js';
import { OFFICE_DIR, fixture, runOffice, adapterFor, libreOfficeConvert, findLeaks, checkPackage, LO_ENABLED } from './support/office.js';

const BOOKS = ['crm-export', 'registry', 'statement', 'sheets', 'comments', 'inline'];
const ALWAYS = new Set([...CATEGORY_GROUPS.pii, ...CATEGORY_GROUPS.ids]);
const secret = (gold) => gold.entities.filter((e) => ALWAYS.has(e.category));
const strip = (xml) => unescapeXml(xml.replace(/<[^>]+>/g, ' '));
const textOf = (bytes) =>
  Object.entries(unzipText(bytes))
    .filter(([n]) => /\.(xml|rels)$/.test(n))
    .map(([, x]) => strip(x))
    .join('\n');
const all = (re, s) => [...s.matchAll(re)].map((m) => m[1]);
/** ячейки листа: ref → {s, t} */
const cellAttrs = (xml) =>
  new Map([...xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)\/?>/g)].map((m) => [m[1], { s: /\ss="(\d+)"/.exec(m[2])?.[1], t: /\st="(\w+)"/.exec(m[2])?.[1] }]));

const results = new Map();
async function anon(name, opts) {
  const key = `${name}|${JSON.stringify(opts || {})}`;
  if (!results.has(key)) {
    const { bytes, gold } = fixture(`${name}.xlsx`);
    results.set(key, { bytes, gold, ...(await runOffice(bytes, `${name}.xlsx`, opts)) });
  }
  return results.get(key);
}

describe('К1: фикстуры Excel', () => {
  it('≥ 6 книг (CRM, реестр, ведомость с числовыми ИНН и счетами, несколько листов, примечания, inline-строки); генератор детерминирован', () => {
    const books = buildOfficeFixtures().filter((f) => f.format === 'xlsx');
    expect(books.map((b) => b.name)).toEqual(BOOKS);
    for (const b of books) {
      expect(Buffer.from(readFileSync(join(OFFICE_DIR, `${b.name}.xlsx`))).equals(Buffer.from(b.bytes)), `${b.name}: npm run gen-office-fixtures`).toBe(true);
      expect(JSON.parse(readFileSync(join(OFFICE_DIR, `${b.name}.xlsx.gold.json`), 'utf8'))).toEqual(b.gold);
    }
    const specs = new Map(books.map((b) => [b.name, b.spec]));
    expect(specs.get('registry').sheets[0].merges).toEqual(['A1:F1']);
    expect(specs.get('statement').sheets).toHaveLength(2);
    expect(specs.get('sheets').sheets.some((s) => s.hidden)).toBe(true);
    expect(specs.get('comments').sheets[0].threaded).toHaveLength(1);
  });

  it('распознаётся по содержимому и имени; не ZIP и ZIP без книги — NOT_SUPPORTED', async () => {
    const { bytes } = fixture('crm-export.xlsx');
    const ad = await adapterFor(bytes, 'выгрузка.bin');
    expect(ad.kind).toBe('xlsx');
    expect(() => ad.parse(new TextEncoder().encode('не zip'))).toThrow(expect.objectContaining({ code: 'NOT_SUPPORTED' }));
    const { makeDocx, para, run } = await import('../helpers/docx.js');
    expect(() => ad.parse(makeDocx(para(run('x'))))).toThrow(expect.objectContaining({ code: 'NOT_SUPPORTED' }));
  });
});

describe('К1: обезличивание книг (настройки по умолчанию)', () => {
  it.each(BOOKS)('%s: все gold pii/ids закрыты — ни целиком, ни частью, ни в одной части пакета; пакет цел', async (name) => {
    const { gold, result, doc } = await anon(name);
    const values = secret(gold).map((e) => e.value);
    expect(findLeaks(result.bytes, values), 'утечки').toEqual([]);
    expect(
      partialLeaks(secret(gold), textOf(result.bytes)).map((e) => `${e.key}/${e.part}`),
      'частичные утечки',
    ).toEqual([]);
    expect(checkPackage(result.bytes)).toEqual([]);
    for (const [n, xml] of Object.entries(unzipText(result.bytes))) if (/\.(xml|rels)$/.test(n)) assertWellFormed(xml, n);
    expect(result.mime).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(doc.kind).toBe('xlsx');
  });

  it.each(BOOKS)('%s: части и их порядок, стили, тема, ширины столбцов, объединения, стили ячеек и коды колонтитулов — как в исходнике', async (name) => {
    const { bytes, result } = await anon(name);
    const src = unzipText(bytes);
    const out = unzipText(result.bytes);
    expect(readZip(result.bytes).map((e) => e.name)).toEqual(readZip(bytes).map((e) => e.name));
    for (const part of ['xl/styles.xml', 'xl/theme/theme1.xml']) expect(out[part], part).toBe(src[part]);
    for (const part of Object.keys(src).filter((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n))) {
      expect(all(/(<cols>.*?<\/cols>)/g, out[part]), `${part} cols`).toEqual(all(/(<cols>.*?<\/cols>)/g, src[part]));
      expect(all(/(<mergeCells.*?<\/mergeCells>)/g, out[part]), `${part} merges`).toEqual(all(/(<mergeCells.*?<\/mergeCells>)/g, src[part]));
      const a = cellAttrs(src[part]);
      const b = cellAttrs(out[part]);
      expect([...b.keys()], `${part}: ячейки`).toEqual([...a.keys()]);
      for (const [ref, x] of a) expect(b.get(ref).s, `${part} ${ref}: стиль`).toBe(x.s);
      // коды колонтитула (&P, &N, &D, &L, &C, &R, шрифт) — те же и в том же порядке
      const codes = (x) => all(/<(?:odd|even|first)(?:Header|Footer)>([^<]*)</g, x).map((h) => unescapeXml(h).match(/&(?:"[^"]*"|\d+|[A-Z])/g));
      expect(codes(out[part]), `${part}: коды колонтитулов`).toEqual(codes(src[part]));
      expect(/<row r="\d+" hidden="1">/.test(out[part])).toBe(/<row r="\d+" hidden="1">/.test(src[part]));
    }
  });

  it('формулы не меняются (кроме согласованного переименования листа); после правок книга пересчитывается при открытии', async () => {
    for (const name of BOOKS) {
      const { bytes, result } = await anon(name);
      const src = unzipText(bytes);
      const out = unzipText(result.bytes);
      for (const part of Object.keys(src).filter((n) => n.startsWith('xl/worksheets/') && n.endsWith('.xml'))) {
        const f = (x) => all(/<f(?:\s[^>]*)?>([^<]*)<\/f>/g, x);
        if (name === 'sheets')
          expect(
            f(out[part]).map((x) => x.replace(/'ФИО_\d+'/g, "'Гаврилов Е.С.'")),
            part,
          ).toEqual(f(src[part]));
        else expect(f(out[part]), `${name} ${part}`).toEqual(f(src[part]));
      }
      expect(out['xl/workbook.xml']).toMatch(/<calcPr calcId="191029" fullCalcOnLoad="1"\/>/);
    }
  });

  it('числа-идентификаторы (ИНН, СНИЛС, телефон числом) → строковая ячейка inlineStr, у формулы — кэш t="str"; стиль сохранён', async () => {
    const { bytes, result } = await anon('statement');
    const src = unzipText(bytes)['xl/worksheets/sheet1.xml'];
    const out = unzipText(result.bytes)['xl/worksheets/sheet1.xml'];
    for (const ref of ['B2', 'C2', 'B6', 'C6']) {
      expect(src).toMatch(new RegExp(`<c r="${ref}" s="2"><v>\\d+</v></c>`));
      expect(out, ref).toMatch(new RegExp(`<c r="${ref}" s="2" t="inlineStr"><is><t>\\[(?:ИНН|СНИЛС)_\\d+\\]</t></is></c>`));
    }
    // формула =Ведомость!C2 на листе «Сводка» с кэшем ИНН — кэш строкой, формула на месте
    const sum = unzipText(result.bytes)['xl/worksheets/sheet2.xml'];
    expect(sum).toMatch(/<c r="B2" t="str"><f>Ведомость!C2<\/f><v>\[ИНН_\d+\]<\/v><\/c>/);
    // CRM: телефоны числом и ИНН физлица числом
    const crm = unzipText((await anon('crm-export')).result.bytes)['xl/worksheets/sheet1.xml'];
    expect(crm).toMatch(/<c r="B3" s="2" t="inlineStr"><is><t>\[ТЕЛ_\d+\]<\/t><\/is><\/c>/);
    expect(crm).toMatch(/<c r="D2" s="2" t="inlineStr"><is><t>\[ИНН_\d+\]<\/t><\/is><\/c>/);
  });

  it('одна сущность — одна метка во всей книге (ИНН на двух листах, ФИО в ячейке и в колонтитуле, листе и формулах)', async () => {
    const st = await anon('statement');
    const out = unzipText(st.result.bytes);
    const c2 = /<c r="C2"[^>]*><is><t>(\[ИНН_\d+\])/.exec(out['xl/worksheets/sheet1.xml'])?.[1];
    expect(c2).toBeTruthy();
    expect(out['xl/worksheets/sheet2.xml']).toContain(`<v>${c2}</v>`);
    const inl = await anon('inline');
    const x = unzipText(inl.result.bytes)['xl/worksheets/sheet1.xml'];
    const tokens = new Set(x.match(/\[ФИО_\d+\]/g));
    expect(tokens.size).toBe(1); // «Тимофеев Роман Ильич» в ячейке и «Тимофеев Р.И.» в колонтитуле
    expect(inl.analysis.groups.filter((g) => g.category === 'PERSON')).toHaveLength(1);
  });

  it('имя листа с сущностью: безопасное имя, ссылки в формулах, именах книги и ссылке «#лист» — согласованно; предупреждение', async () => {
    const { result, analysis, adapter, doc } = await anon('sheets');
    const out = unzipText(result.bytes);
    const names = all(/<sheet name="([^"]*)"/g, out['xl/workbook.xml']);
    expect(names[0]).toBe('Сводка');
    expect(names[2]).toBe('Резерв');
    expect(names[1]).toMatch(/^ФИО_\d+$/); // без [ ] — запрещены в именах листов Excel
    expect(names[1].length).toBeLessThanOrEqual(31);
    expect(out['xl/workbook.xml']).toContain(`<definedName name="Сделки_менеджера">'${names[1]}'!$B$2:$B$4</definedName>`);
    expect(out['xl/worksheets/sheet1.xml']).toContain(`location="'${names[1]}'!A1"`);
    expect(out['xl/worksheets/sheet1.xml']).toContain(`<f>COUNTA('${names[1]}'!A2:A4)</f>`);
    expect(out['xl/worksheets/sheet1.xml']).toContain('<f>SUM(Резерв!B2:B3)</f>'); // другой лист — без изменений
    expect(out['xl/workbook.xml']).toMatch(/<sheet name="Резерв" sheetId="3" state="hidden"/);
    expect(adapter.analysisWarnings(doc, analysis.groups)).toContainEqual({ code: 'XLSX_SHEET_RENAMED', count: 1 });
    expect(analysis.groups.some((g) => g.occurrences.some((o) => doc.streamById.get(o.streamId).attrKind === 'sheet-name'))).toBe(true);
  });

  it('предупреждение «на ячейку ссылаются формулы»: ИНН под LEN() и ссылкой со второго листа; без ссылок — нет', async () => {
    const st = await anon('statement');
    const w = st.adapter.analysisWarnings(st.doc, st.analysis.groups);
    expect(w.find((x) => x.code === 'XLSX_CELL_REFERENCED')?.count).toBe(5);
    const crm = await anon('crm-export');
    expect(crm.adapter.analysisWarnings(crm.doc, crm.analysis.groups)).toEqual([]);
  });

  it('литерал формулы с сущностью: формула не меняется, предупреждение XLSX_FORMULA_LITERAL', async () => {
    const bytes = buildXlsx({
      sheets: [{ name: 'Лист1', rows: [['Звонок', { f: '"Звонить: "&"Гаврилов Евгений Сергеевич"', v: 'Звонить: Гаврилов Евгений Сергеевич', str: true }]] }],
    });
    const { result, adapter, doc, analysis } = await runOffice(bytes, 'f.xlsx');
    expect(adapter.analysisWarnings(doc, analysis.groups)).toContainEqual({ code: 'XLSX_FORMULA_LITERAL', count: 1 });
    const out = unzipText(result.bytes)['xl/worksheets/sheet1.xml'];
    expect(out).toContain('<f>&quot;Звонить: &quot;&amp;&quot;Гаврилов Евгений Сергеевич&quot;</f>');
    expect(out).toMatch(/<v>Звонить: \[ФИО_1\]<\/v>/); // кэш строковой формулы — заменён
  });

  it('скрытые лист и строка — как обычные; примечания, цепочка комментариев, авторы, надпись на листе', async () => {
    const sh = unzipText((await anon('sheets')).result.bytes);
    expect(sh['xl/worksheets/sheet3.xml']).not.toMatch(/45\d\d \d{6}/);
    const crm = unzipText((await anon('crm-export')).result.bytes);
    expect(crm['xl/worksheets/sheet1.xml']).toMatch(/<row r="4" hidden="1"><c r="A4" t="s">/);
    const c = unzipText((await anon('comments')).result.bytes);
    expect(c['xl/comments1.xml']).toMatch(/<author>\[ФИО_\d+\]<\/author>/);
    expect(c['xl/comments1.xml']).toMatch(/<author>tc=\{00000001-0000-4000-8000-000000000000\}<\/author>/);
    expect(c['xl/persons/person.xml']).toMatch(/displayName="\[ФИО_\d+\]" id="\{00000001-0000-4000-8000-000000000000\}" userId="\[ФИО_\d+\]"/);
    expect(c['xl/threadedComments/threadedComment1.xml']).toMatch(/<text>Паспорт подписанта \[ПАСПОРТ_\d+\], звонить \[ФИО_\d+\]<\/text>/);
    expect(c['xl/drawings/drawing1.xml']).toMatch(/<a:t>Куратор проекта: \[ФИО_\d+\]<\/a:t>/);
    // имя в цепочке и в обычном примечании-заглушке — одна метка
    const tc = /звонить (\[ФИО_\d+\])/.exec(c['xl/threadedComments/threadedComment1.xml'])?.[1];
    expect(c['xl/comments1.xml']).toContain(`звонить ${tc}`);
  });

  it('форматированный текст: метка — в первом ране, свойства ранов (жирный) на месте; inline-строки; колонтитул и ссылка mailto', async () => {
    const { result } = await anon('inline');
    const out = unzipText(result.bytes);
    expect(out['xl/worksheets/sheet1.xml']).toMatch(/<is><r><rPr><b\/><sz val="11"\/><\/rPr><t>\[ФИО_1\]<\/t><\/r><r><t xml:space="preserve"><\/t><\/r><\/is>/);
    expect(out['xl/worksheets/sheet1.xml']).toMatch(/<oddHeader>&amp;L\[ФИО_1\]&amp;RАнкета<\/oddHeader>/);
    expect(out['xl/worksheets/_rels/sheet1.xml.rels']).toMatch(/Target="mailto:\[EMAIL_1\]"/);
  });

  it('docProps: по умолчанию очищены; keepMetadata — сущность заменена меткой, остальное на месте', async () => {
    const def = unzipText((await anon('crm-export')).result.bytes);
    expect(def['docProps/core.xml']).not.toContain('Зуев');
    const keep = unzipText((await anon('crm-export', { apply: { keepMetadata: true } })).result.bytes);
    expect(keep['docProps/core.xml']).toMatch(/<dc:creator>\[ФИО_\d+\]<\/dc:creator>/);
    expect(keep['docProps/core.xml']).toContain('<dc:title>Выгрузка контактов</dc:title>');
  });

  it('книга без сущностей: байты результата — как у исходника (ни одной правки, пересчёт не включается)', async () => {
    const bytes = buildXlsx({
      sheets: [
        {
          name: 'План',
          rows: [
            ['Задача', 'Срок'],
            ['Инвентаризация', '30.11.2026'],
            [{ f: 'ROWS(A1:A2)', v: 2 }, null],
          ],
        },
      ],
    });
    // метаданные сохраняются (по умолчанию docProps очищаются — это правка части app.xml)
    const { result } = await runOffice(bytes, 'plan.xlsx', { apply: { keepMetadata: true } });
    expect(result.stats.changedParts).toEqual([]);
    expect(Buffer.from(result.bytes).equals(Buffer.from(bytes))).toBe(true);
  });

  it('коммерческий режим: организации в ячейках заменены, ИНН/счета — тоже', async () => {
    const { gold, result } = await anon('registry', { settings: { ...defaultSettings(), commercial: true } });
    expect(
      findLeaks(
        result.bytes,
        gold.entities.filter((e) => e.category === 'COMPANY').map((e) => e.value),
      ),
    ).toEqual([]);
  });
});

describe.skipIf(!LO_ENABLED)('К1: LibreOffice (локально)', () => {
  it('исходники и результаты открываются без восстановления; формулы пересчитываются без #REF!; меток нет у формул', async () => {
    const files = [];
    for (const name of BOOKS) {
      const { bytes, result } = await anon(name);
      files.push({ name: `${name}.xlsx`, bytes }, { name: `${name}.anon.xlsx`, bytes: result.bytes });
    }
    const out = libreOfficeConvert(files, 'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1', 'xlsx');
    for (const name of BOOKS) {
      const sheets = [...out].filter(([f]) => f.startsWith(`${name}.anon-`));
      expect(sheets.length, name).toBeGreaterThanOrEqual(1);
      const text = sheets.map(([, t]) => t).join('\n');
      expect(text, `${name}: ошибки ссылок`).not.toMatch(/#REF!|#ССЫЛ|Err:5\d\d/);
      for (const e of secret(fixture(`${name}.xlsx`).gold)) if (!e.meta) expect(text.toLowerCase(), `${name}: ${e.key}`).not.toContain(e.value.toLowerCase());
    }
    // переименованный лист открывается под новым именем, формулы на него считаются
    const svod = out.get('sheets.anon-Сводка.csv');
    expect(svod).toMatch(/Сделок у менеджера,3/);
    expect(svod).toMatch(/Сумма сделок,270000/);
  }, 300000);
});

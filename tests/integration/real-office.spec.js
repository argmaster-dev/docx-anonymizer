// Файлы настоящих инструментов (ревью WP12-B): книги openpyxl и pandas, книга, пересохранённая LibreOffice, части, которые пишет
// Excel (сводная, внешняя книга, подключение, общий доступ, упоминания), презентации python-pptx (с книгой диаграммы внутри,
// SmartArt, комментарии, разделы), CSV/JSON pandas, текст UTF-16 без BOM — tests/fixtures/office/real (генератор make_real.py
// рядом). Главная проверка — «ни одного исходного значения ни в одной части zip» (в т.ч. во вложенных книгах, в трёх кодировках)
// при настройках по умолчанию и с «Удалять встроенные объекты»; восстановление по той же карте; LibreOffice открывает результат.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { restoreDocument, defaultSettings, readZip, inflateEntry, loadAdapter, analyze, applyDecisions } from '../../src/core/index.js';
import { addFileNameStream } from '../../src/core/file-name.js';
import { unescapeXml } from '../../src/core/ooxml/xml.js';
import { runOffice, deepLeaks, libreOfficeConvert, LO_ENABLED } from './support/office.js';
import { unzipText } from '../helpers/docx.js';

const DIR = join(process.cwd(), 'tests/fixtures/office/real');
const SECRETS = JSON.parse(readFileSync(join(DIR, 'secrets.json'), 'utf8'));
const FILES = Object.keys(SECRETS).sort();
const bytesOf = (f) => new Uint8Array(readFileSync(join(DIR, f)));

const runs = new Map();
async function anon(file, apply = {}) {
  const key = `${file}|${JSON.stringify(apply)}`;
  if (!runs.has(key)) runs.set(key, await runOffice(bytesOf(file), file, { apply }));
  return runs.get(key);
}

describe('файлы настоящих инструментов (ревью WP12-B)', () => {
  it('набор: каждый файл каталога описан в secrets.json, у каждого есть секреты', () => {
    const files = readdirSync(DIR).filter((f) => !/\.(py|json)$/.test(f) || f === 'pandas-export.json');
    expect(files.sort()).toEqual(FILES);
    for (const f of FILES) expect(SECRETS[f].length, f).toBeGreaterThan(2);
    // исходники и правда содержат каждый секрет (иначе проверка ниже ничего не доказывает)
    for (const f of FILES) {
      const found = new Set(deepLeaks(bytesOf(f), SECRETS[f]).map((x) => x.replace(/ @ .*$/, '')));
      expect(
        SECRETS[f].filter((v) => !found.has(v)),
        f,
      ).toEqual([]);
    }
  });

  it.each(FILES)('%s: ни одного исходного значения ни в одной части zip (настройки по умолчанию)', async (file) => {
    const { result } = await anon(file);
    expect(deepLeaks(result.bytes, SECRETS[file])).toEqual([]);
  });

  it.each(FILES.filter((f) => /\.(xlsx|pptx)$/.test(f)))('%s: с «Удалять встроенные объекты» и с сохранением метаданных — тоже ни одного', async (file) => {
    const strip = await anon(file, { stripEmbedded: true });
    expect(deepLeaks(strip.result.bytes, SECRETS[file])).toEqual([]);
    const keep = await anon(file, { keepMetadata: true });
    // docProps/custom.xml при keepMetadata не трогается (осознанный выбор пользователя, как в DOCX с 0.1)
    expect(deepLeaks(keep.result.bytes, SECRETS[file]).filter((x) => !x.endsWith('@ docProps/custom.xml'))).toEqual([]);
  });

  it.each(FILES)('%s: восстановление по карте — все метки распознаны, ни одной метки не осталось', async (file) => {
    const { adapter, result } = await anon(file, { keepMetadata: true });
    const r = restoreDocument(result.bytes, result.mapping, { adapter, name: file });
    expect(r.unresolved).toEqual([]);
    const tokens = result.mapping.entries.map((e) => e.token);
    expect(deepLeaks(r.bytes, tokens).filter((x) => !/external-link|\[ФИО_\d+\] \(\d\)/.test(x))).toEqual([]);
  });

  it('встроенная книга диаграммы python-pptx обезличена той же картой; при «Удалять встроенные объекты» — удалена со ссылкой', async () => {
    const { doc, result, analysis } = await anon('python-pptx-deck.pptx');
    expect(doc.embedded).toHaveLength(1);
    expect(doc.warnings.map((w) => w.code)).not.toContain('EMBEDDED_NOT_PROCESSED');
    const inner = unzipText(unzipBinary(result.bytes, doc.embedded[0].entry));
    const token = analysis.groups.find((g) => g.value === 'Кравченко О.П.' || /Кравченко/.test(g.value))?.placeholder;
    expect(token).toBeTruthy();
    expect(Object.values(inner).join('')).toContain(token.replace(/^\[|\]$/g, ''));
    const strip = await anon('python-pptx-deck.pptx', { stripEmbedded: true });
    const parts = unzipText(strip.result.bytes);
    expect(Object.keys(parts).some((n) => /embeddings\//.test(n))).toBe(false);
    expect(parts['ppt/charts/chart1.xml'] || Object.entries(parts).find(([n]) => /charts\/chart\d+\.xml$/.test(n))[1]).not.toContain('c:externalData');
  });

  it('ведущие нули и запись целых: ИНН 027409876579, СНИЛС 012-345-679 20, «7.728168971E9», «…0.0» — найдены по формату и заголовку', async () => {
    const { analysis } = await anon('openpyxl-zeros.xlsx');
    const vals = analysis.groups.map((g) => `${g.category}:${g.normalized}`);
    for (const v of ['INN:027409876579', 'INN:0274098767', 'SNILS:01234567920', 'INN:7728168971', 'BIK:044525225', 'PHONE:89172223344'])
      expect(vals, v).toContain(v);
  });

  it('JSON: числа под «clientInn», «contactPhone», «snils_number», «phone_mobile» и «id» с ИНН закрыты; ключ с ФИО заменён, дублей нет', async () => {
    const { result } = await anon('pandas-export.json');
    const text = new TextDecoder().decode(result.bytes);
    const j = JSON.parse(text);
    expect(Object.keys(j)).toHaveLength(2);
    expect(Object.keys(j)[1]).toMatch(/^\[ФИО_\d+\]$/);
    for (const k of ['clientInn', 'contactPhone', 'snils_number', 'phone_mobile', 'id']) expect(j.clients[0][k], k).toMatch(/^\[[A-ZА-ЯЁ_]+_\d+\]$/u);
  });

  it('имя файла — тоже данные: «Орлова_Вера_Степановна.xlsx» → метка той же карты в имени результата', async () => {
    const name = 'Орлова_Вера_Степановна.xlsx';
    const bytes = bytesOf('pandas-clients.xlsx');
    const adapter = await loadAdapter('xlsx');
    const doc = adapter.parse(bytes, name);
    addFileNameStream(doc, name);
    const analysis = await analyze(doc, defaultSettings());
    const r = applyDecisions(doc, analysis.groups, {});
    const orlova = analysis.groups.find((g) => /Орлова/.test(g.value));
    expect(r.fileName).toBe(`${orlova.placeholder}.xlsx`);
    expect(deepLeaks(r.bytes, ['Орлова'])).toEqual([]);
  });
});

describe('файлы настоящих инструментов: структура после обезличивания', () => {
  it('openpyxl: заголовки умной таблицы = ячейки шапки; константа имени книги, список и подсказки проверки данных — метками', async () => {
    const { result } = await anon('openpyxl-crm.xlsx');
    const p = unzipText(result.bytes);
    const tableXml = Object.entries(p).find(([n]) => /tables\/table\d+\.xml$/.test(n))[1];
    const cols = [...tableXml.matchAll(/<tableColumn [^>]*name="([^"]*)"/g)].map((m) => m[1]);
    expect(cols[1]).toMatch(/^\[ФИО_\d+\]$/);
    // шапка листа «График» — inline-строки или общие строки: те же тексты
    const all = unescapeXml(Object.values(p).join('')); // openpyxl пишет кириллицу ссылками &#1060;
    for (const c of cols) expect(all.split(c).length - 1, c).toBeGreaterThanOrEqual(2);
    expect(p['xl/workbook.xml']).toMatch(/<definedName name="Директор">(?:"|&quot;)\[ФИО_\d+\](?:"|&quot;)<\/definedName>/);
    const sheet = p['xl/worksheets/sheet1.xml'];
    expect(sheet).toMatch(/<formula1>(?:"|&quot;)\[ФИО_\d+\],\[ФИО_\d+\](?:"|&quot;)<\/formula1>/);
    expect(sheet).toMatch(/promptTitle="\[ФИО_\d+\]"/);
    // формулы ячеек — как были (ссылки на лист с ФИО — переименованы)
    expect(sheet).toContain('<f>B2*2</f>');
    expect(sheet).toMatch(/<f>'ФИО_\d+'!B2<\/f>/);
  });

  it('части Excel: кэш сводной — строки вместо чисел, без признаков типов, с обновлением при открытии; путь внешней книги и учётные данные подключения убраны', async () => {
    const { result, adapter, doc, analysis } = await anon('excel-extras.xlsx');
    const p = unzipText(result.bytes);
    expect(p['xl/pivotCache/pivotCacheRecords1.xml']).toMatch(/<r><x v="0"\/><s v="\[ИНН_\d+\]"\/><\/r>/);
    const def = p['xl/pivotCache/pivotCacheDefinition1.xml'];
    expect(def).toMatch(/refreshOnLoad="1"/);
    expect(def).not.toMatch(/minValue|maxValue|containsNumber="1" containsInteger/);
    expect(def).toMatch(/refreshedBy="\[ФИО_\d+\]"/);
    expect(p['xl/externalLinks/_rels/externalLink1.xml.rels']).toContain('Target="external-link-1.xlsx"');
    expect(p['xl/connections.xml']).toMatch(/UID=\*\*\*;PWD=\*\*\*/);
    expect(p['xl/usernames.xml']).toMatch(/name="\[ФИО_\d+\]"/);
    expect(p['xl/workbook.xml']).toMatch(/customWorkbookView name="\[ФИО_\d+\] - личное представление"/);
    const codes = adapter.analysisWarnings(doc, analysis.groups).map((w) => w.code);
    expect(codes).toEqual(expect.arrayContaining(['XLSX_EXTERNAL_LINKS', 'XLSX_CONNECTIONS']));
  });

  it('PowerPoint: SmartArt (данные и рисунок), обычный комментарий и автор, раздел, имя слайда, подсказка ссылки — метками', async () => {
    const { result } = await anon('python-pptx-extras.pptx');
    const p = unzipText(result.bytes);
    expect(p['ppt/diagrams/data1.xml']).toMatch(/Руководитель: \[ФИО_\d+\]/);
    expect(p['ppt/diagrams/drawing1.xml']).toMatch(/Руководитель: \[ФИО_\d+\]/);
    expect(p['ppt/comments/comment1.xml']).toMatch(/<p:text>Уточнить у \[ФИО_\d+\], тел\. \[ТЕЛ_\d+\]<\/p:text>/);
    expect(p['ppt/presentation.xml']).toMatch(/<p14:section name="Доклад \[ФИО_\d+\]"/);
    expect(p['ppt/slides/slide1.xml']).toMatch(/<p:cSld name="Слайд \[ФИО_\d+\]"/);
    expect(p['ppt/slides/slide1.xml']).toMatch(/tooltip="Написать \[ФИО_\d+\]"/);
  });

  it('примечания openpyxl и pandas (xl/comments/comment1.xml) — найдены по связи листа, автор и текст заменены', async () => {
    for (const f of ['openpyxl-crm.xlsx', 'pandas-clients.xlsx']) {
      const { result } = await anon(f);
      const c = unzipText(result.bytes)['xl/comments/comment1.xml'];
      expect(c, f).toMatch(/<author>\[ФИО_\d+\]<\/author>/);
    }
  });
});

/** Запись zip по имени (без распаковки вложенного). */
function unzipBinary(bytes, name) {
  return inflateEntry(readZip(bytes).find((e) => e.name === name));
}

describe.skipIf(!LO_ENABLED)('файлы настоящих инструментов: LibreOffice (локально)', () => {
  it('результаты (книги и презентации) открываются: конвертация прошла, листов и слайдов — как у исходника', async () => {
    const files = [];
    for (const f of FILES.filter((x) => /\.(xlsx|pptx)$/.test(x))) {
      const { result } = await anon(f);
      files.push({ name: f, bytes: bytesOf(f) }, { name: f.replace(/(\.\w+)$/, '.anon$1'), bytes: result.bytes });
    }
    const out = libreOfficeConvert(files, 'pdf', 'real');
    for (const f of FILES.filter((x) => /\.(xlsx|pptx)$/.test(x))) {
      expect(out.has(f.replace(/\.\w+$/, '.pdf')), f).toBe(true);
      expect(out.has(f.replace(/\.\w+$/, '.anon.pdf')), `${f}: результат`).toBe(true);
    }
  }, 300000);
});

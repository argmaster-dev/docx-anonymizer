// Скрытые данные (версия 0.5, WP12-D, Ц4, К7; docs/concept-0.5.md п. 6, docs/contracts.md §9.9): счётчики комментариев, истории
// правок, скрытого текста, скрытых листов, строк, столбцов и слайдов верны на фикстурах; каждый переключатель удаляет свои
// элементы, файл остаётся целым (типы содержимого, связи, XML) и открывается LibreOffice; выключенные переключатели не меняют
// структуру документа (байты те же, что без выбора); найденное в скрытом обезличено при любом выборе.
// Фикстуры — scripts/gen-hidden-fixtures.mjs (синтетика) и настоящие файлы LibreOffice (tests/fixtures/hidden/real/, --real).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runOffice, deepLeaks, checkPackage, LO_ENABLED, libreOfficeConvert } from './support/office.js';
import { unzipText } from '../helpers/docx.js';
import { assertWellFormed } from '../helpers/wellformed.js';
import { buildAll } from '../../scripts/gen-hidden-fixtures.mjs';
import { scanWordPart, wordHiddenStyles } from '../../src/core/docx/hidden.js';
import { resolveStrips, collectOrphans, hiddenFlagsFrom, anyHidden } from '../../src/core/ooxml/hidden.js';
import { applyRangeEdits } from '../../src/core/ooxml/xml.js';
import { defaultSettings } from '../../src/core/settings.js';

const DIR = join(process.cwd(), 'tests/fixtures/hidden');
const EXPECTED = JSON.parse(readFileSync(join(DIR, 'expected.json'), 'utf8'));
const load = (name) => new Uint8Array(readFileSync(join(DIR, name)));
const ALL = { comments: true, revisions: true, hiddenText: true, hiddenSheets: true, hiddenSlides: true };
const OFF = { comments: false, revisions: false, hiddenText: false, hiddenSheets: false, hiddenSlides: false };
const FILES = Object.keys(EXPECTED);
const kindOf = (name) => /\.(docx|xlsx|pptx)$/.exec(name)[1];
/** Переключатели своего формата по одному и все вместе. */
const TOGGLES = {
  docx: [{ comments: true }, { revisions: true }, { hiddenText: true }, ALL],
  xlsx: [{ comments: true }, { hiddenSheets: true }, ALL],
  pptx: [{ comments: true }, { hiddenSlides: true }, ALL],
};

/** Обезличивание фикстуры с выбором скрытых данных. */
async function anon(name, hidden) {
  return (await runOffice(load(name), name.replace(/^real\//, ''), { apply: { hidden } })).result;
}

/** Все части XML и связей — корректный XML; пакет цел (типы содержимого, цели связей). */
function assertValid(bytes, label) {
  expect(checkPackage(bytes), label).toEqual([]);
  for (const [n, x] of Object.entries(unzipText(bytes))) if (/\.(xml|rels|vml)$/.test(n)) assertWellFormed(x, `${label}: ${n}`);
}

const count = (s, re) => s.match(re)?.length || 0;
const allXml = (parts) =>
  Object.entries(parts)
    .filter(([n]) => /\.(xml|vml)$/.test(n))
    .map(([, x]) => x)
    .join('\n');

describe('счётчики скрытого (К7)', () => {
  it('фикстуры актуальны (scripts/gen-hidden-fixtures.mjs --check)', () => {
    for (const [name, bytes] of Object.entries(buildAll())) expect(Buffer.compare(readFileSync(join(DIR, name)), Buffer.from(bytes)), name).toBe(0);
  });

  for (const name of FILES) {
    it(`${name}: ${JSON.stringify(EXPECTED[name].counts)}`, async () => {
      const { doc } = await runOffice(load(name), name.replace(/^real\//, ''));
      expect(doc.hidden).toEqual(expect.objectContaining(EXPECTED[name].counts));
      for (const [k, v] of Object.entries(doc.hidden)) if (!(k in EXPECTED[name].counts)) expect(v, k).toBe(0);
    });
  }

  it('договор без скрытого: нули, без обхода частей', async () => {
    const { doc } = await runOffice(load('real/lo-contract.docx'), 'a.docx');
    expect(doc.hidden.comments).toBeGreaterThan(0);
    const { buildSampleDocx } = await import('../../scripts/make-sample.mjs');
    const sample = await runOffice(buildSampleDocx().bytes, 'sample.docx');
    // образец 0.1 содержит комментарий и правки (FR-11): они считаются
    expect(sample.doc.hidden.comments).toBeGreaterThan(0);
    expect(sample.doc.hidden.revisions).toBeGreaterThan(0);
  });
});

describe('выключенные переключатели не меняют документ (К7)', () => {
  for (const name of FILES) {
    it(name, async () => {
      const plain = await anon(name, undefined);
      const off = await anon(name, OFF);
      expect(Buffer.compare(Buffer.from(off.bytes), Buffer.from(plain.bytes))).toBe(0);
      expect(off.stats.removedParts).toEqual(plain.stats.removedParts);
      // части те же, что в исходнике, скрытые элементы на месте
      const src = unzipText(load(name));
      const out = unzipText(off.bytes);
      expect(Object.keys(out)).toEqual(Object.keys(src).filter((n) => !/^docProps\/(custom|thumbnail)/.test(n)));
      const kinds =
        /<w:(?:ins|del|moveFrom|moveTo|vanish|commentReference)\b|<sheet\b[^>]*state="(?:hidden|veryHidden)"|<row\b[^>]*hidden="(?:1|true)"|show="0"|<p:cm\b|<p188:cm\b/g;
      expect(count(allXml(out), kinds)).toBe(count(allXml(src), kinds));
    });
  }
});

describe('найденное в скрытом обезличено при любом выборе (К7)', () => {
  for (const name of FILES) {
    it(name, async () => {
      const kind = kindOf(name);
      for (const hidden of [undefined, OFF, ...TOGGLES[kind]]) {
        const r = await anon(name, hidden);
        expect(deepLeaks(r.bytes, EXPECTED[name].secrets), `${name} ${JSON.stringify(hidden)}`).toEqual([]);
        assertValid(r.bytes, `${name} ${JSON.stringify(hidden)}`);
      }
      // режим маски — тоже
      const masked = (await runOffice(load(name), name.replace(/^real\//, ''), { apply: { mode: 'mask', hidden: ALL } })).result;
      expect(deepLeaks(masked.bytes, EXPECTED[name].secrets)).toEqual([]);
    });
  }
});

describe('Word: переключатели (К7)', () => {
  const name = 'contract-hidden.docx';

  it('«Удалить комментарии»: части, связи, типы содержимого, якоря и ссылки; people.xml остаётся (есть правки)', async () => {
    const r = await anon(name, { comments: true });
    const p = unzipText(r.bytes);
    for (const n of ['word/comments.xml', 'word/commentsExtended.xml', 'word/commentsIds.xml']) expect(p[n], n).toBeUndefined();
    expect(p['word/people.xml']).toBeDefined(); // авторы правок
    expect(p['[Content_Types].xml']).not.toMatch(/comments/i);
    expect(p['word/_rels/document.xml.rels']).not.toMatch(/comments/i);
    expect(p['word/document.xml']).not.toMatch(/<w:comment(?:RangeStart|RangeEnd|Reference)\b/);
    expect(p['word/document.xml']).not.toMatch(/CommentReference/); // ран ссылки — целиком
    expect(p['word/document.xml']).toMatch(/<w:ins\b/); // остальное не тронуто
    expect(r.stats.removedParts.sort()).toEqual(['word/comments.xml', 'word/commentsExtended.xml', 'word/commentsIds.xml']);
  });

  it('«Принять исправления»: вставки — текстом, удаления и прежние свойства — прочь, знак абзаца склеен, строка таблицы удалена', async () => {
    const r = await anon(name, { revisions: true });
    const doc = unzipText(r.bytes)['word/document.xml'];
    expect(doc).not.toMatch(/<w:(?:ins|del|moveFrom|moveTo|moveFromRange\w*|moveToRange\w*|cellIns|cellDel|cellMerge|delText|\w+Change)\b/);
    const text = doc.replace(/<[^>]+>/g, '');
    for (const s of EXPECTED[name].accepted) expect(text, s).toContain(s);
    expect(count(text, /Срок поставки — 10 дней\./g)).toBe(1); // перемещение: только на новом месте
    expect(text).not.toContain('Гарант'); // удалённая строка таблицы
    expect(count(doc, /<w:tr>/g)).toBe(2);
    // удалённый знак абзаца: «Адрес доставки …» и «, склад № 2.» — один абзац
    const merged = doc.split('</w:p>').find((x) => x.includes('Адрес доставки'));
    expect(merged.replace(/<[^>]+>/g, '')).toMatch(/склад № 2/);
    // комментарии и скрытый текст не тронуты
    expect(doc).toMatch(/<w:commentReference\b/);
    expect(doc).toMatch(/<w:vanish\/>/);
    expect(unzipText(r.bytes)['word/people.xml']).toBeDefined();
  });

  it('«Удалить скрытый текст»: раны w:vanish, стили со скрытым текстом, w:specVanish; абзац целиком', async () => {
    const r = await anon(name, { hiddenText: true });
    const doc = unzipText(r.bytes)['word/document.xml'];
    expect(doc).not.toMatch(/<w:(?:vanish|specVanish)\b/);
    expect(doc).not.toMatch(/HiddenChar|HiddenPara/);
    expect(doc.replace(/<[^>]+>/g, '')).not.toMatch(/Резервный контакт|Метка раздела|Служебно/);
    expect(doc).toMatch(/<w:ins\b/);
  });

  it('все вместе: people.xml удалён (комментариев и правок не осталось), трекинг правок в settings.xml не тронут', async () => {
    const r = await anon(name, ALL);
    const p = unzipText(r.bytes);
    expect(p['word/people.xml']).toBeUndefined();
    expect(p['[Content_Types].xml']).not.toMatch(/people/);
    expect(p['word/settings.xml']).toMatch(/trackRevisions/);
    const removed = r.stats.removedParts.sort();
    expect(removed).toEqual(['word/comments.xml', 'word/commentsExtended.xml', 'word/commentsIds.xml', 'word/people.xml']);
  });
});

describe('Excel: переключатели (К7)', () => {
  const name = 'book-hidden.xlsx';

  it('«Удалить комментарии»: примечания, цепочки, люди, VML и legacyDrawing', async () => {
    const r = await anon(name, { comments: true });
    const p = unzipText(r.bytes);
    expect(Object.keys(p).filter((n) => /comments|threadedComments|persons|vmlDrawing/i.test(n))).toEqual([]);
    expect(p['xl/worksheets/sheet1.xml']).not.toMatch(/legacyDrawing/);
    expect(p['[Content_Types].xml']).not.toMatch(/comments|person/i);
    expect(p['xl/workbook.xml']).toMatch(/state="hidden"/); // листы не тронуты
  });

  it('«Удалить скрытые листы, строки и столбцы»: листы со ссылками, локальные имена со сдвигом, ячейки, общие строки', async () => {
    const r = await anon(name, { hiddenSheets: true });
    const p = unzipText(r.bytes);
    const wb = p['xl/workbook.xml'];
    expect(wb).not.toMatch(/state="(?:hidden|veryHidden)"/);
    expect(count(wb, /<sheet\b/g)).toBe(2);
    expect(Object.keys(p).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))).toEqual(['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet3.xml']);
    // локальное имя скрытого листа удалено, «Итоги» (было 2) — теперь 1; глобальное имя на скрытый лист — #REF!; активный лист 2 → 1
    expect(wb).not.toMatch(/localSheetId="2"/);
    expect(count(wb, /localSheetId="1"/g)).toBe(1);
    expect(wb).toMatch(/<definedName name="Резервный">#REF!<\/definedName>/);
    expect(wb).toMatch(/activeTab="1"/);
    // формула на скрытый лист → #REF!; пересчёт при открытии
    expect(p['xl/worksheets/sheet1.xml']).toMatch(/<f>#REF!<\/f>/);
    expect(wb).toMatch(/fullCalcOnLoad="1"/);
    // скрытая строка 3 и скрытый столбец C — без ячеек, сами строка и столбец на месте
    const s1 = p['xl/worksheets/sheet1.xml'];
    expect(s1).toMatch(/<row r="3" hidden="1"><\/row>/);
    expect(s1).not.toMatch(/<c r="C\d+"/);
    expect(s1).toMatch(/<col min="3" max="3"[^>]*hidden="1"/);
    // общие строки скрытого — пустые, индексы прочих на месте
    const sst = p['xl/sharedStrings.xml'];
    expect(count(sst, /<si>/g)).toBe(count(unzipText(load(name))['xl/sharedStrings.xml'], /<si>/g));
    expect(sst).toMatch(/<si><t><\/t><\/si>/);
    // примечания не тронуты
    expect(Object.keys(p).some((n) => /comments/.test(n))).toBe(true);
    expect(r.stats.removedParts).toEqual(expect.arrayContaining(['xl/worksheets/sheet2.xml', 'xl/worksheets/sheet4.xml']));
  });
});

describe('Excel: кэш формул и объединения при удалении скрытого (ревью WP12-D)', () => {
  it('кэш формул на удалённый лист — #REF! (t="e"), на очищенные ячейки — снят (и транзитивно); якорь видимого объединения остаётся', async () => {
    const { buildXlsx } = await import('../../scripts/office-writer.mjs');
    const bytes = buildXlsx({
      sheets: [
        {
          name: 'Данные',
          hiddenRows: [3, 6],
          rows: [
            ['Заголовок', 'Сумма', 'Ссылка'],
            ['ВИД_СТР2', 10, { f: "'Скрытый лист'!A1", v: 'Яковлева Дарья Сергеевна', str: true }],
            ['СКРЫТАЯ_СТР Морозов Илья Петрович', 20, null],
            ['ИТОГО', { f: 'SUM(B2:B3)', v: 30 }, { f: "SUM('Скрытый лист'!B1:B3)", v: 600 }],
            ['ОБЪЕД_ВЕРХ_ВИДИМ', null, null],
            [null, 'ОБЪЕД_СКРЫТ_ВЕРХ', null],
            [null, null, 'ВИД_СТР7'],
            [null, null, 'ВИД_СТР8'],
          ],
          merges: ['A5:A7', 'B6:B8'],
        },
        {
          name: 'Скрытый лист',
          hidden: true,
          rows: [
            ['Яковлева Дарья Сергеевна', 100],
            ['СКР_ЛИСТ_2', 200],
            ['СКР_ЛИСТ_3', 300],
          ],
        },
        {
          name: 'Итоги',
          rows: [['ИТОГ_ЛИСТ', { f: "'Скрытый лист'!B2*2", v: 400 }, { f: 'Данные!B4', v: 30 }, { f: 'SUM(Источник)', v: 600 }, { f: 'B1+1', v: 401 }]],
        },
      ],
      definedNames: [{ name: 'Источник', ref: "'Скрытый лист'!$A$1:$B$3" }],
    });
    const r = (await runOffice(bytes, 'книга.xlsx', { apply: { hidden: { hiddenSheets: true } } })).result;
    assertValid(r.bytes, 'книга');
    const p = unzipText(r.bytes);
    const s1 = p['xl/worksheets/sheet1.xml'];
    const s3 = p['xl/worksheets/sheet3.xml'];
    // ссылка на удалённый лист: формула #REF!, ячейка-ошибка, кэш #REF! (значения скрытого листа не остаются)
    expect(s1).toMatch(/<c r="C2" t="e"><f>#REF!<\/f><v>#REF!<\/v><\/c>/);
    expect(s1).toMatch(/<c r="C4" t="e"><f>SUM\(#REF!\)<\/f><v>#REF!<\/v><\/c>/);
    expect(s3).toMatch(/<c r="B1" t="e"><f>#REF!\*2<\/f><v>#REF!<\/v><\/c>/);
    expect(s3).toMatch(/<c r="D1" t="e"><f>SUM\(Источник\)<\/f><v>#REF!<\/v><\/c>/);
    // итог по очищенной скрытой строке — без кэша; зависящие от него и от ошибки формулы — тоже
    expect(s1).toMatch(/<c r="B4"><f>SUM\(B2:B3\)<\/f><\/c>/);
    expect(s3).toMatch(/<c r="C1"><f>Данные!B4<\/f><\/c>/);
    expect(s3).toMatch(/<c r="E1"><f>B1\+1<\/f><\/c>/);
    for (const v of ['>600<', '>400<', '>401<', '>30<', 'Яковлева', 'Морозов']) expect(`${s1}${s3}${p['xl/sharedStrings.xml']}`, v).not.toContain(v);
    // объединение B6:B8 со скрытой строкой 6 видно в 7–8 — его текст остаётся; ячейка вне объединений в скрытой строке — удалена
    expect(s1).toMatch(/<row r="6" hidden="1"><c r="B6" t="s">/);
    expect(p['xl/sharedStrings.xml']).toContain('ОБЪЕД_СКРЫТ_ВЕРХ');
    expect(s1).toMatch(/<row r="3" hidden="1"><\/row>/);
    expect(p['xl/workbook.xml']).toMatch(/fullCalcOnLoad="1"/);
    if (LO_ENABLED) {
      const out = libreOfficeConvert([{ name: 'formulas.xlsx', bytes: r.bytes }], 'pdf', 'hidden-formulas');
      expect(out.has('formulas.pdf')).toBe(true);
    }
  }, 120000);
});

describe('Excel: диаграммы и сводные на удаляемое (ревью WP12-D)', () => {
  /** Книга: скрытый лист с данными, диаграмма на видимом листе (ряды со ссылками на скрытый лист и на скрытую строку), сводная по скрытому листу. */
  async function bookWithChartAndPivot() {
    const { buildXlsx } = await import('../../scripts/office-writer.mjs');
    const { readZip, inflateEntry, writeZip } = await import('../../src/core/ooxml/zip.js');
    const base = buildXlsx({
      sheets: [
        {
          name: 'Данные',
          hiddenRows: [3],
          rows: [
            ['Месяц', 'Сумма'],
            ['Январь', 4410.5],
            ['Февраль', 4420.25],
          ],
        },
        {
          name: 'Скрытый лист',
          hidden: true,
          rows: [
            ['ФИО', 'Сумма'],
            ['Яковлева Дарья Сергеевна', 7310.25],
            ['СКР_ЛИСТ_ДВА', 7320.5],
          ],
        },
        { name: 'Итоги', rows: [['ИТОГ_ЛИСТ']] },
      ],
    });
    const dec = new TextDecoder();
    const files = Object.fromEntries(readZip(base).map((e) => [e.name, dec.decode(inflateEntry(e))]));
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + R + '"';
    const rels = (list) =>
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list
        .map(([id, type, target]) => `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`)
        .join('')}</Relationships>`;
    const pt = (vals) => `<c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}`;
    const ser = (i, tx, cat, val, nums) =>
      `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>${tx[0]}</c:f><c:strCache>${pt([tx[1]])}</c:strCache></c:strRef></c:tx>` +
      `<c:cat><c:strRef><c:f>${cat[0]}</c:f><c:strCache>${pt(cat[1])}</c:strCache></c:strRef></c:cat>` +
      `<c:val><c:numRef><c:f>${val}</c:f><c:numCache><c:formatCode>General</c:formatCode>${pt(nums)}</c:numCache></c:numRef></c:val></c:ser>`;
    files['xl/charts/chart1.xml'] =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="' +
      R +
      '"><c:chart><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>' +
      ser(
        0,
        ["'Скрытый лист'!$A$1", 'ФИО'],
        ["'Скрытый лист'!$A$2:$A$3", ['Яковлева Дарья Сергеевна', 'СКР_ЛИСТ_ДВА']],
        "'Скрытый лист'!$B$2:$B$3",
        [7310.25, 7320.5],
      ) +
      ser(1, ['Данные!$B$1', 'Сумма'], ['Данные!$A$2:$A$3', ['Январь', 'Февраль']], 'Данные!$B$2:$B$3', [4410.5, 4420.25]) +
      '<c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>' +
      '<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx></c:plotArea></c:chart></c:chartSpace>';
    files['xl/drawings/drawing1.xml'] =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="' +
      R +
      '" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>' +
      '<xdr:to><xdr:col>6</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>15</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Диаграмма 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>' +
      '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>';
    files['xl/drawings/_rels/drawing1.xml.rels'] = rels([['rId1', 'chart', '../charts/chart1.xml']]);
    files['xl/pivotCache/pivotCacheDefinition1.xml'] =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><pivotCacheDefinition ${NS} r:id="rId1" refreshOnLoad="1" recordCount="2"><cacheSource type="worksheet"><worksheetSource ref="A1:B3" sheet="Скрытый лист"/></cacheSource>` +
      '<cacheFields count="2"><cacheField name="ФИО" numFmtId="0"><sharedItems count="2"><s v="Яковлева Дарья Сергеевна"/><s v="СКР_ЛИСТ_ДВА"/></sharedItems></cacheField>' +
      '<cacheField name="Сумма" numFmtId="0"><sharedItems containsSemiMixedTypes="0" containsString="0" containsNumber="1" minValue="7310.25" maxValue="7320.5"/></cacheField></cacheFields></pivotCacheDefinition>';
    files['xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels'] = rels([['rId1', 'pivotCacheRecords', 'pivotCacheRecords1.xml']]);
    files['xl/pivotCache/pivotCacheRecords1.xml'] =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><pivotCacheRecords ${NS} count="2"><r><x v="0"/><n v="7310.25"/></r><r><x v="1"/><n v="7320.5"/></r></pivotCacheRecords>`;
    files['xl/pivotTables/pivotTable1.xml'] =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><pivotTableDefinition ${NS} name="Сводная1" cacheId="1" dataCaption="Значения" createdVersion="6" updatedVersion="6" minRefreshableVersion="3">` +
      '<location ref="D3:E6" firstHeaderRow="1" firstDataRow="1" firstDataCol="1"/><pivotFields count="2"><pivotField axis="axisRow" showAll="0"><items count="3"><item x="0"/><item x="1"/><item t="default"/></items></pivotField>' +
      '<pivotField dataField="1" showAll="0"/></pivotFields><rowFields count="1"><field x="0"/></rowFields><rowItems count="3"><i><x/></i><i><x v="1"/></i><i t="grand"><x/></i></rowItems><colItems count="1"><i/></colItems>' +
      '<dataFields count="1"><dataField name="Сумма по полю Сумма" fld="1" baseField="0" baseItem="0"/></dataFields></pivotTableDefinition>';
    files['xl/pivotTables/_rels/pivotTable1.xml.rels'] = rels([['rId1', 'pivotCacheDefinition', '../pivotCache/pivotCacheDefinition1.xml']]);
    files['xl/worksheets/_rels/sheet3.xml.rels'] = rels([
      ['rId1', 'drawing', '../drawings/drawing1.xml'],
      ['rId2', 'pivotTable', '../pivotTables/pivotTable1.xml'],
    ]);
    files['xl/worksheets/sheet3.xml'] = files['xl/worksheets/sheet3.xml'].replace('</worksheet>', '<drawing r:id="rId1"/></worksheet>');
    files['xl/_rels/workbook.xml.rels'] = files['xl/_rels/workbook.xml.rels'].replace(
      '</Relationships>',
      `<Relationship Id="rId90" Type="${R}/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition1.xml"/></Relationships>`,
    );
    files['xl/workbook.xml'] = files['xl/workbook.xml'].replace(/(<calcPr[^>]*\/>)/, '$1<pivotCaches><pivotCache cacheId="1" r:id="rId90"/></pivotCaches>');
    const ov = (part, type) => `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.${type}+xml"/>`;
    files['[Content_Types].xml'] = files['[Content_Types].xml'].replace(
      '</Types>',
      ov('xl/charts/chart1.xml', 'drawingml.chart') +
        ov('xl/drawings/drawing1.xml', 'drawing') +
        ov('xl/pivotCache/pivotCacheDefinition1.xml', 'spreadsheetml.pivotCacheDefinition') +
        ov('xl/pivotCache/pivotCacheRecords1.xml', 'spreadsheetml.pivotCacheRecords') +
        ov('xl/pivotTables/pivotTable1.xml', 'spreadsheetml.pivotTable') +
        '</Types>',
    );
    const enc = new TextEncoder();
    return writeZip(Object.entries(files).map(([name, d]) => ({ name, data: enc.encode(d) })));
  }

  it('кэш рядов на удалённый лист и скрытую строку — пустой; сводная по удалённому листу — удалена; ни одного значения удалённого; LibreOffice открывает', async () => {
    const bytes = await bookWithChartAndPivot();
    assertValid(bytes, 'исходник');
    // без выбора всё на месте (и данные удалённого листа — тоже, но обезличенные там, где это сущности)
    const before = unzipText((await runOffice(bytes, 'диаграмма.xlsx')).result.bytes);
    expect(before['xl/charts/chart1.xml']).toContain('<c:v>7310.25</c:v>');
    expect(before['xl/pivotCache/pivotCacheRecords1.xml']).toContain('7310.25');
    const r = (await runOffice(bytes, 'диаграмма.xlsx', { apply: { hidden: { hiddenSheets: true } } })).result;
    assertValid(r.bytes, 'результат');
    const p = unzipText(r.bytes);
    expect(Object.keys(p).filter((n) => /pivot/i.test(n))).toEqual([]);
    expect(p['xl/workbook.xml']).not.toMatch(/pivotCache/);
    expect(p['[Content_Types].xml']).not.toMatch(/pivot/i);
    const chart = p['xl/charts/chart1.xml'];
    expect(chart).toMatch(/<c:f>#REF!<\/c:f><c:numCache><c:ptCount val="0"\/><\/c:numCache>/);
    expect(chart).toMatch(/<c:f>Данные!\$B\$2:\$B\$3<\/c:f><c:numCache><c:ptCount val="0"\/><\/c:numCache>/); // строка 3 скрыта и очищена
    expect(chart).toMatch(/<c:f>Данные!\$B\$1<\/c:f><c:strCache><c:ptCount val="1"\/>/); // видимая подпись — как была
    // ни одного значения удалённого листа и скрытой строки ни в одной части zip
    expect(deepLeaks(r.bytes, ['Яковлева', 'СКР_ЛИСТ_ДВА', '7310.25', '7320.5', '4420.25', 'Февраль'])).toEqual([]);
    if (LO_ENABLED) {
      const out = libreOfficeConvert([{ name: 'chart-pivot.xlsx', bytes: r.bytes }], 'pdf', 'hidden-chart-pivot');
      expect(out.has('chart-pivot.pdf')).toBe(true);
    }
  }, 120000);
});

describe('PowerPoint: переключатели (К7)', () => {
  const name = 'deck-hidden.pptx';

  it('«Удалить скрытые слайды»: слайд, заметки, ссылки в презентации, показах, разделах и гиперссылках', async () => {
    const r = await anon(name, { hiddenSlides: true });
    const p = unzipText(r.bytes);
    expect(Object.keys(p).filter((n) => /^ppt\/(?:slides|notesSlides)\/[^/]+\.xml$/.test(n))).toEqual(['ppt/slides/slide1.xml', 'ppt/slides/slide3.xml']);
    expect(allXml(p)).not.toMatch(/show="0"/);
    const pres = p['ppt/presentation.xml'];
    expect(count(pres, /<p:sldId\b/g)).toBe(2);
    expect(count(pres, /<p:sld r:id/g)).toBe(1);
    expect(count(pres, /<p14:sldId\b/g)).toBe(2);
    expect(p['ppt/slides/slide1.xml']).not.toMatch(/hlinkClick/);
    expect(p['ppt/slides/_rels/slide1.xml.rels']).not.toMatch(/slide2\.xml/);
    expect(Object.keys(p).some((n) => /comments/.test(n))).toBe(true); // комментарии не тронуты
  });

  it('«Удалить комментарии»: обычные и современные, авторы, ссылка в слайде', async () => {
    const r = await anon(name, { comments: true });
    const p = unzipText(r.bytes);
    expect(Object.keys(p).filter((n) => /comment|authors/i.test(n))).toEqual([]);
    expect(p['ppt/slides/slide3.xml']).not.toMatch(/commentRel/);
    expect(p['[Content_Types].xml']).not.toMatch(/comment|authors/i);
    expect(p['ppt/presentation.xml']).toMatch(/<p:sldId id="257"/); // слайды не тронуты
  });
});

describe('настоящие файлы LibreOffice: все переключатели', () => {
  for (const name of FILES.filter((n) => n.startsWith('real/'))) {
    it(name, async () => {
      const r = await anon(name, ALL);
      const xml = allXml(unzipText(r.bytes));
      expect(xml).not.toMatch(/<w:(?:ins|del|vanish|commentReference)\b|state="hidden"|<row\b[^>]*hidden="true"><c|show="0"|<p:cm\b/);
      expect(r.stats.removedParts.length).toBeGreaterThan(0);
    });
  }
});

describe.skipIf(!LO_ENABLED)('LibreOffice открывает результат (К7)', () => {
  it('все фикстуры × все переключатели и по одному', async () => {
    const files = [];
    for (const name of FILES) {
      const kind = kindOf(name);
      for (const [i, hidden] of TOGGLES[kind].entries()) {
        const r = await anon(name, hidden);
        files.push({ name: `${name.replace(/[/.]/g, '_')}_${i}.${kind}`, bytes: r.bytes });
      }
    }
    const out = libreOfficeConvert(files, 'pdf', 'hidden');
    for (const f of files) expect(out.has(f.name.replace(/\.\w+$/, '.pdf')), f.name).toBe(true);
  }, 600000);
});

describe('общий слой (ooxml/hidden.js, docx/hidden.js)', () => {
  it('resolveStrips: удаление важнее правок внутри, вложенные — внешнее, частичное — объединение', () => {
    const xml = '0123456789';
    const list = [
      { from: 2, to: 4, text: 'AB' }, // внутри удаления — отброшена
      { from: 1, to: 6, text: '', strip: true },
      { from: 3, to: 5, text: '', strip: true }, // вложено
      { from: 5, to: 8, text: '', strip: true }, // частично — объединение
      { from: 9, to: 9, text: '+' }, // вставка вне
      { from: 7, to: 7, text: '!' }, // вставка внутри — отброшена
    ];
    expect(applyRangeEdits(xml, resolveStrips(list))).toBe('08+9');
  });

  it('collectOrphans: часть, на которую ссылались только удалённые, — транзитивно; общая — остаётся', () => {
    const rels = [
      { source: '', target: 'p.xml', external: false },
      { source: 'p.xml', target: 's1.xml', external: false },
      { source: 'p.xml', target: 's2.xml', external: false },
      { source: 's2.xml', target: 'n2.xml', external: false },
      { source: 'n2.xml', target: 's2.xml', external: false },
      { source: 's2.xml', target: 'img.png', external: false },
      { source: 's1.xml', target: 'layout.xml', external: false },
      { source: 's2.xml', target: 'layout.xml', external: false },
      { source: 's2.xml', target: 'https://example.org', external: true },
    ];
    const removed = new Set(['s2.xml']);
    const names = new Set(['p.xml', 's1.xml', 's2.xml', 'n2.xml', 'img.png', 'layout.xml']);
    expect(collectOrphans(rels, removed, names).sort()).toEqual(['img.png', 'n2.xml']);
    expect(removed.has('layout.xml')).toBe(false);
  });

  it('выбор из настроек: по умолчанию всё выключено', () => {
    const flags = hiddenFlagsFrom(defaultSettings());
    expect(anyHidden(flags)).toBe(false);
    expect(Object.values(flags).every((v) => v === false)).toBe(true);
    expect(hiddenFlagsFrom({ ...defaultSettings(), removeComments: true, acceptRevisions: true })).toMatchObject({ comments: true, revisions: true });
  });

  it('стили: наследование w:basedOn, своё значение важнее, w:vanish w:val="0" — видимый текст', () => {
    const st = wordHiddenStyles(
      '<w:styles><w:style w:type="paragraph" w:styleId="A"><w:rPr><w:vanish/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="B"><w:basedOn w:val="A"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="C"><w:basedOn w:val="A"/><w:rPr><w:vanish w:val="0"/></w:rPr></w:style></w:styles>',
    );
    expect([st.vanish.get('A'), st.vanish.get('B'), st.vanish.get('C')]).toEqual([true, true, false]);
    const xml = '<w:p><w:pPr><w:pStyle w:val="B"/></w:pPr><w:r><w:t>a</w:t></w:r><w:r><w:rPr><w:vanish w:val="0"/></w:rPr><w:t>b</w:t></w:r></w:p>';
    expect(scanWordPart(xml, st).hiddenText).toBe(1);
  });

  it('последний абзац ячейки остаётся, даже если он скрыт; w:vanish внутри *Change не считается', () => {
    const xml =
      '<w:tbl><w:tr><w:tc><w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr><w:r><w:rPr><w:vanish/></w:rPr><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="1"><w:rPr><w:vanish/></w:rPr></w:rPrChange></w:rPr><w:t>y</w:t></w:r></w:p>';
    const r = scanWordPart(xml, wordHiddenStyles(''), { hiddenText: true });
    expect(r.hiddenText).toBe(1);
    expect(r.revisions).toBe(1);
    const out = applyRangeEdits(xml, resolveStrips(r.edits.map((e) => ({ ...e, strip: true }))));
    expect(out).toMatch(/<w:tc><w:p>/); // абзац ячейки на месте, без скрытого рана
    expect(out).not.toContain('>x<');
    expect(out).toContain('>y<');
  });
});

describe('протокол: ENTITIES.hidden и APPLY.options.hidden (хост)', () => {
  it('счётчики в ENTITIES, выбор в APPLY удаляет; без выбора — из настроек (по умолчанию ничего); сообщения по схеме', async () => {
    const { createHost } = await import('../../src/offscreen/host.js');
    const { MSG, postChunked, ChunkAssembler } = await import('../../src/shared/protocol.js');
    const { createValidator } = await import('../helpers/jsonschema.js');
    const schema = JSON.parse(readFileSync('schemas/protocol.schema.json', 'utf8'));
    const mappingSchema = JSON.parse(readFileSync('schemas/mapping.schema.json', 'utf8'));
    const { validate } = createValidator({ 'protocol.schema.json': schema, 'mapping.schema.json': mappingSchema });
    const check = (m) => [...validate({ $ref: `#/$defs/${m.type}` }, m, schema), ...validate(schema, m)];
    const out = [];
    const host = createHost({ post: (c, m) => out.push(m) });
    const run = async (rid, settings, options) => {
      const send = (msg) => host.handle('c1', { settings, ...msg });
      const msgs = [];
      // имя у каждого прогона своё: тот же файл под тем же именем вернул бы прежнюю сессию
      postChunked((m) => msgs.push(m), { requestId: rid, kind: 'FILE', bytes: load('contract-hidden.docx'), meta: { name: `${rid}.docx` } });
      for (const m of msgs) await send(m);
      await send({ type: MSG.ANALYZE, requestId: rid });
      const ent = out.find((m) => m.requestId === rid && m.type === MSG.ENTITIES);
      await send({ type: MSG.APPLY, requestId: `${rid}a`, docId: ent.docId, decisions: [], ...(options ? { options } : {}) });
      const res = out.filter((m) => m.requestId === `${rid}a`);
      const begin = res.find((m) => m.type === MSG.RESULT_BEGIN);
      const asm = new ChunkAssembler(begin);
      for (const m of res.filter((x) => x.type === MSG.RESULT_CHUNK)) asm.add(m.index, m.data);
      return { ent, msgs: [...msgs, ...res], parts: unzipText(asm.result()) };
    };
    const a = await run('h1', defaultSettings());
    expect(a.ent.hidden).toEqual(EXPECTED['contract-hidden.docx'].counts);
    expect(check(a.ent)).toEqual([]);
    expect(a.parts['word/comments.xml']).toBeDefined(); // по умолчанию ничего не удаляется
    const b = await run('h2', defaultSettings(), { hidden: { comments: true } });
    expect(b.parts['word/comments.xml']).toBeUndefined();
    expect(b.parts['word/document.xml']).toMatch(/<w:ins\b/);
    const apply = { type: MSG.APPLY, requestId: 'x', docId: 'd1', options: { hidden: { comments: true, revisions: false } } };
    expect(check(apply)).toEqual([]);
    expect(check({ ...apply, options: { hidden: { comments: 'да' } } })).not.toEqual([]);
    // выбор из настроек, если клиент его не прислал
    const c = await run('h3', { ...defaultSettings(), acceptRevisions: true });
    expect(c.parts['word/document.xml']).not.toMatch(/<w:(?:ins|del)\b/);
    expect(c.parts['word/comments.xml']).toBeDefined();
  });
});

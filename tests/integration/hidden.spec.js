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

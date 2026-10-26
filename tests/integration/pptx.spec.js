// PowerPoint (версия 0.5, WP12-B, Ц1, К2; docs/concept-0.5.md п. 3, docs/contracts.md §9.8): презентации tests/fixtures/office/*.pptx
// (scripts/gen-office-fixtures.mjs) — все gold pii/ids закрыты на слайдах, в таблицах, группах, заметках, комментариях
// (обычных и современных), авторах, alt-текстах и макетах; число слайдов, фигур и их геометрия не меняются; LibreOffice
// открывает результат без восстановления (локально, SKIP_LIBREOFFICE — пропуск).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOfficeFixtures } from '../../scripts/gen-office-fixtures.mjs';
import { partialLeaks } from '../../scripts/eval-genres.mjs';
import { unzipText } from '../helpers/docx.js';
import { assertWellFormed } from '../helpers/wellformed.js';
import { readZip } from '../../src/core/ooxml/zip.js';
import { unescapeXml } from '../../src/core/ooxml/xml.js';
import { CATEGORY_GROUPS } from '../../src/core/categories.js';
import { OFFICE_DIR, fixture, runOffice, adapterFor, libreOfficeConvert, findLeaks, checkPackage, LO_ENABLED } from './support/office.js';

const DECKS = ['deck-sales', 'deck-table', 'deck-comments', 'deck-notes'];
const ALWAYS = new Set([...CATEGORY_GROUPS.pii, ...CATEGORY_GROUPS.ids]);
const secret = (gold) => gold.entities.filter((e) => ALWAYS.has(e.category));
const textOf = (bytes) =>
  Object.entries(unzipText(bytes))
    .filter(([n]) => /\.(xml|rels)$/.test(n))
    .map(([, x]) => unescapeXml(x.replace(/<[^>]+>/g, ' ')))
    .join('\n');
/** Каркас слайда: фигуры, их id и геометрия (смещения и размеры) — без текста. */
const skeleton = (xml) => ({
  shapes: (xml.match(/<p:(?:sp|grpSp|graphicFrame|pic)>/g) || []).length,
  ids: [...xml.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => m[1]),
  geometry: [...xml.matchAll(/<a:(off|ext|chOff|chExt) ([^/]*)\/>/g)].map((m) => `${m[1]} ${m[2]}`),
  cells: (xml.match(/<a:tc>/g) || []).length,
});

const results = new Map();
async function anon(name, opts) {
  const key = `${name}|${JSON.stringify(opts || {})}`;
  if (!results.has(key)) {
    const { bytes, gold } = fixture(`${name}.pptx`);
    results.set(key, { bytes, gold, ...(await runOffice(bytes, `${name}.pptx`, opts)) });
  }
  return results.get(key);
}

describe('К2: фикстуры PowerPoint', () => {
  it('≥ 4 презентации (таблицы, группы, заметки, комментарии); генератор детерминирован', () => {
    const decks = buildOfficeFixtures().filter((f) => f.format === 'pptx');
    expect(decks.map((d) => d.name)).toEqual(DECKS);
    for (const d of decks) {
      expect(Buffer.from(readFileSync(join(OFFICE_DIR, `${d.name}.pptx`))).equals(Buffer.from(d.bytes)), `${d.name}: npm run gen-office-fixtures`).toBe(true);
      expect(JSON.parse(readFileSync(join(OFFICE_DIR, `${d.name}.pptx.gold.json`), 'utf8'))).toEqual(d.gold);
    }
    const kinds = decks.flatMap((d) => d.spec.slides.flatMap((s) => s.shapes.map((x) => x.type)));
    expect(kinds).toEqual(expect.arrayContaining(['table', 'group', 'text']));
    expect(decks.some((d) => d.spec.slides.some((s) => s.notes?.length))).toBe(true);
    expect(decks.some((d) => d.spec.slides.some((s) => s.comments?.length && s.modernComments?.length))).toBe(true);
  });

  it('распознаётся по содержимому; не ZIP — NOT_SUPPORTED', async () => {
    const { bytes } = fixture('deck-sales.pptx');
    const ad = await adapterFor(bytes, 'слайды.bin');
    expect(ad.kind).toBe('pptx');
    expect(() => ad.parse(new TextEncoder().encode('не zip'))).toThrow(expect.objectContaining({ code: 'NOT_SUPPORTED' }));
  });
});

describe('К2: обезличивание презентаций (настройки по умолчанию)', () => {
  it.each(DECKS)('%s: все gold pii/ids закрыты — ни целиком, ни частью; пакет цел', async (name) => {
    const { gold, result, doc } = await anon(name);
    expect(
      findLeaks(
        result.bytes,
        secret(gold).map((e) => e.value),
      ),
      'утечки',
    ).toEqual([]);
    expect(partialLeaks(secret(gold), textOf(result.bytes)).map((e) => `${e.key}/${e.part}`)).toEqual([]);
    expect(checkPackage(result.bytes)).toEqual([]);
    for (const [n, xml] of Object.entries(unzipText(result.bytes))) if (/\.(xml|rels)$/.test(n)) assertWellFormed(xml, n);
    expect(result.mime).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    expect(doc.kind).toBe('pptx');
  });

  it.each(DECKS)('%s: число слайдов, фигур, их id и геометрия, ячейки таблиц, части пакета — как в исходнике', async (name) => {
    const { bytes, result } = await anon(name);
    const src = unzipText(bytes);
    const out = unzipText(result.bytes);
    expect(readZip(result.bytes).map((e) => e.name)).toEqual(readZip(bytes).map((e) => e.name));
    const slides = Object.keys(src).filter((n) => /^ppt\/(?:slides|notesSlides|slideLayouts|slideMasters)\/[^/]+\.xml$/.test(n));
    expect(slides.length).toBeGreaterThan(0);
    for (const s of slides) expect(skeleton(out[s]), s).toEqual(skeleton(src[s]));
    expect(out['ppt/presentation.xml']).toBe(src['ppt/presentation.xml']);
    for (const t of Object.keys(src).filter((n) => n.startsWith('ppt/theme/'))) expect(out[t]).toBe(src[t]);
  });

  it('группы, таблица со столбцом «Телефон» (номер без +7) и «ИНН», заметки докладчика, скрытый слайд', async () => {
    const sales = unzipText((await anon('deck-sales')).result.bytes);
    expect(sales['ppt/slides/slide1.xml']).toMatch(/<a:t>Почта: <\/a:t><\/a:r><a:r><a:rPr lang="ru-RU" sz="1800" b="1" dirty="0"\/><a:t>\[EMAIL_1\]<\/a:t>/);
    expect(sales['ppt/notesSlides/notesSlide1.xml']).toMatch(/<a:t>Сказать, что \[ФИО_\d+\] подтвердила объём\. Её телефон \[ТЕЛ_\d+\]<\/a:t>/);
    expect(sales['ppt/slides/slide1.xml']).toContain('<a:t>Итоги квартала: отдел продаж</a:t>');
    const table = await anon('deck-table');
    const t = unzipText(table.result.bytes)['ppt/slides/slide1.xml'];
    expect(t).toMatch(/<a:t>Телефон<\/a:t>/); // шапка — не ФИО
    expect((t.match(/<a:t>\[ТЕЛ_\d+\]<\/a:t>/g) || []).length).toBe(4);
    expect((t.match(/<a:t>\[ИНН_\d+\]<\/a:t>/g) || []).length).toBe(4);
    expect(table.analysis.groups.some((g) => g.category === 'PERSON' && g.value === 'Телефон')).toBe(false);
    const hidden = unzipText(table.result.bytes)['ppt/slides/slide2.xml'];
    expect(hidden).toMatch(/show="0"/);
    expect(hidden).toMatch(/Резерв: \[ФИО_\d+\], паспорт \[ПАСПОРТ_\d+\]/);
  });

  it('комментарии: обычные (<p:text>) и современные с ответом; авторы, инициалы и идентификаторы — метками авторов', async () => {
    const { result, analysis, doc } = await anon('deck-comments');
    const out = unzipText(result.bytes);
    expect(out['ppt/comments/comment1.xml']).toMatch(/<p:text>Уточнить у \[ФИО_\d+\], телефон \[ТЕЛ_\d+\]<\/p:text>/);
    const modern = Object.keys(out).find((n) => /modernComment/.test(n));
    expect(out[modern]).toMatch(/<a:t>Паспорт подрядчика \[ПАСПОРТ_\d+\]<\/a:t>/);
    expect(out[modern]).toMatch(/<a:t>Почта для акта: \[EMAIL_\d+\]<\/a:t>/);
    expect(out['ppt/commentAuthors.xml']).toMatch(/name="\[ФИО_(\d+)\]" initials="\[ФИО_\1\]"/);
    const kotov = analysis.groups.find((g) => g.value === 'Котов Игорь');
    expect(out['ppt/authors.xml']).toContain(`name="${kotov.placeholder}" initials="${kotov.placeholder}" userId="${kotov.placeholder}"`);
    expect(doc.streams.filter((s) => s.attrKind === 'author').map((s) => s.text)).toEqual([
      'Котов Игорь',
      'Мельникова Ольга',
      'Котов Игорь',
      'Мельникова Ольга',
    ]);
  });

  it('макет — только если в нём сущность; образец слайдов без данных не меняется; alt-текст фигуры', async () => {
    const { bytes, result } = await anon('deck-notes');
    const src = unzipText(bytes);
    const out = unzipText(result.bytes);
    expect(out['ppt/slideLayouts/slideLayout1.xml']).toMatch(/<a:t>Подготовила \[ФИО_\d+\]<\/a:t>/);
    expect(out['ppt/slideMasters/slideMaster1.xml']).toBe(src['ppt/slideMasters/slideMaster1.xml']);
    expect(out['ppt/slides/slide1.xml']).toMatch(/descr="Фото: \[ФИО_\d+\]"/);
    expect(result.stats.changedParts).not.toContain('ppt/slideMasters/slideMaster1.xml');
  });

  it('вкладка «Текст»: слайды и заметки по умолчанию; заголовок слайда — вид абзаца heading, ячейка — cell', async () => {
    const { doc, analysis } = await anon('deck-table');
    const { getParagraphs } = await import('../../src/core/text-view.js');
    const page = getParagraphs(doc, analysis.groups, {});
    expect(page.total).toBeGreaterThan(10);
    expect(page.paragraphs[0].text).toBe('Ключевые контакты');
    expect(doc.paragraphs.find((p) => p.part === 'ppt/slides/slide1.xml').kind).toBe('heading');
    expect(doc.paragraphs.filter((p) => p.kind === 'cell')).toHaveLength(15);
  });
});

describe.skipIf(!LO_ENABLED)('К2: LibreOffice (локально)', () => {
  it('исходники и результаты открываются без восстановления; в тексте результата нет gold', async () => {
    const files = [];
    for (const name of DECKS) {
      const { bytes, result } = await anon(name);
      files.push({ name: `${name}.pptx`, bytes }, { name: `${name}.anon.pptx`, bytes: result.bytes });
    }
    const out = libreOfficeConvert(files, 'fodp', 'pptx');
    for (const name of DECKS) {
      const text = out.get(`${name}.anon.fodp`);
      expect(text, name).toBeTruthy();
      expect(out.get(`${name}.fodp`), name).toBeTruthy();
      const plain = unescapeXml(text.replace(/<[^>]+>/g, ' ')).toLowerCase();
      for (const e of secret(fixture(`${name}.pptx`).gold)) if (!e.meta) expect(plain, `${name}: ${e.key}`).not.toContain(e.value.toLowerCase());
      // слайдов столько же
      const pages = (s) => (s.match(/<draw:page /g) || []).length;
      expect(pages(text)).toBe(pages(out.get(`${name}.fodp`)));
    }
  }, 300000);
});

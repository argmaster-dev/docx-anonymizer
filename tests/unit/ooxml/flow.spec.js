// Общий слой OOXML (WP12-A, docs/contracts.md §9): токенизатор, потоки, charMap и замена через раны на синтетической разметке
// с другими именами элементов — SpreadsheetML (<si>/<r>/<t>), DrawingML (<a:p>/<a:r>/<a:t>) и выдуманной «x:». Заготовка под WP12-B.
import { describe, it, expect } from 'vitest';
import { tokenize, applyRangeEdits } from '../../../src/core/ooxml/xml.js';
import { parseFlowPart, planRunEdits, buildCharMap, OBJ } from '../../../src/core/ooxml/flow.js';
import { SML, DML, XML_X } from './markups.js';

const ctx = () => ({ pidCounter: 0, attrCounter: 0, paragraphs: [] });
// в части потоки лежат в порядке закрытия абзацев; порядок обхода — по позиции (как в ooxml/model.js parsePackage)
const live = (part) => part.streams.filter((s) => s.type === 'live').sort((a, b) => a.pos - b.pos);

/** Правки в координатах потока → новый XML части (как ooxml/serialize.js для одного потока). */
function edit(part, stream, list) {
  const raw = [];
  planRunEdits(part.xml, stream, list, part.markup, (e) => raw.push(e));
  return applyRangeEdits(part.xml, raw);
}

/** charMap: каждый символ virtualText указывает на свой сегмент и смещение в нём. */
function checkCharMap(s) {
  for (let k = 0; k < s.text.length; k++) {
    const seg = s.segments[s.segIndex[k]];
    expect(seg.vStart + s.segOffset[k]).toBe(k);
    expect(seg.text[s.segOffset[k]]).toBe(s.text[k]);
  }
}

describe('токенизатор: имена без префикса и с другим префиксом', () => {
  it('SpreadsheetML-ячейка и DrawingML-абзац — те же события, смещения указывают на исходную строку', () => {
    const xml = '<c r="A1" t="s"><v>0</v></c><a:p><a:r><a:t xml:space="preserve">Тел.</a:t></a:r><a:br/></a:p>';
    const seen = [];
    tokenize(xml, (t) => seen.push(`${t.type}:${t.name}:${xml.slice(t.start, t.end)}`));
    expect(seen).toEqual([
      'open:c:<c r="A1" t="s">',
      'open:v:<v>',
      'text::0',
      'close:v:</v>',
      'close:c:</c>',
      'open:a:p:<a:p>',
      'open:a:r:<a:r>',
      'open:a:t:<a:t xml:space="preserve">',
      'text::Тел.',
      'close:a:t:</a:t>',
      'close:a:r:</a:r>',
      'selfclose:a:br:<a:br/>',
      'close:a:p:</a:p>',
    ]);
  });
});

describe('потоки по описанию разметки', () => {
  it('SpreadsheetML: <t> прямо в <si> и в ранах <r>; фонетика <rPh> — не текст; inline <is>', () => {
    const xml =
      '<sst><si><t>Иванов &amp; сын</t></si>' +
      '<si><r><rPr><b/></rPr><t>Пётр</t></r><r><t xml:space="preserve"> Петрович</t></r><rPh sb="0" eb="1"><t>ПЕТР</t></rPh></si></sst>' +
      '<c t="inlineStr"><is><t>Анна</t></is></c>';
    const part = parseFlowPart('xl/sharedStrings.xml', xml, ctx(), SML);
    expect(part.markup).toBe(SML);
    expect(live(part).map((s) => s.text)).toEqual(['Иванов & сын', 'Пётр Петрович', 'Анна']);
    for (const s of live(part)) checkCharMap(s);
    const two = live(part)[1];
    expect(two.segments.map((g) => g.text)).toEqual(['Пётр', ' Петрович']);
    expect(xml.slice(two.segments[1].contentStart, two.segments[1].contentEnd)).toBe(' Петрович');
  });

  it('DrawingML: <a:br> между ранами и со своим <a:rPr>, поле <a:fld> — текст, <a:pic> — U+FFFC', () => {
    const xml =
      '<p:txBody><a:p><a:r><a:rPr lang="ru-RU"/><a:t>Тел.</a:t></a:r><a:br><a:rPr lang="ru-RU"/></a:br>' +
      '<a:r><a:t>+7 900 000-00-00</a:t></a:r><a:fld id="{1}" type="slidenum"><a:t>3</a:t></a:fld><a:r><a:pic/></a:r></a:p>' +
      '<a:p><a:r><a:t>Слайд</a:t></a:r><a:br/></a:p></p:txBody>';
    const part = parseFlowPart('ppt/slides/slide1.xml', xml, ctx(), DML);
    const [a, b] = live(part);
    expect(a.text).toBe(`Тел.\n+7 900 000-00-003${OBJ}`);
    expect(b.text).toBe('Слайд\n');
    checkCharMap(a);
    const br = a.segments[1];
    expect(br.kind).toBe('special');
    expect(xml.slice(br.elStart, br.elEnd)).toBe('<a:br><a:rPr lang="ru-RU"/></a:br>');
    expect(a.segments[a.segments.length - 1].container).toBe(true);
  });

  it('выдуманная разметка: удалённый текст и спецэлементы в обёртке удаления — свой поток, поле, мягкий перенос (0 символов), вложенный абзац', () => {
    const xml =
      '<x:body><x:para><x:run><x:txt>Ива</x:txt><x:shy/><x:txt>нов</x:txt><x:nl/></x:run>' +
      '<x:gone><x:run><x:old>Сидоров</x:old><x:nl/></x:run></x:gone><x:run><x:code> MERGEFIELD Имя </x:code></x:run>' +
      '<x:run><x:obj><x:para><x:run><x:txt>во врезке</x:txt></x:run></x:para></x:obj></x:run></x:para></x:body>';
    const c = ctx();
    const part = parseFlowPart('x/main.xml', xml, c, XML_X);
    const byType = (t) =>
      part.streams
        .filter((s) => s.type === t)
        .sort((x, y) => x.pos - y.pos)
        .map((s) => s.text);
    expect(byType('live')).toEqual([`Иванов\n${OBJ}`, 'во врезке']);
    expect(byType('deleted')).toEqual(['Сидоров\n']);
    expect(byType('field')).toEqual([' MERGEFIELD Имя ']);
    expect(c.paragraphs.map((p) => [p.pid, p.depth])).toEqual([
      ['p0', 0],
      ['p1', 1],
    ]);
    const s = live(part)[0];
    expect(s.segments.find((g) => g.kind === 'soft')?.text).toBe('');
    checkCharMap(s);
  });

  it('встроенный объект в ране (embeddedOpen / embeddedSelf) — граница рана в part.embeddedRuns', () => {
    const xml = '<x:para><x:run><x:txt>a</x:txt></x:run><x:run><x:ole>…</x:ole></x:run><x:run><x:chart/></x:run></x:para>';
    const part = parseFlowPart('x/main.xml', xml, ctx(), XML_X);
    expect(part.embeddedRuns.map((r) => xml.slice(r.start, r.end))).toEqual(['<x:run><x:ole>…</x:ole></x:run>', '<x:run><x:chart/></x:run>']);
  });

  it('buildCharMap: сегменты нулевой длины не занимают символов', () => {
    const segs = [
      { vStart: 0, vEnd: 2 },
      { vStart: 2, vEnd: 2 },
      { vStart: 2, vEnd: 3 },
    ];
    const { segIndex, segOffset } = buildCharMap(/** @type {any} */ (segs), 3);
    expect([...segIndex]).toEqual([0, 0, 2]);
    expect([...segOffset]).toEqual([0, 1, 0]);
  });
});

describe('замена через раны', () => {
  it('SpreadsheetML: значение через два рана — метка в первом, второй пуст с xml:space; форматирование рана сохранено', () => {
    const xml = '<sst><si><r><rPr><b/></rPr><t>Пётр</t></r><r><t> Петрович</t></r><r><t>, директор</t></r></si></sst>';
    const part = parseFlowPart('xl/sharedStrings.xml', xml, ctx(), SML);
    const s = live(part)[0];
    const out = edit(part, s, [{ start: 0, end: 'Пётр Петрович'.length, newText: '[ФИО_1]' }]);
    expect(out).toBe('<sst><si><r><rPr><b/></rPr><t>[ФИО_1]</t></r><r><t xml:space="preserve"></t></r><r><t>, директор</t></r></si></sst>');
  });

  it('DrawingML: xml:space не ставится; диапазон из одного <a:br> заменяется раном с текстом; спецэлемент внутри диапазона удаляется', () => {
    const xml = '<a:p><a:r><a:t>Тел.</a:t></a:r><a:br><a:rPr/></a:br><a:r><a:t>+7 900 000-00-00 </a:t></a:r></a:p>';
    const part = parseFlowPart('ppt/slides/slide1.xml', xml, ctx(), DML);
    const s = live(part)[0];
    const phone = s.text.indexOf('+7');
    expect(edit(part, s, [{ start: phone, end: phone + '+7 900 000-00-00'.length, newText: ' [ТЕЛЕФОН_1]' }])).toBe(
      '<a:p><a:r><a:t>Тел.</a:t></a:r><a:br><a:rPr/></a:br><a:r><a:t> [ТЕЛЕФОН_1] </a:t></a:r></a:p>',
    );
    expect(edit(part, s, [{ start: 4, end: 5, newText: ' ' }])).toBe(
      '<a:p><a:r><a:t>Тел.</a:t></a:r><a:r><a:t> </a:t></a:r><a:r><a:t>+7 900 000-00-00 </a:t></a:r></a:p>',
    );
    expect(edit(part, s, [{ start: 0, end: 7, newText: 'X' }])).toBe('<a:p><a:r><a:t>X</a:t></a:r><a:r><a:t> 900 000-00-00 </a:t></a:r></a:p>');
  });

  it('правка через контейнер — ошибка; экранирование нового текста (FR-16)', () => {
    const xml = '<a:p><a:r><a:t>до</a:t></a:r><a:r><a:pic/></a:r><a:r><a:t>после</a:t></a:r></a:p>';
    const part = parseFlowPart('ppt/slides/slide1.xml', xml, ctx(), DML);
    const s = live(part)[0];
    expect(() => edit(part, s, [{ start: 0, end: s.text.length, newText: 'x' }])).toThrow(/встроенный объект/);
    expect(edit(part, s, [{ start: 0, end: 2, newText: 'A & <B>' }])).toContain('<a:t>A &amp; &lt;B&gt;</a:t>');
  });
});

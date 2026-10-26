// Каркас пакета OOXML и сборка результата (WP12-A, docs/contracts.md §9) на выдуманном формате «demo»: адаптер описывает
// главную часть, порядок частей и разбор каждой — остальное (ZIP, порядок потоков, язык, метаданные, связи, удаление
// встроенных объектов, байт-копия нетронутых записей) делает общий слой. Так WP12-B подключит Excel и PowerPoint.
import { describe, it, expect } from 'vitest';
import { parsePackage, sortParts, readXmlEntry } from '../../../src/core/ooxml/model.js';
import { parseFlowPart } from '../../../src/core/ooxml/flow.js';
import { parseRelsPart, parseMetaPart, META_PART_RE, resolveTarget, relsBaseDir } from '../../../src/core/ooxml/opc.js';
import { serializePackage } from '../../../src/core/ooxml/serialize.js';
import { readZip, writeZip } from '../../../src/core/ooxml/zip.js';
import { CoreError } from '../../../src/core/errors.js';
import { DML, enc } from './markups.js';

const CT =
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>' +
  '<Override PartName="/demo/embeddings/ole1.bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/></Types>';

function demoBytes() {
  const files = {
    '[Content_Types].xml': CT,
    '_rels/.rels': '<Relationships><Relationship Id="r1" Target="docProps/custom.xml"/><Relationship Id="r2" Target="demo/slide1.xml"/></Relationships>',
    'demo/slide2.xml': '<s><a:p><a:r><a:t>Second slide: Ivan Petrov</a:t></a:r></a:p></s>',
    'demo/slide10.xml': '<s><a:p><a:r><a:t>Десятый слайд</a:t></a:r></a:p></s>',
    'demo/slide1.xml':
      '<s><a:p><a:r><a:t>Договор с Иваном Петровым</a:t></a:r><a:r><a:graphicData>ole</a:graphicData></a:r></a:p><a:p><a:r><a:t>тел. </a:t></a:r><a:r><a:t>+7 900</a:t></a:r></a:p></s>',
    'demo/_rels/slide1.xml.rels':
      '<Relationships><Relationship Id="h1" TargetMode="External" Target="https://example.invalid/ivan"/><Relationship Id="o1" Target="embeddings/ole1.bin"/></Relationships>',
    'demo/embeddings/ole1.bin': new Uint8Array([1, 2, 3]),
    'docProps/core.xml': '<cp:coreProperties><dc:creator>Иван Петров</dc:creator><dc:title>Договор</dc:title></cp:coreProperties>',
    'docProps/custom.xml': '<Properties><property name="x"><vt:lpwstr>секрет</vt:lpwstr></property></Properties>',
  };
  return writeZip(Object.entries(files).map(([name, d]) => ({ name, data: typeof d === 'string' ? enc(d) : d })));
}

const rank = (n) => (/^demo\/slide\d+\.xml$/.test(n) ? 0 : /_rels\//.test(n) ? 1 : 2);
/** @type {import('../../../src/core/ooxml/model.js').PackageDescription} */
const DEMO = {
  kind: 'demo',
  mainPart: 'demo/slide1.xml',
  notFound: { code: 'NOT_DOCX', message: 'нет demo/slide1.xml' },
  parts: (names) =>
    sortParts(
      names.filter((n) => /^demo\/slide\d+\.xml$/.test(n) || /^demo\/_rels\/.+\.rels$/.test(n) || META_PART_RE.test(n)),
      rank,
    ),
  parsePart: (name, xml, ctx) =>
    /\.rels$/.test(name) ? parseRelsPart(name, xml, ctx) : META_PART_RE.test(name) ? parseMetaPart(name, xml, ctx) : parseFlowPart(name, xml, ctx, DML),
  languageStream: (s) => /^demo\/slide/.test(s.part) && s.type === 'live',
};

describe('parsePackage', () => {
  it('порядок частей (естественный: slide2 < slide10), потоки в порядке обхода, kind, язык по своим потокам', () => {
    const doc = parsePackage(demoBytes(), DEMO);
    expect(doc.kind).toBe('demo');
    expect([...doc.parts.keys()]).toEqual(['demo/slide1.xml', 'demo/slide2.xml', 'demo/slide10.xml', 'demo/_rels/slide1.xml.rels', 'docProps/core.xml']);
    expect(doc.streams.map((s) => [s.type, s.text])).toEqual([
      ['live', 'Договор с Иваном Петровым'],
      ['live', 'тел. +7 900'],
      ['live', 'Second slide: Ivan Petrov'],
      ['live', 'Десятый слайд'],
      ['attr', 'https://example.invalid/ivan'],
      ['meta', 'Иван Петров'],
      ['meta', 'Договор'],
    ]);
    expect(doc.streams.map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(doc.streams[4].attrKind).toBe('rel-target');
    expect(doc.streamById.get('p0:live')?.text).toBe('Договор с Иваном Петровым');
    expect(doc.language).toBe('both');
    expect(doc.warnings).toEqual([]);
    expect(doc.parts.get('demo/slide1.xml')?.embeddedRuns).toHaveLength(1);
  });

  it('без главной части — ошибка из описания; не ZIP — NOT_DOCX; BOM части снимается', () => {
    const noMain = writeZip([{ name: 'demo/slide2.xml', data: enc('<s/>') }]);
    expect(() => parsePackage(noMain, DEMO)).toThrow(CoreError);
    expect(() => parsePackage(noMain, DEMO)).toThrow(/нет demo\/slide1\.xml/);
    expect(() => parsePackage(enc('не zip'), DEMO)).toThrow(expect.objectContaining({ code: 'NOT_DOCX' }));
    const bom = readZip(writeZip([{ name: 'a.xml', data: enc('﻿<a/>') }]))[0];
    expect(readXmlEntry(bom)).toBe('<a/>');
  });

  it('связи: базовый каталог и разрешение Target', () => {
    expect(relsBaseDir('demo/_rels/slide1.xml.rels')).toBe('demo/');
    expect(resolveTarget('demo/', '../docProps/x.xml')).toBe('docProps/x.xml');
    expect(resolveTarget('demo/', '/demo/a.xml')).toBe('demo/a.xml');
  });
});

describe('serializePackage', () => {
  const bytes = demoBytes();
  const doc = parsePackage(bytes, DEMO);
  it('правки через раны по разметке части, атрибут-ссылка, нетронутые записи — исходные сжатые байты; модель не меняется', () => {
    const s = doc.streams[1];
    const link = doc.streams[4];
    const {
      bytes: out,
      changedParts,
      removedParts,
    } = serializePackage(
      doc,
      [
        { streamId: s.id, start: 5, end: 11, newText: '[ТЕЛЕФОН_1]' },
        { streamId: link.id, start: 0, end: link.text.length, newText: 'https://anonymized.invalid/[URL_1]' },
      ],
      { keepMetadata: true },
      { embeddedParts: /^demo\/embeddings\// },
    );
    expect(changedParts.sort()).toEqual(['demo/_rels/slide1.xml.rels', 'demo/slide1.xml']);
    expect(removedParts).toEqual([]);
    const slide = readXmlEntry(/** @type {any} */ (readZip(out).find((e) => e.name === 'demo/slide1.xml')));
    expect(slide).toContain('<a:r><a:t>тел. </a:t></a:r><a:r><a:t>[ТЕЛЕФОН_1]</a:t></a:r>');
    expect(readXmlEntry(/** @type {any} */ (readZip(out).find((e) => e.name === 'demo/_rels/slide1.xml.rels')))).toContain(
      'Target="https://anonymized.invalid/[URL_1]"',
    );
    const before = new Map(readZip(bytes).map((e) => [e.name, e.raw]));
    for (const e of readZip(out)) if (!changedParts.includes(e.name)) expect(Buffer.from(e.raw).equals(Buffer.from(before.get(e.name))), e.name).toBe(true);
    expect(readZip(out).map((e) => e.name)).toEqual(readZip(bytes).map((e) => e.name));
    expect(doc.streams[1].text).toBe('тел. +7 900');
  });

  it('keepMetadata: false — docProps очищены, custom.xml удалён вместе с Override и связью (FR-12); stripEmbedded — записи и раны (FR-15)', () => {
    const { bytes: out, removedParts } = serializePackage(doc, [], { keepMetadata: false, stripEmbedded: true }, { embeddedParts: /^demo\/embeddings\// });
    expect(removedParts.sort()).toEqual(['demo/embeddings/ole1.bin', 'docProps/custom.xml']);
    const get = (n) => {
      const e = readZip(out).find((x) => x.name === n);
      return e ? readXmlEntry(e) : null;
    };
    expect(get('docProps/custom.xml')).toBeNull();
    expect(get('docProps/core.xml')).toBe('<cp:coreProperties><dc:creator></dc:creator><dc:title></dc:title></cp:coreProperties>');
    expect(get('[Content_Types].xml')).not.toMatch(/custom\.xml|ole1\.bin/);
    expect(get('_rels/.rels')).not.toContain('custom.xml');
    expect(get('demo/_rels/slide1.xml.rels')).not.toContain('ole1.bin');
    expect(get('demo/slide1.xml')).not.toContain('graphicData');
  });

  it('неизвестный поток, диапазон вне потока, пересекающиеся правки — INTERNAL', () => {
    const d = { embeddedParts: /^$/ };
    expect(() => serializePackage(doc, [{ streamId: 'нет', start: 0, end: 1, newText: '' }], {}, d)).toThrow(/Неизвестный поток/);
    expect(() => serializePackage(doc, [{ streamId: 'p0:live', start: 0, end: 999, newText: '' }], {}, d)).toThrow(/Диапазон вне потока/);
    expect(() =>
      serializePackage(
        doc,
        [
          { streamId: 'p0:live', start: 0, end: 5, newText: 'a' },
          { streamId: 'p0:live', start: 3, end: 7, newText: 'b' },
        ],
        {},
        d,
      ),
    ).toThrow(/Пересекающиеся/);
  });
});

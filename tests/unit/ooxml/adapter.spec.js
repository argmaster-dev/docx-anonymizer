// DocumentAdapter (ТЗ §5.3; версия 0.5, WP12-A, docs/contracts.md §9): Word — первый адаптер общего слоя OOXML, реестр форматов,
// распознавание по сигнатуре и имени; applyDecisions выбирает сериализатор по doc.kind.
import { describe, it, expect } from 'vitest';
import { DOCX_ADAPTER, DOCX_MIME } from '../../../src/core/docx/adapter.js';
import { DOCUMENT_ADAPTERS, adapterForKind, detectAdapter } from '../../../src/core/adapters.js';
import { isZip, zipHasEntry, hasExtension } from '../../../src/core/ooxml/adapter.js';
import { parseDocx, partRank, WORDML } from '../../../src/core/docx/model.js';
import { serializeDocx } from '../../../src/core/docx/replace.js';
import { applyDecisions } from '../../../src/core/apply.js';
import { writeZip } from '../../../src/core/ooxml/zip.js';
import { makeDocx, para, run } from '../../helpers/docx.js';
import { buildSampleDocx } from '../../../scripts/make-sample.mjs';
import { enc } from './markups.js';

describe('адаптер Word', () => {
  it('поля интерфейса: kind, расширения, MIME, detect, parse, serialize, parts', () => {
    expect(DOCX_ADAPTER).toMatchObject({ kind: 'docx', extensions: ['.docx', '.docm'], mime: DOCX_MIME });
    for (const f of ['detect', 'parse', 'serialize', 'parts']) expect(typeof DOCX_ADAPTER[f], f).toBe('function');
    expect(DOCX_ADAPTER.parse).toBe(parseDocx);
    expect(DOCX_ADAPTER.serialize).toBe(serializeDocx);
    expect(Object.isFrozen(DOCX_ADAPTER)).toBe(true);
    expect(WORDML.paragraph).toBe('w:p');
  });

  it('parse → doc.kind docx; parts — части с текстом в порядке обхода FR-25', () => {
    const { bytes } = buildSampleDocx();
    const doc = DOCX_ADAPTER.parse(bytes);
    expect(doc.kind).toBe('docx');
    const names = [
      'docProps/core.xml',
      'word/styles.xml',
      'word/footer1.xml',
      'word/header10.xml',
      'word/header2.xml',
      'word/document.xml',
      'word/_rels/document.xml.rels',
      'word/comments.xml',
      'word/media/a.png',
    ];
    const parts = DOCX_ADAPTER.parts(names);
    expect(parts).toEqual([
      'word/document.xml',
      'word/header2.xml',
      'word/header10.xml',
      'word/footer1.xml',
      'word/comments.xml',
      'word/_rels/document.xml.rels',
      'docProps/core.xml',
    ]);
    expect(parts.map(partRank)).toEqual([...parts.map(partRank)].sort((a, b) => a - b));
  });

  it('detect: ZIP с word/document.xml или имя .docx/.docm; прочее — нет', () => {
    const docx = makeDocx(para(run('текст')));
    const xlsxLike = writeZip([{ name: 'xl/workbook.xml', data: enc('<workbook/>') }]);
    expect(DOCX_ADAPTER.detect(docx)).toBe(true);
    expect(DOCX_ADAPTER.detect(docx, 'файл.bin')).toBe(true);
    expect(DOCX_ADAPTER.detect(enc('мусор'), 'ДОГОВОР.DOCX')).toBe(true); // разбор ответит NOT_DOCX
    expect(DOCX_ADAPTER.detect(enc('мусор'), 'a.docm')).toBe(true);
    expect(DOCX_ADAPTER.detect(xlsxLike, 'книга.xlsx')).toBe(false);
    expect(DOCX_ADAPTER.detect(enc('%PDF-1.7'), 'a.pdf')).toBe(false);
  });
});

describe('реестр адаптеров', () => {
  it('в 0.5 до WP12-B — только Word; adapterForKind: модель без kind — Word, неизвестный вид — null', () => {
    expect(DOCUMENT_ADAPTERS.map((a) => a.kind)).toEqual(['docx']);
    expect(adapterForKind('docx')).toBe(DOCX_ADAPTER);
    expect(adapterForKind(undefined)).toBe(DOCX_ADAPTER);
    expect(adapterForKind('xlsx')).toBeNull();
    expect(detectAdapter(makeDocx(para(run('x'))), 'x.bin')).toBe(DOCX_ADAPTER);
    expect(detectAdapter(enc('просто текст'), 'notes.txt')).toBeNull();
  });

  it('помощники: isZip, zipHasEntry (битый ZIP — false), hasExtension без учёта регистра', () => {
    const z = writeZip([{ name: 'a/b.xml', data: enc('<b/>') }]);
    expect(isZip(z)).toBe(true);
    expect(isZip(enc('PK'))).toBe(false);
    expect(zipHasEntry(z, 'a/b.xml')).toBe(true);
    expect(zipHasEntry(z, 'a/c.xml')).toBe(false);
    expect(zipHasEntry(z.slice(0, 40), 'a/b.xml')).toBe(false);
    expect(hasExtension('Отчёт.XLSX', ['.xlsx'])).toBe(true);
    expect(hasExtension(undefined, ['.xlsx'])).toBe(false);
  });

  it('applyDecisions: сериализатор и MIME — адаптера вида документа; неизвестный вид — INTERNAL', () => {
    const doc = parseDocx(makeDocx(para(run('текст'))));
    const r = applyDecisions(doc, [], { createdAt: '2026-10-26T00:00:00Z' });
    expect(r.mime).toBe(DOCX_MIME);
    expect(Buffer.from(r.bytes).equals(Buffer.from(serializeDocx(doc, [], {}).bytes))).toBe(true);
    expect(() => applyDecisions({ ...doc, kind: 'xlsx' }, [], {})).toThrow(expect.objectContaining({ code: 'INTERNAL' }));
  });
});

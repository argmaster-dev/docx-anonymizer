// Хост и форматы 0.5 (WP12-B, docs/contracts.md §9.8): Excel, PowerPoint и текстовые форматы через протокол §5.4 — модуль формата
// по требованию грузится перед разбором (сбой — FORMAT_LOAD_FAILED, повтор работает), ENTITIES.kind, предупреждения формата,
// имя и MIME результата того же формата, вкладка «Текст»; нераспознанный файл — NOT_SUPPORTED (DOCX — по-прежнему NOT_DOCX).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHost, makeResultName } from '../../src/offscreen/host.js';
import { MSG, postChunked, ChunkAssembler } from '../../src/shared/protocol.js';
import { defaultSettings, loadAdapter } from '../../src/core/index.js';
import { createValidator } from '../helpers/jsonschema.js';

const DIR = 'tests/fixtures/office';
const schema = JSON.parse(readFileSync('schemas/protocol.schema.json', 'utf8'));
const { validate } = createValidator({ 'protocol.schema.json': schema });
/** сообщение по схеме протокола: свой $defs и общий oneOf (как tests/integration/schemas.spec.js) */
const check = (m) => [...validate({ $ref: `#/$defs/${m.type}` }, m, schema), ...validate(schema, m)];

function setup(env = {}) {
  const out = [];
  const host = createHost({ post: (clientId, msg) => out.push({ clientId, ...msg }), ...env });
  const settings = defaultSettings();
  const send = (msg) => host.handle('c1', { settings, ...msg });
  async function upload(requestId, bytes, name) {
    const msgs = [];
    postChunked((m) => msgs.push(m), { requestId, kind: 'FILE', bytes, meta: { name } });
    for (const m of msgs) await send(m);
    await send({ type: MSG.ANALYZE, requestId });
    return out.filter((m) => m.requestId === requestId);
  }
  async function apply(requestId, docId) {
    await send({ type: MSG.APPLY, requestId, docId, decisions: [] });
    const res = out.filter((m) => m.requestId === requestId);
    const begin = res.find((m) => m.type === MSG.RESULT_BEGIN);
    const asm = new ChunkAssembler(begin);
    for (const m of res.filter((x) => x.type === MSG.RESULT_CHUNK)) asm.add(m.index, m.data);
    return { begin, bytes: asm.result(), end: res.find((m) => m.type === MSG.RESULT_END) };
  }
  return { out, send, upload, apply };
}
const file = (n) => new Uint8Array(readFileSync(join(DIR, n)));

describe('хост: форматы 0.5', () => {
  it.each([
    [
      'statement.xlsx',
      'Ведомость.xlsx',
      'xlsx',
      'Ведомость.anon.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'XLSX_CELL_REFERENCED',
    ],
    ['deck-sales.pptx', 'Итоги.PPTX', 'pptx', 'Итоги.anon.PPTX', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', null],
    ['clients-semicolon-cp1251.csv', 'выгрузка.csv', 'plain', 'выгрузка.anon.csv', 'text/csv', null],
    ['crm-export.json', 'crm.json', 'plain', 'crm.anon.json', 'application/json', 'JSON_NUMBER_AS_STRING'],
  ])('%s: ENTITIES.kind %s, предупреждения формата, результат того же формата', async (fx, name, kind, resultName, mime, warning) => {
    const { upload, apply } = setup();
    const ent = (await upload('r1', file(fx), name)).find((m) => m.type === MSG.ENTITIES);
    expect(ent).toBeTruthy();
    expect(ent.kind).toBe(kind);
    expect(ent.entities.length).toBeGreaterThan(3);
    if (warning) expect(ent.warnings.map((w) => w.code)).toContain(warning);
    expect(check(ent)).toEqual([]);
    const r = await apply('r2', ent.docId);
    expect(r.begin.name).toBe(resultName);
    expect(r.begin.mime).toBe(mime);
    expect(r.end.mapping.entries.length).toBeGreaterThan(3);
    // результат разбирается тем же адаптером
    const ad = await loadAdapter(kind);
    expect(ad.parse(r.bytes, resultName).kind).toBe(kind);
  });

  it('вкладка «Текст»: у книги — общие строки и листы, у презентации — слайды и заметки', async () => {
    const { upload, send, out } = setup();
    const x = (await upload('r1', file('crm-export.xlsx'), 'crm.xlsx')).find((m) => m.type === MSG.ENTITIES);
    await send({ type: MSG.GET_TEXT, requestId: 't1', docId: x.docId });
    const tx = out.find((m) => m.requestId === 't1');
    expect(tx.total).toBeGreaterThan(10);
    expect(tx.paragraphs.some((p) => p.spans.length)).toBe(true);
    const p = (await upload('r2', file('deck-notes.pptx'), 'deck.pptx')).find((m) => m.type === MSG.ENTITIES);
    await send({ type: MSG.GET_TEXT, requestId: 't2', docId: p.docId });
    expect(out.find((m) => m.requestId === 't2').paragraphs.map((q) => q.text)).toContain('Кадровый резерв');
  });

  it('ADD_ENTITY в книге: переанализ сохраняет предупреждения формата', async () => {
    const { upload, send, out } = setup();
    const ent = (await upload('r1', file('statement.xlsx'), 's.xlsx')).find((m) => m.type === MSG.ENTITIES);
    await send({ type: MSG.ADD_ENTITY, requestId: 'a1', docId: ent.docId, category: 'PERSON', text: 'Итого' });
    const upd = out.find((m) => m.requestId === 'a1' && m.type === MSG.ENTITIES);
    expect(upd.warnings.map((w) => w.code)).toContain('XLSX_CELL_REFERENCED');
    expect(upd.entities.some((e) => e.value === 'Итого' && e.source === 'user')).toBe(true);
  });

  it('не распознан — NOT_SUPPORTED; битый .xlsx — NOT_SUPPORTED; битый .docx — по-прежнему NOT_DOCX', async () => {
    const { upload } = setup();
    const err = async (bytes, name) => (await upload(name, bytes, name)).find((m) => m.type === MSG.ERROR)?.code;
    expect(await err(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]), 'фото.png')).toBe('NOT_SUPPORTED');
    expect(await err(new TextEncoder().encode('не zip, а текст'), 'книга.xlsx')).toBe('NOT_SUPPORTED');
    expect(await err(new TextEncoder().encode('не zip, а текст'), 'слайды.pptx')).toBe('NOT_SUPPORTED');
    expect(await err(new TextEncoder().encode('не zip, а текст'), 'договор.docx')).toBe('NOT_DOCX');
  });

  it('модуль формата не загрузился — FORMAT_LOAD_FAILED (не INTERNAL); следующая попытка загружает заново', async () => {
    let fail = true;
    const { upload } = setup({
      loadAdapter: async (entry) => {
        if (fail) throw new Error('chunk 404');
        return loadAdapter(entry);
      },
    });
    const first = await upload('r1', file('crm-export.xlsx'), 'crm.xlsx');
    expect(first.find((m) => m.type === MSG.ERROR)).toMatchObject({ code: 'FORMAT_LOAD_FAILED' });
    fail = false;
    const second = await upload('r2', file('crm-export.xlsx'), 'crm.xlsx');
    expect(second.find((m) => m.type === MSG.ENTITIES)?.kind).toBe('xlsx');
  });

  it('makeResultName: тот же формат и регистр расширения; без расширения — .docx; PDF — с ext', () => {
    expect(makeResultName('реестр.xlsx')).toBe('реестр.anon.xlsx');
    expect(makeResultName('макрос.XLSM', '.x')).toBe('макрос.x.XLSM');
    expect(makeResultName('Итоги.pptx')).toBe('Итоги.anon.pptx');
    expect(makeResultName('выгрузка.csv')).toBe('выгрузка.anon.csv');
    expect(makeResultName('a.b.json')).toBe('a.b.anon.json');
    expect(makeResultName('журнал.log')).toBe('журнал.anon.log');
    expect(makeResultName('заметки.md')).toBe('заметки.anon.md');
    expect(makeResultName('без')).toBe('без.anon.docx');
    expect(makeResultName('a.pdf', '.anon', { ext: '.md' })).toBe('a.anon.md');
  });
});

describe('хост: книга без расширения в имени', () => {
  it('распознана по содержимому — результат с расширением формата, а не .docx', async () => {
    const { upload, apply } = setup();
    const ent = (await upload('r1', file('crm-export.xlsx'), 'blob')).find((m) => m.type === MSG.ENTITIES);
    expect(ent.kind).toBe('xlsx');
    expect((await apply('r2', ent.docId)).begin.name).toBe('blob.anon.xlsx');
  });
});

// Ключ восстановления нельзя отправить в ИИ-чат (версия 0.5.1, FR-27, FR-29, NFR-01; src/core/recovery-key.js): открытая карта и
// зашифрованный паролем ключ узнаются по содержимому — под своим именем, переименованные (.txt, .md, .log), в Windows-1251, UTF-16,
// с BOM, в блоке кода Markdown; JSON с полем entries иной формы и обычные выгрузки — не ключ. Хост отказывает кодом RECOVERY_KEY
// (ошибка по схеме протокола), обычный JSON разбирается как прежде. Данные — вымышленные (tests/fixtures/deanon.json).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { hasKeyFileName, isOpenMapping, isRecoveryKeyFile, isRecoveryKeyObject, isRecoveryKeyText } from '../../src/core/recovery-key.js';
import { encryptMapping } from '../../src/core/key-crypto.js';
import { encodeText } from '../../src/core/plain/encoding.js';
import { isKeyFileName } from '../../src/content/files.js';
import { createHost } from '../../src/offscreen/host.js';
import { MSG, postChunked, ERROR_CODES } from '../../src/shared/protocol.js';
import { ERROR_CODES as CORE_CODES } from '../../src/core/errors.js';
import { defaultSettings } from '../../src/core/settings.js';
import { common } from '../../src/ui/i18n/common.js';
import { panel } from '../../src/ui/i18n/panel.js';
import { createValidator } from '../helpers/jsonschema.js';

const MAPPING = JSON.parse(readFileSync(new URL('../fixtures/deanon.json', import.meta.url), 'utf8')).mapping;
const KEY_TEXT = JSON.stringify(MAPPING, null, 2);
const utf8 = (s) => new TextEncoder().encode(s);
const cp1251 = (s) => encodeText(s, { encoding: 'windows-1251', bom: false });
const utf16 = (s) => encodeText(s, { encoding: 'utf-16le', bom: true });
const utf8bom = (s) => encodeText(s, { encoding: 'utf-8', bom: true });

describe('распознавание ключа восстановления', () => {
  it('открытая карта: под своим именем и переименованная, в любой кодировке', () => {
    expect(isOpenMapping(MAPPING)).toBe(true);
    for (const [bytes, name] of [
      [utf8(KEY_TEXT), 'договор.mapping.json'],
      [utf8(KEY_TEXT), 'заметки.txt'],
      [utf8(KEY_TEXT), 'ответ.md'],
      [utf8(KEY_TEXT), 'журнал.log'],
      [utf8(KEY_TEXT), 'данные.json'],
      [utf8(JSON.stringify(MAPPING)), 'без-отступов.csv'],
      [cp1251(KEY_TEXT), 'ключ-1251.txt'],
      [utf16(KEY_TEXT), 'ключ-utf16.json'],
      [utf8bom(KEY_TEXT), 'ключ-bom.json'],
      [utf8(KEY_TEXT), ''],
    ])
      expect(isRecoveryKeyFile(bytes, name), name).toBe(true);
  });

  it('ключ внутри текста: блок кода Markdown, подпись в .txt; массив ключей', () => {
    expect(isRecoveryKeyText(`# Мой ключ\n\n\`\`\`json\n${KEY_TEXT}\n\`\`\`\n`)).toBe(true);
    expect(isRecoveryKeyText(`Ключ от договора:\n${KEY_TEXT}\nне терять`)).toBe(true);
    expect(isRecoveryKeyObject([MAPPING, MAPPING])).toBe(true);
  });

  it('урезанная карта (только entries с метками «[ФИО_1]», как принимает страница «Восстановить») — ключ', () => {
    const slim = { entries: MAPPING.entries.map((e) => ({ token: e.token, value: e.value })) };
    expect(isRecoveryKeyText(JSON.stringify(slim))).toBe(true);
    // пустая карта нашего формата — тоже ключ: в ней имена документов
    expect(isOpenMapping({ ...MAPPING, entries: [] })).toBe(true);
  });

  it('зашифрованный паролем ключ — по содержимому, под любым именем', async () => {
    const enc = await encryptMapping(MAPPING, 'Пароль-для-теста-1', { iterations: 600000 });
    const text = JSON.stringify(enc, null, 2);
    expect(isRecoveryKeyObject(enc)).toBe(true);
    expect(isRecoveryKeyFile(utf8(text), 'договор.mapping.json')).toBe(true);
    expect(isRecoveryKeyFile(utf8(text), 'просто.txt')).toBe(true);
    // в зашифрованном ключе нет исходных значений, но отправлять его всё равно нельзя: слабый пароль подбирается
    expect(text).not.toContain(MAPPING.entries[0].value);
  });

  it('похожий, но не ключ: entries иной формы, пустой entries, token без меток и полей карты', () => {
    for (const obj of [
      { entries: [{ id: 1, title: 'Заметка', text: 'Купить хлеб' }] },
      { entries: [] },
      {
        entries: [
          { token: 'abc123', value: 'session' },
          { token: 'def456', value: 'session' },
        ],
      }, // токены API, а не метки
      { entries: [{ token: '[ФИО_1]', value: 'Иванов' }, 1, 2, 3, 'x'] }, // меньше половины записей — записи карты
      { entries: 'Иванов' },
      { ct: 'abc', note: 'не шифр' },
      { schemaVersion: 1, entries: [] },
    ])
      expect(isRecoveryKeyText(JSON.stringify(obj)), JSON.stringify(obj)).toBe(false);
    expect(isRecoveryKeyText('{"entries": [ битый JSON')).toBe(false);
    expect(isRecoveryKeyText('Обычный текст без JSON')).toBe(false);
  });

  it('имя «*.mapping.json» — дополнительный признак: с ним хватает ослабленной формы, без него — нет', () => {
    const loose = JSON.stringify({ entries: [{ token: 'abc123', value: 'Иванов' }] });
    expect(isRecoveryKeyFile(utf8(loose), 'dogovor.mapping.json')).toBe(true);
    expect(isRecoveryKeyFile(utf8(loose), 'dogovor.json')).toBe(false);
    // обрезанный ключ (битый JSON) с именем ключа — ключ; без имени — нет
    const cut = KEY_TEXT.slice(0, Math.floor(KEY_TEXT.length / 2));
    expect(isRecoveryKeyFile(utf8(cut), 'x.mapping.json')).toBe(true);
    expect(isRecoveryKeyFile(utf8(cut), 'x.txt')).toBe(false);
    expect(hasKeyFileName('Договор.MAPPING.JSON')).toBe(true);
    expect(hasKeyFileName('mapping.json.txt')).toBe(false);
    expect(isKeyFileName({ name: 'a.anon.mapping.json' })).toBe(true);
    expect(isKeyFileName({ name: 'a.json' })).toBe(false);
    expect(isKeyFileName(null)).toBe(false);
  });

  it('обычные текстовые фикстуры (JSON-выгрузки, CSV, Markdown, gold) — не ключи', () => {
    const files = [];
    const walk = (d) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (e === 'private') continue; // tests/fixtures/private не читаем
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(json|txt|md|csv|log)$/i.test(e)) files.push(p);
      }
    };
    walk('tests/fixtures');
    expect(files.length).toBeGreaterThan(50);
    // deanon.json содержит карту под полем mapping — это тестовые данные, а не файл ключа: верхний уровень не карта
    for (const p of files) expect(isRecoveryKeyFile(new Uint8Array(readFileSync(p)), p), p).toBe(false);
  });
});

describe('хост: ключ восстановления — отказ RECOVERY_KEY', () => {
  const schema = JSON.parse(readFileSync('schemas/protocol.schema.json', 'utf8'));
  const { validate } = createValidator({ 'protocol.schema.json': schema });

  async function upload(bytes, name) {
    const out = [];
    const host = createHost({ post: (_c, msg) => out.push(msg) });
    const settings = defaultSettings();
    const msgs = [];
    postChunked((m) => msgs.push(m), { requestId: 'r1', kind: 'FILE', bytes, meta: { name } });
    for (const m of msgs) await host.handle('c1', { settings, ...m });
    await host.handle('c1', { settings, type: MSG.ANALYZE, requestId: 'r1' });
    return out.filter((m) => m.requestId === 'r1');
  }

  it.each([
    ['договор.mapping.json', utf8(KEY_TEXT)],
    ['переименован.txt', utf8(KEY_TEXT)],
    ['ключ-1251.md', cp1251(KEY_TEXT)],
  ])('%s: ERROR RECOVERY_KEY по схеме, без сущностей и без значений в сообщении', async (name, bytes) => {
    const res = await upload(bytes, name);
    expect(res.some((m) => m.type === MSG.ENTITIES)).toBe(false);
    const err = res.find((m) => m.type === MSG.ERROR);
    expect(err.code).toBe('RECOVERY_KEY');
    expect([...validate({ $ref: '#/$defs/ERROR' }, err, schema), ...validate(schema, err)]).toEqual([]);
    for (const e of MAPPING.entries) expect(JSON.stringify(err)).not.toContain(e.value);
  });

  it('обычный JSON с полем entries иной формы разбирается как прежде', async () => {
    const json = JSON.stringify({ entries: [{ id: 1, fio: 'Сидорова Мария Олеговна', phone: '+7 900 123-45-67' }] }, null, 2);
    const res = await upload(utf8(json), 'выгрузка.json');
    expect(res.find((m) => m.type === MSG.ERROR)).toBeUndefined();
    expect(res.find((m) => m.type === MSG.ENTITIES).entities.length).toBeGreaterThan(0);
  });

  it('код RECOVERY_KEY есть в ядре, протоколе и текстах ru/en панели', () => {
    expect(ERROR_CODES).toContain('RECOVERY_KEY');
    expect(CORE_CODES.RECOVERY_KEY).toBe('RECOVERY_KEY');
    expect(common.ru['err.RECOVERY_KEY']).toBe('Это ключ восстановления (карта замен) — в нём настоящие значения. Его нельзя отправлять в ИИ-сервис.');
    expect(common.en['err.RECOVERY_KEY']).toMatch(/recovery key.*must not be sent/);
    expect(panel.ru.keyBlockedNote).toBeTruthy();
    expect(Object.keys(panel.en).sort()).toEqual(Object.keys(panel.ru).sort());
  });
});

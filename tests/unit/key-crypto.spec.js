// Шифрование ключа восстановления паролем (версия 0.5, WP12-D, Ц5, К8; src/core/key-crypto.js, docs/contracts.md §9.9):
// верный пароль расшифровывает; неверный и повреждённые ct/iv — KEY_PASSWORD без частичного результата; в файле нет ни одного
// исходного значения ни в каком виде; параметры KDF не ниже требования; формат — по схеме schemas/mapping.schema.json.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  encryptMapping,
  decryptMapping,
  isEncryptedKey,
  KeyCryptoError,
  KDF_ITERATIONS,
  KDF_MIN_ITERATIONS,
  KEY_ENC,
  KEY_ENC_VERSION,
} from '../../src/core/key-crypto.js';
import { readMappingFiles, parseMappingFiles } from '../../src/ui/deanon/index.js';
import { createValidator } from '../helpers/jsonschema.js';

const fx = JSON.parse(readFileSync(new URL('../fixtures/deanon.json', import.meta.url), 'utf8'));
const MAPPING = fx.mapping;
const PASSWORD = 'Ёлка-2026 зимняя';
const mappingSchema = JSON.parse(readFileSync(new URL('../../schemas/mapping.schema.json', import.meta.url), 'utf8'));
const { validate } = createValidator({ 'mapping.schema.json': mappingSchema });

/** Все строки карты (значения, варианты, метки, имена документов) — их не должно быть в зашифрованном файле. */
function secretsOf(m) {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === 'string' && v.length >= 3) out.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(m.entries);
  walk(m.documents);
  return [...out];
}

/** Все представления текста файла, в которых могло бы проступить значение. */
function views(text) {
  const out = [text, text.toLowerCase()];
  const obj = JSON.parse(text);
  for (const f of [obj.ct, obj.iv, obj.kdf.salt]) {
    const raw = Buffer.from(f, 'base64');
    out.push(raw.toString('utf8'), raw.toString('latin1'), new TextDecoder('utf-16le').decode(raw), new TextDecoder('windows-1251').decode(raw));
  }
  return out;
}

let enc;
beforeAll(async () => {
  enc = await encryptMapping(MAPPING, PASSWORD);
});

describe('шифрование ключа (К8)', () => {
  it('верный пароль — та же карта; формат и параметры по схеме', async () => {
    expect(await decryptMapping(enc, PASSWORD)).toEqual(MAPPING);
    expect(isEncryptedKey(enc)).toBe(true);
    expect(isEncryptedKey(MAPPING)).toBe(false);
    expect(validate(mappingSchema, enc)).toEqual([]);
    expect(Object.keys(enc).sort()).toEqual(['ct', 'enc', 'encVersion', 'iv', 'kdf']);
  });

  it('параметры KDF не ниже требования: PBKDF2-SHA-256, ≥ 600 000 итераций, соль 16 байт; AES-GCM-256, IV 12 байт', () => {
    expect(enc.encVersion).toBe(KEY_ENC_VERSION);
    expect(enc.enc).toBe('AES-GCM-256');
    expect(KEY_ENC).toBe('AES-GCM-256');
    expect(enc.kdf.name).toBe('PBKDF2');
    expect(enc.kdf.hash).toBe('SHA-256');
    expect(enc.kdf.iterations).toBe(KDF_ITERATIONS);
    expect(KDF_ITERATIONS).toBeGreaterThanOrEqual(600000);
    expect(KDF_MIN_ITERATIONS).toBeGreaterThanOrEqual(600000);
    expect(Buffer.from(enc.kdf.salt, 'base64')).toHaveLength(16);
    expect(Buffer.from(enc.iv, 'base64')).toHaveLength(12);
    // шифротекст = данные + тег GCM (16 байт)
    expect(Buffer.from(enc.ct, 'base64').length).toBe(new TextEncoder().encode(JSON.stringify(MAPPING)).length + 16);
  });

  it('соль и IV случайны: два шифрования одной карты различаются', async () => {
    const again = await encryptMapping(MAPPING, PASSWORD);
    expect(again.kdf.salt).not.toBe(enc.kdf.salt);
    expect(again.iv).not.toBe(enc.iv);
    expect(again.ct).not.toBe(enc.ct);
  });

  it('в зашифрованном файле нет ни одного исходного значения ни в каком виде', () => {
    const text = JSON.stringify(enc, null, 2);
    const hay = views(text).map((s) => s.toLowerCase());
    const secrets = secretsOf(MAPPING);
    expect(secrets.length).toBeGreaterThan(5);
    for (const v of secrets) for (const h of hay) expect(h.includes(v.toLowerCase()), v).toBe(false);
    // ни меток, ни имён полей карты
    expect(text).not.toMatch(/entries|placeholder|ФИО|КОМПАНИЯ|ИНН/);
  });

  it('неверный пароль — KEY_PASSWORD, без частичного результата', async () => {
    for (const bad of ['ёлка-2026 зимняя', `${PASSWORD} `, 'x']) {
      const err = await decryptMapping(enc, bad).catch((e) => e);
      expect(err).toBeInstanceOf(KeyCryptoError);
      expect(err.code).toBe('KEY_PASSWORD');
      expect(String(err.message)).not.toContain(PASSWORD);
    }
    expect((await decryptMapping(enc, '').catch((e) => e)).code).toBe('KEY_PASSWORD');
  });

  it('пароль в разной нормальной форме Unicode (NFC/NFD) — один ключ', async () => {
    expect(await decryptMapping(enc, PASSWORD.normalize('NFD'))).toEqual(MAPPING);
  });

  it('повреждённые ct / iv / соль — ошибка без вывода', async () => {
    const flip = (b64, i = 0) => {
      const b = Buffer.from(b64, 'base64');
      b[i] ^= 1;
      return b.toString('base64');
    };
    const cases = [
      { ...enc, ct: flip(enc.ct) },
      { ...enc, ct: flip(enc.ct, Buffer.from(enc.ct, 'base64').length - 1) }, // тег
      { ...enc, iv: flip(enc.iv) },
      { ...enc, kdf: { ...enc.kdf, salt: flip(enc.kdf.salt) } },
      { ...enc, kdf: { ...enc.kdf, iterations: enc.kdf.iterations + 1 } },
    ];
    for (const c of cases) {
      const err = await decryptMapping(c, PASSWORD).catch((e) => e);
      expect(err.code, JSON.stringify(Object.keys(c))).toBe('KEY_PASSWORD');
    }
    const invalid = [
      { ...enc, iv: enc.iv.slice(0, 8) }, // не 12 байт
      { ...enc, ct: '!!!' },
      { ...enc, ct: Buffer.alloc(8).toString('base64') },
      { ...enc, kdf: { ...enc.kdf, iterations: 1000 } }, // ниже требования — не принимается
      { ...enc, kdf: { ...enc.kdf, iterations: 1e9 } }, // подвесил бы страницу
      { ...enc, kdf: { ...enc.kdf, hash: 'SHA-1' } },
      { ...enc, enc: 'AES-CBC-256' },
      { ...enc, encVersion: 2 },
      MAPPING,
    ];
    for (const c of invalid) expect((await decryptMapping(c, PASSWORD).catch((e) => e)).code).toBe('KEY_INVALID');
  });

  it('итераций меньше 600 000 при сохранении не бывает', async () => {
    const err = await encryptMapping(MAPPING, PASSWORD, { iterations: 100000 }).catch((e) => e);
    expect(err.code).toBe('KEY_INVALID');
  });
});

describe('страница восстановления: файлы ключа (readMappingFiles)', () => {
  it('открытый ключ — как раньше; зашифрованный без пароля — просьба пароля', async () => {
    const plain = JSON.stringify(MAPPING);
    expect((await readMappingFiles([plain])).mapping.entries).toHaveLength(MAPPING.entries.length);
    const r = await readMappingFiles([JSON.stringify(enc)]);
    expect(r.needPassword).toBe(true);
    expect(r.mapping).toBeUndefined();
    // прежний синхронный разбор зашифрованный ключ не принимает за карту
    expect(parseMappingFiles([JSON.stringify(enc)]).error).toBe('shape');
  });

  it('верный пароль — карта; неверный — error: password (KEY_PASSWORD) без карты; смешанный набор файлов', async () => {
    const ok = await readMappingFiles([JSON.stringify(enc)], PASSWORD);
    expect(ok.mapping.entries).toHaveLength(MAPPING.entries.length);
    expect(ok.encrypted).toBe(1);
    const bad = await readMappingFiles([JSON.stringify(enc)], 'не тот');
    expect(bad).toMatchObject({ error: 'password', code: 'KEY_PASSWORD' });
    expect(bad.mapping).toBeUndefined();
    const second = { ...MAPPING, documents: [{ name: 'второй.docx' }] };
    const mixed = await readMappingFiles([JSON.stringify(enc), JSON.stringify(second)], PASSWORD);
    expect(mixed.mapping.documents).toHaveLength(MAPPING.documents.length + 1);
    expect((await readMappingFiles(['{не json'], PASSWORD)).error).toBe('json');
  });
});

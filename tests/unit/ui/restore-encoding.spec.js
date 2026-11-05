// Кодировка на странице «Восстановить» (версия 0.5.1, FR-36а): .txt/.md/.log от ИИ читаются байтами и decodeText (BOM, UTF-16,
// строгий UTF-8, иначе Windows-1251), восстановленный файл пишется в исходной кодировке (и с BOM, если он был) — метки заменены,
// кириллица цела; ключ в Windows-1251 — понятная ошибка `encoding`, а не карта с «�». Данные вымышленные (tests/fixtures/deanon.json).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { encodeRestored, encodingLabel, keyTextsFromBytes, mimeFor, readAiText, readMappingFiles } from '../../../src/ui/deanon/index.js';
import { encodeText } from '../../../src/core/plain/encoding.js';
import { restoreText } from '../../../src/core/restore-doc.js';
import { RESTORE_DICT } from '../../../src/ui/i18n/restore.js';

const MAPPING = JSON.parse(readFileSync(new URL('../../fixtures/deanon.json', import.meta.url), 'utf8')).mapping;
const ANSWER = 'Договор с [КОМПАНИЯ_1] подписывает [ФИО_1].\r\nКопия — [ФИО_2]; итог: «готово».\r\n';

const ENCODINGS = [
  ['Windows-1251', { encoding: 'windows-1251', bom: false }, 'Windows-1251'],
  ['UTF-16 LE с BOM', { encoding: 'utf-16le', bom: true }, 'UTF-16'],
  ['UTF-16 BE с BOM', { encoding: 'utf-16be', bom: true }, 'UTF-16 BE'],
  ['UTF-8 с BOM', { encoding: 'utf-8', bom: true }, null],
  ['UTF-8', { encoding: 'utf-8', bom: false }, null],
];

describe('восстановление текстового файла в исходной кодировке', () => {
  it.each(ENCODINGS)('%s: метки заменены, байты — в той же кодировке', (_n, enc, label) => {
    const bytes = encodeText(ANSWER, enc);
    const read = readAiText(bytes);
    expect(read.encoding).toEqual(enc);
    expect(read.text).toBe(ANSWER); // без «�»
    const r = restoreText(read.text, MAPPING, { decline: true });
    expect(r.unresolved).toEqual([]);
    expect(r.text).toContain('Иванов Пётр Сергеевич');
    expect(r.text).not.toMatch(/\[ФИО_\d+\]|\[КОМПАНИЯ_\d+\]/);
    const out = encodeRestored(r.text, read.encoding);
    expect(out.lost).toBe(0);
    expect(Array.from(out.bytes)).toEqual(Array.from(encodeText(r.text, enc)));
    // байты читаются обратно в тот же текст и ту же кодировку: BOM сохранён, если был
    expect(readAiText(out.bytes)).toEqual({ text: r.text, encoding: enc });
    expect(encodingLabel(read.encoding)).toBe(label);
  });

  it('раньше (file.text(), всегда UTF-8) 1251 портился: кириллица → «�», метки не находились', () => {
    const bytes = encodeText(ANSWER, { encoding: 'windows-1251', bom: false });
    const broken = new TextDecoder('utf-8').decode(bytes);
    expect(broken).toContain('�');
    expect(restoreText(broken, MAPPING).replaced).toBeLessThan(restoreText(readAiText(bytes).text, MAPPING).replaced);
  });

  it('символы, которых нет в Windows-1251, считаются: страница предупреждает', () => {
    const out = encodeRestored('Café — 東京', { encoding: 'windows-1251', bom: false });
    expect(out.lost).toBe(3);
    expect(encodeRestored('Café', { encoding: 'utf-16le', bom: true }).lost).toBe(0);
  });

  it('MIME результата: charset по кодировке файла', () => {
    expect(mimeFor('ответ.restored.txt')).toBe('text/plain;charset=utf-8');
    expect(mimeFor('ответ.restored.txt', 'windows-1251')).toBe('text/plain;charset=windows-1251');
    expect(mimeFor('ответ.restored.md', 'utf-16le')).toBe('text/markdown;charset=utf-16le');
    expect(mimeFor('ответ.restored.docx', 'windows-1251')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  it('тексты предупреждения ru/en', () => {
    for (const lang of ['ru', 'en'])
      for (const k of ['enc_h', 'enc_saved', 'enc_lost', 'ai_file_encoding', 'key_encoding']) expect(RESTORE_DICT[lang][k], `${lang}.${k}`).toBeTruthy();
    expect(RESTORE_DICT.ru.enc_h).toContain('{enc}');
    expect(Object.keys(RESTORE_DICT.en).sort()).toEqual(Object.keys(RESTORE_DICT.ru).sort());
  });
});

describe('файл ключа: только UTF-8 (и UTF-16), Windows-1251 — понятная ошибка', () => {
  const text = JSON.stringify(MAPPING, null, 2);

  it('UTF-8, UTF-8 с BOM и UTF-16 читаются без потерь', async () => {
    for (const enc of [
      { encoding: 'utf-8', bom: false },
      { encoding: 'utf-8', bom: true },
      { encoding: 'utf-16le', bom: true },
    ]) {
      const r = keyTextsFromBytes([encodeText(text, enc)]);
      expect(r.texts).toEqual([text]);
      const m = await readMappingFiles(/** @type {string[]} */ (r.texts));
      expect(m.mapping.entries[0].value).toBe(MAPPING.entries[0].value);
    }
  });

  it('ключ, пересохранённый в Windows-1251, — error: encoding, без падения', () => {
    const r = keyTextsFromBytes([new TextEncoder().encode(text), encodeText(text, { encoding: 'windows-1251', bom: false })]);
    expect(r).toEqual({ error: 'encoding' });
    expect(RESTORE_DICT.ru.key_encoding).toMatch(/UTF-8/);
  });
});

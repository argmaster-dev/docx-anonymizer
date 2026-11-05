// Текстовые форматы 0.5.1 (ревью 0.5.1): .markdown и .text перехватываются и разбираются как .md и .txt; файл UTF-8 с немногими
// битыми байтами (обрезан посреди символа) при обезличивании читается как UTF-8 — не как Windows-1251 с порчей всего текста, —
// с предупреждением TEXT_BAD_BYTES. Данные вымышленные.
import { describe, it, expect } from 'vitest';
import { decodeText, encodeText, parsePlain, PLAIN_ADAPTER } from '../../src/core/plain/plain-adapter.js';
import { detectAdapter } from '../../src/core/adapters.js';
import { fileKind, makeResultName, mappingFileName } from '../../src/content/files.js';
import { aiFileKind, mimeFor } from '../../src/ui/deanon/index.js';
import { WARN_KEYS } from '../../src/ui/panel/panel.js';
import { panel } from '../../src/ui/i18n/panel.js';

const enc = new TextEncoder();

describe('.markdown и .text', () => {
  it('перехват, реестр адаптеров, имя результата и ключа, страница восстановления', () => {
    for (const name of ['заметки.markdown', 'ЗАМЕТКИ.TEXT']) {
      expect(fileKind({ name, type: '' }), name).toBe('text');
      expect(detectAdapter(enc.encode('x'), name)?.kind, name).toBe('plain');
      expect(PLAIN_ADAPTER.detect(enc.encode('x'), name), name).toBe(true);
      expect(aiFileKind(name), name).toBe('text');
    }
    expect(makeResultName('заметки.markdown')).toBe('заметки.anon.markdown');
    expect(makeResultName('заметки.text')).toBe('заметки.anon.text');
    expect(mappingFileName('заметки.anon.markdown')).toBe('заметки.mapping.json');
    expect(mimeFor('ответ.restored.text')).toBe('text/plain;charset=utf-8');
    // файлы без расширения и .jsonl не перехватываются (честно — в README и FR-29а)
    expect(fileKind({ name: 'выгрузка.jsonl', type: '' })).toBeNull();
    expect(fileKind({ name: 'README', type: 'text/plain' })).toBeNull();
  });

  it('разбор как .md и .txt: формат, MIME результата', () => {
    const md = parsePlain(enc.encode('# Заголовок\n\nИванов Пётр — директор.\n'), 'a.markdown');
    expect(md.format).toBe('md');
    expect(PLAIN_ADAPTER.serialize(md, []).mime).toBe('text/markdown');
    const txt = parsePlain(enc.encode('Строка 1\nСтрока 2\n'), 'a.text');
    expect(txt.format).toBe('txt');
    expect(PLAIN_ADAPTER.serialize(txt, []).mime).toBe('text/plain');
  });
});

describe('битый UTF-8 при обезличивании', () => {
  const body = 'Договор: Иванов Пётр Сергеевич, тел. +7 900 123-45-67.\n';

  it.each([
    ['байт 0xFF в конце', new Uint8Array([...enc.encode(body), 0xff])],
    ['обрезан посреди символа', enc.encode(`${body}ж`).slice(0, -1)],
  ])('%s: UTF-8 и предупреждение TEXT_BAD_BYTES, кириллица цела, неизменённые байты — как были', (_n, bytes) => {
    const d = decodeText(bytes);
    expect(d.encoding).toBe('utf-8');
    expect(d.replaced).toBe(1);
    const doc = parsePlain(bytes, 'заметки.txt');
    expect(doc.plain.encoding).toBe('utf-8');
    expect(doc.warnings).toContainEqual({ code: 'TEXT_BAD_BYTES', count: 1 });
    expect(doc.plain.text.startsWith(body)).toBe(true);
    // без правок результат — тот же текст в UTF-8; битый байт становится «�» (EF BF BD)
    const out = PLAIN_ADAPTER.serialize(doc, []);
    expect(new TextDecoder().decode(out.bytes)).toBe(`${body}�`);
  });

  it('правильный UTF-8 и Windows-1251 — без предупреждения; текст панели есть ru/en', () => {
    expect(parsePlain(enc.encode(body), 'a.txt').warnings).toEqual([]);
    const cp = parsePlain(encodeText(body, { encoding: 'windows-1251', bom: false }), 'a.txt');
    expect(cp.plain.encoding).toBe('windows-1251');
    expect(cp.warnings).toEqual([]);
    expect(WARN_KEYS.TEXT_BAD_BYTES).toBe('warnTextBadBytes');
    expect(panel.ru.warnTextBadBytes).toContain('{n}');
    expect(panel.en.warnTextBadBytes).toContain('{n}');
  });
});

// К6 (версия 0.5, WP12-C, `docs/concept-0.5.md`): части паспорта — серия и номер, орган выдачи, дата выдачи, код
// подразделения — получают разные метки; карта замен хранит у каждой своё значение; восстановление текста и файла
// подставляет в каждое место своё значение; предупреждение 0.3 «другие значения под одной меткой» для паспорта не возникает.
// Данные вымышленные.
import { describe, it, expect, beforeAll } from 'vitest';
import {
  parseDocx,
  analyze,
  applyDecisions,
  defaultSettings,
  clearDetectors,
  registerBuiltinDetectors,
  deanonymize,
  restoreDocx,
} from '../../src/core/index.js';
import { mixedValueWarnings } from '../../src/ui/deanon/index.js';
import { makeDocx, para, run } from '../helpers/docx.js';

const TEXT = 'Представитель: паспорт 45 05 123456, выдан ОВД района Лесной г. Энска 12.03.2005, код подразделения 770-001.';
const PARTS = { PASSPORT: '45 05 123456', PASSPORT_ISSUER: 'ОВД района Лесной г. Энска', PASSPORT_DATE: '12.03.2005', PASSPORT_DEPT: '770-001' };
const textOf = (bytes) =>
  parseDocx(bytes)
    .streams.filter((s) => s.type === 'live')
    .map((s) => s.text)
    .join('\n');

let doc;
let res;
beforeAll(async () => {
  clearDetectors();
  registerBuiltinDetectors();
  doc = parseDocx(makeDocx(para(run(TEXT))));
  const analysis = await analyze(doc, defaultSettings());
  res = applyDecisions(doc, analysis.groups, { mode: 'placeholder', placeholderLanguage: 'ru', createdAt: '2026-10-26T00:00:00Z' });
});

describe('К6: паспорт по частям', () => {
  it('четыре записи карты с разными метками, у каждой своё значение и нет «вариантов»', () => {
    const entries = res.mapping.entries.filter((e) => e.category in PARTS);
    // порядок карты — порядок каталога: номер, код подразделения, кем выдан, дата выдачи
    expect(entries.map((e) => [e.category, e.value, e.token])).toEqual([
      ['PASSPORT', PARTS.PASSPORT, '[ПАСПОРТ_1]'],
      ['PASSPORT_DEPT', PARTS.PASSPORT_DEPT, '[ПАСП_КОД_1]'],
      ['PASSPORT_ISSUER', PARTS.PASSPORT_ISSUER, '[ПАСП_ВЫДАН_1]'],
      ['PASSPORT_DATE', PARTS.PASSPORT_DATE, '[ПАСП_ДАТА_1]'],
    ]);
    expect(new Set(entries.map((e) => e.token)).size).toBe(4);
    for (const e of entries) expect(e.variants, e.category).toEqual([]);
    expect(mixedValueWarnings(res.mapping)).toEqual([]);
  });

  it('в обезличенном файле нет ни одной части паспорта, на их местах — четыре разные метки', () => {
    const out = textOf(res.bytes);
    for (const v of Object.values(PARTS)) expect(out).not.toContain(v);
    expect(out).toBe('Представитель: паспорт [ПАСПОРТ_1], выдан [ПАСП_ВЫДАН_1] [ПАСП_ДАТА_1], код подразделения [ПАСП_КОД_1].');
  });

  it('восстановление текста ответа ИИ: каждая метка — своё значение', () => {
    const r = deanonymize('Проверьте [ПАСП_КОД_1], [ПАСП_ДАТА_1] и орган [ПАСП_ВЫДАН_1] для паспорта [ПАСПОРТ_1].', res.mapping);
    expect(r.text).toBe('Проверьте 770-001, 12.03.2005 и орган ОВД района Лесной г. Энска для паспорта 45 05 123456.');
    expect(r.unresolved).toEqual([]);
  });

  it('восстановление файла: исходный текст абзаца целиком, предупреждений о смешанных значениях нет', () => {
    const back = restoreDocx(res.bytes, res.mapping);
    expect(textOf(back.bytes)).toBe(TEXT);
    expect(back.unresolved).toEqual([]);
    expect(mixedValueWarnings(res.mapping, back.tokens)).toEqual([]);
  });

  it('карта 0.4 (паспорт одной меткой с вариантами) по-прежнему даёт предупреждение — старые ключи восстановления', () => {
    const old = { entries: [{ token: '[ПАСПОРТ_1]', category: 'PASSPORT', value: '45 05 123456', variants: ['ОВД района Лесной г. Энска', '770-001'] }] };
    expect(mixedValueWarnings(old)).toEqual([{ token: '[ПАСПОРТ_1]', n: 2 }]);
  });
});

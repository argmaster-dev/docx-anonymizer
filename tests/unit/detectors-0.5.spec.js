// К5 (версия 0.5, WP12-C, `docs/concept-0.5.md`): новые категории — ≥ 10 позитивов и ≥ 10 негативов в
// tests/fixtures/categories/<ID>.json, ≥ 95 % позитивов найдены точно, 0 ложных на негативах; ложные контрольные суммы
// отклоняются; детекторы выдают только уровни из `allowedLevels` (без метки — только форматы с жёсткой структурой).
// Точное совпадение каждого примера — ещё и в tests/unit/identifiers/categories.spec.js.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { detect, catalog } from './identifiers/helper.js';
import { IDENTIFIER_DETECTORS } from '../../src/core/detect/identifiers/index.js';
import { oms, vin, ipv4, ipv6, roman, luhn } from '../../src/core/validators.js';
import { CATEGORY_GROUPS } from '../../src/core/categories.js';
import { EXTRA_RX, labelHits, labelStarts } from '../../src/core/detect/identifiers/labels.js';

export const NEW_IDS = [
  ...['PASSPORT_DEPT', 'PASSPORT_ISSUER', 'PASSPORT_DATE', 'INTL_PASSPORT', 'DRIVER_LICENSE', 'MILITARY_ID', 'RESIDENCE_PERMIT', 'MIGRATION_CARD'],
  ...['CIVIL_CERT', 'OMS', 'VEHICLE_DOC', 'VIN', 'PLATE', 'NICKNAME', 'IP', 'MAC', 'HEALTH', 'SPECIAL'],
  ...['EGRN_RECORD', 'CADASTRAL', 'ENFORCEMENT', 'COURT_CASE', 'POA', 'NOTARY_REG'],
  ...['TENDER', 'ORDER_NO', 'INVOICE_NO', 'CLIENT_NO', 'IP_REG'],
];
const load = (id) => JSON.parse(readFileSync(new URL(`../fixtures/categories/${id}.json`, import.meta.url), 'utf8'));
const stream = { id: 's1', part: 'word/document.xml', pid: 'p1', type: 'live' };

describe('К5: новые категории 0.5', () => {
  it('у каждой новой категории есть детектор и фикстура', () => {
    for (const id of NEW_IDS) {
      expect(IDENTIFIER_DETECTORS[id], id).toBeTypeOf('function');
      expect(catalog.byId.get(id)?.builtin, id).toBe(true);
    }
  });

  it.each(NEW_IDS)('%s: ≥ 10/10 примеров, ≥ 95 % позитивов точно, 0 ложных', (id) => {
    const fx = load(id);
    expect(fx.category).toBe(id);
    expect(fx.positive.length).toBeGreaterThanOrEqual(10);
    expect(fx.negative.length).toBeGreaterThanOrEqual(10);
    const exact = fx.positive.filter((p) => {
      const got = detect(p.text).filter((e) => e.category === id);
      return JSON.stringify(got.map((e) => e.text)) === JSON.stringify(p.expect.map((e) => e.text));
    }).length;
    expect(exact / fx.positive.length).toBeGreaterThanOrEqual(0.95);
    const fp = fx.negative.filter((n) => detect(n.text).some((e) => e.category === id));
    expect(fp.map((n) => n.text)).toEqual([]);
  });

  it.each(NEW_IDS)('%s: детектор выдаёт только уровни из allowedLevels (ядро молча отбросило бы остальные)', (id) => {
    const cat = catalog.byId.get(id);
    for (const p of load(id).positive) {
      for (const c of IDENTIFIER_DETECTORS[id](p.text, { stream, language: 'ru', category: cat, catalog, settings: {} }))
        expect(cat.allowedLevels, `${id}: «${p.text}»`).toContain(c.confidence);
    }
  });

  it('без метки ищутся только форматы с жёсткой структурой', () => {
    const bare = NEW_IDS.filter((id) => catalog.byId.get(id).allowedLevels.includes('validated')).sort();
    expect(bare).toEqual(['CADASTRAL', 'CIVIL_CERT', 'COURT_CASE', 'EGRN_RECORD', 'ENFORCEMENT', 'IP', 'MAC', 'NICKNAME', 'PLATE', 'VIN']);
    for (const id of NEW_IDS)
      expect(
        catalog.byId.get(id).allowedLevels.every((l) => l === 'validated' || l === 'labeled'),
        id,
      ).toBe(true);
  });

  it('новые категории — в группах политики 0.4: pii/ids всегда, коммерческие — по переключателю', () => {
    for (const id of ['TENDER', 'ORDER_NO', 'INVOICE_NO', 'CLIENT_NO', 'IP_REG']) expect(CATEGORY_GROUPS.commercial, id).toContain(id);
    for (const id of NEW_IDS.filter((x) => !CATEGORY_GROUPS.commercial.includes(x))) expect([...CATEGORY_GROUPS.pii, ...CATEGORY_GROUPS.ids], id).toContain(id);
  });
});

describe('К5: контрольные суммы и проверки формата', () => {
  it('полис ОМС: 16 цифр и контрольная Mod10 (ISO/HL7 27931 = Луна); ложная контрольная — отказ, и с меткой тоже', () => {
    expect(oms('7700000012345672')).toBe(luhn('7700000012345672'));
    expect(oms('7700000012345672')).toBe(true);
    expect(oms('7700 0000 1234 5672')).toBe(true);
    expect(oms('7700000012345673')).toBe(false);
    expect(oms('770000001234567')).toBe(false);
    expect(detect('полис ОМС 7700000012345673').filter((e) => e.category === 'OMS')).toEqual([]);
  });
  it('VIN: проверочная цифра — дополнительный признак, не обязательный; I/O/Q не допускаются', () => {
    expect(vin('1HGCM82633A004352')).toBe(true);
    expect(vin('1HGCM82603A004352')).toBe(false);
    expect(vin('1HGCM8263OA004352')).toBe(false);
    // европейский VIN без проверочной цифры — по метке и по структуре (буквы в WMI, четыре цифры в конце)
    expect(detect('VIN WVWZZZ1JZXW000001').map((e) => e.category)).toEqual(['VIN']);
    expect(detect('VIN XTA21099Q12345678').filter((e) => e.category === 'VIN')).toEqual([]);
  });
  it('IPv4 — октеты 0–255 без ведущих нулей; IPv6 — восемь групп или «::»', () => {
    expect(ipv4('192.168.1.10')).toBe(true);
    expect(ipv4('256.1.1.1')).toBe(false);
    expect(ipv4('62.01.11.000')).toBe(false);
    expect(ipv6('2001:db8::1')).toBe(true);
    expect(ipv6('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(true);
    expect(ipv6('12:30:45')).toBe(false);
    expect(ipv6('00:1A:2B:3C:4D:5E')).toBe(false);
    expect(ipv6('1::2::3')).toBe(false);
  });
  it('римская серия свидетельства: I…XXXIX, кириллические «І» и «Х» — как латиница', () => {
    for (const s of ['I', 'IV', 'IX', 'XII', 'XXXIX', 'ІХ', 'Х']) expect(roman(s), s).toBe(true);
    for (const s of ['IIII', 'VV', 'IC', '', 'XL']) expect(roman(s), s).toBe(false);
  });
  it('кадастровый номер и запись ЕГРН — только формат (контрольной суммы нет)', () => {
    expect(detect('77:01:0001001:1234').map((e) => e.category)).toEqual(['CADASTRAL']);
    expect(detect('77:01:0001001:1234-77/011/2026-1').map((e) => e.category)).toEqual(['EGRN_RECORD']);
  });
});

describe('метка ячейки таблицы и заголовок столбца (detect/tables.js → ctx.stream)', () => {
  const run = (id, text, extra) => IDENTIFIER_DETECTORS[id](text, { stream: { ...stream, ...extra }, language: 'ru', catalog, settings: {} });
  it('особые категории и здоровье — значение всей ячейки под меткой строки или столбца', () => {
    expect(run('SPECIAL', 'православие', { rowHeader: 'Вероисповедание' }).map((c) => [c.start, c.end])).toEqual([[0, 11]]);
    expect(run('HEALTH', 'J45.0 Бронхиальная астма', { columnHeader: 'Диагноз' })[0]).toMatchObject({ start: 0, end: 24 }); // целиком (за ним — запасные части)
    expect(run('SPECIAL', 'православие', { rowHeader: 'Город' })).toEqual([]);
    expect(run('SPECIAL', 'православие', {})).toEqual([]);
  });
  it('номера документов и коды — по метке строки', () => {
    expect(run('DRIVER_LICENSE', '77 12 345678', { rowHeader: 'Водительское удостоверение' }).length).toBe(1);
    expect(run('CLIENT_NO', '100234', { rowHeader: 'Номер клиента' }).length).toBe(1);
    expect(run('PASSPORT_DEPT', '770-001', { rowHeader: 'Код подразделения' }).length).toBe(1);
    expect(run('PASSPORT_DATE', '12.03.2005', { rowHeader: 'Дата выдачи' }).length).toBe(1);
    expect(run('PASSPORT_ISSUER', 'ГУ МВД России по Энской области', { rowHeader: 'Кем выдан' }).length).toBe(1);
  });
});

describe('ревью WP12-C: таблицы и контекст', () => {
  const run = (id, text, extra) => IDENTIFIER_DETECTORS[id](text, { stream: { ...stream, ...extra }, language: 'ru', catalog, settings: {} });
  it('IP без метки не берётся под заголовком столбца с кодами и версиями; под «IP-адрес» — берётся', () => {
    expect(run('IP', '26.20.11.110', { columnHeader: 'Код ОКПД2' })).toEqual([]);
    expect(run('IP', '10.4.12.200', { columnHeader: 'Версия' })).toEqual([]);
    expect(run('IP', '10.4.12.200', { columnHeader: 'IP-адрес' }).length).toBe(1);
  });
  it('строка заголовка таблицы: ячейка слева — не метка («Ф.И.О. | Диагноз | Госномер»)', () => {
    expect(run('HEALTH', 'Госномер', { rowHeader: 'Диагноз', headerRow: true })).toEqual([]);
    expect(run('HEALTH', 'Примечание', { rowHeader: 'Диагноз', headerRow: true })).toEqual([]);
    expect(run('HEALTH', 'Госномер', { rowHeader: 'Диагноз' })).toEqual([]); // ячейка — сама метка
    expect(run('HEALTH', 'J45.0 Бронхиальная астма', { rowHeader: 'Диагноз' })[0]).toMatchObject({ start: 0, end: 24 });
  });
  it('таблица PDF целиком: заголовки на месте, значения под ними замаскированы, коды ОКПД2 — нет', async () => {
    const { fromText, analyze, defaultSettings, registerBuiltinDetectors, clearDetectors, applyDecisions } = await import('../../src/core/index.js');
    clearDetectors();
    registerBuiltinDetectors();
    const rows = [
      ['Ф.И.О.', 'Диагноз', 'Госномер', 'VIN', 'Код ОКПД2'],
      ['Иванов Иван Иванович', 'J45.0 Бронхиальная астма', 'А123ВС77', 'XTA21099071234567', '26.20.11.110'],
    ];
    const blocks = [];
    rows.forEach((row, r) => row.forEach((t, c) => blocks.push({ kind: 'cell', text: t, page: 1, table: { index: 0, row: r, col: c, cols: row.length } })));
    const doc = fromText(blocks, { name: 'a.pdf', size: 1 });
    const a = await analyze(doc, defaultSettings());
    const out = new TextDecoder().decode(applyDecisions(doc, a.groups, { placeholderLanguage: 'ru', textFormat: 'md' }).bytes);
    expect(out).toContain('| Ф.И.О. | Диагноз | Госномер | VIN | Код ОКПД2 |');
    for (const v of ['Иванов', 'J45.0', 'А123ВС77', 'XTA21099071234567']) expect(out).not.toContain(v);
    expect(out).toContain('26.20.11.110');
    // вернуть реестр помощника detect(): только детекторы идентификаторов
    const { registerDetector, registerDocumentDetector } = await import('../../src/core/contracts/detector.js');
    const { register } = await import('../../src/core/detect/identifiers/index.js');
    clearDetectors();
    register({ registerDetector, registerDocumentDetector });
  });
});

describe('метки 0.5 (labels.js): поиск без флага i по тексту в нижнем регистре', () => {
  it('основы EXTRA_RX написаны строчными (кроме экранирования \\p{L}, \\t, \\u00a0)', () => {
    for (const [id, src] of Object.entries(EXTRA_RX))
      expect(src.replace(/\\(?:p\{[LN]\}|t|u00a0)/g, ''), id).toBe(src.replace(/\\(?:p\{[LN]\}|t|u00a0)/g, '').toLowerCase());
  });
  it('позиции меток и ответы labelHits не зависят от регистра текста', () => {
    const t = 'ВОДИТЕЛЬСКОЕ УДОСТОВЕРЕНИЕ 77 12 345678';
    expect(labelStarts(t, { stream })).toContain(0);
    expect([...labelHits(t, 27, { stream }).keys()]).toContain('DRIVER_LICENSE');
    expect(detect(t).map((e) => e.category)).toEqual(['DRIVER_LICENSE']);
  });
});

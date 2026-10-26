// Словари ФИО из файлов пакета vendor/dict/*.txt (версия 0.5, WP12-A, К14; docs/contracts.md §2): загрузка один раз,
// getDicts() до загрузки — понятная ошибка, сбой загрузки — пустые списки и { ok: false, reason } (хост → DICT_FAILED),
// правила и база знаний продолжают работать. Состояние модуля — на файл теста (vitest изолирует файлы); после каждого
// теста словари загружаются с диска снова.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { getDicts, bigFirstNameInfo, surnameLemmas } from '../../src/core/detect/names/dict/index.js';
import { loadDicts, dictState, parseDictFile, resetDictsForTests, DICT_FILES } from '../../src/core/detect/names/dict/load.js';
import { encodeList, decodeList } from '../../src/core/detect/names/dict/codec.js';
import { readDictFromDisk, loadDictsFromDisk } from '../../scripts/dicts-node.mjs';

// вымышленные данные: «Зульфия Хасанова» находит только словарь (фикстура PERSON-dict.json, dictOnly)
const PARAS = ['Отчёт подготовила Зульфия Хасанова.', 'Исполнитель: Петров Пётр Петрович, ИНН 7707083893, почта petrov@example.invalid.'];

beforeEach(() => resetDictsForTests());
afterEach(async () => {
  resetDictsForTests();
  await loadDictsFromDisk();
});

describe('формат файла словаря', () => {
  it('секции «#=ИМЯ», комментарии «#», CRLF; тело — строка codec.js', () => {
    const body = encodeList(['иванов', 'петров']);
    const text = `# комментарий\r\n#=A\r\n${body.replace(/\n/g, '\r\n')}\r\n#=B\n${encodeList(['smith'])}\n`;
    const m = parseDictFile(text);
    expect([...m.keys()]).toEqual(['A', 'B']);
    expect(decodeList(/** @type {string} */ (m.get('A')))).toEqual(['иванов', 'петров']);
    expect(decodeList(/** @type {string} */ (m.get('B')))).toEqual(['smith']);
  });

  it('данные вне секции, повтор секции, не-ASCII в теле, тело не строка кодека — ошибка', () => {
    expect(() => parseDictFile('R0abc\n')).toThrow();
    expect(() => parseDictFile('#=A\nR0a\n#=A\nR0b\n')).toThrow();
    expect(() => parseDictFile('#=A\nR0иванов\n')).toThrow();
    expect(() => parseDictFile('#=A\n0abc\n')).toThrow();
  });

  it('файлы vendor/dict/*.txt: нужные секции на месте, первая строка — комментарий-заголовок', async () => {
    const want = { 'ru-surnames': ['SURNAMES'], 'ru-first': ['MALE', 'FEMALE', 'UNISEX', 'AMBIGUOUS'], 'en-first': ['FIRST'], 'en-surnames': ['SURNAMES'] };
    expect([...DICT_FILES]).toEqual(Object.keys(want));
    for (const name of DICT_FILES) {
      const text = new TextDecoder().decode(await readDictFromDisk(name));
      expect(text.startsWith('# '), name).toBe(true);
      expect([...parseDictFile(text).keys()], name).toEqual(want[name]);
    }
  });
});

describe('loadDicts', () => {
  it('до загрузки getDicts() бросает понятную ошибку; dictState — none', () => {
    expect(dictState()).toBe('none');
    expect(() => getDicts()).toThrow(/Словари ФИО не загружены.*loadDicts/);
    expect(() => bigFirstNameInfo('Иван')).toThrow(/не загружены/);
  });

  it('загрузка с диска: списки на месте; повторный вызов не читает файлы; параллельные вызовы — одна загрузка', async () => {
    const read = vi.fn(readDictFromDisk);
    const [a, b] = await Promise.all([loadDicts(read), loadDicts(read)]);
    expect(a).toMatchObject({ ok: true });
    expect(b).toMatchObject({ ok: true });
    expect(read).toHaveBeenCalledTimes(DICT_FILES.length);
    expect(dictState()).toBe('loaded');
    const d = getDicts();
    expect(d.ruSurnames.size).toBe(50000);
    expect(d.enSurnames.size).toBe(10000);
    expect(d.ruFirst.get('зульфия')).toBe('f');
    expect(await loadDicts(read)).toEqual({ ok: true, ms: 0 });
    expect(read).toHaveBeenCalledTimes(DICT_FILES.length);
  });

  it('строки и Uint8Array равноценны', async () => {
    const r = await loadDicts(async (n) => new TextDecoder().decode(await readDictFromDisk(n)));
    expect(r.ok).toBe(true);
    expect(surnameLemmas('Хасановой').length).toBeGreaterThan(0);
  });

  it('файл не прочитан → READ_FAILED, списки пустые (курируемые имена lexicon.js остаются); сбой окончательный — файлы больше не читаются', async () => {
    const r = await loadDicts(async (n) => {
      if (n === 'ru-first') throw new Error('404');
      return readDictFromDisk(n);
    });
    expect(r).toMatchObject({ ok: false, reason: 'READ_FAILED' });
    expect(dictState()).toBe('failed');
    const d = getDicts();
    expect(d.ruSurnames.size).toBe(0);
    expect(d.enFirst.size).toBe(0);
    expect(d.ruFirst.get('иван')).toBe('m'); // MALE_NAMES_RU
    expect(d.ruFirst.has('зульфия')).toBe(false);
    expect(surnameLemmas('Хасановой')).toEqual([]);
    // повтор на той же жизни воркера: тот же отказ без чтения (кэши разборов детекторов не устаревают)
    const read = vi.fn(readDictFromDisk);
    expect(await loadDicts(read)).toMatchObject({ ok: false, reason: 'READ_FAILED' });
    expect(read).not.toHaveBeenCalled();
    expect(dictState()).toBe('failed');
  });

  it('битый файл → BAD_FORMAT; нет секции → BAD_FORMAT; не байты и не строка → READ_FAILED', async () => {
    const bad = (patch) => async (n) => (n in patch ? patch[n] : readDictFromDisk(n));
    resetDictsForTests();
    expect(await loadDicts(bad({ 'en-first': 'это не словарь' }))).toMatchObject({ ok: false, reason: 'BAD_FORMAT' });
    resetDictsForTests();
    expect(await loadDicts(bad({ 'ru-first': '#=MALE\nR0a\n' }))).toMatchObject({ ok: false, reason: 'BAD_FORMAT' });
    resetDictsForTests();
    expect(await loadDicts(bad({ 'en-first': new Uint8Array([0xff, 0xfe, 0x00]) }))).toMatchObject({ ok: false, reason: 'READ_FAILED' });
    resetDictsForTests();
    expect(await loadDicts(bad({ 'en-first': 42 }))).toMatchObject({ ok: false, reason: 'READ_FAILED' });
    expect(() => getDicts()).not.toThrow();
  });
});

describe('анализ без словарей (NFR-13)', () => {
  /** Свежий граф модулей ядра (своё состояние словарей и кэши детекторов) — как новый воркер. */
  async function freshCore() {
    vi.resetModules();
    const load = await import('../../src/core/detect/names/dict/load.js');
    const core = await import('../../src/core/index.js');
    const runner = await import('../../src/core/detect/runner.js');
    const helpers = await import('./names/helpers.js');
    core.clearDetectors();
    core.registerBuiltinDetectors();
    const run = async () => {
      const r = await runner.analyze(helpers.docFromParagraphs(PARAS), core.defaultSettings());
      return { r, values: (cat) => r.groups.filter((g) => g.category === cat).map((g) => g.value) };
    };
    return { load, run };
  }

  it('сбой загрузки: правила и база знаний на месте, словарное лицо не находится; со словарями — находится', async () => {
    const a = await freshCore();
    expect(a.load.dictState()).toBe('none');
    expect((await a.load.loadDicts(async () => Promise.reject(new Error('нет файла')))).ok).toBe(false);
    const without = await a.run();
    expect(without.r.warnings.map((w) => w.code)).not.toContain('DETECTOR_FAILED');
    expect(without.values('INN')).toEqual(['7707083893']);
    expect(without.values('EMAIL')).toEqual(['petrov@example.invalid']);
    expect(without.values('PERSON')).toContain('Петров Пётр Петрович');
    expect(without.values('PERSON')).not.toContain('Зульфия Хасанова');

    const b = await freshCore();
    expect((await b.load.loadDicts(readDictFromDisk)).ok).toBe(true);
    const withDicts = await b.run();
    expect(withDicts.values('PERSON')).toEqual(expect.arrayContaining(['Петров Пётр Петрович', 'Зульфия Хасанова']));
    vi.resetModules();
  });
});

// Версия 0.5.2 (WP14-A, docs/concept-0.5.2.md Ц2–Ц4, К4–К6): список «не спрашивать» (FR-04в) — валидатор, разбор поля, миграция 4 → 5,
// экспорт; какие файлы проходят мимо панели (isSkipped); интерсептор берёт любой файл, очищает поле выбора сразу (FR-01а) и подставляет
// результат явно при любом решении. Интерсептор — на поддельном window (EventTarget Node), без браузера; браузерные пути — e2e guard-052.
import { describe, it, expect } from 'vitest';
import {
  defaultSettings,
  migrateSettings,
  applyMigrations,
  validateSettingsPatch,
  parseExtensionList,
  isSkipExtension,
  SUPPORTED_EXTENSIONS,
  SETTINGS_SCHEMA_VERSION,
} from '../../src/core/settings.js';
import { fileKind, isSkipped, isSupported, extOf } from '../../src/content/files.js';
import { createInterceptor } from '../../src/content/interceptor.js';
import { panel } from '../../src/ui/i18n/panel.js';
import { OPTIONS_DICT } from '../../src/ui/i18n/options.js';
import { HELP_DICT } from '../../src/ui/i18n/help.js';

const f = (name, type = '') => new File(['x'], name, { type });

describe('список «не спрашивать» (FR-04в)', () => {
  it('SUPPORTED_EXTENSIONS = расширения, которые узнаёт fileKind; прочие — неподдерживаемые', () => {
    for (const ext of SUPPORTED_EXTENSIONS) expect(fileKind(f(`a.${ext}`)), ext).not.toBeNull();
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'zip', 'doc', 'rtf', 'odt', 'xls', 'ppt', 'jsonl', 'html', 'dat'])
      expect(fileKind(f(`a.${ext}`)), ext).toBeNull();
    expect(SUPPORTED_EXTENSIONS).toEqual(expect.arrayContaining(['json', 'txt', 'md', 'csv', 'log', 'pdf']));
  });

  it('валидатор: только строчные расширения без точки, не поддерживаемые форматы, до 50', () => {
    expect(defaultSettings().skipExtensions).toEqual([]);
    expect(validateSettingsPatch({ skipExtensions: [] })).toEqual([]);
    expect(validateSettingsPatch({ skipExtensions: ['png', 'jpg', 'zip', 'tar-gz', '7z', 'c++'] })).toEqual([]);
    for (const bad of [['json'], ['txt'], ['png', 'md'], ['pdf'], ['docx'], ['.png'], ['PNG'], [''], ['a'.repeat(17)], ['фото'], ['a b'], [1], 'png'])
      expect(validateSettingsPatch({ skipExtensions: bad }), JSON.stringify(bad)).toEqual(['skipExtensions']);
    expect(validateSettingsPatch({ skipExtensions: Array.from({ length: 51 }, (_, i) => `x${i}`) })).toEqual(['skipExtensions']);
    expect(isSkipExtension('mapping')).toBe(true); // «*.mapping.json» — расширение json, его в список не добавить
    expect(isSkipExtension('json')).toBe(false);
  });

  it('разбор поля: точки, звёздочки, регистр, повторы, разделители; поддерживаемые и не-расширения — отдельно', () => {
    expect(parseExtensionList('.JPG, png; *.zip  jpg\n.Png')).toEqual({ list: ['jpg', 'png', 'zip'], supported: [], invalid: [] });
    expect(parseExtensionList('png, .JSON, txt, *.mapping.json')).toEqual({ list: ['png'], supported: ['json', 'txt'], invalid: ['mapping.json'] });
    expect(parseExtensionList('фото, a/b')).toEqual({ list: [], supported: [], invalid: ['фото', 'a/b'] });
    expect(parseExtensionList('')).toEqual({ list: [], supported: [], invalid: [] });
    expect(parseExtensionList('  ,  ')).toEqual({ list: [], supported: [], invalid: [] });
  });

  it('isSkipped: по расширению без учёта регистра; поддерживаемый формат, ключ и файл без расширения — никогда', () => {
    const s = { ...defaultSettings(), skipExtensions: ['png', 'zip'] };
    expect(isSkipped(f('фото.png'), s)).toBe(true);
    expect(isSkipped(f('ФОТО.PNG'), s)).toBe(true);
    expect(isSkipped(f('архив.zip'), s)).toBe(true);
    expect(isSkipped(f('скан.jpg'), s)).toBe(false);
    expect(isSkipped(f('без-расширения'), s)).toBe(false);
    expect(isSkipped(f('фото.png'), defaultSettings())).toBe(false);
    // список поправлен в хранилище вручную (мимо валидатора) — поддерживаемые форматы и ключ всё равно не проходят мимо панели
    const forced = { ...defaultSettings(), skipExtensions: ['json', 'txt', 'pdf', 'docx'] };
    for (const name of ['ключ.mapping.json', 'заметки.txt', 'договор.docx', 'скан.pdf']) expect(isSkipped(f(name), forced), name).toBe(false);
    expect(isSkipped(f('скан.pdf'), { ...forced, pdfMode: 'off' })).toBe(false);
    expect(extOf(f('a.b.TAR'))).toBe('tar');
    expect(extOf(f('.gitignore'))).toBe('gitignore');
    expect(extOf(f('README'))).toBe('');
  });

  it('PDF при pdfMode off — не обрабатывается (уйдёт в панель строкой-отказом), но и мимо панели не проходит', () => {
    const off = { ...defaultSettings(), pdfMode: 'off' };
    expect(isSupported(f('a.pdf'), off)).toBe(false);
    expect(isSkipped(f('a.pdf'), off)).toBe(false);
  });

  it('миграция 4 → 5 (К6): прежние поля сохранены, список пуст; частичный патч — только версия; неверный список — пустой', () => {
    const v4 = {
      ...defaultSettings(),
      schemaVersion: 4,
      interceptEnabled: true,
      mode: 'mask',
      pdfMode: 'off',
      exclusions: [{ value: 'ООО Ромашка', category: 'COMPANY' }],
    };
    delete v4.skipExtensions;
    const { settings, changed } = migrateSettings(v4);
    expect(changed).toBe(true);
    expect(SETTINGS_SCHEMA_VERSION).toBe(5);
    expect(settings.schemaVersion).toBe(5);
    expect(settings.skipExtensions).toEqual([]);
    for (const [k, v] of Object.entries(v4)) if (k !== 'schemaVersion') expect(settings[k], k).toEqual(v);
    expect(applyMigrations({ mode: 'mask' }, 4)).toEqual({ mode: 'mask', schemaVersion: 5 });
    expect(migrateSettings({ ...settings, skipExtensions: ['png', 'json'] }).settings.skipExtensions).toEqual([]);
    expect(migrateSettings({ ...settings, skipExtensions: ['png'] }).settings.skipExtensions).toEqual(['png']);
  });

  it('экспорт и импорт конфигурации: список переносится, с поддерживаемым форматом — пропускается', async () => {
    const { parseConfigFile, CONFIG_KIND, NOT_EXPORTED } = await import('../../src/options/config-io.js');
    expect(NOT_EXPORTED.has('skipExtensions')).toBe(false);
    const file = (settings, schemaVersion = 5) => JSON.stringify({ kind: CONFIG_KIND, version: 1, schemaVersion, settings });
    expect(parseConfigFile(file({ skipExtensions: ['png', 'zip'] })).patch).toEqual({ skipExtensions: ['png', 'zip'] });
    expect(parseConfigFile(file({ skipExtensions: ['json'] }))).toEqual({ patch: {}, skipped: ['skipExtensions'] });
    // файл 0.5.1 (схема 4) без списка — список пользователя не трогается
    expect(parseConfigFile(file({ mode: 'mask' }, 4)).patch).toEqual({ mode: 'mask' });
  });

  it('тексты ru/en: панель и страница настроек', () => {
    for (const lang of ['ru', 'en']) {
      for (const k of ['unsupportedExt', 'unsupportedNoExt', 'unsupportedPdfOff', 'unsupportedNote']) expect(panel[lang][k], `${lang}.${k}`).toBeTruthy();
      for (const k of ['skip_ext', 'skip_ext_hint', 'skip_ext_placeholder', 'skip_ext_supported', 'skip_ext_invalid'])
        expect(OPTIONS_DICT[lang][k], `${lang}.${k}`).toBeTruthy();
      expect(panel[lang].unsupportedExt).toContain('.{ext}');
    }
    expect(panel.ru.unsupportedExt.replace('{ext}', 'jpg')).toBe('Формат .jpg не проверяется на персональные данные');
    expect(panel.ru.unsupportedPdfOff).toMatch(/PDF выключен в настройках/);
    // список поддерживаемых в подсказке поля — из SUPPORTED_EXTENSIONS (options.js подставляет {list}), в справке — все 14
    for (const lang of ['ru', 'en']) {
      expect(OPTIONS_DICT[lang].skip_ext_hint).toContain('({list})');
      for (const ext of SUPPORTED_EXTENSIONS) expect(HELP_DICT[lang].guard_2, `${lang} .${ext}`).toMatch(new RegExp(`\\.${ext}[,)]`));
    }
  });
});

/* ---------- интерсептор на поддельном window ---------- */

class FakeDataTransfer {
  constructor() {
    this.list = [];
    this.items = { add: (file) => this.list.push(file) };
  }
  get files() {
    return this.list;
  }
}

class FakeInput extends EventTarget {
  constructor() {
    super();
    this.tagName = 'INPUT';
    this.type = 'file';
    this.files = [];
  }
  set value(v) {
    if (v === '') this.files = [];
  }
  get value() {
    return this.files.length ? 'C:\\fakepath\\x' : '';
  }
}

/** Событие с composedPath, как у события поля на window в фазе capture. */
class PathEvent extends Event {
  constructor(type, target) {
    super(type);
    this.path = [target];
    this.stopped = false;
  }
  composedPath() {
    return this.path;
  }
  stopImmediatePropagation() {
    this.stopped = true;
    super.stopImmediatePropagation();
  }
}

function setup(skip = () => false) {
  const win = new EventTarget();
  Object.assign(win, {
    document: { documentElement: null, addEventListener() {} },
    DataTransfer: FakeDataTransfer,
    Event,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout,
    clearTimeout,
  });
  const input = new FakeInput();
  const got = []; // что получил «сайт»: списки имён по событиям change
  input.addEventListener('change', () => got.push(input.files.map((x) => x.name)));
  const resolvers = [];
  const calls = [];
  const flow = {
    run(files, pass) {
      calls.push({ files, pass, duringRun: input.files.length });
      return new Promise((r) => resolvers.push(r));
    },
  };
  createInterceptor(flow, { win, isSkipped: skip }).attach();
  /** выбор файлов человеком: событие change на window (capture), затем — у поля, если интерсептор не остановил */
  const choose = (files) => {
    input.files = files;
    const e = new PathEvent('change', input);
    win.dispatchEvent(e);
    if (!e.stopped) input.dispatchEvent(new Event('change'));
    return e.stopped;
  };
  /** решение по выборке k (по умолчанию — последней) */
  return { input, got, calls, choose, decide: (res, k = resolvers.length - 1) => resolvers[k](res) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('интерсептор 0.5.2: любой файл, пустое поле во время обработки, явная подстановка (FR-01а, FR-04б)', () => {
  it('картинка перехватывается: поле пустое во время обработки, сайт ничего не получил; «Отмена» — 0 событий', async () => {
    const t = setup();
    expect(t.choose([f('фото.jpg', 'image/jpeg')])).toBe(true);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].duringRun).toBe(0);
    expect(t.calls[0].pass).toEqual([false]);
    expect(t.input.files).toHaveLength(0);
    t.decide({ action: 'cancel', files: t.calls[0].files });
    await tick();
    expect(t.got).toEqual([]);
    expect(t.input.files).toHaveLength(0);
  });

  it('«Загрузить как есть» — в поле ровно исходный файл (тот же объект), одно событие; повтор события сайтом панель не открывает', async () => {
    const t = setup();
    const img = f('фото.png', 'image/png');
    t.choose([img]);
    t.decide({ action: 'anonymized', files: [img] });
    await tick();
    expect(t.got).toEqual([['фото.png']]);
    expect(t.input.files[0]).toBe(img);
    // сайт пересылает те же объекты — это наш результат, не новый выбор
    expect(t.choose([img])).toBe(false);
    expect(t.calls).toHaveLength(1);
    // новый выбор того же файла с диска — новые объекты: панель снова
    expect(t.choose([f('фото.png', 'image/png')])).toBe(true);
    expect(t.calls).toHaveLength(2);
  });

  it('«оригинал» той же длины подставляется явно (раньше полагались на то, что оригиналы остались в поле)', async () => {
    const t = setup();
    const doc = f('договор.docx');
    t.choose([doc]);
    expect(t.input.files).toHaveLength(0);
    t.decide({ action: 'original', files: [doc] });
    await tick();
    expect(t.got).toEqual([['договор.docx']]);
    expect(t.input.files).toEqual([doc]);
  });

  it('обезличенный результат подставляется и запоминается: повтор события сайтом с ним панель не открывает', async () => {
    const t = setup();
    t.choose([f('договор.docx')]);
    const anon = f('договор.anon.docx');
    t.decide({ action: 'anonymized', files: [anon] });
    await tick();
    expect(t.got).toEqual([['договор.anon.docx']]);
    expect(t.choose([anon])).toBe(false);
    expect(t.calls).toHaveLength(1);
  });

  it('список «не спрашивать»: только такие файлы — без перехвата, как в 0.5.1; смешанный выбор — pass по файлам', () => {
    const t = setup((x) => /\.png$/i.test(x.name));
    expect(t.choose([f('a.png'), f('b.PNG')])).toBe(false);
    expect(t.got).toEqual([['a.png', 'b.PNG']]);
    expect(t.calls).toHaveLength(0);
    expect(t.choose([f('a.png'), f('договор.docx'), f('скан.jpg')])).toBe(true);
    expect(t.calls[0].pass).toEqual([true, false, false]);
  });

  it('вторая выборка в то же поле, пока открыта панель (ревью 0.5.2): забирается из поля, ждёт очереди; «Отмена» первой поле не наполняет', async () => {
    const t = setup();
    t.choose([f('договор.docx')]);
    expect(t.choose([f('паспорт.jpg')])).toBe(true);
    expect(t.calls).toHaveLength(2);
    expect(t.calls[1].files.map((x) => x.name)).toEqual(['паспорт.jpg']);
    expect(t.calls[1].duringRun).toBe(0);
    expect(t.input.files).toHaveLength(0);
    // второе событие той же (второй) выборки — с уже пустым полем — гасится, во flow не идёт
    expect(t.choose([])).toBe(true);
    expect(t.calls).toHaveLength(2);
    t.decide({ action: 'cancel', files: [] }, 0);
    await tick();
    expect(t.input.files).toHaveLength(0);
    expect(t.got).toEqual([]);
    const img = t.calls[1].files[0];
    t.decide({ action: 'anonymized', files: [img] }, 1);
    await tick();
    expect(t.got).toEqual([['паспорт.jpg']]);
    // обе выборки решены — поле больше не «в обработке»: новая выборка снова идёт во flow
    expect(t.choose([f('ещё.png')])).toBe(true);
    expect(t.calls).toHaveLength(3);
  });

  it('сбой сценария — поле остаётся пустым, сайт ничего не получил', async () => {
    const t = setup();
    t.choose([f('архив.zip')]);
    t.decide(Promise.reject(new Error('сбой')));
    await tick();
    await tick();
    expect(t.got).toEqual([]);
    expect(t.input.files).toHaveLength(0);
  });
});

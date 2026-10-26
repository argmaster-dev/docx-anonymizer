// Скрытые данные и ключ с паролем в интерфейсе (версия 0.5, WP12-D, Ц4, Ц5): формы числа строки «В документе: …», тексты ru/en
// панели и страницы восстановления, настройки выбора (по умолчанию всё выключено, запоминается, проходит валидатор).
import { describe, it, expect } from 'vitest';
import { pluralForm } from '../../../src/ui/panel/panel.js';
import { panel } from '../../../src/ui/i18n/panel.js';
import { RESTORE_DICT } from '../../../src/ui/i18n/restore.js';
import { HELP_DICT } from '../../../src/ui/i18n/help.js';
import { createT } from '../../../src/ui/i18n/index.js';
import { defaultSettings, migrateSettings, validateSettingsPatch } from '../../../src/core/settings.js';
import { HIDDEN_SETTINGS, hiddenFlagsFrom } from '../../../src/core/ooxml/hidden.js';

describe('строка «В документе: …»', () => {
  it('формы числа: ru — one/few/many, en — one/many', () => {
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map((n) => pluralForm(n, 'ru'))).toEqual([
      'one',
      'few',
      'few',
      'many',
      'many',
      'many',
      'many',
      'one',
      'few',
      'many',
      'one',
      'many',
    ]);
    expect([1, 2, 5].map((n) => pluralForm(n, 'en'))).toEqual(['one', 'many', 'many']);
  });

  it('тексты из ТЗ: «3 комментария, история правок, скрытый текст» и переключатели', () => {
    const t = createT(panel, 'ru');
    const list = [t(`hiddenComments_${pluralForm(3, 'ru')}`, { n: 3 }), t('hiddenRevisions'), t('hiddenTextFound')].join(', ');
    expect(t('hiddenSummary', { list })).toBe('В документе: 3 комментария, история правок, скрытый текст');
    expect(t(`hiddenSheets_${pluralForm(2, 'ru')}`, { n: 2 })).toBe('2 скрытых листа');
    expect(t(`hiddenSlides_${pluralForm(1, 'ru')}`, { n: 1 })).toBe('1 скрытый слайд');
    expect([t('hiddenOptComments'), t('hiddenOptRevisions'), t('hiddenOptText'), t('hiddenOptSheets'), t('hiddenOptSlides')]).toEqual([
      'Удалить комментарии',
      'Принять исправления',
      'Удалить скрытый текст',
      'Удалить скрытые листы, строки и столбцы',
      'Удалить скрытые слайды',
    ]);
    expect(createT(panel, 'en')('hiddenSummary', { list: 'x' })).toBe('The document has: x');
  });

  it('ключи ru/en панели, страницы восстановления и справки совпадают; предупреждение о забытом пароле есть', () => {
    for (const d of [panel, RESTORE_DICT, HELP_DICT]) expect(Object.keys(d.en).sort()).toEqual(Object.keys(d.ru).sort());
    // пароль вводится только на странице расширения (ревью WP12-D): в панели — кнопка, полей и их текстов нет
    expect(panel.ru.btnSaveKeyProtected).toBe('Сохранить с паролем…');
    expect(Object.keys(panel.ru).filter((k) => /^keyPw|^keyPassword/.test(k))).toEqual([]);
    expect(RESTORE_DICT.ru.save_warn).toMatch(/Забытый пароль = потерянный ключ/);
    expect(RESTORE_DICT.en.save_warn).toMatch(/forgotten password/);
    expect(panel.ru.hiddenHintSheets).toMatch(/#REF!/);
    expect(RESTORE_DICT.ru.key_password_bad).toMatch(/Неверный пароль/);
    expect(HELP_DICT.ru.hidden_3).toMatch(/600 000/);
  });
});

describe('настройки выбора скрытых данных', () => {
  it('по умолчанию всё выключено; ключи настроек — по одному на переключатель; патч проходит валидатор', () => {
    const s = defaultSettings();
    for (const key of Object.values(HIDDEN_SETTINGS)) {
      expect(s[key], key).toBe(false);
      expect(validateSettingsPatch({ [key]: true })).toEqual([]);
      expect(validateSettingsPatch({ [key]: 'да' })).toEqual([key]);
    }
    expect(Object.values(hiddenFlagsFrom(s)).some(Boolean)).toBe(false);
  });

  it('настройки схемы 4 без новых ключей дополняются выключенными (миграция схемы не нужна); выбор сохраняется', () => {
    const { settings } = migrateSettings({ schemaVersion: 4 });
    expect(settings.removeComments).toBe(false);
    expect(settings.acceptRevisions).toBe(false);
    const kept = migrateSettings({ ...defaultSettings(), removeComments: true, removeHiddenSlides: true }).settings;
    expect(hiddenFlagsFrom(kept)).toMatchObject({ comments: true, hiddenSlides: true, revisions: false });
  });
});

describe('«Сохранить с паролем…»: страница расширения (OPEN_KEY_SAVE, ревью WP12-D)', () => {
  it('ссылка — только id сессий и имя файла ключа без путей; схема протокола', async () => {
    const { keySavePath, MSG } = await import('../../../src/shared/protocol.js');
    const { readFileSync } = await import('node:fs');
    const { createValidator } = await import('../../helpers/jsonschema.js');
    expect(keySavePath({ docIds: ['d1', 'd12'], name: '[ФИО_1].mapping.json' })).toBe(
      'restore/restore.html?save=1&docId=d1&docId=d12&name=%5B%D0%A4%D0%98%D0%9E_1%5D.mapping.json',
    );
    for (const bad of [
      { docIds: [], name: 'a.mapping.json' },
      { docIds: ['x1'], name: 'a.mapping.json' },
      { docIds: ['d1'], name: '../a.mapping.json' },
      { docIds: ['d1'], name: 'a.json' },
      { docIds: ['d1'], name: 'a\nb.mapping.json' },
      { docIds: 'd1', name: 'a.mapping.json' },
    ])
      expect(keySavePath(bad), JSON.stringify(bad)).toBeNull();
    const schema = JSON.parse(readFileSync('schemas/protocol.schema.json', 'utf8'));
    const { validate } = createValidator({ 'protocol.schema.json': schema });
    const msg = { type: MSG.OPEN_KEY_SAVE, requestId: 'k1', docIds: ['d3'], name: 'договор.mapping.json' };
    expect(validate(schema, msg)).toEqual([]);
    expect(validate(schema, { ...msg, docIds: ['../x'] })).not.toEqual([]);
  });
});

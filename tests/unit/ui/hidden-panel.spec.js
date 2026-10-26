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
    expect(panel.ru.keyPwWarn).toMatch(/Забытый пароль = потерянный ключ/);
    expect(panel.en.keyPwWarn).toMatch(/forgotten password/);
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

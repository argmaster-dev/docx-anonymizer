import { describe, it, expect } from 'vitest';
import { HELP_DICT } from '../../src/ui/i18n/help.js';
import { common } from '../../src/ui/i18n/common.js';
import { popup } from '../../src/ui/i18n/popup.js';
import { readFileSync } from 'node:fs';

describe('строки справки и подписи', () => {
  it('русский и английский словари справки совпадают по ключам и не пусты', () => {
    expect(Object.keys(HELP_DICT.en).sort()).toEqual(Object.keys(HELP_DICT.ru).sort());
    for (const lang of ['ru', 'en']) for (const [k, v] of Object.entries(HELP_DICT[lang])) expect(v.trim(), `${lang}.${k}`).not.toBe('');
  });

  it('справка говорит главное: что делает, как пользоваться, данные остаются на компьютере', () => {
    const ru = HELP_DICT.ru;
    expect(ru.what_p1).toMatch(/локально/);
    expect(ru.privacy_h).toBe('Данные не покидают ваш компьютер');
    expect(ru.privacy_1).toMatch(/ни одного сетевого запроса/);
    expect([ru.how_1, ru.how_2, ru.how_3, ru.how_4].every(Boolean)).toBe(true);
  });

  it('раздел о политике 0.4: что всегда, что по желанию, список компаний — 4 пункта ru/en', () => {
    const ru = HELP_DICT.ru;
    expect(ru.policy_h).toBe('Что маскируется');
    expect(ru.policy_1).toMatch(/Всегда: персональные данные/);
    expect(ru.policy_1).toMatch(/ИП/);
    expect(ru.policy_2).toMatch(/ИНН/);
    expect(ru.policy_3).toMatch(/По желанию/);
    expect(ru.policy_3).toMatch(/Коммерческая информация/);
    expect(ru.policy_4).toMatch(/Маскировать всегда/);
    for (const lang of ['ru', 'en']) for (let i = 1; i <= 4; i++) expect(HELP_DICT[lang][`policy_${i}`], `${lang}.policy_${i}`).toBeTruthy();
    expect(HELP_DICT.ru.policy_5).toBeUndefined();
    const helpJs = readFileSync(new URL('../../src/help/help.js', import.meta.url), 'utf8');
    expect(helpJs).toContain("list('ul', t, 'policy', 4)");
  });

  // WP13-L (0.5.1): пакет модели 1.2.1 (те же веса, что 1.2.0) и лицензия Apache 2.0 кода и весов; предупреждение о корпусах — на месте
  it('строка о модели: пакет 1.2.1, лицензия Apache 2.0 (база — MIT), предупреждение о NEREL/Nerus — ru/en', () => {
    for (const lang of ['ru', 'en']) {
      const s = HELP_DICT[lang].check_2;
      expect(s, lang).toContain('1.2.1');
      expect(s, lang).not.toContain('1.2.0');
      expect(s, lang).toMatch(/Apache 2\.0/);
      expect(s, lang).toMatch(/rubert-tiny2[^.]*MIT/);
      expect(s, lang).toMatch(/NEREL/);
      expect(s, lang).toMatch(/NOTICE/);
    }
  });

  it('«Сделано в Sitimlab» и «Справка» есть в общих строках на обоих языках, меню их наследует', () => {
    expect(common.ru.madeBy).toBe('Сделано в');
    expect(common.en.madeBy).toBe('Made at');
    expect(common.ru.help).toBe('Справка');
    expect(common.en.help).toBe('Help');
    expect(popup.ru.help).toBeUndefined(); // берётся из common, дубля нет
  });
});

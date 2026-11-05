// Подпись студии: «Сделано в Sitimlab · @sitimlab» (с 0.5.1 — ссылка на Telegram-канал студии) и ссылка на справку. Общая для
// меню, настроек, восстановления и справки.
// Ссылки открываются щелчком пользователя в новой вкладке; сам код расширения сеть не использует (NFR-01).
import { createT } from './i18n/index.js';
import { common } from './i18n/common.js';

export const SITIMLAB_URL = 'https://sitimlab.ru';
/** Telegram-канал студии (0.5.1): обычная ссылка, по ней переходит пользователь — расширение запросов не делает (NFR-01). */
export const TELEGRAM_URL = 'https://t.me/sitimlab';
export const TELEGRAM_HANDLE = '@sitimlab';
export const HELP_PATH = 'help/help.html';

/** @param {'ru'|'en'} lang */
export function madeByLine(lang) {
  const t = createT(common, lang);
  const p = document.createElement('p');
  p.className = 'made-by';
  // «Сделано в Sitimlab» — в своём span: у ссылки на сайт родитель с текстом ровно «Сделано в Sitimlab» (tests/e2e/brand.spec.js)
  const studio = document.createElement('span');
  studio.append(`${t('madeBy')} `);
  const a = document.createElement('a');
  a.href = SITIMLAB_URL;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = 'Sitimlab';
  a.dataset.testid = 'made-by-link';
  studio.append(a);
  p.append(studio, ' · ', channelLink(lang));
  return p;
}

/**
 * Ссылка на Telegram-канал студии «@sitimlab» (0.5.1): новая вкладка, без opener и referrer.
 * @param {'ru'|'en'} lang
 */
export function channelLink(lang) {
  const t = createT(common, lang);
  const a = document.createElement('a');
  a.href = TELEGRAM_URL;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = TELEGRAM_HANDLE;
  a.title = t('channel');
  a.dataset.testid = 'channel-link';
  return a;
}

/**
 * Ссылка «Справка» на страницу справки; `prefix` — путь от текущей страницы к корню расширения.
 * @param {'ru'|'en'} lang
 */
export function helpLink(lang, prefix = '../') {
  const t = createT(common, lang);
  const a = document.createElement('a');
  a.href = `${prefix}${HELP_PATH}`;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = t('help');
  a.dataset.testid = 'help-link';
  return a;
}

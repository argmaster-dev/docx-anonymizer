// Скрытые данные и ключ с паролем в браузере (версия 0.5, WP12-D, Ц4, Ц5, К7, К8, К13): панель показывает «В документе: …» и
// переключатели (по умолчанию выключены, выбор запоминается в настройках, включённый удаляет элементы из отправляемого файла);
// ключ восстановления сохраняется с паролем на странице расширения (панель на сайте полей пароля не содержит — ревью WP12-D:
// слушатели страницы видели бы ввод) и открывается на странице «Восстановить» только верным паролем; ни одного http(s)-запроса
// наружу. Страница чата — локальная (intercept-basic.html), https и http (шифрование идёт на странице расширения — работает и так).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from './fixtures.js';
import { captureAllRequests, externalRequests } from './helpers/network.js';
import { unzipText } from '../helpers/docx.js';

const ORIGIN = 'https://intercept.test';
const PAGE_HTML = readFileSync(resolve('tests/e2e/pages/intercept-basic.html'), 'utf8');
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const FX = resolve('tests/fixtures/hidden');
const EXPECTED = JSON.parse(readFileSync(resolve(FX, 'expected.json'), 'utf8'));
const PASSWORD = 'Зимний-вечер-2026';

/** Шпион страницы чата (проба ревьюера WP12-D): все события клавиатуры и ввода на window и document в фазе перехвата. */
const SPY = () => {
  window.__spy = [];
  const types = ['keydown', 'keypress', 'keyup', 'input', 'beforeinput', 'textInput', 'compositionend', 'change', 'focusin', 'paste'];
  for (const tgt of [window, document])
    for (const ty of types)
      tgt.addEventListener(
        ty,
        (e) => {
          let val;
          try {
            val = e.target && 'value' in e.target ? String(e.target.value) : undefined;
          } catch {
            /* чужой элемент */
          }
          window.__spy.push({ type: ty, key: e.key, data: e.data, val, target: e.target?.tagName });
        },
        true,
      );
};

async function setup(context, extensionId, extra = {}, origin = ORIGIN) {
  await context.route(`${origin}/**`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE_HTML }));
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await ext.evaluate(
    async ({ origin, extra }) =>
      chrome.storage.local.set({
        __e2eOpenShadow: true,
        settings: { interceptEnabled: true, allowlist: [origin], uiLanguage: 'ru', hintMappingShown: true, ...extra },
      }),
    { origin, extra },
  );
  await ext.close();
  const page = await context.newPage();
  await page.addInitScript(SPY);
  await page.goto(`${origin}/`);
  return page;
}
const dump = (page) => page.evaluate(() => window.__dump());
const storedSettings = async (context, extensionId) => {
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  const s = await ext.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
  await ext.close();
  return s;
};

test('скрытые данные: строка «В документе», переключатели выключены, выбор запоминается и удаляет комментарии; сеть — 0', async ({ context, extensionId }) => {
  const net = await captureAllRequests(context);
  const page = await setup(context, extensionId);
  await page.setInputFiles('#single', { name: 'договор.docx', mimeType: DOCX_MIME, buffer: readFileSync(resolve(FX, 'contract-hidden.docx')) });
  await expect(page.getByTestId('hidden-summary')).toHaveText('В документе: 3 комментария, история правок, скрытый текст', { timeout: 60000 });
  for (const flag of ['comments', 'revisions', 'hiddenText']) {
    await expect(page.getByTestId(`hidden-${flag}`)).toBeVisible();
    await expect(page.getByTestId(`hidden-${flag}`)).not.toBeChecked();
  }
  await expect(page.getByTestId('hidden-hiddenSlides')).toHaveCount(0); // переключатели только для найденного
  await page.screenshot({ path: resolve('test-output/hidden-panel.png') });
  await page.getByTestId('hidden-comments').check();
  await expect.poll(async () => (await storedSettings(context, extensionId))?.removeComments, { timeout: 10000 }).toBe(true);
  await expect(page.getByTestId('btn-anonymize')).toBeEnabled({ timeout: 30000 });
  await page.getByTestId('btn-anonymize').click();
  await expect(page.getByTestId('done-title')).toBeVisible({ timeout: 30000 });
  const [got] = await dump(page);
  const parts = unzipText(Buffer.from(got.b64, 'base64'));
  expect(parts['word/comments.xml']).toBeUndefined();
  expect(parts['word/document.xml']).not.toMatch(/<w:commentReference\b/);
  expect(parts['word/document.xml']).toMatch(/<w:ins\b/); // «Принять исправления» выключен — правки на месте
  const text = Object.values(parts).join('\n');
  for (const v of EXPECTED['contract-hidden.docx'].secrets) expect(text, v).not.toContain(v);

  // следующий файл: выбор уже стоит (из настроек)
  await page.reload();
  await page.setInputFiles('#single', { name: 'второй.docx', mimeType: DOCX_MIME, buffer: readFileSync(resolve(FX, 'real/lo-contract.docx')) });
  await expect(page.getByTestId('hidden-comments')).toBeChecked({ timeout: 60000 });
  await expect(page.getByTestId('hidden-revisions')).not.toBeChecked();
  expect(externalRequests(await net.stop(), [ORIGIN]), 'К13').toEqual([]);
});

for (const origin of ['https://intercept.test', 'http://intercept.test']) {
  test(`ключ с паролем (${origin.split(':')[0]}): «Сохранить с паролем…» → страница расширения; сайт не видит ни одного символа пароля; восстановление только верным паролем; сеть — 0`, async ({
    context,
    extensionId,
  }) => {
    const net = await captureAllRequests(context);
    const page = await setup(context, extensionId, {}, origin);
    await page.setInputFiles('#single', { name: 'договор.docx', mimeType: DOCX_MIME, buffer: readFileSync(resolve(FX, 'contract-hidden.docx')) });
    await expect(page.getByTestId('btn-anonymize')).toBeEnabled({ timeout: 60000 });
    // работа с панелью: поиск по найденному (буквы, которых нет в пароле) — ввод в панели страница видит, но пароля в панели нет вовсе
    await page.locator('docx-anonymizer-root .pv-search').pressSequentially('Солодку');
    await page.locator('docx-anonymizer-root .pv-search').fill('');
    await page.getByTestId('btn-anonymize').click();
    await expect(page.getByTestId('done-title')).toBeVisible({ timeout: 30000 });
    const [got] = await dump(page);
    const anonText = Object.values(unzipText(Buffer.from(got.b64, 'base64'))).join('\n');
    const token = /\[ФИО_\d+\]/.exec(anonText)?.[0];
    expect(token).toBeTruthy();

    await page.getByTestId('btn-more').click();
    await expect(page.locator('docx-anonymizer-root input[type="password"]')).toHaveCount(0);
    // шпион работает: ввод в панели страница видит (поэтому пароля в панели и нет)
    const typed = await page.evaluate(() => window.__spy.map((e) => [e.key, e.data].filter(Boolean).join('')).join(''));
    for (const ch of 'Солодку') expect(typed, `шпион видит «${ch}» из панели`).toContain(ch);
    await page.evaluate(() => (window.__spy.length = 0));
    const [savePage] = await Promise.all([context.waitForEvent('page'), page.getByTestId('btn-save-key-password').click()]);
    await savePage.waitForLoadState();
    expect(savePage.url()).toMatch(new RegExp(`^chrome-extension://${extensionId}/restore/restore\\.html\\?save=1&docId=d\\d+&name=`));
    await expect(savePage.getByTestId('key-save')).toContainText('Забытый пароль = потерянный ключ');
    await savePage.getByTestId('key-save-password').pressSequentially('коротко');
    await expect(savePage.getByTestId('key-save-meter')).toContainText('Длина: 7');
    await savePage.getByTestId('key-save-run').click();
    await expect(savePage.getByTestId('key-save-status')).toContainText('короче 8');
    await savePage.getByTestId('key-save-password').fill('');
    await savePage.getByTestId('key-save-password').pressSequentially(PASSWORD);
    await savePage.getByTestId('key-save-password2').pressSequentially(`${PASSWORD}!`);
    await savePage.getByTestId('key-save-run').click();
    await expect(savePage.getByTestId('key-save-status')).toHaveText('Пароли не совпадают');
    await savePage.getByTestId('key-save-password2').fill('');
    await savePage.getByTestId('key-save-password2').pressSequentially(PASSWORD);
    const [dl] = await Promise.all([savePage.waitForEvent('download', { timeout: 30000 }), savePage.getByTestId('key-save-password2').press('Enter')]);
    expect(dl.suggestedFilename()).toBe('договор.mapping.json');
    await expect(savePage.getByTestId('key-save-status')).toContainText('Ключ сохранён');
    await expect(savePage.getByTestId('key-save-password')).toHaveValue('');
    await expect(savePage.getByTestId('key-save-password2')).toHaveValue('');
    const keyPath = await dl.path();
    const keyText = readFileSync(keyPath, 'utf8');
    const key = JSON.parse(keyText);
    expect(Object.keys(key).sort()).toEqual(['ct', 'enc', 'encVersion', 'iv', 'kdf']);
    expect(key.kdf).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256' });
    expect(key.kdf.iterations).toBeGreaterThanOrEqual(600000);
    expect(keyText).not.toContain(token);
    for (const v of ['Громов', 'Зайцева', 'Сидорова', '+7 916']) expect(keyText).not.toContain(v);

    // страница чата не видела ни одного символа пароля (ни клавиш, ни данных ввода, ни значений полей)
    const spy = await page.evaluate(() => window.__spy);
    const seen = spy.map((e) => [e.key, e.data, e.val].filter(Boolean).join('')).join('');
    for (const ch of new Set(PASSWORD)) if (!/[-\d]/.test(ch)) expect(seen, `символ «${ch}»`).not.toContain(ch);
    expect(seen).not.toContain(PASSWORD.slice(0, 4));

    // восстановление: без пароля и с неверным — нет вывода, с верным — все метки
    const restore = await context.newPage();
    await restore.goto(`chrome-extension://${extensionId}/restore/restore.html`);
    await restore.getByTestId('source-file').check({ force: true });
    await restore.getByTestId('restore-input').fill(`Подписант: ${token}.`);
    await restore.getByTestId('mapping-file').setInputFiles(keyPath);
    await expect(restore.getByTestId('file-info')).toContainText('защищён паролем');
    await restore.getByTestId('restore-run').click();
    await expect(restore.getByTestId('restore-error')).toContainText('введите пароль');
    await restore.getByTestId('key-password').fill('не-тот-пароль');
    await restore.getByTestId('key-unlock').click();
    await expect(restore.getByTestId('file-info')).toContainText('Неверный пароль или файл ключа повреждён', { timeout: 30000 });
    await expect(restore.getByTestId('key-password')).toHaveValue('');
    await restore.getByTestId('restore-run').click();
    await expect(restore.getByTestId('restore-output')).not.toContainText('Подписант');
    await restore.getByTestId('key-password').fill(PASSWORD);
    await restore.getByTestId('key-password').press('Enter');
    await expect(restore.getByTestId('file-info')).toContainText('Ключ открыт', { timeout: 30000 });
    await restore.getByTestId('restore-run').click();
    await expect(restore.getByTestId('restore-output')).toContainText('Подписант: ');
    await expect(restore.getByTestId('restore-output')).not.toContainText(token);
    await expect(restore.getByTestId('restore-unresolved')).toContainText('Все метки восстановлены');
    const stored = JSON.stringify(await restore.evaluate(async () => chrome.storage.local.get(null)));
    expect(stored).not.toContain(PASSWORD);
    expect(externalRequests(await net.stop(), [origin]), 'К13').toEqual([]);
  });
}

// Скрытые данные и ключ с паролем в браузере (версия 0.5, WP12-D, Ц4, Ц5, К7, К8, К13): панель показывает «В документе: …» и
// переключатели (по умолчанию выключены, выбор запоминается в настройках, включённый удаляет элементы из отправляемого файла);
// ключ восстановления сохраняется с паролем и открывается на странице «Восстановить» только верным паролем; ни одного
// http(s)-запроса наружу. Страница чата — локальная (intercept-basic.html), под https: WebCrypto есть только в защищённом контексте.
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

async function setup(context, extensionId, extra = {}) {
  await context.route(`${ORIGIN}/**`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE_HTML }));
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await ext.evaluate(
    async ({ origin, extra }) =>
      chrome.storage.local.set({
        __e2eOpenShadow: true,
        settings: { interceptEnabled: true, allowlist: [origin], uiLanguage: 'ru', hintMappingShown: true, ...extra },
      }),
    { origin: ORIGIN, extra },
  );
  await ext.close();
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/`);
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

test('ключ с паролем: сохранение из «Ещё», страница восстановления — неверный пароль не открывает, верный открывает; сеть — 0', async ({
  context,
  extensionId,
}) => {
  const net = await captureAllRequests(context);
  const page = await setup(context, extensionId);
  await page.setInputFiles('#single', { name: 'договор.docx', mimeType: DOCX_MIME, buffer: readFileSync(resolve(FX, 'contract-hidden.docx')) });
  await expect(page.getByTestId('btn-anonymize')).toBeEnabled({ timeout: 60000 });
  await page.getByTestId('btn-anonymize').click();
  await expect(page.getByTestId('done-title')).toBeVisible({ timeout: 30000 });
  const [got] = await dump(page);
  const anonText = Object.values(unzipText(Buffer.from(got.b64, 'base64'))).join('\n');
  const token = /\[ФИО_\d+\]/.exec(anonText)?.[0];
  expect(token).toBeTruthy();

  await page.getByTestId('btn-more').click();
  await page.getByTestId('mapping-protect').check();
  await expect(page.getByTestId('mapping-password')).toBeVisible();
  await expect(page.getByTestId('more-menu')).toContainText('Забытый пароль = потерянный ключ');
  await page.getByTestId('mapping-password').fill('коротко');
  await expect(page.getByTestId('mapping-pw-meter')).toContainText('Длина: 7');
  await page.getByTestId('btn-download-mapping').click();
  await expect(page.getByTestId('mapping-pw-error')).toContainText('короче 8');
  await page.getByTestId('mapping-password').fill(PASSWORD);
  await page.getByTestId('mapping-password2').fill(`${PASSWORD}!`);
  await page.getByTestId('btn-download-mapping').click();
  await expect(page.getByTestId('mapping-pw-error')).toHaveText('Пароли не совпадают');
  await page.getByTestId('mapping-password2').fill(PASSWORD);
  await page.screenshot({ path: resolve('test-output/hidden-key-password.png') });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByTestId('btn-download-mapping').click()]);
  expect(dl.suggestedFilename()).toMatch(/\.mapping\.json$/);
  const keyPath = await dl.path();
  const keyText = readFileSync(keyPath, 'utf8');
  const key = JSON.parse(keyText);
  expect(Object.keys(key).sort()).toEqual(['ct', 'enc', 'encVersion', 'iv', 'kdf']);
  expect(key.kdf).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256' });
  expect(key.kdf.iterations).toBeGreaterThanOrEqual(600000);
  expect(keyText).not.toContain(token);
  for (const v of ['Громов', 'Зайцева', 'Сидорова', '+7 916']) expect(keyText).not.toContain(v);
  await expect(page.getByTestId('more-menu')).toBeHidden();

  const restore = await context.newPage();
  await restore.goto(`chrome-extension://${extensionId}/restore/restore.html`);
  await restore.getByTestId('source-file').check({ force: true });
  await restore.getByTestId('restore-input').fill(`Подписант: ${token}.`);
  await restore.getByTestId('mapping-file').setInputFiles(keyPath);
  await expect(restore.getByTestId('file-info')).toContainText('защищён паролем');
  await expect(restore.getByTestId('key-password')).toBeVisible();
  // без пароля восстановить нельзя
  await restore.getByTestId('restore-run').click();
  await expect(restore.getByTestId('restore-error')).toContainText('введите пароль');
  await expect(restore.getByTestId('restore-output')).not.toContainText('Подписант');
  // неверный пароль: понятный текст, ни карты, ни вывода
  await restore.getByTestId('key-password').fill('не-тот-пароль');
  await restore.getByTestId('key-unlock').click();
  await expect(restore.getByTestId('file-info')).toContainText('Неверный пароль или файл ключа повреждён', { timeout: 30000 });
  await expect(restore.getByTestId('key-password')).toHaveValue('');
  await restore.getByTestId('restore-run').click();
  await expect(restore.getByTestId('restore-output')).not.toContainText('Подписант');
  // верный пароль
  await restore.getByTestId('key-password').fill(PASSWORD);
  await restore.getByTestId('key-password').press('Enter');
  await expect(restore.getByTestId('file-info')).toContainText('Ключ открыт', { timeout: 30000 });
  await expect(restore.getByTestId('key-password')).toBeHidden();
  await restore.getByTestId('restore-run').click();
  await expect(restore.getByTestId('restore-output')).toContainText('Подписант: ');
  await expect(restore.getByTestId('restore-output')).not.toContainText(token);
  await expect(restore.getByTestId('restore-unresolved')).toContainText('Все метки восстановлены');
  // пароль нигде не сохранён
  const stored = JSON.stringify(await restore.evaluate(async () => chrome.storage.local.get(null)));
  expect(stored).not.toContain(PASSWORD);
  expect(externalRequests(await net.stop(), [ORIGIN]), 'К13').toEqual([]);
});

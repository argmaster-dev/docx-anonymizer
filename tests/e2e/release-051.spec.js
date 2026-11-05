// Версия 0.5.1 в браузере: ключ восстановления нельзя отправить в ИИ-чат (перехват отказывает — сайт не получает ключ ни при каком
// выборе), кодировка файла от ИИ на странице «Восстановить» (Windows-1251 сохраняется), ссылка на Telegram-канал в меню.
// Страница чата — локальная (intercept-basic.html под http://intercept.test), внешней сети нет. Данные — вымышленные.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from './fixtures.js';
import { writeTemp } from './helpers/chat.js';
import { captureAllRequests, externalRequests } from './helpers/network.js';
import { makeDocx, para, run } from '../helpers/docx.js';
import { encodeText } from '../../src/core/plain/encoding.js';

const ORIGIN = 'http://intercept.test';
const PAGE_HTML = readFileSync(resolve('tests/e2e/pages/intercept-basic.html'), 'utf8');
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAPPING = JSON.parse(readFileSync(resolve('tests/fixtures/deanon.json'), 'utf8')).mapping;
const KEY = Buffer.from(JSON.stringify(MAPPING, null, 2));
const KEY_ERROR = 'Это ключ восстановления (карта замен) — в нём настоящие значения. Его нельзя отправлять в ИИ-сервис.';
const docxFile = (name) => ({ name, mimeType: DOCX_MIME, buffer: Buffer.from(makeDocx(para(run('Связь: ivan.petrov@example.com. Срок — 10 дней.')))) });

async function setup(context, extensionId) {
  await context.route(`${ORIGIN}/**`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE_HTML }));
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await ext.evaluate(
    async ({ origin }) =>
      chrome.storage.local.set({ __e2eOpenShadow: true, settings: { interceptEnabled: true, allowlist: [origin], uiLanguage: 'ru', hintMappingShown: true } }),
    { origin: ORIGIN },
  );
  await ext.close();
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/`);
  return page;
}
const dump = (page) => page.evaluate(() => window.__dump());

test.describe('ключ восстановления не уходит в чат (0.5.1)', () => {
  test('приложил договор.mapping.json → отказ без «загрузить как есть», сайт ничего не получил', async ({ context, extensionId }) => {
    const page = await setup(context, extensionId);
    await page.setInputFiles('#single', { name: 'договор.mapping.json', mimeType: 'application/json', buffer: KEY });
    await expect(page.getByTestId('error-message')).toHaveText(KEY_ERROR, { timeout: 30000 });
    await expect(page.getByTestId('key-blocked-note')).toBeVisible();
    await expect(page.getByTestId('btn-asis')).toHaveCount(0);
    await expect(page.getByTestId('btn-retry')).toHaveCount(0);
    await expect(page.getByTestId('btn-original')).toHaveCount(0);
    await expect(page.getByTestId('btn-anonymize')).toBeDisabled();
    // Esc — просто отмена (загружать нечего): без подтверждения «загрузить оригинал»
    await page.keyboard.press('Escape');
    await expect(page.locator('docx-anonymizer-root')).toHaveCount(0);
    expect(await dump(page)).toEqual([]);
    expect(await page.evaluate(() => document.getElementById('single').files.length)).toBe(0);
  });

  test('[договор.docx, переименованный ключ заметки.txt] → сайт получает только договор.anon.docx; «оригинал» — тоже без ключа', async ({
    context,
    extensionId,
  }) => {
    const page = await setup(context, extensionId);
    const files = [docxFile('договор.docx'), { name: 'заметки.txt', mimeType: 'text/plain', buffer: KEY }];
    await page.setInputFiles('#multi', files);
    await expect(page.getByTestId('file-tab')).toHaveCount(2);
    await page.getByTestId('file-tab').nth(1).click();
    await expect(page.locator('.fview.active [data-testid="error-message"]')).toHaveText(KEY_ERROR, { timeout: 30000 });
    await expect(page.locator('.fview.active [data-testid="btn-asis"]')).toHaveCount(0);
    await expect(page.getByTestId('btn-anonymize')).toBeEnabled({ timeout: 30000 });
    await page.getByTestId('btn-anonymize').click();
    await expect(page.getByTestId('done-title')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('done-files')).not.toContainText('заметки');
    const got = await dump(page);
    expect(got.map((g) => g.name)).toEqual(['договор.anon.docx']);
    for (const e of MAPPING.entries) expect(Buffer.from(got[0].b64, 'base64').toString('latin1')).not.toContain(e.token);

    // «Загрузить оригинал» с тем же набором: уходит только договор, ключ остаётся у пользователя
    const page2 = await context.newPage();
    await page2.goto(`${ORIGIN}/`);
    await page2.setInputFiles('#multi', [docxFile('договор.docx'), { name: 'ключ.mapping.json', mimeType: 'application/json', buffer: KEY }]);
    await expect(page2.getByTestId('file-tab')).toHaveCount(2);
    await expect(page2.getByTestId('btn-anonymize')).toBeEnabled({ timeout: 30000 });
    await page2.getByTestId('btn-original').click();
    await page2.getByTestId('btn-original-confirm').click();
    await expect.poll(async () => (await dump(page2)).length).toBe(1);
    expect((await dump(page2)).map((g) => g.name)).toEqual(['договор.docx']);
    expect(await page2.evaluate(() => [...document.getElementById('multi').files].map((f) => f.name))).toEqual(['договор.docx']);
  });

  test('обычный JSON с полем entries — обрабатывается как прежде', async ({ context, extensionId }) => {
    const page = await setup(context, extensionId);
    const json = JSON.stringify({ entries: [{ id: 1, fio: 'Сидорова Мария Олеговна', email: 'maria.sidorova@example.org' }] }, null, 2);
    await page.setInputFiles('#single', { name: 'выгрузка.json', mimeType: 'application/json', buffer: Buffer.from(json) });
    await expect(page.getByTestId('pv-summary')).toContainText('Найдено', { timeout: 30000 });
    await page.getByTestId('btn-anonymize').click();
    await expect(page.getByTestId('done-title')).toBeVisible({ timeout: 30000 });
    expect((await dump(page)).map((g) => g.name)).toEqual(['выгрузка.anon.json']);
  });
});

test('«Восстановить»: ответ ИИ .txt в Windows-1251 → метки заменены, файл сохранён в 1251, предупреждение', async ({ context, extensionId }) => {
  const answer = 'Договор с ООО «[КОМПАНИЯ_1]» подписал [ФИО_1].\r\n';
  const aiPath = writeTemp('ответ-1251.txt', Buffer.from(encodeText(answer, { encoding: 'windows-1251', bom: false })));
  const keyPath = writeTemp('e2e-051.mapping.json', KEY);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/restore/restore.html`);
  await page.evaluate(() => chrome.storage.local.set({ settings: { uiLanguage: 'ru' } }));
  await page.reload();
  await page.getByTestId('restore-mode-file').check({ force: true });
  await page.getByTestId('ai-file').setInputFiles(aiPath);
  await expect(page.getByTestId('ai-file-info')).toContainText('кодировка Windows-1251');
  await page.getByTestId('mapping-file').setInputFiles(keyPath);
  await expect(page.getByTestId('file-info')).toContainText('Загружено записей');
  await page.getByTestId('restore-run').click();
  await expect(page.getByTestId('restore-output')).toContainText('Договор с ООО «Ромашка-Трейд» подписал Иванов Пётр Сергеевич.');
  await expect(page.getByTestId('restore-unresolved')).not.toContainText('Не найдено');
  await expect(page.getByTestId('restore-encoding')).toContainText('Кодировка файла — Windows-1251.');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('restore-download').click()]);
  expect(dl.suggestedFilename()).toBe('ответ-1251.restored.txt');
  // байт в байт — Windows-1251 (кириллица по байту на букву), а не UTF-8
  const want = 'Договор с ООО «Ромашка-Трейд» подписал Иванов Пётр Сергеевич.\r\n';
  expect([...readFileSync(await dl.path())]).toEqual([...encodeText(want, { encoding: 'windows-1251', bom: false })]);

  // ключ, пересохранённый в Windows-1251, — понятная ошибка
  const key1251 = writeTemp('e2e-051-1251.mapping.json', Buffer.from(encodeText(JSON.stringify(MAPPING), { encoding: 'windows-1251', bom: false })));
  await page.getByTestId('mapping-file').setInputFiles(key1251);
  await expect(page.getByTestId('file-info')).toContainText('не в кодировке UTF-8');
});

test('меню: ссылка на Telegram-канал @sitimlab рядом с «Сделано в Sitimlab», без сетевых запросов', async ({ context, extensionId }) => {
  const net = await captureAllRequests(context);
  for (const [path, lang, title] of [
    ['popup/popup.html', 'ru', 'Telegram-канал Sitimlab'],
    ['popup/popup.html', 'en', 'Sitimlab Telegram channel'],
    ['help/help.html', 'ru', 'Telegram-канал Sitimlab'],
  ]) {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${path}`);
    await page.evaluate((l) => chrome.storage.local.set({ settings: { uiLanguage: l } }), lang);
    await page.reload();
    const link = page.getByTestId('channel-link');
    await expect(link).toBeVisible();
    await expect(link).toHaveText('@sitimlab');
    await expect(link).toHaveAttribute('href', 'https://t.me/sitimlab');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toHaveAttribute('title', title);
    await expect(page.locator('.made-by')).toHaveText(lang === 'ru' ? /^\s*Сделано в Sitimlab\s*·\s*@sitimlab\s*$/ : /^\s*Made at Sitimlab\s*·\s*@sitimlab\s*$/);
    await page.close();
  }
  const urls = await net.stop();
  expect(externalRequests(urls)).toEqual([]);
});

// Форматы 0.5 в браузере (WP12-B, Ц1, Ц2, К1–К4, К13): перехват .xlsx, .pptx и .csv на сайте → панель → сайт получает файл того
// же формата с метками; восстановление ответа ИИ в этих форматах на странице «Восстановить» по сессии. Фикстуры —
// tests/fixtures/office (scripts/gen-office-fixtures.mjs). Страница чата — локальная (intercept-basic.html под http://intercept.test).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from './fixtures.js';
import { installClient, runPipeline } from './helpers/client.js';
import { writeTemp } from './helpers/chat.js';
import { captureAllRequests, externalRequests } from './helpers/network.js';
import { unzipText } from '../helpers/docx.js';
import { decodeText } from '../../src/core/plain/plain-adapter.js';
import { unescapeXml } from '../../src/core/ooxml/xml.js';

const ORIGIN = 'http://intercept.test';
const PAGE_HTML = readFileSync(resolve('tests/e2e/pages/intercept-basic.html'), 'utf8');
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const ALWAYS = new Set(['PERSON', 'PHONE', 'EMAIL', 'INN', 'SNILS', 'CARD', 'PASSPORT', 'ACCOUNT', 'ADDRESS', 'BIRTHDATE']);
const fx = (name) => ({
  bytes: readFileSync(resolve('tests/fixtures/office', name)),
  gold: JSON.parse(readFileSync(resolve('tests/fixtures/office', `${name}.gold.json`), 'utf8')),
});
const ooxmlText = (buf) =>
  Object.entries(unzipText(buf))
    .filter(([n]) => n.endsWith('.xml'))
    .map(([, x]) => unescapeXml(x))
    .join('\n');
const secretValues = (gold) => gold.entities.filter((e) => ALWAYS.has(e.category) && !e.meta).map((e) => e.value);

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

test.describe('перехват форматов 0.5', () => {
  test('.xlsx: панель с предупреждением о формулах → сайт получает .anon.xlsx того же типа без gold', async ({ context, extensionId }) => {
    const page = await setup(context, extensionId);
    const { bytes, gold } = fx('statement.xlsx');
    await page.setInputFiles('#single', { name: 'ведомость.xlsx', mimeType: XLSX, buffer: bytes });
    await expect(page.getByTestId('pv-summary')).toContainText('Найдено', { timeout: 60000 });
    await expect(page.locator('.warn', { hasText: 'ссылаются формулы' })).toBeVisible();
    expect(await dump(page)).toEqual([]);
    await page.getByTestId('btn-anonymize').click();
    await expect(page.getByTestId('done-title')).toBeVisible({ timeout: 30000 });
    const [got] = await dump(page);
    expect(got.name).toBe('ведомость.anon.xlsx');
    expect(got.type).toBe(XLSX);
    const text = ooxmlText(Buffer.from(got.b64, 'base64'));
    for (const v of secretValues(gold)) expect(text, v).not.toContain(v);
    expect(text).toMatch(/\[ИНН_\d+\]/);
  });

  test('[.pptx, .csv] → [.anon.pptx, .anon.csv]: слайды и CSV (Windows-1251, «;») обезличены, кодировка и разделитель на месте', async ({
    context,
    extensionId,
  }) => {
    const page = await setup(context, extensionId);
    const deck = fx('deck-table.pptx');
    const csv = fx('clients-semicolon-cp1251.csv');
    await page.setInputFiles('#multi', [
      { name: 'контакты.pptx', mimeType: PPTX, buffer: deck.bytes },
      { name: 'клиенты.csv', mimeType: 'text/csv', buffer: csv.bytes },
    ]);
    await expect(page.getByTestId('file-tab')).toHaveCount(2);
    await expect(page.getByTestId('btn-anonymize')).toBeEnabled({ timeout: 60000 });
    await page.getByTestId('btn-anonymize').click();
    await expect(page.getByTestId('done-title')).toBeVisible({ timeout: 30000 });
    const got = await dump(page);
    expect(got.map((g) => g.name)).toEqual(['контакты.anon.pptx', 'клиенты.anon.csv']);
    expect(got[0].type).toBe(PPTX);
    const slides = ooxmlText(Buffer.from(got[0].b64, 'base64'));
    for (const v of secretValues(deck.gold)) expect(slides, v).not.toContain(v);
    const out = decodeText(new Uint8Array(Buffer.from(got[1].b64, 'base64')));
    expect(out.encoding).toBe('windows-1251');
    expect(out.text.split('\r\n')[0]).toBe('ФИО;Телефон;E-mail;ИНН;Комментарий');
    for (const v of secretValues(csv.gold)) expect(out.text, v).not.toContain(v);
    expect(out.text.split('\r\n')).toHaveLength(decodeText(new Uint8Array(csv.bytes)).text.split('\r\n').length);
  });

  test('изображение и неизвестный файл проходят без панели (распознавание сканов — в следующей версии)', async ({ context, extensionId }) => {
    const page = await setup(context, extensionId);
    await page.setInputFiles('#single', { name: 'скан.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) });
    await expect.poll(async () => (await dump(page)).length).toBe(1);
    expect(await page.evaluate(() => document.querySelector('docx-anonymizer-root'))).toBeNull();
  });
});

/** Файл → ANALYZE → APPLY через порт расширения; сессия остаётся в offscreen. */
async function pipeline(context, extensionId, name, bytes) {
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await installClient(ext);
  const r = await runPipeline(ext, { name, bytes });
  await ext.close();
  return r;
}

test.describe('восстановление файла от ИИ: .xlsx, .pptx, .csv (К3)', () => {
  for (const [file, name, check] of [
    ['registry.xlsx', 'реестр.xlsx', (buf) => ooxmlText(buf)],
    ['deck-sales.pptx', 'итоги.pptx', (buf) => ooxmlText(buf)],
    ['clients-comma-utf8bom.csv', 'клиенты.csv', (buf) => decodeText(new Uint8Array(buf)).text],
  ]) {
    test(`${file}: .anon из конвейера + сессия → .restored того же формата, метки заменены значениями, без сети`, async ({ context, extensionId }) => {
      const net = await captureAllRequests(context);
      const { bytes } = fx(file);
      const run = await pipeline(context, extensionId, name, bytes);
      const anon = Buffer.from(run.b64, 'base64');
      expect(run.resultName).toBe(name.replace(/\.(\w+)$/, '.anon.$1'));
      const anonText = check(anon);
      const tokens = run.mapping.entries.filter((e) => anonText.includes(e.token));
      expect(tokens.length).toBeGreaterThan(3);
      const anonPath = writeTemp(run.resultName, anon);

      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/restore/restore.html?docId=${encodeURIComponent(run.ent.docId)}`);
      await page.evaluate(() => chrome.storage.local.set({ settings: { uiLanguage: 'ru' } }));
      await page.reload();
      await expect(page.getByTestId('source-session')).toBeChecked();
      await page.getByTestId('restore-mode-file').check({ force: true });
      await page.getByTestId('ai-file').setInputFiles(anonPath);
      await expect(page.getByTestId('ai-file-info')).toContainText(run.resultName);
      await page.getByTestId('restore-run').click();
      await expect(page.getByTestId('restore-docx-summary')).toBeVisible();
      await expect(page.getByTestId('restore-unresolved')).toContainText('Все метки восстановлены');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('restore-download').click()]);
      expect(dl.suggestedFilename()).toBe(name.replace(/\.(\w+)$/, '.restored.$1'));
      const back = check(readFileSync(await dl.path()));
      for (const e of tokens) {
        expect(back, e.token).not.toContain(e.token);
        expect(back, e.token).toContain(e.value);
      }
      expect(externalRequests(await net.stop()), 'NFR-01').toEqual([]);
    });
  }
});

test.describe('имя файла (ревью WP12-B)', () => {
  test('тот же файл под именем с ФИО → сайт получает имя с меткой, не исходное; два файла с одной меткой в имени — разные имена', async ({
    context,
    extensionId,
  }) => {
    const { makeDocx, para, run } = await import('../helpers/docx.js');
    const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const bytes = Buffer.from(makeDocx(para(run('Подписала Кравченко Ольга Петровна, почта k.olga@example.org.'))));
    const page = await setup(context, extensionId);
    await page.setInputFiles('#single', { name: 'договор.docx', mimeType: DOCX, buffer: bytes });
    await expect(page.getByTestId('btn-anonymize')).toBeEnabled({ timeout: 60000 });
    await page.getByTestId('btn-anonymize').click();
    await expect(page.getByTestId('done-title')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('btn-done-close').click();
    await page.setInputFiles('#single', { name: 'Кравченко_Ольга_Петровна.docx', mimeType: DOCX, buffer: bytes });
    await expect(page.getByTestId('btn-anonymize')).toBeEnabled({ timeout: 60000 });
    await page.getByTestId('btn-anonymize').click();
    await expect(page.getByTestId('done-title')).toBeVisible({ timeout: 30000 });
    const got = await dump(page);
    expect(got.map((g) => g.name)).toEqual(['договор.anon.docx', expect.stringMatching(/^\[ФИО_\d+\]\.anon\.docx$/)]);
    await page.getByTestId('btn-done-close').click();
    // одна отправка: два разных файла с одним человеком в имени — имена результатов не совпадают
    await page.setInputFiles('#multi', [
      { name: 'Иванов Иван Петрович.docx', mimeType: DOCX, buffer: Buffer.from(makeDocx(para(run('Первый файл.')))) },
      { name: 'Иванов_Иван_Петрович.docx', mimeType: DOCX, buffer: Buffer.from(makeDocx(para(run('Второй файл.')))) },
    ]);
    await expect(page.getByTestId('btn-anonymize')).toBeEnabled({ timeout: 60000 });
    await page.getByTestId('btn-anonymize').click();
    await expect(page.getByTestId('done-title')).toBeVisible({ timeout: 30000 });
    const names = (await dump(page)).slice(2).map((g) => g.name);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    for (const n of names) expect(n).not.toMatch(/Иванов/);
  });
});

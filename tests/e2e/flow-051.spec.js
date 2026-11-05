// Ключ восстановления при сбое хоста и инвалидации контекста (ревью 0.5.1): сценарий перехвата content/flow.js с поддельным chrome
// (tests/e2e/helpers/flow-entry.js) на локальной странице чата — хост недоступен (HOST_UNAVAILABLE) или контекст инвалидирован.
// Переименованный ключ узнаёт сам перехват по началу файла, ключ под именем *.mapping.json не уходит без ответа хоста; drop, paste и
// input — сайт получает только остальные файлы. Внешней сети нет. Данные — вымышленные.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { test, expect } from './fixtures.js';
import { makeDocx, para, run } from '../helpers/docx.js';

const ORIGIN = 'http://intercept.test';
const PAGE_HTML = readFileSync(resolve('tests/e2e/pages/intercept-basic.html'), 'utf8');
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAPPING = JSON.parse(readFileSync(resolve('tests/fixtures/deanon.json'), 'utf8')).mapping;
const KEY = JSON.stringify(MAPPING, null, 2);
/** под именем ключа, но по содержимому не узнаётся (ни правил по тексту, ни формы карты) — решает имя */
const WEAK_KEY = JSON.stringify({ entries: [{ token: 'abc', value: 'Иванов Пётр Сергеевич' }] });
const KEY_ERROR = 'Это ключ восстановления (карта замен) — в нём настоящие значения. Его нельзя отправлять в ИИ-сервис.';
const docxB64 = () => Buffer.from(makeDocx(para(run('Связь: ivan.petrov@example.com.')))).toString('base64');

let bundle;
async function setup(context, mode) {
  if (!bundle) {
    const r = await build({
      entryPoints: [resolve('tests/e2e/helpers/flow-entry.js')],
      bundle: true,
      format: 'iife',
      write: false,
      charset: 'utf8',
      target: ['chrome120'],
      define: { __BUNDLED_MODEL__: 'null', __VERSION__: '"0.5.1"' },
    });
    bundle = r.outputFiles[0].text;
  }
  await context.route(`${ORIGIN}/**`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE_HTML }));
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(bundle);
  await page.evaluate((m) => window.__startFlow(m), mode);
  return page;
}

/** Файлы — в DataTransfer страницы: [{name, type, b64}] (base64 — бинарные, text — текст UTF-8). */
function dispatch(page, kind, files) {
  return page.evaluate(
    ({ kind, files }) => {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f.b64 ? window.__make(f.name, f.type, f.b64) : new File([f.text], f.name, { type: f.type }));
      if (kind === 'drop')
        document.getElementById('dropzone').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, composed: true }));
      else
        document.getElementById('pastezone').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true }));
    },
    { kind, files },
  );
}
const received = (page) => page.evaluate(() => window.__received.map((r) => `${r.via}: ${r.name}`));
const view = (page, i) => page.locator('.fview').nth(i);

test.describe('ключ восстановления без хоста (0.5.1)', () => {
  test('drop [договор.docx, заметки.txt = ключ], хост недоступен: у ключа нет «как есть», договор уходит как есть, ключ — нет', async ({ context }) => {
    const page = await setup(context, 'unavailable');
    await dispatch(page, 'drop', [
      { name: 'договор.docx', type: DOCX_MIME, b64: docxB64() },
      { name: 'заметки.txt', type: 'text/plain', text: KEY },
    ]);
    await expect(page.getByTestId('file-tab')).toHaveCount(2);
    await expect(view(page, 1).getByTestId('error-message')).toHaveText(KEY_ERROR);
    await expect(view(page, 1).getByTestId('btn-asis')).toHaveCount(0);
    await expect(view(page, 0).getByTestId('error-message')).toContainText('Модуль обработки недоступен');
    await page.getByTestId('file-tab').nth(0).click();
    await view(page, 0).getByTestId('btn-asis').click();
    await page.getByTestId('btn-anonymize').click();
    await expect.poll(() => received(page)).toEqual(['drop: договор.docx']);
  });

  test('paste [ключ.mapping.json — не узнаётся по содержимому, договор.docx], хост недоступен: ключ не уходит по имени', async ({ context }) => {
    const page = await setup(context, 'unavailable');
    await dispatch(page, 'paste', [
      { name: 'ключ.mapping.json', type: 'application/json', text: WEAK_KEY },
      { name: 'договор.docx', type: DOCX_MIME, b64: docxB64() },
    ]);
    await expect(page.getByTestId('file-tab')).toHaveCount(2);
    await expect(view(page, 0).getByTestId('error-message')).toHaveText(KEY_ERROR, { timeout: 10000 });
    await expect(view(page, 0).getByTestId('btn-asis')).toHaveCount(0);
    await expect(view(page, 0).getByTestId('btn-retry')).toHaveCount(0);
    await page.getByTestId('file-tab').nth(1).click();
    await view(page, 1).getByTestId('btn-asis').click();
    await page.getByTestId('btn-anonymize').click();
    await expect.poll(() => received(page)).toEqual(['paste: договор.docx']);
  });

  test('drop одного переименованного ключа, хост недоступен: отказ, «оригинала» нет, Esc — отмена, сайт ничего не получил', async ({ context }) => {
    const page = await setup(context, 'unavailable');
    await dispatch(page, 'drop', [{ name: 'ответ.md', type: 'text/markdown', text: `Сохранил:\n\`\`\`json\n${KEY}\n\`\`\`\n` }]);
    await expect(page.getByTestId('error-message')).toHaveText(KEY_ERROR);
    await expect(page.getByTestId('btn-original')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('docx-anonymizer-root')).toHaveCount(0);
    expect(await received(page)).toEqual([]);
  });

  for (const [label, keyFile] of [
    ['переименованный ключ заметки.txt', { name: 'заметки.txt', type: 'text/plain', text: KEY }],
    ['ключ.mapping.json, не узнаваемый по содержимому', { name: 'ключ.mapping.json', type: 'application/json', text: WEAK_KEY }],
  ])
    test(`инвалидация контекста, input [договор.docx, ${label}] → «Загрузить оригинал» отдаёт только договор`, async ({ context }) => {
      const page = await setup(context, 'invalidated');
      await page.setInputFiles('#multi', [
        { name: 'договор.docx', mimeType: DOCX_MIME, buffer: Buffer.from(docxB64(), 'base64') },
        { name: keyFile.name, mimeType: keyFile.type, buffer: Buffer.from(keyFile.text) },
      ]);
      await expect(page.getByTestId('notice-title')).toBeVisible();
      await page.getByTestId('btn-notice-original').click();
      await expect.poll(() => received(page)).toEqual(['multi: договор.docx']);
      expect(await page.evaluate(() => [...document.getElementById('multi').files].map((f) => f.name))).toEqual(['договор.docx']);
    });

  test('инвалидация контекста, drop только ключа → «Загрузить оригинал» ничего не отдаёт', async ({ context }) => {
    const page = await setup(context, 'invalidated');
    await dispatch(page, 'drop', [{ name: 'k.json', type: 'application/json', text: KEY }]);
    await expect(page.getByTestId('notice-title')).toBeVisible();
    await page.getByTestId('btn-notice-original').click();
    await expect(page.locator('docx-anonymizer-root')).toHaveCount(0);
    expect(await received(page)).toEqual([]);
  });
});

// Версия 0.5.2 (WP14-A, docs/concept-0.5.2.md Ц2–Ц4, К2–К5): сторож не пропускает файл молча. Настоящее расширение (dist-e2e),
// локальная страница tests/e2e/pages/intercept-basic.html под origin http://intercept.test, внешней сети нет. Данные — вымышленные.
// К2: неподдерживаемый файл (.jpg, .png, .zip, .doc, без расширения) на выборе, перетаскивании и вставке — до решения сайт получает 0 файлов,
// после «Отмены» — 0, после «Загрузить как есть» — ровно исходные байты. К3: смешанный выбор. К4: список «не спрашивать», ключ.
// К5: во время обработки input.files.length === 0; после «оригинала» и «как есть» — исходные файлы, после обезличивания — обезличенные.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from './fixtures.js';
import { makeDocx, para, run, unzipText } from '../helpers/docx.js';

const ORIGIN = 'http://intercept.test';
const PAGE_HTML = readFileSync(resolve('tests/e2e/pages/intercept-basic.html'), 'utf8');
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const EMAIL = 'olga.vymyslova@example.com';
const KEY = JSON.stringify(JSON.parse(readFileSync(resolve('tests/fixtures/deanon.json'), 'utf8')).mapping, null, 2);
const sha = (b) => createHash('sha256').update(b).digest('hex');

/** Неподдерживаемые файлы К2: имя, тип, байты, ожидаемый текст отказа. */
const UNSUPPORTED = [
  {
    name: 'паспорт.jpg',
    type: 'image/jpeg',
    bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]),
    text: 'Формат .jpg не проверяется на персональные данные',
  },
  {
    name: 'схема.png',
    type: 'image/png',
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
    text: 'Формат .png не проверяется на персональные данные',
  },
  {
    name: 'документы.zip',
    type: 'application/zip',
    bytes: Buffer.from('PK\u0003\u0004 вымышленный архив'),
    text: 'Формат .zip не проверяется на персональные данные',
  },
  {
    name: 'старый.doc',
    type: 'application/msword',
    bytes: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    text: 'Формат .doc не проверяется на персональные данные',
  },
  { name: 'README', type: '', bytes: Buffer.from('просто заметка без данных'), text: 'Файл без расширения не проверяется на персональные данные' },
];
const docxBytes = () => Buffer.from(makeDocx(para(run(`Связь с исполнителем: ${EMAIL}. Срок — 10 дней.`))));

async function setup(context, extensionId, extra = {}) {
  await context.route(`${ORIGIN}/**`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE_HTML }));
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await ext.evaluate(
    async ({ origin, extra }) => {
      await chrome.storage.local.set({
        __e2eOpenShadow: true,
        settings: { interceptEnabled: true, allowlist: [origin], uiLanguage: 'ru', hintMappingShown: true, ...extra },
      });
    },
    { origin: ORIGIN, extra },
  );
  await ext.close();
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/`);
  return page;
}

/** Файлы — на страницу одним путём: input (#multi, setInputFiles), drop (#dropzone) или paste (#pastezone). */
async function attach(page, via, files) {
  if (via === 'input') {
    await page.setInputFiles(
      '#multi',
      files.map((f) => ({ name: f.name, mimeType: f.type, buffer: f.bytes })),
    );
    return;
  }
  await page.evaluate(
    ({ via, files }) => {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(window.__make(f.name, f.type, f.b64));
      if (via === 'drop')
        document.getElementById('dropzone').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, composed: true }));
      else
        document.getElementById('pastezone').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true }));
    },
    { via, files: files.map((f) => ({ name: f.name, type: f.type, b64: f.bytes.toString('base64') })) },
  );
}

const dump = (page) => page.evaluate(() => window.__dump());
const inputCount = (page) => page.evaluate(() => document.getElementById('multi').files.length);
const view = (page, i) => page.locator('.fview').nth(i);
const root = (page) => page.locator('docx-anonymizer-root');

test.describe('неподдерживаемый файл не уходит молча (К2)', () => {
  for (const via of ['input', 'drop', 'paste']) {
    test(`${via}: .jpg, .png, .zip, .doc, без расширения — 0 файлов до решения и после «Отмены», после «как есть» — исходные байты`, async ({
      context,
      extensionId,
    }) => {
      const page = await setup(context, extensionId);
      await attach(page, via, UNSUPPORTED);
      await expect(page.getByTestId('file-tab')).toHaveCount(UNSUPPORTED.length);
      for (let i = 0; i < UNSUPPORTED.length; i++) {
        await page.getByTestId('file-tab').nth(i).click();
        await expect(view(page, i).getByTestId('error-message')).toHaveText(UNSUPPORTED[i].text);
        await expect(view(page, i).getByTestId('btn-asis')).toBeVisible();
        await expect(view(page, i).getByTestId('btn-retry')).toHaveCount(0);
      }
      await expect(page.getByTestId('btn-anonymize')).toBeDisabled(); // без решения ни один файл не уходит
      expect(await dump(page)).toEqual([]);
      if (via === 'input') expect(await inputCount(page)).toBe(0); // К5: поле очищено сразу
      // «Отмена» — ничего
      await page.getByTestId('btn-cancel').click();
      if (await page.getByTestId('btn-confirm-cancel').count()) await page.getByTestId('btn-confirm-cancel').click();
      await expect(root(page)).toHaveCount(0);
      expect(await dump(page)).toEqual([]);
      expect(await page.evaluate(() => window.__events)).toBe(0);
      if (via === 'input') expect(await inputCount(page)).toBe(0);

      // снова — и «Загрузить как есть» у каждого файла
      await attach(page, via, UNSUPPORTED);
      await expect(page.getByTestId('file-tab')).toHaveCount(UNSUPPORTED.length);
      for (let i = 0; i < UNSUPPORTED.length; i++) {
        await page.getByTestId('file-tab').nth(i).click();
        await view(page, i).getByTestId('btn-asis').click();
      }
      await expect(page.getByTestId('btn-anonymize')).toHaveText('Загрузить');
      await page.getByTestId('btn-anonymize').click();
      await expect.poll(async () => (await dump(page)).length).toBe(UNSUPPORTED.length);
      const got = await dump(page);
      expect(got.map((g) => g.name)).toEqual(UNSUPPORTED.map((f) => f.name));
      for (let i = 0; i < got.length; i++) expect(sha(Buffer.from(got[i].b64, 'base64')), got[i].name).toBe(sha(UNSUPPORTED[i].bytes));
      if (via === 'input') {
        expect(await page.evaluate(() => window.__events)).toBe(1);
        expect(await page.evaluate(() => [...document.getElementById('multi').files].map((f) => f.name))).toEqual(UNSUPPORTED.map((f) => f.name));
      }
    });
  }

  test('одна картинка: Esc → подтверждение закрытия → «Отменить загрузку» — 0 файлов', async ({ context, extensionId }) => {
    const page = await setup(context, extensionId);
    await attach(page, 'input', [UNSUPPORTED[0]]);
    await expect(page.getByTestId('error-message')).toHaveText(UNSUPPORTED[0].text);
    await expect(page.getByTestId('error-note')).toContainText('Загрузить как есть');
    await page.keyboard.press('Escape');
    await page.getByTestId('btn-confirm-cancel').click();
    await expect(root(page)).toHaveCount(0);
    expect(await dump(page)).toEqual([]);
  });

  test("PDF при pdfMode 'off' — предупреждение, что перехват PDF выключен в настройках; «как есть» — исходный PDF", async ({ context, extensionId }) => {
    const page = await setup(context, extensionId, { pdfMode: 'off' });
    const pdf = { name: 'справка.pdf', type: 'application/pdf', bytes: Buffer.from('%PDF-1.4\n% вымышленный\n%%EOF\n') };
    await attach(page, 'drop', [pdf]);
    await expect(page.getByTestId('error-message')).toHaveText('Перехват PDF выключен в настройках — файл не проверяется на персональные данные');
    expect(await dump(page)).toEqual([]);
    await page.getByTestId('btn-asis').click();
    await page.getByTestId('btn-anonymize').click();
    await expect.poll(async () => (await dump(page)).length).toBe(1);
    const [got] = await dump(page);
    expect([got.name, sha(Buffer.from(got.b64, 'base64'))]).toEqual([pdf.name, sha(pdf.bytes)]);
  });
});

test.describe('смешанный выбор и поле выбора (К3, К5)', () => {
  for (const asIs of [false, true])
    test(`input [договор.docx, паспорт.jpg]: ${asIs ? 'с «как есть» — обезличенный договор и картинка' : 'без «как есть» — только обезличенный договор'}`, async ({
      context,
      extensionId,
    }) => {
      const page = await setup(context, extensionId);
      await attach(page, 'input', [{ name: 'договор.docx', type: DOCX_MIME, bytes: docxBytes() }, UNSUPPORTED[0]]);
      await expect(page.getByTestId('file-tab')).toHaveCount(2); // одна панель на оба файла
      expect(await inputCount(page)).toBe(0); // во время обработки поле пустое
      await expect(view(page, 1).getByTestId('error-message')).toHaveText(UNSUPPORTED[0].text);
      await expect(page.getByTestId('btn-anonymize')).toBeEnabled({ timeout: 30000 });
      expect(await inputCount(page)).toBe(0);
      expect(await dump(page)).toEqual([]);
      if (asIs) {
        await page.getByTestId('file-tab').nth(1).click();
        await view(page, 1).getByTestId('btn-asis').click();
      }
      await page.getByTestId('btn-anonymize').click();
      await expect(page.getByTestId('done-title')).toBeVisible({ timeout: 30000 });
      await expect.poll(async () => (await dump(page)).length).toBe(asIs ? 2 : 1);
      const got = await dump(page);
      expect(got.map((g) => g.name)).toEqual(asIs ? ['договор.anon.docx', 'паспорт.jpg'] : ['договор.anon.docx']);
      expect(Object.values(unzipText(Buffer.from(got[0].b64, 'base64'))).join('\n')).not.toContain(EMAIL);
      if (asIs) expect(sha(Buffer.from(got[1].b64, 'base64'))).toBe(sha(UNSUPPORTED[0].bytes));
      // в поле — то же, что получил сайт
      expect(await page.evaluate(() => [...document.getElementById('multi').files].map((f) => f.name))).toEqual(got.map((g) => g.name));
      expect(await page.evaluate(() => window.__events)).toBe(1);
    });

  test('«Загрузить оригинал» при [договор.docx, паспорт.jpg, ключ.txt]: в поле ровно исходные договор и картинка, ключа нет', async ({
    context,
    extensionId,
  }) => {
    const page = await setup(context, extensionId);
    const doc = { name: 'договор.docx', type: DOCX_MIME, bytes: docxBytes() };
    await attach(page, 'input', [doc, UNSUPPORTED[0], { name: 'ключ.txt', type: 'text/plain', bytes: Buffer.from(KEY) }]);
    await expect(page.getByTestId('file-tab')).toHaveCount(3);
    expect(await inputCount(page)).toBe(0);
    await expect(page.getByTestId('btn-original')).toBeVisible();
    await page.getByTestId('btn-original').click();
    await page.getByTestId('btn-original-confirm').click();
    await expect.poll(async () => (await dump(page)).length).toBe(2);
    const got = await dump(page);
    expect(got.map((g) => [g.name, sha(Buffer.from(g.b64, 'base64'))])).toEqual([
      [doc.name, sha(doc.bytes)],
      [UNSUPPORTED[0].name, sha(UNSUPPORTED[0].bytes)],
    ]);
    expect(await page.evaluate(() => [...document.getElementById('multi').files].map((f) => f.name))).toEqual([doc.name, UNSUPPORTED[0].name]);
  });
});

test.describe('список «не спрашивать» (К4)', () => {
  test('png и zip в списке: проходят без панели на всех трёх путях, как в 0.5.1; jpg — по-прежнему с панелью', async ({ context, extensionId }) => {
    const page = await setup(context, extensionId, { skipExtensions: ['png', 'zip'] });
    const png = UNSUPPORTED[1];
    const zip = UNSUPPORTED[2];
    await attach(page, 'input', [png, zip]);
    await expect.poll(async () => (await dump(page)).length).toBe(2);
    await attach(page, 'drop', [png]);
    await attach(page, 'paste', [zip]);
    await expect
      .poll(async () => (await dump(page)).map((g) => `${g.via}: ${g.name}`))
      .toEqual(['multi: схема.png', 'multi: документы.zip', 'drop: схема.png', 'paste: документы.zip']);
    await expect(root(page)).toHaveCount(0);
    await attach(page, 'drop', [UNSUPPORTED[0]]);
    await expect(page.getByTestId('error-message')).toHaveText(UNSUPPORTED[0].text);
  });

  test('смешанный выбор со списком: png уходит без вопроса, договор — через панель', async ({ context, extensionId }) => {
    const page = await setup(context, extensionId, { skipExtensions: ['png'] });
    await attach(page, 'drop', [UNSUPPORTED[1], { name: 'договор.docx', type: DOCX_MIME, bytes: docxBytes() }]);
    await expect(page.getByTestId('file-tab')).toHaveCount(1); // в панели только договор
    await expect(page.getByTestId('btn-anonymize')).toBeEnabled({ timeout: 30000 });
    expect(await dump(page)).toEqual([]);
    await page.getByTestId('btn-anonymize').click();
    await expect.poll(async () => (await dump(page)).map((g) => g.name)).toEqual(['схема.png', 'договор.anon.docx']);
  });

  test('ключ восстановления не уходит при любом списке: json/txt в хранилище (мимо валидатора) и переименованный в .dat ключ не получают «как есть»', async ({
    context,
    extensionId,
  }) => {
    // список поправлен в хранилище вручную: migrateSettings отбрасывает неверный список целиком
    const page = await setup(context, extensionId, { skipExtensions: ['json', 'txt', 'png'] });
    await attach(page, 'drop', [{ name: 'договор.mapping.json', type: 'application/json', bytes: Buffer.from(KEY) }]);
    await expect(page.getByTestId('error-message')).toContainText('ключ восстановления', { timeout: 30000 });
    await expect(page.getByTestId('btn-asis')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(root(page)).toHaveCount(0);
    // png из того же (отброшенного) списка тоже спрашивается
    await attach(page, 'paste', [UNSUPPORTED[1]]);
    await expect(page.getByTestId('error-message')).toHaveText(UNSUPPORTED[1].text);
    await page.getByTestId('btn-cancel').click();
    await expect(root(page)).toHaveCount(0);
    // переименованный ключ с неподдерживаемым расширением узнаётся по началу файла: «как есть» нет
    await attach(page, 'input', [{ name: 'архив.dat', type: '', bytes: Buffer.from(KEY) }]);
    await expect(page.getByTestId('error-message')).toContainText('ключ восстановления');
    await expect(page.getByTestId('btn-asis')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(root(page)).toHaveCount(0);
    expect(await dump(page)).toEqual([]);
    expect(await inputCount(page)).toBe(0);
  });

  test('страница настроек: поле «не спрашивать» сохраняет список, поддерживаемые форматы отклоняет с пояснением', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options/options.html`);
    await page.evaluate(() => chrome.storage.local.set({ settings: { uiLanguage: 'ru' } }));
    await page.reload();
    const field = page.getByTestId('skip-ext');
    await expect(page.getByTestId('skip-ext-hint')).toContainText('Поддерживаемые форматы');
    await field.fill('.PNG, jpg; *.zip');
    await field.press('Enter');
    await expect(field).toHaveValue('png, jpg, zip');
    await expect.poll(() => page.evaluate(async () => (await chrome.storage.local.get('settings')).settings.skipExtensions)).toEqual(['png', 'jpg', 'zip']);
    await field.fill('png, json, txt');
    await field.press('Enter');
    await expect(page.getByTestId('skip-ext-err')).toHaveText('Эти форматы расширение проверяет, их нельзя добавить в список: .json, .txt');
    await expect(field).toHaveClass(/invalid/);
    expect(await page.evaluate(async () => (await chrome.storage.local.get('settings')).settings.skipExtensions)).toEqual(['png', 'jpg', 'zip']);
    await field.fill('');
    await field.press('Enter');
    await expect.poll(() => page.evaluate(async () => (await chrome.storage.local.get('settings')).settings.skipExtensions)).toEqual([]);
  });
});

test.describe('контрольные документы docs/verify (К7)', () => {
  test('все пять файлов одной отправкой: картинка — «не проверяется», в четырёх обезличенных нет ни одного обязательного значения', async ({
    context,
    extensionId,
  }) => {
    const { docs } = JSON.parse(readFileSync(resolve('docs/verify/expected.json'), 'utf8'));
    const MIME = { docx: DOCX_MIME, xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf', png: 'image/png' };
    const page = await setup(context, extensionId);
    await attach(
      page,
      'input',
      docs.map((d) => ({ name: d.file, type: MIME[d.file.split('.').pop()], bytes: readFileSync(resolve('docs/verify', d.file)) })),
    );
    await expect(page.getByTestId('file-tab')).toHaveCount(docs.length);
    const img = docs.findIndex((d) => d.unsupported);
    await expect(view(page, img).getByTestId('error-message')).toHaveText('Формат .png не проверяется на персональные данные');
    await expect(page.getByTestId('btn-anonymize')).toBeEnabled({ timeout: 60000 });
    await page.getByTestId('btn-anonymize').click();
    await expect(page.getByTestId('done-title')).toBeVisible({ timeout: 60000 });
    await expect.poll(async () => (await dump(page)).length).toBe(docs.length - 1); // картинка без «как есть» не ушла
    const got = await dump(page);
    expect(got.map((g) => g.name)).toEqual(['01-dogovor.anon.docx', '02-reestr-klientov.anon.xlsx', '03-spravka.anon.md', '05-trudnye-sluchai.anon.docx']);
    const norm = (s) =>
      s
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[\s\u00a0]+/g, ' ');
    const unesc = (s) =>
      s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
    const textOf = (g) => {
      const bytes = Buffer.from(g.b64, 'base64');
      if (g.name.endsWith('.md')) return bytes.toString('utf8');
      return Object.entries(unzipText(bytes))
        .filter(([n]) => n.endsWith('.xml'))
        .map(([, x]) => unesc(x.replace(/<[^>]+>/g, ' ')))
        .join('\n');
    };
    const sent = docs.filter((d) => !d.unsupported);
    for (let i = 0; i < sent.length; i++) {
      const out = norm(textOf(got[i]));
      for (const x of sent[i].expect.filter((v) => !v.mayMiss)) expect(out, `${sent[i].file}: ${x.category}`).not.toContain(norm(x.value));
      for (const s of sent[i].stays) expect(out, `${sent[i].file}: остаётся`).toContain(norm(s));
    }
  });
});

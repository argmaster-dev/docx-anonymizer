// Снимки для магазинов и README (версия 0.5, WP12-F, К15/К16): `npm run store:shots` (scripts/store-shots.mjs).
// Расширение — e2e-сборка dist-e2e/ (с моделью NER, если пакет есть в release/); сайт — нейтральная локальная страница
// tests/shots/pages/chat-demo.html под вымышленным https://chat.example (context.route, сети нет); документы — только
// синтетические фикстуры tests/fixtures. Подпись студии на страницах расширения скрывается, чужих логотипов и названий
// ИИ-сервисов в кадре нет. Выход: docs/store/images/{ru,en}/NN-*.png (1280×800), docs/store/images/promo-*.png,
// docs/screenshots/*.png (README, только ru). SHOTS_ONLY=store|readme|promo — часть набора.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test, expect } from '../e2e/fixtures.js';
import { unzipText } from '../helpers/docx.js';

const ORIGIN = 'https://chat.example';
const CHAT_HTML = readFileSync(resolve('tests/shots/pages/chat-demo.html'), 'utf8');
const PROMO_HTML = readFileSync(resolve('tests/shots/pages/promo.html'), 'utf8');
const STORE_DIR = resolve('docs/store/images');
const README_DIR = resolve('docs/screenshots');
const ONLY = process.env.SHOTS_ONLY || '';
const W = 1280;
const H = 800;
// подпись студии и служебный раздел «Проверка конвейера (dev)» в кадр не попадают
const HIDE_CSS = '.made-by, #made-by, #dev-pipeline { display: none !important; }';

const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const fixture = (path, name) => ({ name, mimeType: MIME[path.split('.').pop()], buffer: readFileSync(resolve('tests/fixtures', path)) });

// Документы кадров: ru — договоры и выгрузки на русском, en — английский договор там, где это Word
const DOCS = {
  ru: {
    word: fixture('docs/two-companies.docx', 'Договор поставки.docx'),
    hidden: fixture('hidden/contract-hidden.docx', 'Договор (правки юриста).docx'),
    excel: fixture('genres/xlsx-crm/crm-contacts.xlsx', 'Контакты CRM.xlsx'),
    deck: fixture('genres/pptx-deck/deck-contacts.pptx', 'Презентация для партнёра.pptx'),
  },
  en: {
    word: fixture('docs/english-contract.docx', 'Service agreement.docx'),
    hidden: fixture('hidden/contract-hidden.docx', 'Contract (lawyer edits).docx'),
    excel: fixture('genres/xlsx-crm/crm-contacts.xlsx', 'CRM contacts.xlsx'),
    deck: fixture('genres/pptx-deck/deck-contacts.pptx', 'Partner deck.pptx'),
  },
};

async function settings(context, extensionId, lang, extra = {}) {
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await ext.evaluate(
    async ({ origin, lang, extra }) => {
      await chrome.storage.local.set({
        __e2eOpenShadow: true,
        settings: { interceptEnabled: true, allowlist: [origin], uiLanguage: lang, hintMappingShown: true, ...extra },
      });
    },
    { origin: ORIGIN, lang, extra },
  );
  await ext.close();
}

async function openChat(context, extensionId, lang, extra) {
  await context.route(`${ORIGIN}/**`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: CHAT_HTML }));
  await settings(context, extensionId, lang, extra);
  const page = await context.newPage();
  await page.setViewportSize({ width: W, height: H });
  await page.goto(`${ORIGIN}/?lang=${lang}`);
  return page;
}

/** Приложить файл и дождаться конца анализа (кнопка «Анонимизировать» доступна). */
async function attach(page, file) {
  await page.setInputFiles('#file', file);
  await expect(page.getByTestId('btn-anonymize')).toBeEnabled({ timeout: 60000 });
  await page.waitForTimeout(400); // анимация появления панели
}

async function extPage(context, extensionId, path, { width = W, height = H, lang = 'ru' } = {}) {
  const p = await context.newPage();
  await p.setViewportSize({ width, height });
  await p.goto(`chrome-extension://${extensionId}/${path}`);
  await p.evaluate(async (lang) => {
    const { settings = {} } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, uiLanguage: lang } });
  }, lang);
  await p.reload();
  await p.addStyleTag({ content: HIDE_CSS });
  await p.waitForTimeout(500);
  return p;
}

const shot = async (page, file, opts = {}) => {
  mkdirSync(join(file, '..'), { recursive: true });
  await page.screenshot({ path: file, ...opts });
};

/** Ответ «ИИ» с метками из обезличенного файла: первые метки людей, ИНН, телефона и паспорта, какие нашлись. */
function aiAnswer(anonText, lang) {
  const tags = [...new Set(anonText.match(/\[[A-ZА-ЯЁ_]+_\d+\]/g) || [])];
  const pick = (re) => tags.find((x) => re.test(x));
  const per = tags.filter((x) => /^\[(ФИО|PERSON|NAME)_/.test(x));
  const inn = pick(/^\[(ИНН|INN|TIN)_/);
  const phone = pick(/^\[(ТЕЛ|PHONE)_/);
  // почта второй стороны (вторая метка), если есть: претензии уходят покупателю
  const mails = tags.filter((x) => /^\[EMAIL_/.test(x));
  const mail = mails[1] || mails[0];
  const ru = [
    'Основные риски для поставщика:',
    `1. Договор от имени поставщика подписывает ${per[0] || '[ФИО_1]'}${inn ? ` (ИНН ${inn})` : ''} — проверьте полномочия по доверенности.`,
    `2. Претензии направляются ${per[1] ? `представителю покупателя ${per[1]}` : 'покупателю'}${mail ? ` на адрес ${mail}` : ''}; срок ответа — 10 дней.`,
    `3. Штраф за просрочку поставки не ограничен сверху — предложите предел 10 % от цены партии.${phone ? ` Контакт для согласования: ${phone}.` : ''}`,
  ];
  const en = [
    'Key risks for the supplier:',
    `1. The agreement is signed for the supplier by ${per[0] || '[PERSON_1]'}${inn ? ` (tax ID ${inn})` : ''} — check the power of attorney.`,
    `2. Claims go to ${per[1] ? `the buyer's representative ${per[1]}` : 'the buyer'}${mail ? ` at ${mail}` : ''}; the reply period is 10 days.`,
    `3. The late delivery penalty has no cap — propose a limit of 10 % of the batch price.${phone ? ` Contact for approval: ${phone}.` : ''}`,
  ];
  return (lang === 'en' ? en : ru).join('\n');
}

for (const lang of ['ru', 'en']) {
  test(`магазин: снимки 1280×800 (${lang})`, async ({ context, extensionId }) => {
    test.skip(ONLY && ONLY !== 'store', `SHOTS_ONLY=${ONLY}`);
    test.setTimeout(240000);
    const dir = join(STORE_DIR, lang);
    const docs = DOCS[lang];

    // 1. Word: панель над чатом — найденные данные и метки
    const page = await openChat(context, extensionId, lang);
    await attach(page, docs.word);
    await shot(page, join(dir, '01-panel-word.png'));
    // 2. вкладка «Текст»: документ с подсвеченными находками
    await page.getByTestId('pv-tab-text').click();
    await page.waitForTimeout(500);
    await shot(page, join(dir, '02-preview-text.png'));
    // обезличить и получить файл, который ушёл бы на сайт, — для ответа «ИИ» в кадре восстановления
    await page.getByTestId('pv-tab-entities').click();
    await page.getByTestId('btn-anonymize').click();
    await expect(page.getByTestId('done-title')).toBeVisible({ timeout: 60000 });
    const sent = await page.evaluate(() => window.__files);
    const anonText = Object.entries(unzipText(Buffer.from(sent.at(-1).b64, 'base64')))
      .filter(([n]) => /^word\/document\.xml$/.test(n))
      .map(([, x]) => x.replace(/<[^>]+>/g, ''))
      .join('\n');
    await page.close();

    // 5. восстановление ответа ИИ: метки → настоящие значения (карта — из недавней обработки, в памяти; снимается до
    // других файлов, чтобы в списке недавних была одна обработка)
    const rp = await extPage(context, extensionId, 'restore/restore.html', { lang });
    await rp.getByTestId('restore-input').fill(aiAnswer(anonText, lang));
    await rp.getByTestId('restore-run').click();
    await expect(rp.getByTestId('restore-output')).not.toBeEmpty();
    await expect(rp.getByTestId('restore-error')).toHaveText('');
    // кадр — от карточки «2. Откуда взять карту замен» до результата
    await rp.evaluate(() => {
      const card = document.querySelector('[data-testid="session-radio"]').closest('section, .card, fieldset') || document.body;
      document.body.style.paddingBottom = '600px'; // чтобы прокрутка дошла до карточки и на коротком (en) тексте
      window.scrollTo(0, card.getBoundingClientRect().top + window.scrollY - 28);
    });
    await rp.waitForTimeout(300);
    await shot(rp, join(dir, '05-restore.png'));
    await rp.close();

    // 3. Excel: выгрузка CRM
    const xl = await openChat(context, extensionId, lang);
    await attach(xl, docs.excel);
    await shot(xl, join(dir, '03-panel-excel.png'));
    await xl.close();

    // 4. скрытые данные: комментарии, история правок, скрытый текст — и переключатели удаления
    const hid = await openChat(context, extensionId, lang);
    await attach(hid, docs.hidden);
    await expect(hid.getByTestId('hidden-data')).toBeVisible();
    await shot(hid, join(dir, '04-hidden-data.png'));
    await hid.close();

    // 6. PowerPoint (Edge принимает до 6 снимков, Chrome Web Store — до 5: шестой — только для Edge)
    const pp = await openChat(context, extensionId, lang);
    await attach(pp, docs.deck);
    await shot(pp, join(dir, '06-panel-powerpoint.png'));
    await pp.close();
  });
}

test('магазин: промо-плитки 440×280 и 1400×560, значок 128 и логотип 300', async ({ context }) => {
  test.skip(ONLY && ONLY !== 'promo', `SHOTS_ONLY=${ONLY}`);
  await context.route('https://promo.example/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: PROMO_HTML }));
  for (const [size, w, h] of [
    ['small', 440, 280],
    ['marquee', 1400, 560],
  ]) {
    const p = await context.newPage();
    await p.setViewportSize({ width: w, height: h });
    await p.goto(`https://promo.example/?size=${size}`);
    await p.waitForTimeout(200);
    await shot(p, join(STORE_DIR, `promo-${w}x${h}.png`));
    await p.close();
  }
  // значок листинга — тот же знак, что icons/icon-128.png (assets/sitimlab-icon.svg, без подписи): Chrome Web Store советует
  // рисунок 96×96 с прозрачными полями 16 px (store-icon-128.png), Edge — логотип 300×300 (logo-300x300.png)
  const svg = readFileSync(resolve('assets/sitimlab-icon.svg'), 'utf8');
  for (const [file, size, art] of [
    ['store-icon-128.png', 128, 96],
    ['logo-300x300.png', 300, 300],
  ]) {
    const p = await context.newPage();
    await p.setViewportSize({ width: size, height: size });
    const pad = (size - art) / 2;
    await p.setContent(
      `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${art}px;height:${art}px;margin:${pad}px}</style>${svg}`,
    );
    await p.screenshot({ path: join(STORE_DIR, file), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await p.close();
  }
});

test('README: снимки docs/screenshots', async ({ context, extensionId }) => {
  test.skip(ONLY && ONLY !== 'readme', `SHOTS_ONLY=${ONLY}`);
  test.setTimeout(240000);
  const sample = fixture('sample-contract.docx', 'Договор поставки.docx');
  const page = await openChat(context, extensionId, 'ru');
  await page.setViewportSize({ width: 1100, height: 780 });
  await attach(page, sample);
  await shot(page, join(README_DIR, 'panel-intercept.png'));
  await page.getByTestId('pv-tab-text').click();
  await page.waitForTimeout(500);
  await shot(page, join(README_DIR, 'panel-preview.png'));
  await page.getByTestId('pv-tab-entities').click();
  await page.getByTestId('btn-anonymize').click();
  await expect(page.getByTestId('done-title')).toBeVisible({ timeout: 60000 });
  const sent = await page.evaluate(() => window.__files);
  const anon = Buffer.from(sent.at(-1).b64, 'base64');
  const anonText = Object.entries(unzipText(anon))
    .filter(([n]) => n === 'word/document.xml')
    .map(([, x]) => x.replace(/<[^>]+>/g, ''))
    .join('\n');

  // «до и после»: обе версии договора через LibreOffice (если есть) → PNG первой страницы → одна картинка
  beforeAfter(sample.buffer, anon);
  const ba = await context.newPage();
  await ba.setViewportSize({ width: 2230, height: 705 });
  await context.route('https://shots.example/**', (route) => {
    const name = new URL(route.request().url()).pathname.slice(1);
    if (name.endsWith('.png')) return route.fulfill({ contentType: 'image/png', body: readFileSync(join(BA_DIR, name)) });
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: BA_HTML });
  });
  if (BA_DIR) {
    await ba.goto('https://shots.example/');
    await ba.waitForTimeout(300);
    await shot(ba, join(README_DIR, 'before-after.png'));
    rmSync(BA_DIR, { recursive: true, force: true });
  }
  await ba.close();
  await page.close();

  const pop = await extPage(context, extensionId, 'popup/popup.html', { width: 340, height: 420 });
  await shot(pop, join(README_DIR, 'popup.png'));
  await pop.close();

  const opt = await extPage(context, extensionId, 'options/options.html', { width: 1100, height: 900 });
  // разделы «Перехват», «Что маскируется», «Компании для маскирования» — остальное в README описано текстом
  const optH = await opt.evaluate(() => Math.ceil(document.querySelectorAll('section.card')[2].getBoundingClientRect().bottom + window.scrollY + 24));
  await shot(opt, join(README_DIR, 'options.png'), { fullPage: true, clip: { x: 0, y: 0, width: 1100, height: optH } });
  await opt.close();

  const help = await extPage(context, extensionId, 'help/help.html', { width: 900, height: 1000 });
  // разделы «Скрытые данные и ключ с паролем» и «Данные не покидают ваш компьютер»: в остальных разделах справки названы
  // ИИ-сервисы и бренд разработчика, а в картинках их быть не должно (WP12-F)
  const helpClip = await help.evaluate(() => {
    const a = document.querySelector('[data-testid="help-hidden"]').getBoundingClientRect();
    const b = document.querySelector('[data-testid="help-privacy"]').getBoundingClientRect();
    return { x: Math.floor(a.left - 16), y: Math.floor(a.top + window.scrollY - 16), width: Math.ceil(a.width + 32), height: Math.ceil(b.bottom - a.top + 32) };
  });
  await shot(help, join(README_DIR, 'help.png'), { fullPage: true, clip: helpClip });
  await help.close();

  const rp = await extPage(context, extensionId, 'restore/restore.html', { width: 1280, height: 900 });
  await rp.getByTestId('restore-input').fill(aiAnswer(anonText, 'ru'));
  await rp.getByTestId('restore-run').click();
  await expect(rp.getByTestId('restore-output')).not.toBeEmpty();
  await rp.waitForTimeout(300);
  await shot(rp, join(README_DIR, 'restore.png'), { fullPage: true });
  await rp.close();
});

// --- «до и после» ---
// LibreOffice из snap не видит скрытые каталоги домашней папки (~/.local/tmp), поэтому рабочий каталог — SHOTS_TMP
// (по умолчанию test-output/shots-tmp в репозитории, он в .gitignore).
let BA_DIR = null;
// как в scripts/gen-pdf-fixtures.mjs: snap-пакет LibreOffice или soffice из PATH
const SOFFICE = process.env.SOFFICE || (existsSync('/snap/bin/libreoffice') ? '/snap/bin/libreoffice' : 'soffice');
const BA_HTML = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#f3f4f7;font:700 30px 'DejaVu Sans',sans-serif;display:flex;gap:28px;padding:18px 28px 0;box-sizing:border-box;width:2230px;height:705px;overflow:hidden}
.c{flex:1;display:flex;flex-direction:column;gap:12px;min-width:0}.c h1{font-size:30px;margin:0;letter-spacing:.02em}
.c div{flex:1;overflow:hidden;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.12)}.c img{width:100%;display:block;margin-top:-56px}
.b h1{color:#b42318}.a h1{color:#067647}</style>
<section class="c b"><h1>До: исходный договор</h1><div><img src="before.png"></div></section>
<section class="c a"><h1>После: уходит в ИИ</h1><div><img src="after.png"></div></section>`;

function beforeAfter(before, after) {
  const base = resolve(process.env.SHOTS_TMP || 'test-output/shots-tmp');
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'ba-'));
  writeFileSync(join(dir, 'before.docx'), before);
  writeFileSync(join(dir, 'after.docx'), after);
  try {
    for (const n of ['before', 'after']) {
      execFileSync(SOFFICE, ['--headless', '--convert-to', 'pdf', '--outdir', dir, join(dir, `${n}.docx`)], { stdio: 'pipe', timeout: 120000 });
      // первая страница в PNG 150 dpi (pdftoppm из poppler-utils)
      execFileSync('pdftoppm', ['-png', '-r', '150', '-f', '1', '-l', '1', '-singlefile', join(dir, `${n}.pdf`), join(dir, n)], { stdio: 'pipe' });
    }
    BA_DIR = dir;
  } catch (e) {
    console.warn(`«до и после» пропущен: нужен LibreOffice (soffice) и pdftoppm — ${e.message.split('\n')[0]}`);
    rmSync(dir, { recursive: true, force: true });
  }
}

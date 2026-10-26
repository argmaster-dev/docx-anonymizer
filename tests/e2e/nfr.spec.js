// NFR-01: расширение не делает сетевых запросов наружу — ни со страниц расширения, ни из content script на тестовом сайте,
// ни из service worker, offscreen-документа и его воркера (К6: запись через CDP браузера, helpers/network.js).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from './fixtures.js';
import { buildSampleDocx } from '../../scripts/make-sample.mjs';
import { installClient, runPipeline } from './helpers/client.js';
import { openChat, writeTemp, enableIntercept } from './helpers/chat.js';
import { captureAllRequests, externalRequests, offscreenRequests } from './helpers/network.js';

test('NFR-01: за весь сценарий нет запросов, кроме локального тестового сайта', async ({ context, extensionId, site }) => {
  const { bytes } = buildSampleDocx();
  const net = await captureAllRequests(context);

  await enableIntercept(context, extensionId, site);
  const chat = await openChat(context, site);
  // файл выбирается, но панель не трогаем: достаточно, что content script и background живы
  await chat.setInputFiles('#multi-input', writeTemp('nfr.docx', bytes)).catch(() => {});

  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await installClient(ext);
  await runPipeline(ext, { name: 'nfr.docx', bytes });
  await chat.waitForTimeout(500);

  const urls = await net.stop();
  // chrome:// — ресурсы самого Chromium (тема, шрифты), не расширения
  const foreign = urls.filter((u) => !u.startsWith(site.origin) && !/^(chrome-extension|chrome|data|blob|about):/.test(u));
  expect(foreign, 'запросы наружу').toEqual([]);
  expect(externalRequests(urls, [site.origin]), 'http(s) вне тестового сайта').toEqual([]);
  // запись не пустая: видны тестовый сайт и offscreen-документ с воркером
  expect(urls.some((u) => u.startsWith(site.origin))).toBe(true);
  expect(offscreenRequests(urls)).toEqual(
    expect.arrayContaining([expect.stringMatching(/\/offscreen\/offscreen\.html$/), expect.stringMatching(/\/offscreen\/worker\.js$/)]),
  );
});

// К7, К17 (версия 0.3): сценарий с PDF — pdf.js, его воркер, CMaps и шрифты грузятся только из пакета расширения.
test('PDF: перехват и конвейер без единого http(s)-запроса, pdf.js — из vendor/pdfjs/', async ({ context, extensionId, site }) => {
  const bytes = readFileSync(resolve('tests/fixtures/pdf/sample-contract.pdf'));
  const net = await captureAllRequests(context);
  await enableIntercept(context, extensionId, site);
  const chat = await openChat(context, site);
  await chat.setInputFiles('#multi-input', writeTemp('nfr.pdf', bytes)).catch(() => {});

  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await installClient(ext);
  const r = await runPipeline(ext, { name: 'nfr.pdf', bytes });
  expect(r.resultName).toBe('nfr.anon.md');
  await chat.waitForTimeout(500);

  const urls = await net.stop();
  expect(
    urls.filter((u) => !u.startsWith(site.origin) && !/^(chrome-extension|chrome|data|about):/.test(u)),
    'запросы наружу и blob',
  ).toEqual([]);
  expect(externalRequests(urls, [site.origin])).toEqual([]);
  expect(offscreenRequests(urls)).toEqual(
    expect.arrayContaining([expect.stringMatching(/\/vendor\/pdfjs\/pdf\.mjs$/), expect.stringMatching(/\/vendor\/pdfjs\/pdf\.worker\.mjs$/)]),
  );
  // запросы pdf.js — только к собственным файлам пакета (CMaps/шрифты, если понадобились, — оттуда же)
  for (const u of urls.filter((x) => x.includes('pdfjs'))) expect(u).toMatch(/^chrome-extension:\/\/[^/]+\/vendor\/pdfjs\//);
});

// К13, К14 (версия 0.5, WP12-A): словари ФИО — файлы vendor/dict/*.txt пакета, воркер читает их сам (chrome-extension://);
// разбор PDF ядра — модуль offscreen/chunks/ по требованию. Ни одного http(s)-запроса; словарное лицо находится в браузере.
// Запись сети — с самого старта (earlyCapture): в полной сборке offscreen и воркер поднимаются сразу (автоустановка модели) и
// читают словари раньше, чем тест успел бы подключить запись.
test.describe('словари ФИО из пакета (WP12-A)', () => {
  test.use({ earlyCapture: true });
  test('словари ФИО и модуль разбора PDF — из пакета расширения, без http(s); словарное лицо находится (WP12-A)', async ({ context, extensionId }) => {
    const net = await captureAllRequests(context);
    const ext = await context.newPage();
    await ext.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await installClient(ext);
    // вымышленные данные: «Зульфия Хасанова» находит только словарный детектор (фикстура PERSON-dict.json, dictOnly)
    const { makeDocx, para, run } = await import('../helpers/docx.js');
    const docx = await runPipeline(ext, { name: 'dict.docx', bytes: makeDocx(para(run('Отчёт подготовила Зульфия Хасанова.'))) });
    expect(docx.ent.warnings.map((w) => w.code)).not.toContain('DICT_FAILED');
    expect(docx.ent.entities.filter((e) => e.category === 'PERSON').map((e) => e.value)).toContain('Зульфия Хасанова');
    const pdf = await runPipeline(ext, { name: 'dict.pdf', bytes: readFileSync(resolve('tests/fixtures/pdf/sample-contract.pdf')) });
    expect(pdf.resultName).toBe('dict.anon.md');

    const urls = await net.stop();
    expect(externalRequests(urls), 'http(s)').toEqual([]);
    expect(
      urls.filter((u) => !/^(chrome-extension|chrome|data|about):/.test(u)),
      'прочие схемы',
    ).toEqual([]);
    const own = offscreenRequests(urls);
    for (const name of ['ru-surnames', 'ru-first', 'en-first', 'en-surnames']) {
      expect(
        own.filter((u) => u.endsWith(`/vendor/dict/${name}.txt`)),
        name,
      ).toHaveLength(1); // один раз на жизнь воркера
    }
    expect(
      own.some((u) => /\/offscreen\/chunks\/extract-[^/]+\.js$/.test(u)),
      'модуль разбора PDF',
    ).toBe(true);
    for (const u of urls.filter((x) => x.includes('/vendor/dict/') || x.includes('/offscreen/chunks/')))
      expect(u).toMatch(new RegExp(`^chrome-extension://${extensionId}/`));
  });
});

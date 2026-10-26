#!/usr/bin/env node
// Бенчмарк конвейера без модели (версия 0.5, WP12-A, Ц8, К14; NFR-03): холодный старт ядра и анализ «20-страничного договора»
// (≈ 9 000 слов из корпуса tests/fixtures/ner/eval-ru.json, абзацами, как в scripts/bench-ner.mjs). Числа — в «Статус» WP12-A.
//
//   npm run bench                     — Node: холодный старт в отдельных процессах (импорт ядра, словари ФИО, первый анализ)
//                                       и parse → analyze → apply 20-страничного договора (медиана);
//   npm run bench -- --browser        — то же в Chromium (Playwright) на сборке dist-e2e/ (node scripts/build.mjs --e2e,
//                                       под flock): первый ANALYZE свежего профиля (offscreen + воркер + словари) и 20 страниц;
//   --runs=<n> (по умолчанию 7 в Node, 3 в браузере), --dist=<каталог e2e-сборки> (для --browser), --json.
// Тексты документов в вывод не попадают (NFR-14): только времена и размеры.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const has = (name) => process.argv.includes(`--${name}`);

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const ms = (x) => Math.round(x * 10) / 10;

/** «20-страничный договор» как DOCX: абзацы из bigDocument (scripts/bench-ner.mjs). */
async function bigDocx() {
  const { bigDocument } = await import('./bench-ner.mjs');
  const { makeDocx, para, run } = await import('../tests/helpers/docx.js');
  const { esc } = await import('./make-sample.mjs');
  const corpus = JSON.parse(readFileSync(join(root, 'tests/fixtures/ner/eval-ru.json'), 'utf8'));
  const paras = bigDocument(corpus);
  return { bytes: makeDocx(paras.map((t) => para(run(esc(t)))).join('')), words: paras.join(' ').split(/\s+/).length, paragraphs: paras.length };
}

/** Словари ФИО с диска, если ядро грузит их отдельно (0.5: vendor/dict/, names/dict/load.js); в 0.4 — встроены в модуль. */
async function loadDictsIfNeeded() {
  const p = join(root, 'src/core/detect/names/dict/load.js');
  if (!existsSync(p)) return 0;
  const t0 = performance.now();
  const { loadDictsFromDisk } = await import(pathToFileURL(join(root, 'scripts/dicts-node.mjs')).href);
  await loadDictsFromDisk();
  return performance.now() - t0;
}

/** Дочерний процесс: одно холодное измерение. */
async function childCold() {
  const t0 = performance.now();
  const core = await import('../src/core/index.js');
  const tImport = performance.now() - t0;
  const tDicts = await loadDictsIfNeeded();
  const { buildSampleDocx } = await import('./make-sample.mjs');
  core.registerBuiltinDetectors();
  const { bytes } = buildSampleDocx();
  const t1 = performance.now();
  const doc = core.parseDocx(bytes);
  await core.analyze(doc, core.defaultSettings());
  const tFirst = performance.now() - t1;
  process.stdout.write(JSON.stringify({ import: tImport, dicts: tDicts, first: tFirst, total: performance.now() - t0 }));
}

async function nodeBench(runs) {
  const cold = [];
  for (let i = 0; i < runs; i++) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child-cold'], { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`холодный старт: процесс завершился с кодом ${r.status}\n${r.stderr}`);
    cold.push(JSON.parse(r.stdout));
  }
  const core = await import('../src/core/index.js');
  await loadDictsIfNeeded();
  core.registerBuiltinDetectors();
  const big = await bigDocx();
  const one = async () => {
    const t0 = performance.now();
    const doc = core.parseDocx(big.bytes);
    const a = await core.analyze(doc, core.defaultSettings());
    const t1 = performance.now();
    core.applyDecisions(doc, a.groups, { mode: 'placeholder', createdAt: '2026-10-26T00:00:00Z' });
    return { analyze: t1 - t0, apply: performance.now() - t1 };
  };
  await one(); // прогрев
  const times = [];
  for (let i = 0; i < runs; i++) times.push(await one());
  return {
    env: `Node ${process.version}`,
    cold: Object.fromEntries(['import', 'dicts', 'first', 'total'].map((k) => [k, ms(median(cold.map((c) => c[k])))])),
    big: { words: big.words, paragraphs: big.paragraphs, analyze: ms(median(times.map((t) => t.analyze))), apply: ms(median(times.map((t) => t.apply))) },
    runs,
  };
}

async function browserBench(runs) {
  // --dist=<каталог> — другая e2e-сборка (например, сохранённая сборка прошлой версии для сравнения)
  const dist = arg('dist') ? resolve(/** @type {string} */ (arg('dist'))) : join(root, 'dist-e2e');
  if (!existsSync(join(dist, 'manifest.json'))) throw new Error('Сначала node scripts/build.mjs --e2e (под flock)');
  const { chromium } = await import('@playwright/test');
  const { installClient, runPipeline } = await import('../tests/e2e/helpers/client.js');
  const { buildSampleDocx } = await import('./make-sample.mjs');
  const big = await bigDocx();
  const sample = buildSampleDocx().bytes;
  const out = [];
  for (let i = 0; i < runs; i++) {
    const dir = mkdtempSync(join(tmpdir(), 'docx-anon-bench-'));
    const context = await chromium.launchPersistentContext(dir, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    });
    try {
      let [sw] = context.serviceWorkers();
      if (!sw) sw = await context.waitForEvent('serviceworker');
      const id = new URL(sw.url()).host;
      const page = await context.newPage();
      await page.goto(`chrome-extension://${id}/popup/popup.html`);
      await installClient(page);
      const cold = await runPipeline(page, { name: 'sample.docx', bytes: sample });
      const b = await runPipeline(page, { name: 'big.docx', bytes: big.bytes });
      out.push({ cold: cold.analyzeMs, big: b.analyzeMs });
    } finally {
      await context.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return {
    env: `Chromium (Playwright), ${dist}`,
    cold: ms(median(out.map((x) => x.cold))),
    big: { words: big.words, paragraphs: big.paragraphs, analyze: ms(median(out.map((x) => x.big))) },
    runs,
  };
}

if (has('child-cold')) {
  await childCold();
} else {
  const browser = has('browser');
  const runs = Number(arg('runs')) || (browser ? 3 : 7);
  const res = browser ? await browserBench(runs) : await nodeBench(runs);
  if (has('json')) console.log(JSON.stringify(res, null, 2));
  else if (browser) {
    console.log(`${res.env}, медиана из ${res.runs}:`);
    console.log(`  первый анализ свежего профиля (offscreen + воркер + словари): ${res.cold} мс`);
    console.log(`  20 страниц (${res.big.words} слов, ${res.big.paragraphs} абзацев): ANALYZE ${res.big.analyze} мс`);
  } else {
    console.log(`${res.env}, медиана из ${res.runs}:`);
    console.log(
      `  холодный старт: импорт ядра ${res.cold.import} мс, словари ${res.cold.dicts} мс, первый анализ образца ${res.cold.first} мс, всего ${res.cold.total} мс`,
    );
    console.log(`  20 страниц (${res.big.words} слов, ${res.big.paragraphs} абзацев): parse+analyze ${res.big.analyze} мс, apply ${res.big.apply} мс`);
  }
}

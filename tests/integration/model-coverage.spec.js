// Модель NER только добавляет находки (версия 0.5, WP12-E): с моделью (NER_MODEL_DIR) ни один символ, закрытый правилами и словарями
// без модели, не остаётся открытым — на корпусе и сетке ревью WP12-C (`scripts/coverage-grid.mjs`, тот же расчёт покрытия по
// символам, что в coverage-grid.spec.js) и на всех DOCX-фикстурах регрессии (`docx-regression.spec.js`: tests/fixtures/**/*.docx
// и образец), в обычном и коммерческом режиме; сравнение со снимком 0.4/2d862d6 с моделью — тот же белый список, что без модели.
//   NER_MODEL_DIR=models-src/rubert-tiny2-ner-ruen npx vitest run tests/integration/model-coverage.spec.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { SETS, coverage, leaksAgainst, loadJson } from '../../scripts/coverage-grid.mjs';
import { loadNerProvider } from '../../scripts/eval-genres.mjs';
import { buildSampleDocx } from '../../scripts/make-sample.mjs';
import * as core from '../../src/core/index.js';
import { fromText } from '../../src/core/text/model.js';

const MODEL_DIR = process.env.NER_MODEL_DIR ? resolve(process.env.NER_MODEL_DIR) : '';
const ROOT = process.cwd();

/** Символы, закрытые без модели и открытые с моделью: «текст: «отрезок»». */
function lost(base, withModel) {
  const out = [];
  for (let i = 0; i < base.length; i++)
    for (let j = 0; j < base[i].length; j++) {
      const { text, mask } = base[i][j];
      const m2 = withModel[i][j].mask;
      let k = 0;
      while (k < text.length) {
        if (mask[k] && !m2[k]) {
          let e = k;
          while (e < text.length && mask[e] && !m2[e]) e++;
          out.push(`«${text.slice(k, e)}» | ${text}`);
          k = e;
        } else k++;
      }
    }
  return out;
}

/** Маска закрытых символов по потокам DOCX (как coverage() в scripts/coverage-grid.mjs). */
async function docxMasks(bytes, settings, nerProvider) {
  const doc = core.parseDocx(bytes);
  const a = await core.analyze(doc, settings, { nerProvider });
  const masks = new Map(doc.streams.map((st) => [st.id, new Uint8Array(st.text.length)]));
  for (const g of a.groups) {
    if (!g.enabled) continue;
    for (const o of g.occurrences) {
      const m = masks.get(o.streamId);
      if (m) for (let i = o.start + (o.keepPrefix || 0); i < o.end - (o.keepSuffix || 0); i++) m[i] = 1;
    }
  }
  return [doc.streams.map((st) => ({ text: st.text, mask: masks.get(st.id) }))];
}

function listDocx(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'private') out.push(...listDocx(p));
    } else if (e.name.endsWith('.docx')) out.push(p);
  }
  return out;
}

describe.skipIf(!MODEL_DIR)('модель только добавляет находки (NER_MODEL_DIR)', () => {
  let provider;
  /** core с моделью: analyze получает провайдер NER */
  let withModel;
  beforeAll(async () => {
    core.clearDetectors();
    core.registerBuiltinDetectors();
    provider = await loadNerProvider(MODEL_DIR);
    if (!provider) throw new Error('модель не найдена');
    withModel = { ...core, analyze: (doc, s) => core.analyze(doc, s, { nerProvider: provider }) };
  }, 60000);
  afterAll(() => provider?.dispose?.());

  const whitelist = loadJson('whitelist.json');
  for (const set of SETS)
    it(`${set.name}: закрытое без модели закрыто и с моделью; против снимка 0.4/2d862d6 — только белый список`, async () => {
      const base = await coverage(core, fromText, set.corpus(), set.mode);
      const cur = await coverage(withModel, fromText, set.corpus(), set.mode);
      expect(lost(base, cur)).toEqual([]);
      const leaks = leaksAgainst(cur, loadJson(`prev-${set.name}.json`));
      const bad = leaks.filter((l) => !whitelist.some((w) => w.text === l.text && w.segs.includes(l.seg)));
      expect(bad.map((l) => `«${l.seg}» (было ${l.was}) | ${l.text}`)).toEqual([]);
    }, 300000);

  it('DOCX-фикстуры регрессии: закрытое без модели закрыто и с моделью (обычный и коммерческий режим)', async () => {
    const files = listDocx(join(ROOT, 'tests/fixtures')).map((p) => ({ name: relative(ROOT, p), bytes: new Uint8Array(readFileSync(p)) }));
    files.push({ name: 'make-sample', bytes: buildSampleDocx().bytes });
    expect(files.length).toBeGreaterThanOrEqual(40);
    const bad = [];
    for (const { name, bytes } of files)
      for (const settings of [core.defaultSettings(), { ...core.defaultSettings(), commercial: true }]) {
        const base = await docxMasks(bytes, settings, undefined);
        const cur = await docxMasks(bytes, settings, provider);
        for (const l of lost(base, cur)) bad.push(`${name}${settings.commercial ? ' (коммерческий)' : ''}: ${l}`);
      }
    expect(bad).toEqual([]);
  }, 600000);
});

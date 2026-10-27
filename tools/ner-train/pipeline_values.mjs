#!/usr/bin/env node
// PERSON / COMPANY values found by the whole extension pipeline (rules + dictionaries + NER model) on the genre corpus —
// the second measurement of compare_natasha.py (version 0.5, WP12-E): `--pipeline-json <label>=<this output>`.
// Commercial mode (organisations are masked), the same analyze() as `npm run eval-genres`; documents in every corpus
// format (DOCX, PDF through the extension's own PDF extraction, XLSX, PPTX, CSV, JSON). English documents are skipped
// (Natasha is Russian-only).
//
//   node tools/ner-train/pipeline_values.mjs --model=models-src/rubert-tiny2-ner-ruen --out=tools/ner-train/runs/compare-natasha/pipeline-1.2.0.json
//   node tools/ner-train/pipeline_values.mjs --out=.../pipeline-rules.json          (no model: rules and dictionaries only)
import { mkdirSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { dirname, resolve } from 'node:path';
import { listCorpus, loadDoc, loadNerProvider, modeSettings } from '../../scripts/eval-genres.mjs';
import { analyze, registerBuiltinDetectors } from '../../src/core/index.js';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const modelDir = arg('model') ? resolve(arg('model')) : '';
const out = resolve(arg('out') || 'tools/ner-train/runs/compare-natasha/pipeline.json');

registerBuiltinDetectors();
const provider = modelDir ? await loadNerProvider(modelDir) : null;
if (modelDir && !provider) throw new Error(`model not found: ${modelDir}`);
const docs = [];
const t0 = performance.now();
try {
  for (const it of listCorpus()) {
    if (it.name.endsWith('-en')) continue;
    const doc = await loadDoc(it.path);
    const a = await analyze(doc, modeSettings('commercial'), { nerProvider: provider || undefined });
    const vals = { PERSON: new Set(), COMPANY: new Set() };
    for (const e of a.entities) if (e.category in vals && e.text) vals[e.category].add(e.text);
    docs.push({ genre: it.genre, name: it.name, format: it.format, PERSON: [...vals.PERSON].sort(), COMPANY: [...vals.COMPANY].sort() });
  }
} finally {
  provider?.dispose?.();
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  `${JSON.stringify({ model: provider ? provider.label : null, mode: 'commercial', seconds: Math.round(performance.now() - t0) / 1000, docs }, null, 1)}\n`,
);
console.log(JSON.stringify({ out, model: provider ? provider.label : null, documents: docs.length }));

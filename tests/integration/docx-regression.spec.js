// Регрессия DOCX байт-в-байт (версия 0.5, WP12-A, К14; FR-40 — детерминированный результат): вынос общего слоя OOXML
// (src/core/ooxml/) и словарей ФИО (vendor/dict/) не должен изменить ни одного байта результата.
// Снимок sha256 снят ДО переноса (коммит концепции 0.5, fc9a46b) и хранится в tests/fixtures/docx-regression.json.
// Для каждой DOCX-фикстуры (tests/fixtures/**/*.docx, образец scripts/make-sample.mjs) — четыре хеша:
//   normal     — настройки по умолчанию, режим «метки»;
//   commercial — коммерческая группа включена (политика 0.4), режим «метки»;
//   strip      — тот же анализ, режим «маска», keepMetadata: false, stripEmbedded: true (FR-12, FR-15);
//   restore    — restoreDocx(commercial, mapping) — обратная замена по тем же потокам (FR-36а).
// Переснять снимок (только если поведение DOCX меняется намеренно): UPDATE_DOCX_REGRESSION=1 npx vitest run tests/integration/docx-regression.spec.js
import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildSampleDocx } from '../../scripts/make-sample.mjs';
import { parseDocx, analyze, applyDecisions, restoreDocx, defaultSettings, clearDetectors, registerBuiltinDetectors } from '../../src/core/index.js';

const ROOT = process.cwd();
const FIXTURES = join(ROOT, 'tests/fixtures');
const SNAPSHOT = join(FIXTURES, 'docx-regression.json');
const UPDATE = process.env.UPDATE_DOCX_REGRESSION === '1';
const FIXED = { createdAt: '2026-10-04T00:00:00Z', placeholderLanguage: 'ru' };

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Все .docx под tests/fixtures, кроме private/ (настоящие документы владельца не в репозитории). */
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

/** @returns {{name: string, bytes: Uint8Array}[]} */
function corpus() {
  const files = listDocx(FIXTURES)
    .map((p) => ({ name: relative(ROOT, p), bytes: new Uint8Array(readFileSync(p)) }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  return [...files, { name: 'scripts/make-sample.mjs#buildSampleDocx', bytes: buildSampleDocx().bytes }];
}

/** @returns {Promise<Record<string, string>>} */
async function hashes(name, bytes) {
  const doc = parseDocx(bytes);
  const document = { name: name.split('/').pop(), sha256: sha256(bytes), resultName: 'document.anon.docx' };
  const normal = await analyze(doc, defaultSettings());
  const commercial = await analyze(doc, { ...defaultSettings(), commercial: true });
  const a = applyDecisions(doc, normal.groups, { mode: 'placeholder', ...FIXED, document });
  const b = applyDecisions(doc, commercial.groups, { mode: 'placeholder', ...FIXED, document });
  const c = applyDecisions(doc, commercial.groups, { mode: 'mask', keepMetadata: false, stripEmbedded: true, ...FIXED, document });
  const r = restoreDocx(b.bytes, b.mapping);
  return { normal: sha256(a.bytes), commercial: sha256(b.bytes), strip: sha256(c.bytes), restore: sha256(r.bytes) };
}

let docs;
/** @type {Record<string, Record<string, string>>} */
let snapshot = {};

beforeAll(() => {
  clearDetectors();
  registerBuiltinDetectors();
  docs = corpus();
  if (!UPDATE) snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
});

describe('DOCX: результат apply байт-в-байт совпадает со снимком до переноса в ooxml/ (WP12-A)', () => {
  it('снимок покрывает все DOCX-фикстуры', () => {
    if (UPDATE) return;
    expect(Object.keys(snapshot).sort()).toEqual(docs.map((d) => d.name).sort());
    expect(docs.length).toBeGreaterThanOrEqual(40);
  });

  it('хеши normal / commercial / strip / restore совпадают', { timeout: 300000 }, async () => {
    /** @type {Record<string, Record<string, string>>} */
    const got = {};
    for (const { name, bytes } of docs) got[name] = await hashes(name, bytes);
    if (UPDATE) {
      writeFileSync(SNAPSHOT, JSON.stringify(got, null, 2) + '\n');
      return;
    }
    expect(existsSync(SNAPSHOT)).toBe(true);
    for (const { name } of docs) expect(got[name], name).toEqual(snapshot[name]);
  });
});

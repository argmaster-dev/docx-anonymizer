// Помощники тестов форматов 0.5 (WP12-B, К1–К4): загрузка адаптера, конвейер «разбор → анализ → применение» в Node,
// пакетная конвертация в LibreOffice (локально; в CI LibreOffice нет — SKIP_LIBREOFFICE, LO_ENABLED из pipeline.js).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  analyze,
  applyDecisions,
  defaultSettings,
  detectAdapter,
  loadAdapter,
  registerBuiltinDetectors,
  getDetectors,
  readZip,
  inflateEntry,
} from '../../../src/core/index.js';
import { SOFFICE } from './pipeline.js';
import { attachEmbeddedBooks } from '../../../src/core/embedded.js';

export const OFFICE_DIR = join(process.cwd(), 'tests/fixtures/office');

/** Фикстура tests/fixtures/office/<имя>: байты и gold. */
export function fixture(file) {
  const bytes = new Uint8Array(readFileSync(join(OFFICE_DIR, file)));
  const gold = JSON.parse(readFileSync(join(OFFICE_DIR, `${file}.gold.json`), 'utf8'));
  return { bytes, gold };
}

/** Адаптер файла по сигнатуре и имени (модуль по требованию загружается). */
export async function adapterFor(bytes, name) {
  const entry = detectAdapter(bytes, name);
  if (!entry) throw new Error(`не распознан: ${name}`);
  return loadAdapter(entry);
}

/**
 * Разбор → анализ → применение (метки, настройки по умолчанию или переданные).
 * @returns {Promise<{adapter: any, doc: any, analysis: any, result: any}>}
 */
export async function runOffice(bytes, name, { settings = defaultSettings(), apply = {} } = {}) {
  if (!getDetectors().size) registerBuiltinDetectors();
  const adapter = await adapterFor(bytes, name);
  const doc = adapter.parse(bytes, name);
  // как хост: встроенные книги и диаграммы Word (core/embedded.js)
  await attachEmbeddedBooks(doc, loadAdapter);
  const analysis = await analyze(doc, settings);
  const result = applyDecisions(doc, analysis.groups, { createdAt: '2026-10-26T00:00:00Z', ...apply });
  return { adapter, doc, analysis, result };
}

/** Профиль LibreOffice: пересчёт формул при открытии книги Excel — всегда (как Excel по fullCalcOnLoad). */
const XCU =
  '<?xml version="1.0" encoding="UTF-8"?>\n<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n' +
  '<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>\n</oor:items>\n';

/**
 * Пакетная конвертация в LibreOffice headless: каталог test-output/lo-office/<tag> (snap-LibreOffice не видит скрытые каталоги
 * и /tmp), свой профиль на вызов. Ошибка запуска — исключение; что результат есть на каждый файл и его структура — проверяют тесты.
 * @param {{name: string, bytes: Uint8Array}[]} files
 * @param {string} to  фильтр --convert-to ('pdf', 'csv:…')
 * @param {string} tag
 * @returns {Map<string, string>} имя выходного файла → текст (для pdf — пусто, проверяется только наличие)
 */
export function libreOfficeConvert(files, to, tag) {
  const dir = join(process.cwd(), 'test-output', 'lo-office', tag);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // свой профиль на каждый вызов и процесс vitest: параллельные LibreOffice с одним профилем мешают друг другу (ревью WP12-B)
  const profile = join(process.cwd(), 'test-output', 'lo-office', `profile-${tag}-${process.pid}`);
  if (!existsSync(join(profile, 'user'))) mkdirSync(join(profile, 'user'), { recursive: true });
  const xcu = join(profile, 'user', 'registrymodifications.xcu');
  if (!existsSync(xcu) || !readFileSync(xcu, 'utf8').includes('OOXMLRecalcMode')) writeFileSync(xcu, XCU);
  const paths = files.map((f) => {
    const p = join(dir, f.name);
    writeFileSync(p, f.bytes);
    return p;
  });
  const out = join(dir, 'out');
  mkdirSync(out, { recursive: true });
  const res = spawnSync(
    /** @type {string} */ (SOFFICE),
    [`-env:UserInstallation=file://${profile}`, '--headless', '--convert-to', to, ...paths, '--outdir', out],
    {
      encoding: 'utf8',
      timeout: 300000,
    },
  );
  // «открывается без восстановления» — по факту: конвертация прошла и дала результат на каждый файл (структуру сверяют тесты)
  rmSync(profile, { recursive: true, force: true });
  if (res.status !== 0) throw new Error(`LibreOffice: код ${res.status}`);
  const map = new Map();
  for (const f of readdirSync(out)) map.set(f, /\.(csv|txt|fodp|fods)$/.test(f) ? readFileSync(join(out, f), 'utf8') : '');
  return map;
}

// утечки в частях пакета, целостность пакета, LibreOffice включён — общие помощники DOCX (pipeline.js)
export { findLeaks, checkPackage, LO_ENABLED } from './pipeline.js';

/**
 * Утечки «ни одного исходного значения ни в одной части zip» (по образцу конвейера ревьюера WP12-B): каждая запись пакета,
 * вложенные zip (книги диаграмм) — рекурсивно; текст — в UTF-8, UTF-16LE и Windows-1251, как есть, с раскрытыми сущностями XML,
 * без тегов и с раскрытыми \uXXXX (JSON); регистр не учитывается. Не zip — весь файл одной «частью».
 * @param {Uint8Array} bytes
 * @param {string[]} secrets
 * @returns {string[]} «значение @ часть»
 */
export function deepLeaks(bytes, secrets, prefix = '') {
  const unesc = (s) =>
    s
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  let files;
  try {
    files = readZip(bytes).map((e) => [e.name, inflateEntry(e)]);
  } catch {
    files = [['<файл>', bytes]];
  }
  const out = [];
  for (const [name, data] of files) {
    const n = prefix + name;
    if (data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && name !== '<файл>') {
      out.push(...deepLeaks(data, secrets, `${n}!`));
      continue;
    }
    const variants = [];
    for (const enc of ['utf-8', 'utf-16le', 'windows-1251']) {
      const t = new TextDecoder(enc).decode(data);
      variants.push(
        t,
        unesc(t),
        unesc(t.replace(/<[^>]+>/g, '')),
        t.replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))),
      );
    }
    const hay = variants.map((s) => s.toLowerCase());
    for (const v of secrets) if (hay.some((h) => h.includes(v.toLowerCase()))) out.push(`${v} @ ${n}`);
  }
  return out;
}

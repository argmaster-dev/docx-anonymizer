// Пакет для Chrome Web Store и Edge Add-ons (версия 0.5, WP12-F, К15, концепция 0.5 п. 9):
// npm run pack:store → release/docx-anonymizer-<версия>-store.zip.
// Это полный архив релиза (модель NER в models/, ставится сама при первом запуске — без импорта и без сети), но манифест
// без поля key: магазин назначает расширению свой идентификатор, а key в манифесте загружаемого пакета магазины не принимают
// (key нужен только распакованной установке — закрепляет ID при обновлении из папки, README «Обновление»).
// Встраивается только последний пакет из KNOWN_PACKS (сейчас 1.2.0) — иначе ошибка: в магазин уходит проверенная модель.
// После сборки пакет проверяется по требованиям магазинов (checkStorePackage; чек-лист — docs/store/checklist.md).
// Сети не требует, ничего никуда не отправляет: подачу в магазины делает владелец вручную.
//
//   node scripts/pack-store.mjs [--out=<каталог>] [--model=<zip пакета>] [--lite]
//   --lite — без модели (…-store-lite.zip): только создать продукт в Edge, если полный пакет не грузится (docs/store/edge-upload.md)
import { unzipSync, strFromU8 } from 'fflate';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findModelZip, latestKnownPack, packOne } from './pack.mjs';
import { findKnownPack } from '../src/core/ner/known-packs.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Лимиты магазинов, которые проверяются автоматически (источники — docs/store/checklist.md). */
export const STORE_LIMITS = {
  // описание в манифесте — краткое описание листинга: Chrome Web Store — не длиннее 132 символов
  descriptionMax: 132,
  // название расширения в манифесте — не длиннее 75 символов (справка по manifest.json Chrome)
  nameMax: 75,
  // К14 версии 0.5: полный архив ≤ 45 МБ (магазины принимают больше; лимит — наш сторож от раздувания)
  sizeMax: 45 * 1024 * 1024,
};

/** Манифест пакета для магазина: без key и update_url (обновления — только через магазин). */
export function storeManifest(manifest) {
  const out = { ...manifest };
  delete out.key;
  delete out.update_url;
  return out;
}

/**
 * Проверка готового пакета по требованиям магазинов. Возвращает список проблем (пустой — пакет годен).
 * @param {Record<string, Uint8Array>} entries — распакованный zip
 * @param {{version: string, size: number, lite?: boolean}} info — lite: пакет без модели (только для создания продукта в Edge, docs/store/edge-upload.md)
 * @returns {string[]}
 */
export function checkStorePackage(entries, { version, size, lite = false }) {
  const problems = [];
  const names = Object.keys(entries);
  if (!entries['manifest.json']) return ['manifest.json не в корне архива'];
  const m = JSON.parse(strFromU8(entries['manifest.json']));
  if (m.manifest_version !== 3) problems.push(`manifest_version ${m.manifest_version}, нужен 3`);
  if (m.version !== version) problems.push(`версия манифеста ${m.version} ≠ ${version}`);
  if ('key' in m) problems.push('в манифесте есть key — магазины такой пакет не принимают');
  if ('update_url' in m) problems.push('в манифесте есть update_url — обновления идут только через магазин');
  if (m.host_permissions?.length)
    problems.push(`host_permissions ${JSON.stringify(m.host_permissions)}: доступ к сайтам — только по запросу (optional_host_permissions)`);
  // строки листинга из _locales: каждая локаль — краткое описание и название
  const msgName = (s) => /^__MSG_(\w+)__$/.exec(s)?.[1];
  const locales = names.filter((n) => /^_locales\/[^/]+\/messages\.json$/.test(n));
  if (!locales.length) problems.push('нет _locales/*/messages.json');
  if (!entries[`_locales/${m.default_locale}/messages.json`]) problems.push(`нет локали по умолчанию ${m.default_locale}`);
  for (const loc of locales) {
    const msgs = JSON.parse(strFromU8(entries[loc]));
    const desc = msgName(m.description) ? msgs[msgName(m.description)]?.message : m.description;
    const name = msgName(m.name) ? msgs[msgName(m.name)]?.message : m.name;
    if (!desc) problems.push(`${loc}: нет описания`);
    else if ([...desc].length > STORE_LIMITS.descriptionMax) problems.push(`${loc}: описание ${[...desc].length} символов > ${STORE_LIMITS.descriptionMax}`);
    if (!name) problems.push(`${loc}: нет названия`);
    else if ([...name].length > STORE_LIMITS.nameMax) problems.push(`${loc}: название длиннее ${STORE_LIMITS.nameMax}`);
  }
  // иконка 128×128 для листинга и все иконки манифеста — в пакете
  for (const p of new Set([...Object.values(m.icons || {}), ...Object.values(m.action?.default_icon || {})])) {
    if (!entries[p]) problems.push(`нет иконки ${p}`);
  }
  if (!m.icons?.['128']) problems.push('нет иконки 128×128');
  // удалённого кода нет: страницы расширения грузят скрипты только из пакета, CSP без внешних источников
  for (const n of names.filter((x) => x.endsWith('.html'))) {
    const html = strFromU8(entries[n]);
    if (/<script[^>]+src\s*=\s*["']?(https?:)?\/\//i.test(html)) problems.push(`${n}: скрипт с внешнего адреса`);
  }
  const csp = m.content_security_policy?.extension_pages || '';
  if (/https?:|\*/.test(csp)) problems.push(`CSP допускает внешние источники: ${csp}`);
  // модель — данные пакета: ровно один проверенный пакет последней версии
  if (lite) {
    if (names.some((n) => n.startsWith('models/'))) problems.push('лёгкий пакет: в models/ ничего не должно быть');
  } else if (!entries['models/index.json']) problems.push('нет models/index.json — модель не встроена, пакет для магазина должен быть полным');
  else {
    const index = JSON.parse(strFromU8(entries['models/index.json']));
    const latest = latestKnownPack();
    const e = index[0];
    const bytes = e && entries[`models/${e.file}`];
    if (index.length !== 1 || !bytes) problems.push('models/index.json: нужен ровно один пакет модели');
    else {
      const sha = createHash('sha256').update(bytes).digest('hex');
      if (sha !== e.sha256 || !findKnownPack(sha)) problems.push(`пакет модели ${e.file}: sha256 не из KNOWN_PACKS`);
      if (latest && e.version !== latest.version) problems.push(`пакет модели ${e.version}, последний проверенный — ${latest.version}`);
    }
  }
  // в пакете нет исходников, тестов, зависимостей, sourcemaps
  const junk = names.filter((n) => /\.map$|^src\/|^tests\/|node_modules|^docs\/|^scripts\/|package/.test(n));
  if (junk.length) problems.push(`лишние файлы: ${junk.slice(0, 5).join(', ')}`);
  if (size > STORE_LIMITS.sizeMax) problems.push(`размер ${size} байт > ${STORE_LIMITS.sizeMax} (К14)`);
  return problems;
}

/**
 * Собрать пакет для магазинов и проверить его. lite — без модели: только чтобы создать продукт в Edge Partner Center, если
 * браузерная загрузка полного пакета падает, а затем загрузить полный через REST API (docs/store/edge-upload.md); не публиковать.
 * @param {{outDir?: string, modelZip?: string|null, lite?: boolean}} [opts]
 * @returns {import('./pack.mjs').PackResult & {problems: string[]}}
 */
export function packStore({ outDir = join(root, 'release'), modelZip = null, lite = false } = {}) {
  if (!lite && !modelZip) modelZip = findModelZip();
  if (!lite && !modelZip) {
    throw new Error('нет пакета модели: положите release/docx-anonymizer-ner-*.zip из KNOWN_PACKS (npm run pack:model) или задайте --model=<zip>');
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const res = packOne({
    outDir,
    name: `docx-anonymizer-${pkg.version}-store${lite ? '-lite' : ''}.zip`,
    version: pkg.version,
    buildArgs: lite ? [] : [`--with-model=${modelZip}`],
    prepare: (stage) => {
      const p = join(stage, 'manifest.json');
      writeFileSync(p, JSON.stringify(storeManifest(JSON.parse(readFileSync(p, 'utf8'))), null, 2) + '\n');
    },
  });
  const problems = checkStorePackage(unzipSync(new Uint8Array(readFileSync(res.file))), { ...res, lite });
  return { ...res, problems };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  try {
    const lite = process.argv.includes('--lite');
    const modelArg = process.argv.find((a) => a.startsWith('--model='));
    const r = packStore({
      ...(outArg ? { outDir: outArg.slice('--out='.length) } : {}),
      ...(modelArg ? { modelZip: findModelZip(process.argv) } : {}),
      lite,
    });
    console.log(
      `${relative(process.cwd(), r.file) || r.file}: ${r.files.length} файлов, ${r.size} байт (${(r.size / 1048576).toFixed(1)} МБ), версия ${r.version}`,
    );
    console.log(`sha256 ${r.sha256}`);
    if (r.problems.length) {
      console.error('пакет НЕ годен для магазинов:');
      for (const p of r.problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log(
      lite
        ? 'лёгкий пакет без модели — только для создания продукта в Edge Partner Center, не публиковать (docs/store/edge-upload.md)'
        : 'проверки магазинов пройдены (key нет, модель встроена, описание ≤ 132 символов, удалённого кода нет); чек-лист — docs/store/checklist.md',
    );
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

// Пакет для магазинов (npm run pack:store, версия 0.5, WP12-F, К15): манифест без key, модель встроена, проверки требований
// магазинов (scripts/pack-store.mjs checkStorePackage; чек-лист — docs/store/checklist.md). Сети не требуется.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { strToU8, unzipSync, strFromU8 } from 'fflate';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkStorePackage, packStore, storeManifest, STORE_LIMITS } from '../../scripts/pack-store.mjs';
import { latestKnownPack, latestModelZipPath } from '../../scripts/pack.mjs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));

describe('storeManifest', () => {
  it('убирает key и update_url, остальное не трогает', () => {
    const m = storeManifest({ ...manifest, update_url: 'https://example.invalid/u.xml' });
    expect('key' in m).toBe(false);
    expect('update_url' in m).toBe(false);
    expect(m.permissions).toEqual(manifest.permissions);
    expect(m.optional_host_permissions).toEqual(manifest.optional_host_permissions);
    expect(m.content_security_policy).toEqual(manifest.content_security_policy);
    expect('key' in manifest).toBe(true); // исходный объект не изменён
  });

  it('описание расширения в _locales не длиннее 132 символов, название — 75 (листинг магазинов)', () => {
    for (const loc of ['ru', 'en']) {
      const msgs = JSON.parse(readFileSync(`src/_locales/${loc}/messages.json`, 'utf8'));
      expect([...msgs.extDescription.message].length, loc).toBeLessThanOrEqual(STORE_LIMITS.descriptionMax);
      expect([...msgs.extName.message].length, loc).toBeLessThanOrEqual(STORE_LIMITS.nameMax);
    }
  });
});

describe('checkStorePackage', () => {
  // минимальный «пакет» в памяти: манифест, локали, иконки, модель с sha из KNOWN_PACKS не подделать — проверяется отдельно
  const base = () => {
    const m = storeManifest({ ...manifest, version: pkg.version });
    return {
      'manifest.json': strToU8(JSON.stringify(m)),
      '_locales/ru/messages.json': strToU8(JSON.stringify({ extName: { message: 'DOCX Anonymizer' }, extDescription: { message: 'Коротко.' } })),
      '_locales/en/messages.json': strToU8(JSON.stringify({ extName: { message: 'DOCX Anonymizer' }, extDescription: { message: 'Short.' } })),
      ...Object.fromEntries(Object.values(manifest.icons).map((p) => [p, new Uint8Array(4)])),
      'popup/popup.html': strToU8('<script src="popup.js"></script>'),
      LICENSE: strToU8('Apache License Version 2.0, January 2004'),
      NOTICE: strToU8('DOCX Anonymizer, Sitimlab'),
    };
  };
  const info = { version: pkg.version, size: 1000 };

  it('без модели — проблема «модель не встроена», остальное в порядке', () => {
    expect(checkStorePackage(base(), info)).toEqual([expect.stringContaining('модель не встроена')]);
  });

  it('key, длинное описание, внешний скрипт, host_permissions, лишние файлы, размер — каждая проблема названа', () => {
    const e = base();
    const m = JSON.parse(strFromU8(e['manifest.json']));
    e['manifest.json'] = strToU8(JSON.stringify({ ...m, key: 'x', host_permissions: ['<all_urls>'] }));
    e['_locales/en/messages.json'] = strToU8(JSON.stringify({ extName: { message: 'X' }, extDescription: { message: 'a'.repeat(133) } }));
    e['help/help.html'] = strToU8('<script src="https://cdn.example/x.js"></script>');
    e['src/core/index.js'] = new Uint8Array(1);
    e['popup/popup.html'] = strToU8('<details class="dev" id="dev-pipeline"></details>');
    const problems = checkStorePackage(e, { version: pkg.version, size: STORE_LIMITS.sizeMax + 1 }).join('\n');
    for (const s of ['key', 'описание 133', 'скрипт с внешнего адреса', 'host_permissions', 'лишние файлы', 'размер', 'Проверка конвейера'])
      expect(problems).toContain(s);
  });

  it('лёгкий пакет (--lite): модель не требуется, но и лишнего в models/ быть не должно', () => {
    expect(checkStorePackage(base(), { ...info, lite: true })).toEqual([]);
    expect(checkStorePackage({ ...base(), 'models/x.zip': new Uint8Array(1) }, { ...info, lite: true })).toEqual([expect.stringContaining('лёгкий пакет')]);
  });

  // WP13-L (0.5.1): лицензия проекта — Apache 2.0; без LICENSE/NOTICE в корне или с прежним текстом MIT пакет не годен
  it('нет LICENSE или NOTICE в корне, LICENSE не Apache — проблема', () => {
    const e = base();
    delete e.NOTICE;
    expect(checkStorePackage({ ...e, LICENSE: strToU8('MIT License') }, { ...info, lite: true })).toEqual([
      expect.stringContaining('LICENSE (Apache 2.0)'),
      expect.stringContaining('NOTICE'),
    ]);
  });

  it('нет manifest.json в корне — сразу проблема', () => {
    expect(checkStorePackage({ 'x/manifest.json': new Uint8Array(1) }, info)).toEqual(['manifest.json не в корне архива']);
  });
});

// Настоящий пакет — только если локально есть zip последнего пакета модели (в git и CI его нет), как полный архив в pack.spec.js
const MODEL_ZIP = latestModelZipPath();
describe.skipIf(!existsSync(MODEL_ZIP))('пакет для магазинов (npm run pack:store)', () => {
  let dir;
  let res;
  let zip;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'docx-anon-pack-store-'));
    res = packStore({ outDir: dir, modelZip: MODEL_ZIP });
    zip = unzipSync(new Uint8Array(readFileSync(res.file)));
  }, 120000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('называется <имя>-store.zip, проверки магазинов пройдены, размер ≤ 45 МБ (К14)', () => {
    console.log(`пакет для магазинов ${res.size} байт (${(res.size / 1048576).toFixed(1)} МБ)`);
    expect(res.name).toBe(`docx-anonymizer-${pkg.version}-store.zip`);
    expect(res.problems).toEqual([]);
    expect(res.size).toBeLessThanOrEqual(45 * 1024 * 1024);
  });

  it('манифест без key, остальное как у релиза; модель — последний пакет из KNOWN_PACKS, байт в байт', () => {
    const m = JSON.parse(strFromU8(zip['manifest.json']));
    expect('key' in m).toBe(false);
    expect(m).toEqual({ ...storeManifest(manifest), version: pkg.version });
    const index = JSON.parse(strFromU8(zip['models/index.json']));
    expect(index[0].version).toBe(latestKnownPack().version);
    const entry = zip[`models/${index[0].file}`];
    expect(createHash('sha256').update(entry).digest('hex')).toBe(latestKnownPack().sha256);
    expect(Buffer.from(entry).equals(readFileSync(MODEL_ZIP))).toBe(true);
    // WP13-L: LICENSE и NOTICE — как в репозитории
    for (const f of ['LICENSE', 'NOTICE']) expect(Buffer.from(zip[f]).equals(readFileSync(f)), f).toBe(true);
  });

  it('воспроизводим', () => {
    const again = packStore({ outDir: join(dir, 'again'), modelZip: MODEL_ZIP });
    expect(again.sha256).toBe(res.sha256);
  }, 120000);
});

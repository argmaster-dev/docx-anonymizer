#!/usr/bin/env node
// Сравнение покрытия по символам с прежними версиями (третье ревью WP12-C, версия 0.5): «закрыто в 0.4 или в 2d862d6 →
// открыто сейчас». Корпус — строки обоих ревью, фикстур, жанров и таблиц (`tests/fixtures/coverage/corpus.json`) и сетка
// «метка × значение × разделитель» (`buildGrid`). Прежние версии заморожены снимком покрытия (`prev-*.json`: какие символы
// каждого потока были закрыты в 0.4 — «B» и в 2d862d6 — «C»), а не кодом. Тест — tests/integration/coverage-grid.spec.js;
// ложные срабатывания прежних версий — в белом списке `whitelist.json` с причиной.
//
//   node scripts/coverage-grid.mjs                        — отчёт: список «раньше закрыто → открыто» без белого списка
//   node scripts/coverage-grid.mjs --snapshot <0.4> <c1>  — пересобрать снимок из каталогов прежних версий (нужен их код)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const COVERAGE_DIR = join(root, 'tests/fixtures/coverage');

// prettier-ignore
const LABELS = ['полис ОМС', 'полис', 'ОМС', 'загранпаспорт', 'заграничный паспорт', 'водительское удостоверение', 'в/у', 'ВУ', 'военный билет',
  'вид на жительство', 'ВНЖ', 'патент', 'миграционная карта', 'СТС', 'ПТС', 'свидетельство о рождении', 'свидетельство о браке', 'VIN', 'госномер',
  'г/н', 'IP', 'MAC', 'ник', 'Telegram', 'кадастровый номер', 'дело', 'дело №', 'исполнительное производство', 'доверенность', 'реестр', 'номер закупки',
  'заказ', 'счёт', 'номер клиента', 'клиент', 'Диагноз:', 'Национальность:', 'Судимость:', 'кем выдан', 'дата выдачи', 'код подразделения',
  'паспорт выдан', 'ЕНП', 'страховой полис', 'удостоверение', 'серия', 'номер'];
// prettier-ignore
const VALUES = ['+7 (495) 123-45-67', '8 999 123-45-67', '89991234567', '+79991234567', '7707083893', '770708389301', '112-233-445 95', '11223344595',
  '4276 1600 1234 5678', 'ivanov@mail.ru', '1027700132195', '40702810400000012345', 'Иванов Иван Иванович', 'г. Москва, ул. Тверская, д. 1, кв. 5', '12.03.1980'];
const SEPS = [' ', ': ', ', ', ' — ', ' № '];

/** Сетка ревьюера: 47 меток × 15 значений × 5 разделителей = 3 525 строк. */
export function buildGrid() {
  const out = [];
  for (const l of LABELS) for (const v of VALUES) for (const sep of SEPS) out.push({ lines: [l + sep + v] });
  return out;
}

/**
 * Маски покрытия: для каждого элемента — потоки текстовой модели {text, mask: '0101…'}.
 * @param {any} core модуль src/core/index.js (и text/model.js) нужной версии
 * @param {{lines?: string[], rows?: string[][]}[]} corpus
 * @param {'n'|'c'} mode обычный или коммерческий режим
 */
export async function coverage(core, fromText, corpus, mode) {
  const s = core.defaultSettings();
  if (mode === 'c') s.commercial = true;
  const out = [];
  for (const item of corpus) {
    const blocks = [];
    if (item.rows)
      item.rows.forEach((row, r) =>
        row.forEach((t, c) => blocks.push({ kind: 'cell', text: t, page: 1, table: { index: 0, row: r, col: c, cols: row.length } })),
      );
    else for (const t of item.lines) blocks.push({ kind: 'p', text: t, page: 1 });
    const doc = fromText(blocks, { name: 'a.pdf', size: 1 });
    const a = await core.analyze(doc, s);
    const masks = new Map(doc.streams.map((st) => [st.id, new Uint8Array(st.text.length)]));
    for (const g of a.groups) {
      if (!g.enabled) continue;
      for (const o of g.occurrences) {
        const m = masks.get(o.streamId);
        if (m) for (let i = o.start + (o.keepPrefix || 0); i < o.end - (o.keepSuffix || 0); i++) m[i] = 1;
      }
    }
    out.push(doc.streams.map((st) => ({ text: st.text, mask: masks.get(st.id) })));
  }
  return out;
}

/** Снимок прежних версий: «i.j» → [[начало, конец, 'B'|'C'|'BC'], …] — закрытые символы (B — 0.4, C — 2d862d6). */
export function snapshotOf(base, c1) {
  const snap = {};
  for (let i = 0; i < base.length; i++)
    for (let j = 0; j < base[i].length; j++) {
      const B = base[i][j].mask;
      const C = c1?.[i]?.[j]?.text === base[i][j].text ? c1[i][j].mask : null;
      const runs = [];
      for (let k = 0; k < B.length; k++) {
        const src = (B[k] ? 'B' : '') + (C?.[k] ? 'C' : '');
        const last = runs[runs.length - 1];
        if (!src) continue;
        if (last && last[1] === k && last[2] === src) last[1] = k + 1;
        else runs.push([k, k + 1, src]);
      }
      if (runs.length) snap[`${i}.${j}`] = runs;
    }
  return snap;
}

/**
 * Утечки относительно снимка: отрезки из букв и цифр, закрытые раньше и открытые сейчас.
 * @returns {{key: string, text: string, seg: string, was: string}[]}
 */
export function leaksAgainst(cur, snap) {
  const out = [];
  for (const [key, runs] of Object.entries(snap)) {
    const [i, j] = key.split('.').map(Number);
    const st = cur[i]?.[j];
    if (!st) {
      out.push({ key, text: '', seg: '(поток пропал)', was: '' });
      continue;
    }
    for (const [a, b, src] of runs) {
      let s = -1;
      for (let k = a; k <= b; k++) {
        const open = k < b && !st.mask[k] && /[\p{L}\p{N}]/u.test(st.text[k]);
        if (open && s < 0) s = k;
        if (!open && s >= 0) {
          out.push({ key, text: st.text, seg: st.text.slice(s, k), was: src });
          s = -1;
        }
      }
    }
  }
  return out;
}

export const loadJson = (name) => JSON.parse(readFileSync(join(COVERAGE_DIR, name), 'utf8'));
export const SETS = [
  { name: 'corpus-n', corpus: () => loadJson('corpus.json'), mode: 'n' },
  { name: 'corpus-c', corpus: () => loadJson('corpus.json'), mode: 'c' },
  { name: 'grid', corpus: buildGrid, mode: 'n' },
];

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const load = async (r) => [await import(`${r}/src/core/index.js`), (await import(`${r}/src/core/text/model.js`)).fromText];
  const fresh = async (r) => {
    const [core, fromText] = await load(r);
    core.clearDetectors();
    core.registerBuiltinDetectors();
    return [core, fromText];
  };
  if (process.argv[2] === '--snapshot') {
    const [r04, rc1] = process.argv.slice(3).map((p) => resolve(p));
    for (const set of SETS) {
      const [c04, f04] = await fresh(r04);
      const base = await coverage(c04, f04, set.corpus(), set.mode);
      const [cc1, fc1] = await fresh(rc1);
      const c1 = await coverage(cc1, fc1, set.corpus(), set.mode);
      writeFileSync(join(COVERAGE_DIR, `prev-${set.name}.json`), JSON.stringify(snapshotOf(base, c1)) + '\n');
      console.log(set.name, 'записан');
    }
  } else {
    const [core, fromText] = await fresh(root);
    for (const set of SETS) {
      const leaks = leaksAgainst(await coverage(core, fromText, set.corpus(), set.mode), loadJson(`prev-${set.name}.json`));
      for (const l of leaks) console.log(`${set.name} [${l.key}] «${l.seg}» было ${l.was} | ${l.text}`);
      console.log(`${set.name}: отрезков ${leaks.length}`);
    }
  }
}

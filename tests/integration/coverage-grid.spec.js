// Третье ревью WP12-C (версия 0.5): ни одной утечки, которой не было в 0.4 и в первой версии пакета (2d862d6). Покрытие по символам
// на корпусе ревью (строки обоих ревью, фикстуры, жанры, таблицы — 2 227 элементов, обычный и коммерческий режим) и на сетке
// «метка × значение × разделитель» (3 525 строк) сравнивается со снимком прежних версий (`tests/fixtures/coverage/prev-*.json`,
// `scripts/coverage-grid.mjs`). Отрезок, закрытый раньше и открытый сейчас, допустим только из белого списка (`whitelist.json`):
// там — ложные срабатывания прежних версий с причиной. Новая утечка или ставшая ненужной запись белого списка — ошибка.
import { describe, it, expect, beforeAll } from 'vitest';
import { SETS, coverage, leaksAgainst, loadJson } from '../../scripts/coverage-grid.mjs';
import * as core from '../../src/core/index.js';
import { fromText } from '../../src/core/text/model.js';

const whitelist = loadJson('whitelist.json');
const used = new Set();
const allowed = (l) => {
  const w = whitelist.find((x) => x.text === l.text && x.segs.includes(l.seg));
  if (w) used.add(w);
  return !!w;
};

beforeAll(() => {
  core.clearDetectors();
  core.registerBuiltinDetectors();
});

describe('покрытие не хуже 0.4 и 2d862d6 (сравнение по символам)', () => {
  for (const set of SETS)
    it(`${set.name}: «раньше закрыто → открыто сейчас» — только ложные срабатывания прежних версий из белого списка`, async () => {
      const leaks = leaksAgainst(await coverage(core, fromText, set.corpus(), set.mode), loadJson(`prev-${set.name}.json`));
      const bad = leaks.filter((l) => !allowed(l)).map((l) => `«${l.seg}» (было ${l.was}) | ${l.text}`);
      expect(bad).toEqual([]);
    }, 120000);

  it('у каждой записи белого списка есть причина, и каждая запись ещё нужна', () => {
    for (const w of whitelist) expect(w.reason.length, w.text).toBeGreaterThan(20);
    expect(whitelist.filter((w) => !used.has(w)).map((w) => w.text)).toEqual([]);
  });
});

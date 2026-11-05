// WP7, К4: время анализа ~300-страничного синтетического текста со словарным детектором ≤ 130 % от времени без него.
// 2 400 абзацев × ~65 слов из фиксированного словаря, ~8 % слов с заглавной, ~1 % — пары «Имя Фамилия».
// Прогрев, затем минимум из 5 чередующихся прогонов для dictNames: false и true (устойчиво к нагрузке соседних тестов:
// разовый всплеск нагрузки попадает в один прогон, а не в отношение; 0.5, WP12-C). Детекторы — полный встроенный набор.
// 0.5.1: до 3 независимых замеров, засчитывается лучшее отношение — на общем раннере CI всплеск нагрузки от соседних файлов
// тестов давал 1,46 при настоящих 1,09–1,23; настоящая регрессия (отношение стабильно > 1,3) по-прежнему роняет тест.
import { describe, it, expect, beforeAll } from 'vitest';
import { analyze } from '../../../src/core/detect/runner.js';
import { clearDetectors, registerBuiltinDetectors } from '../../../src/core/index.js';
import { docFromParagraphs, allOnSettings } from './helpers.js';

// prettier-ignore
const WORDS = [
  'стороны', 'обязуются', 'выполнить', 'работы', 'в', 'срок', 'согласно', 'договору', 'и', 'приложению', 'по', 'акту', 'приёмки',
  'оплата', 'производится', 'на', 'расчётный', 'счёт', 'исполнителя', 'течение', 'десяти', 'рабочих', 'дней', 'с', 'даты', 'подписания',
  'заказчик', 'вправе', 'требовать', 'устранения', 'недостатков', 'качество', 'услуг', 'должно', 'соответствовать', 'требованиям',
  'настоящего', 'документа', 'при', 'этом', 'ответственность', 'наступает', 'за', 'нарушение', 'сроков', 'поставки', 'товара', 'не',
  'более', 'чем', 'пять', 'процентов', 'от', 'стоимости', 'уведомление', 'направляется', 'письменно', 'адресу', 'указанному', 'разделе',
];
// prettier-ignore
const CAPS = ['Договор', 'Сторона', 'Заказчик', 'Исполнитель', 'Приложение', 'Акт', 'Товар', 'Москва', 'Работы', 'Покупатель', 'Стороны', 'Услуги', 'Порядок', 'Срок', 'Цена'];
// prettier-ignore
const PAIRS = [
  'Зульфие Хасановой', 'Прохору Шевчуку', 'Анвара Юсупова', 'Есения Павловская', 'Тихоном Брагиным', 'Ильнуре Сафине', 'Остап Ткаченко',
  'Мирославы Зайцевой', 'Елисею Голубеву', 'Аделину Мухаметзянову', 'Петру Смирнову', 'Анне Кузнецовой',
];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function corpus(paragraphs, seed) {
  const rand = rng(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const out = [];
  for (let p = 0; p < paragraphs; p++) {
    const words = [];
    for (let w = 0; w < 65; w++) {
      const r = rand();
      if (r < 0.005)
        words.push(pick(PAIRS)); // пара — 2 слова, ~1 % слов
      else if (r < 0.085) words.push(pick(CAPS));
      else words.push(pick(WORDS));
      if (rand() < 0.07) words[words.length - 1] += '.';
    }
    out.push(words.join(' ') + '.');
  }
  return out;
}

/** Минимум времени из `n` прогонов, режимы чередуются: оба видят одну и ту же нагрузку машины. */
async function minTimes(doc, a, b, n = 5) {
  let ta = Infinity;
  let tb = Infinity;
  for (let i = 0; i < n; i++) {
    let t0 = performance.now();
    await analyze(doc, a);
    ta = Math.min(ta, performance.now() - t0);
    t0 = performance.now();
    await analyze(doc, b);
    tb = Math.min(tb, performance.now() - t0);
  }
  return [ta, tb];
}

describe('К4: производительность словарного детектора', () => {
  beforeAll(() => {
    clearDetectors();
    registerBuiltinDetectors();
  });

  it('dictNames: true ≤ 130 % времени dictNames: false (2 400 абзацев)', async () => {
    const doc = docFromParagraphs(corpus(2400, 7));
    const off = allOnSettings({ dictNames: false });
    const on = allOnSettings({ dictNames: true });
    // прогрев: JIT, декодирование словарей, мемо
    await analyze(doc, off);
    await analyze(doc, on);
    const LIMIT = 1.3;
    const ATTEMPTS = 3;
    let best = Infinity;
    for (let attempt = 1; attempt <= ATTEMPTS && best > LIMIT; attempt++) {
      const [tOff, tOn] = await minTimes(doc, off, on);
      const ratio = tOn / tOff;
      best = Math.min(best, ratio);
      console.log(`К4, замер ${attempt}: без словаря ${tOff.toFixed(0)} мс, со словарём ${tOn.toFixed(0)} мс, отношение ${ratio.toFixed(3)}`);
    }
    expect(best).toBeLessThanOrEqual(LIMIT);
  }, 240000);
});

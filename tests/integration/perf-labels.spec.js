// Ревью WP12-C (версия 0.5): время анализа растёт линейно и на одном очень длинном абзаце с метками (151 тыс. знаков —
// склеенный PDF без переводов строк). Раньше окна меток искали начало строки по всему потоку, перебирали все позиции меток,
// а разрешение пересечений сравнивало каждую находку со всеми оставленными — квадратичный рост (981 мс против 241 мс в 0.4).
// 0.5.1: до 3 независимых замеров, засчитывается лучший — короткий замер «small» чувствителен к нагрузке соседних файлов тестов
// (на загруженной машине отношение доходило до 9); квадратичный рост (≈ 16) по-прежнему роняет тест.
// Данные вымышленные.
import { describe, it, expect, beforeAll } from 'vitest';
import { fromText, analyze, defaultSettings, registerBuiltinDetectors, clearDetectors } from '../../src/core/index.js';

const UNIT =
  'Диагноз: J45.0; Национальность: русский; Заказ № 123; счёт № 45; дело № 2-15/2026; паспорт 4506 123456 выдан ОВД 12.03.2006 код подразделения 770-001; ';

async function timeOf(n) {
  const blocks = [{ kind: 'p', text: UNIT.repeat(n), page: 1 }];
  let best = Infinity;
  let entities = 0;
  for (let i = 0; i < 3; i++) {
    const doc = fromText(blocks, { name: 'a.pdf', size: 1 });
    const t0 = performance.now();
    const a = await analyze(doc, defaultSettings());
    best = Math.min(best, performance.now() - t0);
    entities = a.entities.length;
  }
  return { ms: best, entities };
}

describe('скорость: длинный абзац с метками', () => {
  beforeAll(() => {
    clearDetectors();
    registerBuiltinDetectors();
  });

  it('в 4 раза длиннее — не дольше чем в 7 раз (линейный рост, не квадратичный); 151 тыс. знаков — меньше 3 с', async () => {
    await timeOf(50); // прогрев: компиляция регулярок
    let bestRatio = Infinity;
    let bestBig = Infinity;
    for (let attempt = 1; attempt <= 3 && !(bestRatio < 7 && bestBig < 3000); attempt++) {
      const small = await timeOf(250);
      const big = await timeOf(1000);
      console.log(
        `[perf] замер ${attempt}: 37,8 тыс. знаков — ${small.ms.toFixed(0)} мс, 151 тыс. — ${big.ms.toFixed(0)} мс (находок ${small.entities} / ${big.entities})`,
      );
      expect(big.entities).toBe(small.entities * 4);
      bestRatio = Math.min(bestRatio, big.ms / small.ms);
      bestBig = Math.min(bestBig, big.ms);
    }
    expect(bestRatio).toBeLessThan(7);
    expect(bestBig).toBeLessThan(3000);
  }, 120000);
});

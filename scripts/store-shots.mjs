// Снимки для магазинов и README (версия 0.5, WP12-F, К15/К16): npm run store:shots [-- <аргументы playwright>].
// 1) e2e-сборка dist-e2e/ — с моделью NER, если в release/ есть пакет из KNOWN_PACKS (тогда в панели нет подсказки
//    «установите модель», а находки — как у полного архива); 2) Playwright с playwright.shots.config.js (tests/shots/).
// Сеть не нужна: страницы чата и плиток — локальные (context.route). Пишет в dist-e2e/, поэтому запускать под той же
// блокировкой, что e2e. После съёмки обычный `npm run e2e` пересоберёт dist-e2e/ лёгкой.
// SHOTS_ONLY=store|promo|readme — часть набора; SHOTS_TMP — рабочий каталог LibreOffice для «до и после».
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findModelZip } from './pack.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const model = findModelZip([]);
console.log(model ? `e2e-сборка с моделью ${model}` : 'пакета модели нет — e2e-сборка лёгкая (в панели будет подсказка о модели)');
execFileSync(process.execPath, [join(root, 'scripts/build.mjs'), '--e2e', ...(model ? [`--with-model=${model}`] : [])], { cwd: root, stdio: 'inherit' });
execFileSync('npx', ['playwright', 'test', '--config=playwright.shots.config.js', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });

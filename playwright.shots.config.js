// Снимки для магазинов и README (версия 0.5, WP12-F): отдельный конфиг, чтобы `npm run e2e` их не запускал.
// Запуск — `npm run store:shots` (scripts/store-shots.mjs: e2e-сборка с моделью и этот конфиг).
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/shots',
  testMatch: '**/*.shots.js',
  timeout: 240000,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-output/playwright-shots',
});

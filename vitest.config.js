import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.spec.js', 'tests/integration/**/*.spec.js'],
    environment: 'node',
    // словари ФИО (vendor/dict, WP12-A) загружаются до каждого файла теста
    setupFiles: ['tests/setup/dicts.js'],
    testTimeout: 20000,
  },
});

// Словари ФИО — файлы vendor/dict/*.txt (версия 0.5, WP12-A): ядро получает их через loadDicts() до первого анализа.
// В тестах — один раз на файл теста с диска (как воркер расширения — из своего пакета). Тесты состояния «не загружены»
// (tests/unit/dict-load.spec.js) сбрасывают его сами.
import { loadDictsFromDisk } from '../../scripts/dicts-node.mjs';

await loadDictsFromDisk();

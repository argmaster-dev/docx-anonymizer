// Словари ФИО в Node (версия 0.5, WP12-A): чтение vendor/dict/*.txt с диска для тестов (tests/setup/dicts.js) и скриптов
// (eval-genres, gen-ner-eval, bench). В расширении те же файлы читает воркер из своего пакета (offscreen/worker.js).
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDicts } from '../src/core/detect/names/dict/load.js';

export const DICT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor/dict');

/** @param {string} name имя файла без .txt */
export const readDictFromDisk = async (name) => new Uint8Array(await readFile(join(DICT_DIR, `${name}.txt`)));

/** Загружает словари с диска; сбой — исключение (в Node словари обязаны быть на месте). */
export async function loadDictsFromDisk() {
  const r = await loadDicts(readDictFromDisk);
  if (!r.ok) throw new Error(`словари ФИО не загрузились из ${DICT_DIR}: ${r.reason}`);
  return r;
}

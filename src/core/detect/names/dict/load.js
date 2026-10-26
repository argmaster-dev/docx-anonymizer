// Загрузка словарей ФИО из файлов пакета vendor/dict/*.txt (версия 0.5, WP12-A, К14, Ц8; docs/contracts.md §2):
// словари больше не входят в код offscreen/worker.js — воркер читает их один раз на жизнь (в браузере — readPackageFile,
// только chrome-extension:// своего пакета; в Node — с диска, scripts/dicts-node.mjs) и передаёт сюда. Сети нет (NFR-01).
// Сбой не роняет анализ (NFR-13): списки заменяются пустыми, работают правила, база знаний и модель, а хост выдаёт
// предупреждение DICT_FAILED {details: {reason}} к каждому анализу. Повторной попытки нет: файлы пакета не меняются за жизнь
// воркера, а подмена словарей после первого анализа оставила бы устаревшие разборы слов в кэшах детекторов (person-dict.js) —
// словарь «наполовину» хуже, чем явно выключенный.
// Ошибки и логи не содержат содержимого словарей.
import { getDicts, setDictSources, EMPTY_DICT_SOURCES } from './index.js';

/** Файлы словарей в vendor/dict/ (без расширения .txt). */
export const DICT_FILES = Object.freeze(['ru-surnames', 'ru-first', 'en-first', 'en-surnames']);

/** Какие секции каких файлов становятся какими списками (DictSources). */
const LAYOUT = Object.freeze([
  ['ruSurnames', 'ru-surnames', 'SURNAMES'],
  ['male', 'ru-first', 'MALE'],
  ['female', 'ru-first', 'FEMALE'],
  ['unisex', 'ru-first', 'UNISEX'],
  ['ambiguous', 'ru-first', 'AMBIGUOUS'],
  ['enFirst', 'en-first', 'FIRST'],
  ['enSurnames', 'en-surnames', 'SURNAMES'],
]);

/** @type {'none'|'loaded'|'failed'} */
let state = 'none';
/** @type {Promise<DictLoadResult> | null} */
let pending = null;
/** @type {DictLoadResult | null} итог первой загрузки (сбой — окончательный) */
let result = null;

/**
 * Итог загрузки; причины DICT_FAILED: READ_FAILED — файл не получен или не UTF-8, BAD_FORMAT — получен, но не словарь.
 * @typedef {{ok: true, ms: number} | {ok: false, reason: 'READ_FAILED'|'BAD_FORMAT', ms: number}} DictLoadResult
 */

/** Состояние словарей: 'none' — не загружались, 'loaded', 'failed' — загрузка не удалась (списки пустые до конца жизни воркера). */
export const dictState = () => state;

/**
 * Разбор файла словаря: «# …» — комментарии, «#=<ИМЯ>» — начало секции, строки до следующей строки «#…» — тело секции
 * (строка codec.js). Строки кодека с «#» не начинаются, поэтому тело берётся одним срезом, без разбиения на строки.
 * @param {string} text
 * @returns {Map<string, string>} имя секции → упакованный список
 */
export function parseDictFile(text) {
  const t = text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
  /** @type {Map<string, string>} */
  const out = new Map();
  /** @type {string | null} */
  let cur = null;
  let bodyStart = 0;
  const close = (end) => {
    if (cur === null) return;
    let e = end;
    while (e > bodyStart && t.charCodeAt(e - 1) === 10) e--;
    const body = t.slice(bodyStart, e);
    if (!/^[RL]/.test(body) || /[^\x20-\x7e\n]/.test(body)) throw new Error('словарь: неверная строка кодека');
    out.set(cur, body);
    cur = null;
  };
  let pos = 0;
  while (pos < t.length) {
    if (t.charCodeAt(pos) === 35 /* # */) {
      const nl = t.indexOf('\n', pos);
      const lineEnd = nl < 0 ? t.length : nl;
      close(pos);
      if (t.startsWith('#=', pos)) {
        const name = t.slice(pos + 2, lineEnd).trim();
        if (!/^[A-Z][A-Z0-9_]*$/.test(name) || out.has(name)) throw new Error('словарь: неверная секция');
        cur = name;
        bodyStart = lineEnd + 1;
      }
      pos = lineEnd + 1;
    } else if (t.charCodeAt(pos) === 10 && cur === null) {
      pos++; // пустая строка вне секции
    } else {
      if (cur === null) throw new Error('словарь: данные вне секции');
      const next = t.indexOf('\n#', pos);
      pos = next < 0 ? t.length : next + 1;
    }
  }
  close(t.length);
  return out;
}

/**
 * Загружает словари один раз на жизнь модуля (воркера): параллельные вызовы ждут одну загрузку, последующие получают её итог
 * без чтения файлов (успех — `{ok: true, ms: 0}`). Не бросает: сбой — `{ok: false, reason}`, большие списки при этом пустые
 * (getDicts() работает), и этот итог окончательный. Детектор работает урезанно, а не выключается: курируемые имена и фамилии
 * `lexicon.js` (MALE_NAMES_RU, FEMALE_NAMES_RU, омонимы — они в коде, а не в vendor/dict) остаются, так что частые имена
 * находятся и без словарей; пропадают редкие фамилии и имена из больших списков (предупреждение DICT_FAILED, текст панели —
 * `warnDictFailed`).
 * @param {(name: string) => Promise<Uint8Array | string>} read  имя файла без .txt (DICT_FILES) → содержимое
 * @returns {Promise<DictLoadResult>}
 */
export function loadDicts(read) {
  if (result) return Promise.resolve(result.ok ? { ok: true, ms: 0 } : result);
  if (!pending) {
    pending = doLoad(read).then((r) => {
      result = r;
      pending = null;
      return r;
    });
  }
  return pending;
}

/** @param {(name: string) => Promise<Uint8Array | string>} read */
async function doLoad(read) {
  const t0 = now();
  /** @type {string[]} */
  let texts;
  try {
    const raw = await Promise.all(DICT_FILES.map((n) => read(n)));
    texts = raw.map((t) => {
      if (typeof t === 'string') return t;
      if (t instanceof Uint8Array) return new TextDecoder('utf-8', { fatal: true }).decode(t);
      throw new Error('словарь: нет данных');
    });
  } catch {
    return fail('READ_FAILED', t0);
  }
  try {
    const files = new Map(DICT_FILES.map((n, i) => [n, parseDictFile(texts[i])]));
    /** @type {Record<string, string>} */
    const src = {};
    for (const [key, file, section] of LAYOUT) {
      const body = files.get(file)?.get(section);
      if (body === undefined) throw new Error('словарь: нет секции');
      src[key] = body;
    }
    setDictSources(/** @type {import('./index.js').DictSources} */ (/** @type {unknown} */ (src)));
    getDicts(); // декодирование сразу: формат проверен до первого анализа, первый анализ не платит за него
  } catch {
    return fail('BAD_FORMAT', t0);
  }
  state = 'loaded';
  return { ok: true, ms: now() - t0 };
}

/**
 * @param {'READ_FAILED'|'BAD_FORMAT'} reason
 * @param {number} t0
 * @returns {DictLoadResult}
 */
function fail(reason, t0) {
  setDictSources(EMPTY_DICT_SOURCES);
  state = 'failed';
  return { ok: false, reason, ms: now() - t0 };
}

/** Для тестов: вернуть состояние «не загружались». */
export function resetDictsForTests() {
  setDictSources(null);
  state = 'none';
  pending = null;
  result = null;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

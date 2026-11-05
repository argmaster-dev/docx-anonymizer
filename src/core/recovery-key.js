// Распознавание ключа восстановления (.mapping.json) по содержимому (версия 0.5.1, spec FR-27, FR-29а, NFR-01): карта замен хранит ВСЕ
// настоящие значения документа — отправить её в ИИ-чат значит отдать то, что расширение скрывало (и то, что пропустили детекторы).
// Хост (offscreen/host.js) отказывает такому файлу кодом RECOVERY_KEY; перехват (content/flow.js) до хоста проверяет начало файла
// теми же правилами по тексту (core/recovery-key-sniff.js). Здесь — полная проверка: правила по всему тексту, затем разбор JSON
// (весь текст или JSON Lines построчно) и обход на любой глубине — открытая карта (форма schemas/mapping.schema.json, в том числе
// урезанная до entries или голый массив записей) и зашифрованный ключ (isEncryptedKey, core/key-crypto.js). Имя «*.mapping.json» —
// дополнительный признак. JSON с полем entries иной формы — не ключ. Бинарные форматы не разбираются. Чистый JS, без DOM;
// значения из файла в логи не попадают (NFR-14).
import { isEncryptedKey } from './key-crypto.js';
import { TOOL_NAME } from './mapping.js';
import { decodeText } from './plain/encoding.js';
import { looksLikeKeyText } from './recovery-key-sniff.js';

/** Метка встроенной категории, как пишет PlaceholderAllocator: «[ФИО_1]», «[PERSON_12]». */
const TOKEN_RE = /^\[\p{Lu}[\p{Lu}\p{N}_]*_\d+\]$/u;
/** Любая метка «[…_N]» (свои категории: префикс может быть строчным) — только с категорией в формате карты. */
const ANY_TOKEN_RE = /^\[[^[\]]{1,40}_\d+\]$/u;
const CATEGORY_RE = /^(?:[A-Z][A-Z0-9_]*|custom:.+)$/;
/** Сколько записей проверять: для решения хватает начала карты. */
const SAMPLE = 200;
/** Предел обхода разобранного JSON: глубина и число узлов (огромная выгрузка не должна подвесить хост). */
const MAX_DEPTH = 8;
const MAX_NODES = 50000;

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

/** Запись карты: значение — строка, метка — наша («[ФИО_1]») или «[…_N]» с категорией карты. */
function entryLike(e) {
  if (!isObj(e) || typeof e.token !== 'string' || typeof (e.value ?? e.original) !== 'string') return false;
  return TOKEN_RE.test(e.token) || (ANY_TOKEN_RE.test(e.token) && typeof e.category === 'string' && CATEGORY_RE.test(e.category));
}

/** Массив записей карты: не меньше половины первых SAMPLE — записи карты; одна запись — только с категорией или полной формой. */
function entriesLike(arr) {
  const sample = arr.slice(0, SAMPLE);
  const good = sample.filter(entryLike);
  if (!good.length || good.length * 2 < sample.length) return false;
  return good.length > 1 || typeof good[0].category === 'string' || typeof good[0].placeholder === 'string';
}

/**
 * Открытая карта замен: записи карты в entries (одной записи с меткой «[ФИО_1]» достаточно) или наш заголовок карты
 * (`schemaVersion: 1` и `tool.name` расширения) — при любом режиме и даже без записей: имена документов — тоже данные.
 * @param {any} obj
 */
export function isOpenMapping(obj) {
  if (!isObj(obj) || !Array.isArray(obj.entries)) return false;
  if (obj.schemaVersion === 1 && obj.tool?.name === TOOL_NAME) return true;
  const sample = obj.entries.slice(0, SAMPLE);
  const good = sample.filter(entryLike).length;
  return good > 0 && good * 2 >= sample.length;
}

/** Зашифрованный ключ: поля isEncryptedKey и их типы (у описания формата в JSON Schema те же имена полей, но это объекты). */
const encryptedLike = (obj) => isEncryptedKey(obj) && typeof obj.ct === 'string' && isObj(obj.kdf);

/**
 * Значение JSON — ключ восстановления или содержит его на любой глубине (до MAX_DEPTH, MAX_NODES узлов): открытая карта,
 * зашифрованный ключ, массив записей карты.
 * @param {any} value
 */
export function isRecoveryKeyObject(value) {
  let nodes = 0;
  const walk = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > MAX_DEPTH || ++nodes > MAX_NODES) return false;
    if (Array.isArray(v)) {
      if (entriesLike(v)) return true;
      for (const x of v.slice(0, SAMPLE)) if (walk(x, depth + 1)) return true;
      return false;
    }
    if (isOpenMapping(v) || encryptedLike(v)) return true;
    for (const k in v) if (walk(v[k], depth + 1)) return true;
    return false;
  };
  return walk(value, 0);
}

function tryParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: undefined };
  }
}

/** JSON Lines: строки, которые разбираются как JSON (объекты и массивы), — одним массивом. */
function jsonLines(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t[0] !== '{' && t[0] !== '[') continue;
    const r = tryParse(t);
    if (r.ok) out.push(r.value);
  }
  return out;
}

/**
 * Текст файла — ключ восстановления: правила по тексту (core/recovery-key-sniff.js — обрезанный, склеенный, в Markdown); иначе
 * весь текст как JSON или JSON Lines построчно и обход разобранного. Быстрый отсев: без «"entries"», «"token"» и «"ct"» — не ключ.
 * @param {string} text
 */
export function isRecoveryKeyText(text) {
  if (typeof text !== 'string' || !/"(?:entries|token|ct)\\?"/.test(text)) return false; // \" — ключ строкой внутри JSON
  if (looksLikeKeyText(text)) return true;
  const whole = tryParse(text.trim());
  if (whole.ok) return isRecoveryKeyObject(whole.value);
  const lines = jsonLines(text);
  return lines.length > 0 && isRecoveryKeyObject(lines);
}

/**
 * Имя файла ключа, как его даёт расширение: «договор.mapping.json». Дополнительный признак, не решающий: с таким именем
 * достаточно и ослабленной формы (запись с token и значением, битый JSON с этими полями — обрезанный ключ).
 * @param {string} name
 */
export function hasKeyFileName(name) {
  return /\.mapping\.json$/i.test(String(name || ''));
}

/** Ослабленная проверка для файла с именем ключа: хоть одна запись с token и значением; битый JSON — те же поля в тексте. */
function looseKeyText(text) {
  const j = tryParse(text.trim());
  if (j.ok) return isObj(j.value) && Array.isArray(j.value.entries) && j.value.entries.some((e) => isObj(e) && typeof e.token === 'string');
  return /"token"\s*:\s*"/.test(text) && /"(?:value|original)"\s*:\s*"/.test(text);
}

/**
 * Файл (байты и имя) — ключ восстановления. Кодировка — как у адаптера текстовых форматов (BOM, UTF-16, UTF-8, Windows-1251).
 * @param {Uint8Array} bytes
 * @param {string} [name]
 */
export function isRecoveryKeyFile(bytes, name) {
  if (!bytes?.length) return false;
  const text = decodeText(bytes).text;
  return isRecoveryKeyText(text) || (hasKeyFileName(name) && looseKeyText(text));
}

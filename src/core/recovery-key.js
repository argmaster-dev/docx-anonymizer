// Распознавание ключа восстановления (.mapping.json) по содержимому (версия 0.5.1, FR-27, FR-29, NFR-01): карта замен хранит ВСЕ
// настоящие значения документа — отправить её в ИИ-чат значит отдать то, что расширение скрывало (и то, что пропустили детекторы).
// Перехват (content/flow.js) и хост (offscreen/host.js) отказывают такому файлу кодом RECOVERY_KEY без «загрузить как есть».
// Узнаём открытую карту (форма schemas/mapping.schema.json, в том числе урезанную до entries, как её принимает страница
// «Восстановить») и зашифрованный паролем ключ (isEncryptedKey, core/key-crypto.js). Имя «*.mapping.json» — только дополнительный
// признак: переименованный ключ (.txt, .md, .log, .csv) узнаётся так же. JSON с полем entries иной формы — не ключ.
// Бинарные форматы (DOCX, PDF, Excel, PowerPoint, ZIP) не разбираются. Чистый JS, без DOM; значения из файла в логи не попадают (NFR-14).
import { isEncryptedKey } from './key-crypto.js';
import { TOOL_NAME } from './mapping.js';
import { decodeText } from './plain/encoding.js';

/** Метка вида «[ФИО_1]», «[КОМПАНИЯ_12]», «[custom:Код_3]» — как пишет PlaceholderAllocator. */
const TOKEN_RE = /^\[[^\][]+_\d+\]$/;
/** Поля верхнего уровня открытой карты (schemas/mapping.schema.json), кроме entries. */
const TOP_FIELDS = ['schemaVersion', 'createdAt', 'tool', 'mode', 'language', 'documents'];
/** Сколько записей проверять: для решения хватает начала карты. */
const SAMPLE = 200;

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

/** Запись карты: метка и значение — строки; метка похожа на нашу или рядом есть категория/полная форма. */
function entryLike(e) {
  if (!isObj(e) || typeof e.token !== 'string' || typeof (e.value ?? e.original) !== 'string') return false;
  return TOKEN_RE.test(e.token) || typeof e.category === 'string' || typeof e.placeholder === 'string';
}

/**
 * Открытая карта замен: массив entries, где не меньше половины записей (и хотя бы одна) — записи карты. Пустая карта — ключ,
 * только если верхний уровень наш (schemaVersion, tool с нашим именем или документы): имена документов — тоже данные.
 * @param {any} obj
 */
export function isOpenMapping(obj) {
  if (!isObj(obj) || !Array.isArray(obj.entries)) return false;
  const top = TOP_FIELDS.filter((k) => k in obj).length;
  if (!obj.entries.length) return obj.schemaVersion === 1 && (obj.tool?.name === TOOL_NAME || (Array.isArray(obj.documents) && top >= 3));
  const sample = obj.entries.slice(0, SAMPLE);
  const good = sample.filter(entryLike).length;
  if (!good || good * 2 < sample.length) return false;
  // без полей верхнего уровня (карту урезали до entries) — только если метки наши: «[ФИО_1]», а не произвольные token
  return top > 0 || sample.some((e) => entryLike(e) && TOKEN_RE.test(e.token));
}

/**
 * Объект JSON — ключ восстановления: открытая карта, зашифрованный ключ или массив, где есть такой (склеенные вручную ключи).
 * @param {any} obj
 */
export function isRecoveryKeyObject(obj) {
  if (Array.isArray(obj)) return obj.slice(0, SAMPLE).some((x) => isOpenMapping(x) || isEncryptedKey(x));
  return isOpenMapping(obj) || isEncryptedKey(obj);
}

function tryParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: undefined };
  }
}

/**
 * Текст файла — ключ восстановления. Весь текст как JSON; не разобрался (ключ вставлен в .md в блок кода или с подписью
 * в .txt) — кусок от первой «{» до последней «}». Быстрый отсев: без «"entries"» и «"ct"» JSON не разбирается.
 * @param {string} text
 */
export function isRecoveryKeyText(text) {
  if (typeof text !== 'string' || !/"(?:entries|ct)"\s*:/.test(text)) return false;
  const whole = tryParse(text.trim());
  if (whole.ok) return isRecoveryKeyObject(whole.value);
  const from = text.indexOf('{');
  const to = text.lastIndexOf('}');
  if (from < 0 || to <= from) return false;
  const inner = tryParse(text.slice(from, to + 1));
  return inner.ok && isRecoveryKeyObject(inner.value);
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

// Ключ восстановления по тексту (версия 0.5.1, spec FR-29а, ревью 0.5.1) — общие правила для перехвата и хоста, чтобы они не
// разошлись: content script проверяет первые KEY_SNIFF_BYTES байт каждого перехваченного текстового файла сам, без хоста (сбой
// хоста или инвалидация контекста не должны открыть путь «загрузить как есть»), хост (core/recovery-key.js) — весь текст, плюс
// разбор JSON. Ищутся записи карты в тексте, а не форма JSON: правила работают на обрезанном, склеенном, вложенном ключе и на ключе
// внутри Markdown. Маленький модуль без зависимостей: он входит в content.js (бюджет — pack.spec.js). Значения в логи не попадают (NFR-14).

/**
 * Начало файла → текст для правил (перехват): лёгкая замена decodeText, чтобы не тянуть его в content.js. UTF-16 — по BOM или
 * нулевому байту в первой паре (JSON начинается с ASCII); иначе строгий UTF-8 (обрезанный посреди символа хвост не ошибка —
 * `stream`); не UTF-8 — Windows-1251.
 * @param {Uint8Array} b
 */
export function sniffDecode(b) {
  const dec = (enc, from = 0) => new TextDecoder(enc).decode(b.subarray(from));
  if (b[0] === 0xff && b[1] === 0xfe) return dec('utf-16le', 2);
  if (b[0] === 0xfe && b[1] === 0xff) return dec('utf-16be', 2);
  if (b[0] && b[1] === 0) return dec('utf-16le');
  if (b[0] === 0 && b[1]) return dec('utf-16be');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b, { stream: true });
  } catch {
    return dec('windows-1251');
  }
}

/** Сколько байт начала файла проверяет перехват (ключ на десятки записей помещается целиком, у большого хватает начала). */
export const KEY_SNIFF_BYTES = 64 * 1024;

/** Запись карты: метка как у PlaceholderAllocator встроенных категорий — «[ФИО_1]», «[PERSON_12]», «[ПАСП_КОД_1]». */
const ENTRY_RE = /"token"\s*:\s*"\[\p{Lu}[\p{Lu}\p{N}_]*_\d+\]"/gu;
/** Любая метка в скобках с номером — для своих категорий (префикс может быть строчным) при признаках карты рядом. */
const ANY_TOKEN_RE = /"token"\s*:\s*"\[[^"[\]]{1,40}_\d+\]"/u;
const VALUE_RE = /"(?:value|original)"\s*:\s*"/;
/** Признаки карты: версия схемы, полная форма, категория в формате карты (schemas/mapping.schema.json). */
const SIGN_RE = /"schemaVersion"\s*:\s*1\b|"placeholder"\s*:\s*"|"category"\s*:\s*"(?:[A-Z][A-Z0-9_]*|custom:)/;
/** Наш заголовок карты — ключ при любом режиме (mask/delete: метки — не «[…_N]») и даже без записей (имена документов — тоже данные). */
const OURS_RE = /"tool"\s*:\s*\{\s*"name"\s*:\s*"DOCX Anonymizer"/;
/** Зашифрованный ключ (core/key-crypto.js): версия или алгоритм, параметры KDF и base64 соли, IV или шифротекста. */
const ENC_HEAD_RE = /"encVersion"\s*:\s*\d|"enc"\s*:\s*"AES-GCM/;
const ENC_KDF_RE = /"kdf"\s*:\s*\{/;
const ENC_DATA_RE = /"(?:ct|iv|salt)"\s*:\s*"[A-Za-z0-9+/]{8}/;

/** Сколько записей карты (до двух — больше для решения не нужно). */
function countEntries(text) {
  ENTRY_RE.lastIndex = 0;
  let n = 0;
  while (n < 2 && ENTRY_RE.exec(text)) n++;
  return n;
}

function rules(text) {
  if (ENC_HEAD_RE.test(text) && ENC_KDF_RE.test(text) && ENC_DATA_RE.test(text)) return true;
  if (OURS_RE.test(text) && text.includes('"entries"')) return true;
  if (!VALUE_RE.test(text)) return false;
  const n = countEntries(text);
  return n >= 2 || ((n > 0 || ANY_TOKEN_RE.test(text)) && SIGN_RE.test(text));
}

/**
 * Текст похож на ключ восстановления: две записи карты с метками «[…_N]» и значением, одна — с признаком карты (полная форма,
 * категория, schemaVersion), наш заголовок карты или параметры зашифрованного ключа. Ключ, вложенный строкой в другой JSON
 * (кавычки экранированы), проверяется и без экранирования.
 * @param {string} text
 */
export function looksLikeKeyText(text) {
  if (typeof text !== 'string' || !text.includes('"')) return false;
  return rules(text) || (text.includes('\\"') && rules(text.replace(/\\"/g, '"')));
}

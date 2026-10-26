// Шифрование ключа восстановления паролем (версия 0.5, WP12-D, Ц5, К8; docs/concept-0.5.md п. 7, docs/contracts.md §9.9).
// Ключ восстановления — карта «метка → настоящее значение» (FR-27, FR-28): в открытом виде это все найденные данные документа.
// По желанию пользователя файл .mapping.json сохраняется зашифрованным: WebCrypto, PBKDF2-SHA-256 (600 000 итераций, соль 16
// байт) → ключ AES-GCM-256, IV 12 байт; шифруется JSON карты целиком, заголовок (версия, алгоритм, параметры KDF) — AAD. В файле — только параметры и шифротекст (base64): ни
// значений, ни имён документов, ни меток. Неверный пароль и повреждённый файл неразличимы (тег GCM не сходится) — код
// KEY_PASSWORD, без частичного вывода. Пароль никуда не пишется и не логируется; расшифрованная карта живёт только в памяти
// страницы. Забытый пароль = потерянный ключ: восстановить его нельзя (риск концепции, сказано в интерфейсе).
// Чистый JS поверх globalThis.crypto.subtle (браузер, Node ≥ 20) — без chrome.*, document, window и сети.

/** Версия формата зашифрованного ключа (поле `encVersion`). */
export const KEY_ENC_VERSION = 1;
/** Алгоритм шифрования (поле `enc`). */
export const KEY_ENC = 'AES-GCM-256';
/** Итераций PBKDF2 при сохранении (OWASP 2023 для PBKDF2-HMAC-SHA256 — 600 000). */
export const KDF_ITERATIONS = 600000;
/** Пределы итераций при чтении: не ниже требования К8 и не настолько много, чтобы файл подвесил страницу. */
export const KDF_MIN_ITERATIONS = 600000;
export const KDF_MAX_ITERATIONS = 2000000;
/** Минимальная длина пароля в интерфейсе (символов). */
export const MIN_PASSWORD_LENGTH = 8;
const SALT_BYTES = 16;
/**
 * Заголовок ключа как дополнительные аутентифицированные данные AES-GCM (AAD): канонический JSON версии, алгоритма и параметров KDF
 * (порядок полей фиксирован) — подмена любого поля заголовка ломает тег, даже если ключ вывелся бы тот же.
 */
const aad = (h) => new TextEncoder().encode(JSON.stringify([h.encVersion, h.enc, h.kdf.name, h.kdf.hash, h.kdf.iterations, h.kdf.salt]));
const IV_BYTES = 12;

/** Ошибка ключа: `KEY_PASSWORD` — неверный пароль или повреждённый шифротекст; `KEY_INVALID` — не зашифрованный ключ этого формата. */
export class KeyCryptoError extends Error {
  /** @param {'KEY_PASSWORD'|'KEY_INVALID'|'KEY_CRYPTO_UNAVAILABLE'} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'KeyCryptoError';
    this.code = code;
  }
}

/**
 * Зашифрованный ключ восстановления (схема `schemas/mapping.schema.json#/$defs/encrypted`).
 * @typedef {object} EncryptedKey
 * @property {1} encVersion
 * @property {'AES-GCM-256'} enc
 * @property {{name: 'PBKDF2', hash: 'SHA-256', iterations: number, salt: string}} kdf
 * @property {string} iv   base64, 12 байт
 * @property {string} ct   base64: шифротекст JSON карты и тег GCM
 */

/**
 * Похож ли объект на зашифрованный ключ (по полям, без проверки значений): страница восстановления спрашивает пароль.
 * @param {any} obj
 */
export function isEncryptedKey(obj) {
  return !!obj && typeof obj === 'object' && !Array.isArray(obj) && 'ct' in obj && 'kdf' in obj && 'enc' in obj;
}

function subtle(c) {
  const s = c?.subtle;
  if (!s) throw new KeyCryptoError('KEY_CRYPTO_UNAVAILABLE', 'Шифрование недоступно в этом окружении');
  return s;
}

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, /** @type {any} */ (bytes.subarray(i, i + 0x8000)));
  return btoa(bin);
}

function fromBase64(s, field) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4) throw new KeyCryptoError('KEY_INVALID', `Поле ${field} — не base64`);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Пароль в одной нормальной форме Unicode: «ё», набранное по-разному, даёт один ключ. */
const passwordBytes = (password) => new TextEncoder().encode(String(password).normalize('NFC'));

async function deriveKey(s, password, salt, iterations, usage) {
  const base = await s.importKey('raw', passwordBytes(password), 'PBKDF2', false, ['deriveKey']);
  return s.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

/**
 * Шифрует карту замен паролем.
 * @param {object | string} mapping  карта (объект) или её JSON
 * @param {string} password  непустой
 * @param {{iterations?: number, crypto?: Crypto}} [opts]  iterations — не меньше KDF_MIN_ITERATIONS (тесты К8 проверяют нижнюю границу)
 * @returns {Promise<EncryptedKey>}
 */
export async function encryptMapping(mapping, password, opts = {}) {
  const c = opts.crypto || globalThis.crypto;
  const s = subtle(c);
  if (typeof password !== 'string' || !password) throw new KeyCryptoError('KEY_INVALID', 'Пустой пароль');
  const iterations = opts.iterations ?? KDF_ITERATIONS;
  if (!Number.isInteger(iterations) || iterations < KDF_MIN_ITERATIONS || iterations > KDF_MAX_ITERATIONS)
    throw new KeyCryptoError('KEY_INVALID', 'Недопустимое число итераций');
  const salt = c.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = c.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(s, password, salt, iterations, 'encrypt');
  const plain = new TextEncoder().encode(typeof mapping === 'string' ? mapping : JSON.stringify(mapping));
  const head = { encVersion: KEY_ENC_VERSION, enc: KEY_ENC, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) } };
  const ct = new Uint8Array(await s.encrypt({ name: 'AES-GCM', iv, additionalData: aad(head) }, key, plain));
  return { ...head, iv: toBase64(iv), ct: toBase64(ct) };
}

/**
 * Расшифровывает ключ. Неверный пароль или повреждённые `ct`/`iv` — KeyCryptoError('KEY_PASSWORD') без частичного результата;
 * не тот формат (версия, алгоритм, параметры KDF вне пределов, длины соли и IV) — 'KEY_INVALID'.
 * @param {EncryptedKey | any} obj
 * @param {string} password
 * @param {{crypto?: Crypto}} [opts]
 * @returns {Promise<any>}  карта замен (объект)
 */
export async function decryptMapping(obj, password, opts = {}) {
  const c = opts.crypto || globalThis.crypto;
  if (!isEncryptedKey(obj)) throw new KeyCryptoError('KEY_INVALID', 'Это не зашифрованный ключ');
  const k = obj.kdf;
  if (obj.encVersion !== KEY_ENC_VERSION || obj.enc !== KEY_ENC || !k || k.name !== 'PBKDF2' || k.hash !== 'SHA-256')
    throw new KeyCryptoError('KEY_INVALID', 'Неизвестный формат зашифрованного ключа');
  if (!Number.isInteger(k.iterations) || k.iterations < KDF_MIN_ITERATIONS || k.iterations > KDF_MAX_ITERATIONS)
    throw new KeyCryptoError('KEY_INVALID', 'Недопустимое число итераций');
  const salt = fromBase64(k.salt, 'salt');
  const iv = fromBase64(obj.iv, 'iv');
  const ct = fromBase64(obj.ct, 'ct');
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || ct.length < 16) throw new KeyCryptoError('KEY_INVALID', 'Повреждены параметры шифрования');
  if (typeof password !== 'string' || !password) throw new KeyCryptoError('KEY_PASSWORD', 'Нужен пароль');
  const s = subtle(c);
  let plain;
  try {
    const key = await deriveKey(s, password, salt, k.iterations, 'decrypt');
    plain = await s.decrypt({ name: 'AES-GCM', iv, additionalData: aad(obj) }, key, ct);
  } catch {
    // тег GCM не сошёлся: неверный пароль или изменённый файл — одинаково, без подробностей
    throw new KeyCryptoError('KEY_PASSWORD', 'Неверный пароль или файл ключа повреждён');
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
  } catch {
    throw new KeyCryptoError('KEY_INVALID', 'Внутри ключа не карта замен');
  }
}

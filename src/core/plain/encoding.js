// Кодировки текстовых файлов (версия 0.5, WP12-B; вынесено из plain-adapter.js в 0.5.1): определение при чтении и запись в той же
// кодировке. Общие для адаптера текстовых форматов, распознавания ключа восстановления при перехвате (core/recovery-key.js) и
// страницы «Восстановить» (файлы .txt/.md/.log от ИИ, 0.5.1). Чистый JS, без DOM (NFR-14).

/** Таблица Windows-1251 для записи: символ → байт (из декодера платформы, без своих таблиц в коде). */
let cp1251 = null;
function cp1251Table() {
  if (!cp1251) {
    cp1251 = new Map();
    const all = new TextDecoder('windows-1251').decode(Uint8Array.from({ length: 256 }, (_, i) => i));
    for (let i = 0; i < 256; i++) if (!cp1251.has(all[i])) cp1251.set(all[i], i);
  }
  return cp1251;
}

/**
 * Байты → текст и кодировка: BOM UTF-8/UTF-16 — по нему; иначе строгий UTF-8; не прошёл — Windows-1251.
 * @param {Uint8Array} bytes
 * @returns {{text: string, encoding: 'utf-8'|'utf-16le'|'utf-16be'|'windows-1251', bom: boolean}}
 */
export function decodeText(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8', bom: true };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le', bom: true };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be', bom: true };
  // UTF-16 без BOM (ревью WP12-B, п. 13): у текста на кириллице и латинице каждый второй байт часто нулевой
  const sample = bytes.subarray(0, 4096 - (Math.min(bytes.length, 4096) % 2));
  if (sample.length >= 4) {
    let even = 0;
    let odd = 0;
    for (let i = 0; i < sample.length; i++) if (!sample[i]) i % 2 ? odd++ : even++;
    const half = sample.length / 2;
    if (odd / half > 0.3 && even / half < 0.05) return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'utf-16le', bom: false };
    if (even / half > 0.3 && odd / half < 0.05) return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'utf-16be', bom: false };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8', bom: false };
  } catch {
    return { text: new TextDecoder('windows-1251').decode(bytes), encoding: 'windows-1251', bom: false };
  }
}

/**
 * Текст → байты в той же кодировке. В Windows-1251 символ без кода (редкие знаки замены) становится «?».
 * @param {string} text
 * @param {{encoding: string, bom: boolean}} enc
 */
export function encodeText(text, enc) {
  if (enc.encoding === 'utf-8') {
    const body = new TextEncoder().encode(text);
    if (!enc.bom) return body;
    const out = new Uint8Array(body.length + 3);
    out.set([0xef, 0xbb, 0xbf]);
    out.set(body, 3);
    return out;
  }
  if (enc.encoding === 'windows-1251') {
    const t = cp1251Table();
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = t.get(text[i]) ?? 0x3f;
    return out;
  }
  const le = enc.encoding === 'utf-16le';
  const out = new Uint8Array(2 + text.length * 2);
  const off = enc.bom ? 2 : 0;
  if (enc.bom) out.set(le ? [0xff, 0xfe] : [0xfe, 0xff]);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[off + i * 2] = le ? c & 0xff : c >> 8;
    out[off + 1 + i * 2] = le ? c >> 8 : c & 0xff;
  }
  return off ? out : out.subarray(0, text.length * 2);
}

/**
 * Сколько символов текста не записать в этой кодировке (encodeText заменит их на «?»): бывает только у Windows-1251 (0.5.1:
 * страница «Восстановить» предупреждает, если в восстановленном значении есть такие символы).
 * @param {string} text
 * @param {{encoding: string}} enc
 */
export function unencodableCount(text, enc) {
  if (enc.encoding !== 'windows-1251') return 0;
  const t = cp1251Table();
  let n = 0;
  for (let i = 0; i < text.length; i++) if (!t.has(text[i])) n++;
  return n;
}

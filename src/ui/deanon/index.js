// Логика страницы «Восстановить» без DOM: разбор файла карты (с 0.5 — и зашифрованного паролем, WP12-D, К8), подготовка текста
// с подсветкой нераспознанного и склонённого (FR-36, FR-37), файл от ИИ — вид, имя результата, MIME, предвыбор сессии (FR-36а, WP10-B).
import { mergeMappings } from '../../core/mapping.js';
import { decryptMapping, isEncryptedKey } from '../../core/key-crypto.js';
import { decodeText, encodeText, unencodableCount } from '../../core/plain/encoding.js';

/**
 * Разбирает содержимое .mapping.json (или нескольких файлов) в один маппинг.
 * @param {string[]} texts
 * @returns {{mapping?: any, error?: 'json'|'shape'}}
 */
export function parseMappingFiles(texts) {
  const objs = [];
  for (const t of texts) {
    try {
      objs.push(JSON.parse(t));
    } catch {
      return { error: 'json' };
    }
  }
  return mappingFromObjects(objs);
}

/** Объекты файлов карты → один маппинг (проверка формы, склейка нескольких). */
function mappingFromObjects(objs) {
  const list = [];
  for (const j of objs) {
    if (
      !j ||
      typeof j !== 'object' ||
      !Array.isArray(j.entries) ||
      !j.entries.every((e) => e && typeof e.token === 'string' && typeof (e.value ?? e.original) === 'string')
    ) {
      return { error: 'shape' };
    }
    list.push({ ...j, entries: j.entries.map((e) => ({ variants: [], parts: [], occurrences: 0, ...e })), documents: j.documents || [] });
  }
  if (!list.length) return { error: 'shape' };
  return { mapping: list.length === 1 ? list[0] : mergeMappings(list) };
}

/**
 * Файлы карты, среди которых могут быть зашифрованные паролем (0.5, WP12-D): без пароля — `needPassword` (страница спрашивает
 * пароль); с паролем — расшифровка всех зашифрованных одним паролем. Неверный пароль или повреждённый шифротекст — `error:
 * 'password'` (код KEY_PASSWORD), не тот формат — `error: 'invalid'`; частичного результата нет. Пароль не сохраняется.
 * @param {string[]} texts
 * @param {string} [password]
 * @returns {Promise<{mapping?: any, error?: 'json'|'shape'|'password'|'invalid', code?: string, needPassword?: boolean, encrypted: number}>}
 */
export async function readMappingFiles(texts, password) {
  const objs = [];
  for (const t of texts) {
    try {
      objs.push(JSON.parse(t));
    } catch {
      return { error: 'json', encrypted: 0 };
    }
  }
  const encrypted = objs.filter(isEncryptedKey).length;
  if (encrypted && !password) return { needPassword: true, encrypted };
  const plain = [];
  for (const j of objs) {
    if (!isEncryptedKey(j)) {
      plain.push(j);
      continue;
    }
    try {
      plain.push(await decryptMapping(j, /** @type {string} */ (password)));
    } catch (e) {
      const code = /** @type {any} */ (e)?.code || 'KEY_INVALID';
      return { error: code === 'KEY_PASSWORD' ? 'password' : 'invalid', code, encrypted };
    }
  }
  return { ...mappingFromObjects(plain), encrypted };
}

/**
 * Режет текст на сегменты для подсветки нераспознанных меток и склонённых подстановок (FR-36, FR-37).
 * Диапазоны не пересекаются; при пересечении побеждает начавшийся раньше.
 * @param {string} text
 * @param {{start: number, end: number}[]} unresolved позиции в text
 * @param {{start: number, end: number}[]} [declined] позиции склонённых подстановок в text
 * @returns {{text: string, unresolved: boolean, declined: boolean, item?: any}[]} item — исходная запись declined
 */
export function toSegments(text, unresolved, declined = []) {
  const marks = [
    ...unresolved.map((u) => ({ start: u.start, end: u.end, kind: 'unresolved', item: u })),
    ...declined.map((d) => ({ start: d.start, end: d.end, kind: 'declined', item: d })),
  ].sort((a, b) => a.start - b.start);
  const out = [];
  let pos = 0;
  for (const u of marks) {
    if (u.start < pos) continue;
    if (u.start > pos) out.push({ text: text.slice(pos, u.start), unresolved: false, declined: false });
    out.push(
      u.kind === 'declined'
        ? { text: text.slice(u.start, u.end), unresolved: false, declined: true, item: u.item }
        : { text: text.slice(u.start, u.end), unresolved: true, declined: false },
    );
    pos = u.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), unresolved: false, declined: false });
  return out;
}

/** Уникальные нераспознанные метки с числом повторов. */
export function countUnresolved(unresolved) {
  const m = new Map();
  for (const u of unresolved) m.set(u.text, (m.get(u.text) || 0) + 1);
  return [...m].map(([text, count]) => ({ text, count }));
}

/** Категории, у которых варианты — формы одного значения (падежи ФИО, «ООО «X»» / «X»): предупреждение не нужно. */
const FORM_CATEGORIES = new Set(['PERSON', 'COMPANY']);
/** Для сравнения значений: без регистра, «ё», пробелов и знаков («+7 900 …» и «8(900)…» различаются, «45 05» и «4505» — нет). */
const normValue = (v) =>
  String(v ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Метки, под которыми в исходном документе были разные значения (FR-36а): при восстановлении все места получат одно
 * значение `value`. Пример — карты 0.2–0.4 с паспортом: `[ПАСПОРТ_1]` = серия и номер, а в `variants` — орган выдачи и код
 * подразделения; с 0.5 (WP12-C, К6) части паспорта — разные категории, и для новых карт предупреждения нет.
 * PERSON и COMPANY пропускаются: их варианты — формы того же значения.
 * @param {{entries?: {token: string, category: string, value?: string, original?: string, variants?: string[]}[]}} mapping
 * @param {Iterable<string>} [tokens] только эти метки (найденные в восстанавливаемом тексте); не задано — все
 * @returns {{token: string, n: number}[]} n — число других значений
 */
export function mixedValueWarnings(mapping, tokens) {
  const only = tokens ? new Set(tokens) : null;
  const out = [];
  for (const e of mapping?.entries || []) {
    if (FORM_CATEGORIES.has(e.category) || (only && !only.has(e.token))) continue;
    const same = new Set([normValue(e.value), normValue(e.original)]);
    const other = new Set((e.variants || []).map(normValue).filter((v) => v && !same.has(v)));
    if (other.size) out.push({ token: e.token, n: other.size });
  }
  return out;
}

/* ---------- Файл от ИИ (WP10-B, FR-36а) ---------- */

/**
 * Вид файла от ИИ по имени: DOCX восстанавливается с сохранением форматирования; Excel, PowerPoint, CSV и JSON (0.5, WP12-B) —
 * через адаптер формата с сохранением структуры (строгие правила FR-36а); Markdown, текст и журнал — как текст.
 * @param {string} name
 * @returns {'docx'|'xlsx'|'pptx'|'csv'|'json'|'text'|null}
 */
export function aiFileKind(name) {
  const ext = extOf(name);
  if (ext === '.docx' || ext === '.docm') return 'docx';
  if (ext === '.xlsx' || ext === '.xlsm') return 'xlsx';
  if (ext === '.pptx' || ext === '.pptm') return 'pptx';
  if (ext === '.csv') return 'csv';
  if (ext === '.json') return 'json';
  if (ext === '.md' || ext === '.markdown' || ext === '.txt' || ext === '.text' || ext === '.log') return 'text';
  return null;
}

/** Вид адаптера ядра (core/adapters.js) для файла от ИИ, который восстанавливается через адаптер; иначе null. */
export function aiFileAdapterKind(kind) {
  return kind === 'xlsx' || kind === 'pptx' ? kind : kind === 'csv' || kind === 'json' ? 'plain' : null;
}

/** Суффикс анонимизированного файла по умолчанию (настройка outputSuffix). */
const DEFAULT_SUFFIX = '.anon';

/**
 * Имя восстановленного файла: «договор.anon.docx» → «договор.restored.docx», «answer.md» → «answer.restored.md».
 * Снимаются хвост повторного скачивания « (n)» («договор.anon (1).docx») и суффикс анонимизации — пользовательский
 * (настройка outputSuffix) или «.anon» по умолчанию, если суффикс с тех пор меняли.
 * @param {string} name
 * @param {string} [suffix='.anon'] суффикс анонимизированного файла (настройка outputSuffix), снимается перед «.restored»
 */
export function restoredName(name, suffix = DEFAULT_SUFFIX) {
  const ext = extOf(name);
  let base = ext ? name.slice(0, -ext.length) : name;
  const noCopy = base.replace(/ \(\d+\)$/u, '');
  if (noCopy) base = noCopy;
  for (const sfx of new Set([suffix, DEFAULT_SUFFIX])) {
    if (sfx && base.toLowerCase().endsWith(sfx.toLowerCase()) && base.length > sfx.length) {
      base = base.slice(0, -sfx.length);
      break;
    }
  }
  return `${base}.restored${ext}`;
}

/**
 * Сессия для предвыбора: запрошенная (?docId=), если она есть, иначе самая свежая; нет сессий — ''.
 * @param {{docId: string, createdAt: number}[]} sessions
 * @param {string|null} [wantDocId]
 */
export function pickSession(sessions, wantDocId) {
  if (!sessions?.length) return '';
  if (wantDocId && sessions.some((s) => s.docId === wantDocId)) return wantDocId;
  return sessions.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)).docId;
}

/**
 * Файлы ключа (байты) → тексты для readMappingFiles (0.5.1). Ключ расширение пишет в UTF-8; UTF-8 с BOM и UTF-16 читаются без
 * потерь, а файл не в UTF-8 (пересохранён как ANSI / Windows-1251) — понятная ошибка `encoding` вместо карты с «�» в значениях.
 * @param {Uint8Array[]} list
 * @returns {{texts?: string[], error?: 'encoding'}}
 */
export function keyTextsFromBytes(list) {
  const texts = [];
  for (const bytes of list) {
    const d = decodeText(bytes);
    if (d.encoding === 'windows-1251') return { error: 'encoding' };
    texts.push(d.text);
  }
  return { texts };
}

/**
 * Текстовый файл от ИИ (.txt, .md, .markdown, .text, .log) → текст и кодировка (0.5.1, FR-36а): как у адаптера текстовых форматов —
 * BOM, UTF-16, строгий UTF-8, UTF-8 с немногими битыми байтами (`replaced` — сколько стало «�»), иначе Windows-1251
 * (`file.text()` читал всё как UTF-8 и портил кириллицу в 1251).
 * @param {Uint8Array} bytes
 * @returns {{text: string, encoding: {encoding: string, bom: boolean}, replaced: number}}
 */
export function readAiText(bytes) {
  const d = decodeText(bytes);
  return { text: d.text, encoding: { encoding: d.encoding, bom: d.bom }, replaced: d.replaced || 0 };
}

/**
 * Восстановленный текст → байты в исходной кодировке (и с BOM, если он был); `lost` — сколько символов не записать в Windows-1251
 * (стали «?»).
 * @param {string} text
 * @param {{encoding: string, bom: boolean}} encoding
 */
export function encodeRestored(text, encoding) {
  return { bytes: encodeText(text, encoding), lost: unencodableCount(text, encoding) };
}

/** Название кодировки для предупреждения; для UTF-8 (с BOM и без) — null: предупреждать не о чем. */
export function encodingLabel(encoding) {
  const e = encoding?.encoding;
  if (!e || e === 'utf-8') return null;
  if (e === 'windows-1251') return 'Windows-1251';
  return e === 'utf-16be' ? 'UTF-16 BE' : 'UTF-16';
}

/**
 * MIME восстановленного файла для Blob. `charset` — кодировка текстового результата (0.5.1): файл в Windows-1251 не помечается
 * как UTF-8.
 * @param {string} name
 * @param {string} [charset]
 */
export function mimeFor(name, charset) {
  const m = mimeForExt(name);
  return charset && /;charset=/.test(m) ? m.replace(/;charset=.*$/, `;charset=${charset}`) : m;
}

function mimeForExt(name) {
  switch (extOf(name)) {
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.docm':
      return 'application/vnd.ms-word.document.macroEnabled.12';
    case '.md':
    case '.markdown':
      return 'text/markdown;charset=utf-8';
    case '.txt':
    case '.text':
    case '.log':
      return 'text/plain;charset=utf-8';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.xlsm':
      return 'application/vnd.ms-excel.sheet.macroEnabled.12';
    case '.pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case '.pptm':
      return 'application/vnd.ms-powerpoint.presentation.macroEnabled.12';
    case '.csv':
      return 'text/csv';
    case '.json':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}

/** Расширение в нижнем регистре с точкой ('' — нет). */
function extOf(name) {
  const m = /\.[^./\\]+$/.exec(String(name || ''));
  return m ? m[0].toLowerCase() : '';
}

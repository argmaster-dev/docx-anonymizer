// Восстановление файла от ИИ (FR-36а, FR-37): .docx с плейсхолдерами + карта замен → .docx с настоящими значениями.
// Обратная замена идёт по тем же потокам, что и анонимизация (ТЗ §6.1–6.3): форматирование ранов сохраняется,
// плейсхолдер, разбитый на раны, восстанавливается в первом ране (как прямая замена §6.3 п.2–4).
// С 0.5 (WP12-B, К3) — любой формат через его адаптер (restoreDocument): книги Excel, презентации PowerPoint, CSV и JSON —
// по тем же строгим правилам; литералы формул Excel не трогаются (формулы не меняются и при анонимизации).
import { parseDocx } from './docx/model.js';
import { serializeDocx } from './docx/replace.js';
import { deanonymize, deanonymizeSpans, findUnresolved } from './deanon.js';

/** FR-13: внешняя ссылка после анонимизации (core/apply.js) — восстанавливается исходный URL целиком. */
const ANON_URL_RE = /^https:\/\/anonymized\.invalid\/(.+)$/;

/**
 * @typedef {object} RestoreDocxResult
 * @property {Uint8Array} bytes
 * @property {number} replaced                         число восстановленных меток
 * @property {{text: string, streamId: string, part: string}[]} unresolved   метки [X_n], которых нет в карте
 * @property {{streamId: string, part: string, start: number, end: number, case: string, original: string, text: string}[]} declined
 *   склонённые ФИО (FR-37): координаты — в тексте потока до восстановления
 * @property {{streamId: string, part: string, reason: 'container'}[]} skipped  метки, пересекающие встроенный объект (не трогаются)
 * @property {string[]} changedParts
 * @property {string[]} tokens  метки карты, найденные в документе, без повторов (`[ПАСПОРТ_1]`)
 */

/**
 * Обратная замена во всех потоках DOCX: тело, таблицы, колонтитулы, сноски, комментарии, авторы правок,
 * поля, alt-тексты, внешние ссылки и docProps (метаданные сохраняются: keepMetadata).
 * Склонение ФИО (decline) — только в тексте документа (live/deleted); в атрибутах и метаданных — исходная форма.
 * Распознавание строгое (FR-36а): без скобок — только точный текст метки («ФИО_1»), чтобы «Счет 1» или «Договор 1»
 * из обычного текста документа не заменялись значениями из карты.
 * @param {Uint8Array} bytes  .docx / .docm
 * @param {import('./mapping.js').Mapping} mapping
 * @param {{decline?: boolean}} [opts]
 * @returns {RestoreDocxResult}
 */
export function restoreDocx(bytes, mapping, { decline = false } = {}) {
  return restoreModel(parseDocx(bytes), mapping, decline, (doc, edits) => serializeDocx(doc, edits, { keepMetadata: true, stripEmbedded: false }));
}

/**
 * Восстановление файла любого поддерживаемого формата через его адаптер (0.5, WP12-B, К3): .xlsx/.xlsm, .pptx/.pptm, .csv,
 * .json, .txt (как файл: по строкам, строго) — те же правила, что у restoreDocx. Адаптер формата по требованию должен быть
 * загружен (core/adapters.js loadAdapter). Ошибки разбора — CoreError адаптера (NOT_SUPPORTED, ENCRYPTED, PARSE_FAILED).
 * @param {Uint8Array} bytes
 * @param {import('./mapping.js').Mapping} mapping
 * @param {{adapter: import('./ooxml/adapter.js').DocumentAdapter, name?: string, decline?: boolean}} opts
 * @returns {RestoreDocxResult & {mime?: string}}
 */
export function restoreDocument(bytes, mapping, { adapter, name, decline = false }) {
  const doc = /** @type {any} */ (adapter.parse)(bytes, name);
  let mime;
  // пометки формата из карты (JSON: какие метки были числами, какие ключи получили суффикс) — по всем документам карты
  const restore = { numbers: [], keys: [] };
  for (const d of /** @type {any} */ (mapping).documents || []) {
    restore.numbers.push(...(d.restore?.numbers || []));
    restore.keys.push(...(d.restore?.keys || []));
  }
  const r = restoreModel(doc, mapping, decline, (d, edits) => {
    const out = adapter.serialize(d, edits, /** @type {any} */ ({ keepMetadata: true, stripEmbedded: false, restore }));
    mime = /** @type {any} */ (out).mime || adapter.mime;
    return out;
  });
  return { ...r, mime };
}

/**
 * Общая часть восстановления: метки во всех потоках модели → правки → сериализатор формата.
 * @param {any} doc
 * @param {import('./mapping.js').Mapping} mapping
 * @param {boolean} decline
 * @param {(doc: any, edits: import('./ooxml/serialize.js').TextEdit[]) => {bytes: Uint8Array, changedParts: string[]}} serialize
 * @returns {RestoreDocxResult}
 */
function restoreModel(doc, mapping, decline, serialize) {
  /** @type {import('./docx/replace.js').TextEdit[]} */
  const edits = [];
  /** @type {RestoreDocxResult['unresolved']} */
  const unresolved = [];
  /** @type {RestoreDocxResult['declined']} */
  const declined = [];
  /** @type {RestoreDocxResult['skipped']} */
  const skipped = [];
  /** @type {Set<string>} */
  const used = new Set();

  for (const s of doc.streams) {
    // литерал формулы Excel: формулы не меняются ни при анонимизации, ни при восстановлении
    if (s.attrKind === 'formula-literal') continue;
    if (s.attrKind === 'rel-target') {
      const url = restoreAnonUrl(s.text, mapping);
      if (url !== null) {
        edits.push({ streamId: s.id, start: 0, end: s.text.length, newText: url });
        continue;
      }
    }
    // used: метки, встреченные в документе (в т.ч. не тронутые у встроенных объектов) — для предупреждений страницы
    const spans = deanonymizeSpans(s.text, mapping, { decline: decline && (s.type === 'live' || s.type === 'deleted'), strict: true, used });
    const kept = [];
    for (const sp of spans) {
      if (crossesContainer(s, sp.start, sp.end)) {
        skipped.push({ streamId: s.id, part: s.part, reason: 'container' });
        continue;
      }
      kept.push(sp);
      edits.push({ streamId: s.id, start: sp.start, end: sp.end, newText: sp.newText });
      if (sp.declined) {
        declined.push({ streamId: s.id, part: s.part, start: sp.start, end: sp.end, case: sp.declined.case, original: sp.declined.original, text: sp.newText });
      }
    }
    for (const u of findUnresolved(s.text, kept)) unresolved.push({ text: u.text, streamId: s.id, part: s.part });
  }

  const { bytes: out, changedParts } = serialize(doc, edits);
  return { bytes: out, replaced: edits.length, unresolved, declined, skipped, changedParts, tokens: [...used] };
}

/** Восстановление текста (.md/.txt и вставленный ответ) — то же, что deanonymize (FR-36). */
export const restoreText = deanonymize;

/**
 * `https://anonymized.invalid/[URL_1]` → исходный URL, если хвост — ровно одна известная метка (в т.ч. в %-кодировке).
 * @returns {string|null}
 */
function restoreAnonUrl(text, mapping) {
  const m = ANON_URL_RE.exec(text);
  if (!m) return null;
  const tails = [m[1]];
  try {
    const dec = decodeURIComponent(m[1]);
    if (dec !== m[1]) tails.push(dec);
  } catch {
    /* битая %-последовательность — только как есть */
  }
  for (const tail of tails) {
    const spans = deanonymizeSpans(tail, mapping, { strict: true });
    if (spans.length === 1 && spans[0].start === 0 && spans[0].end === tail.length) return spans[0].newText;
  }
  return null;
}

/** Правка не должна задевать встроенный объект (w:drawing и т.п.): serializeDocx такие правки отвергает целиком. */
function crossesContainer(s, start, end) {
  if (!s.segments || !s.segIndex || end <= start) return false;
  const first = s.segIndex[start];
  const last = s.segIndex[end - 1];
  for (let i = first; i <= last; i++) if (s.segments[i].container) return true;
  return false;
}

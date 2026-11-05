// Текстовые форматы (DocumentAdapter, ТЗ §5.3; версия 0.5, WP12-B, Ц2, К4; docs/concept-0.5.md п. 4, docs/contracts.md §9.8).
// Модуль по требованию (offscreen/chunks/, core/adapters.js). Модель — обычная DocModel, как у текстовой модели PDF (core/text/):
// потоки-абзацы в части «word/document.xml» (база знаний сторон, поиск, вкладка «Текст» работают без изменений), но результат —
// тот же формат и та же кодировка, а не Markdown:
//   - .txt, .log, .md — как есть: поток на непустую строку, правки — по смещениям в тексте файла;
//   - .csv — разделитель «,», «;» или табуляция определяется по первым строкам, кавычки по RFC 4180; ячейка — поток, ячейки —
//     таблица с заголовком (detect/tables.js: «ИНН» над числом); число строк, столбцов и разделитель сохраняются;
//   - .json — только строковые значения (ключи и структура не меняются, результат — валидный JSON); число-идентификатор под
//     ключом «inn», «phone», «snils»… — поток со своим ключом-меткой, заменяется строкой (предупреждение JSON_NUMBER_AS_STRING).
// Кодировка: UTF-8 с BOM и без, UTF-16 с BOM, иначе Windows-1251 — определяется и сохраняется. Значения в логи не попадают (NFR-14).
import { detectLanguage } from '../ooxml/model.js';
import { hasExtension } from '../ooxml/adapter.js';
import { CoreError } from '../errors.js';
import { registerAdapter } from '../adapters.js';
import { tableBlocks } from '../table-blocks.js';
import { decodeText, encodeText } from './encoding.js';

// .markdown и .text — с 0.5.1 (ревью 0.5.1): разбираются как .md и .txt
const EXTENSIONS = ['.txt', '.log', '.md', '.markdown', '.text', '.csv', '.json'];
const MAIN = 'word/document.xml';
const MIME = { txt: 'text/plain', log: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json' };
/** Расширение → формат: синонимы .markdown и .text (0.5.1) */
const FORMAT_ALIAS = { markdown: 'md', text: 'txt' };

/* ---------- кодировки ---------- */

// decodeText/encodeText вынесены в ./encoding.js (0.5.1: их же используют перехват ключа восстановления и страница восстановления)
export { decodeText, encodeText };

/* ---------- разбор ---------- */

/**
 * Блок текстовой модели: кусок файла и как его записать обратно.
 * @typedef {{pid: string, kind: 'p'|'cell', text: string, start: number, end: number, write: 'raw'|'csv'|'json', quoted?: boolean,
 *   table?: {index: number, row: number, col: number, cols?: number}, number?: boolean, stream?: boolean}} PlainBlock
 */

/** Формат по имени файла; без имени — по содержимому (JSON, CSV, иначе текст). */
function formatOf(name, text) {
  const m = /\.(txt|text|log|md|markdown|csv|json)$/i.exec(String(name || ''));
  if (m) {
    const ext = m[1].toLowerCase();
    return /** @type {'txt'|'log'|'md'|'csv'|'json'} */ (FORMAT_ALIAS[ext] || ext);
  }
  const head = text.trimStart()[0];
  if (head === '{' || head === '[') return 'json';
  return detectDelimiter(text) ? 'csv' : 'txt';
}

/** Строки текста: непустые — блоки «как есть» (смещения в тексте файла). */
function lineBlocks(text) {
  const out = [];
  const re = /[^\r\n]+/g;
  let m;
  while ((m = re.exec(text))) if (m[0].trim()) out.push({ kind: 'p', text: m[0], start: m.index, end: m.index + m[0].length, write: 'raw', stream: true });
  return out;
}

/**
 * Разделитель CSV по первым 20 записям: тот из «;», «,», табуляции, который встречается вне кавычек в каждой записи
 * одинаковое число раз (≥ 1); при равенстве — чаще встречающийся. Не нашёлся — null.
 * @param {string} text
 */
export function detectDelimiter(text) {
  let best = null;
  let bestScore = 0;
  for (const d of [';', ',', '\t']) {
    const rows = parseCsv(text, d, 20);
    if (rows.length < 1) continue;
    const counts = rows.filter((r) => r.length > 1 || r[0].text).map((r) => r.length - 1);
    if (!counts.length || counts[0] < 1) continue;
    const same = counts.filter((c) => c === counts[0]).length / counts.length;
    const score = same * 1000 + counts[0];
    if (same >= 0.8 && score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Записи CSV (RFC 4180): поля в кавычках с "" внутри и переводами строк, CRLF/LF. Ячейка — текст и сырой диапазон.
 * @param {string} text
 * @param {string} delim
 * @param {number} [limit]  не больше стольких записей
 * @returns {{text: string, start: number, end: number, quoted: boolean}[][]}
 */
export function parseCsv(text, delim, limit = Infinity) {
  const rows = [];
  let row = [];
  let i = 0;
  const n = text.length;
  if (!n) return rows;
  while (i <= n && rows.length < limit) {
    const start = i;
    let value;
    let quoted = false;
    if (text[i] === '"') {
      quoted = true;
      let j = i + 1;
      let v = '';
      for (;;) {
        const q = text.indexOf('"', j);
        if (q < 0) {
          v += text.slice(j);
          j = n;
          break;
        }
        v += text.slice(j, q);
        if (text[q + 1] === '"') {
          v += '"';
          j = q + 2;
        } else {
          j = q + 1;
          break;
        }
      }
      // мусор после закрывающей кавычки до разделителя — часть сырого поля (не по RFC, но не теряем)
      let k = j;
      while (k < n && text[k] !== delim && text[k] !== '\n' && text[k] !== '\r') k++;
      value = v + text.slice(j, k);
      i = k;
    } else {
      let k = i;
      while (k < n && text[k] !== delim && text[k] !== '\n' && text[k] !== '\r') k++;
      value = text.slice(i, k);
      i = k;
    }
    row.push({ text: value, start, end: i, quoted });
    if (i < n && text[i] === delim) {
      i++;
      continue;
    }
    rows.push(row);
    row = [];
    if (i >= n) break;
    if (text[i] === '\r' && text[i + 1] === '\n') i += 2;
    else i++;
    if (i >= n) break;
  }
  if (row.length) rows.push(row);
  return rows;
}

function csvBlocks(text, delim) {
  const rows = parseCsv(text, delim);
  const cols = Math.max(0, ...rows.map((r) => r.length));
  const out = [];
  rows.forEach((r, ri) =>
    r.forEach((c, ci) => {
      if (!c.text.trim()) return;
      out.push({
        kind: 'cell',
        text: c.text,
        start: c.start,
        end: c.end,
        write: 'csv',
        quoted: c.quoted,
        table: { index: 0, row: ri, col: ci, cols },
        stream: true,
      });
    }),
  );
  return { blocks: out, rows: rows.length, cols };
}

/* ---------- JSON ---------- */

/** Ключ → метка для детекторов (заголовок строки «ключ | значение»): латинские ключи выгрузок → русские метки каталога. */
const KEY_LABELS = [
  [/^(?:inn|инн|taxid|tin)$/, 'ИНН', true],
  [/^(?:kpp|кпп)$/, 'КПП', true],
  [/^(?:ogrn|ogrnip|огрн|огрнип)$/, 'ОГРН', true],
  [/^(?:bik|bic|бик)$/, 'БИК', true],
  [/^(?:snils|снилс)$/, 'СНИЛС', true],
  [/^(?:phone|phonenumber|tel|telephone|mobile|mobilephone|телефон|тел)$/, 'Телефон', true],
  [/^(?:passport|passportnumber|паспорт)$/, 'Паспорт', true],
  [/^(?:account|accountnumber|acc|rs|settlementaccount|счет|счёт|расчетныйсчет)$/, 'Расчётный счёт', true],
  [/^(?:corraccount|ks|корсчет)$/, 'Корр. счёт', true],
  [/^(?:card|cardnumber|pan|карта)$/, 'Номер карты', true],
  [/^(?:email|mail|emailaddress|почта)$/, 'E-mail', false],
  [/^(?:birthdate|birthday|dob|dateofbirth|датарождения)$/, 'Дата рождения', false],
  [/^(?:fio|fullname|фио)$/, 'ФИО', false],
  [/^(?:firstname|givenname|имя)$/, 'Имя', false],
  [/^(?:lastname|surname|familyname|фамилия)$/, 'Фамилия', false],
  [/^(?:middlename|patronymic|отчество)$/, 'Отчество', false],
  [/^(?:address|addr|legaladdress|адрес)$/, 'Адрес', false],
];

/**
 * Метка ключа JSON и можно ли под ним искать идентификатор в числе.
 * @param {string} key
 * @returns {{label: string, numeric: boolean}}
 */
export function keyLabel(key) {
  const raw = String(key || '');
  // ключ целиком («phonenumber») и по словам: camelCase, snake_case, kebab-case («clientInn», «snils_number», «phone_mobile»)
  const words = raw
    .replace(/([\p{Ll}\d])(\p{Lu})/gu, '$1 $2')
    .toLowerCase()
    .split(/[\s_\-.]+/)
    .filter(Boolean);
  const candidates = [words.join(''), ...words];
  for (const k of candidates)
    for (const [re, label, numeric] of KEY_LABELS) if (re.test(k)) return { label: /** @type {string} */ (label), numeric: /** @type {boolean} */ (numeric) };
  return { label: raw, numeric: false };
}

/**
 * Ключи, строковые значения и числа JSON с позициями (у ключа — номер объекта: замена ключа не должна дать два одинаковых
 * ключа в одном объекте). Ошибка синтаксиса — исключение.
 * @param {string} text
 * @returns {{kind: 'key'|'string'|'number', start: number, end: number, value: string, key: string, obj?: number}[]}
 */
export function scanJson(text) {
  const out = [];
  let i = 0;
  const n = text.length;
  const ws = () => {
    while (i < n && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++;
  };
  const fail = () => {
    throw new SyntaxError('JSON');
  };
  const str = () => {
    const start = i;
    i++;
    while (i < n && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    if (i >= n) fail();
    i++;
    return { start, end: i, value: /** @type {string} */ (JSON.parse(text.slice(start, i))) };
  };
  let objects = 0;
  const value = (key) => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      ws();
      if (text[i] === '}') return void i++;
      const obj = objects++;
      for (;;) {
        ws();
        if (text[i] !== '"') fail();
        const ks = str();
        const k = ks.value;
        out.push({ kind: 'key', key: k, obj, ...ks });
        ws();
        if (text[i] !== ':') fail();
        i++;
        value(k);
        ws();
        if (text[i] === ',') i++;
        else if (text[i] === '}') return void i++;
        else fail();
      }
    }
    if (c === '[') {
      i++;
      ws();
      if (text[i] === ']') return void i++;
      for (;;) {
        value(key);
        ws();
        if (text[i] === ',') i++;
        else if (text[i] === ']') return void i++;
        else fail();
      }
    }
    if (c === '"') return void out.push({ kind: 'string', key, ...str() });
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|^(?:true|false|null)/.exec(text.slice(i, i + 400));
    if (!m) fail();
    if (/^\d/.test(m[0]) || m[0][0] === '-') out.push({ kind: 'number', key, start: i, end: i + m[0].length, value: m[0] });
    i += m[0].length;
  };
  value('');
  ws();
  if (i < n) fail();
  return out;
}

function jsonBlocks(text, nest = null, seq = { table: 0, nest: 0 }) {
  const out = [];
  const objBase = nest ? nest.id * 100000 : 0;
  for (const v of scanJson(text)) {
    // ключ — тоже текст (ревью WP12-B, п. 14): «{"Иванов Иван": {...}}» — поток; при замене ключа дубли не создаются
    if (v.kind === 'key') {
      if (/\p{L}{2}|\d{5}/u.test(v.value))
        out.push({
          kind: 'p',
          text: v.value,
          start: v.start,
          end: v.end,
          write: 'json',
          key: true,
          obj: objBase + /** @type {number} */ (v.obj),
          nest,
          stream: true,
        });
      continue;
    }
    // строка, которая сама — JSON («"meta": "{\"tel\": 79267771122}"»): разбирается рекурсивно (ревью WP12-B)
    if (v.kind === 'string' && /^\s*[[{]/.test(v.value)) {
      try {
        const inner = { id: ++seq.nest, start: v.start, end: v.end, text: v.value, parent: nest, depth: (nest?.depth ?? 0) + 1 };
        out.push(...jsonBlocks(v.value, inner, seq));
        continue;
      } catch {
        /* не JSON — обычная строка */
      }
    }
    const { label } = keyLabel(v.key);
    // любое целое из 6–20 цифр — поток (ключ — только метка): «clientInn», «contactPhone», «id» с ИНН — закроются по формату
    if (v.kind === 'number' && !/^\d{6,20}$/.test(v.value)) continue;
    if (v.kind === 'string' && !v.value.trim()) continue;
    // ключ и значение — строка таблицы «ключ | значение»: ключ становится меткой строки (rowHeader, detect/tables.js)
    const index = seq.table++;
    if (label)
      out.push({ kind: 'cell', text: label, start: v.start, end: v.start, write: 'json', nest, table: { index, row: 0, col: 0, cols: 2 }, stream: false });
    out.push({
      kind: 'cell',
      text: v.value,
      start: v.start,
      end: v.end,
      write: 'json',
      number: v.kind === 'number',
      nest,
      table: { index, row: 0, col: 1, cols: 2 },
      stream: true,
    });
  }
  return out;
}

/* ---------- модель ---------- */

/**
 * Разбирает текстовый файл. Формат — по имени (.txt/.log/.md/.csv/.json), без имени — по содержимому.
 * Битый JSON разбирается как текст по строкам (предупреждение JSON_INVALID); CSV без разделителя — одна колонка.
 * @param {Uint8Array} bytes
 * @param {string} [name]
 */
export function parsePlain(bytes, name) {
  const enc = decodeText(bytes);
  const text = enc.text;
  const format = formatOf(name, text);
  /** @type {{code: string, count?: number, details?: object}[]} */
  const warnings = [];
  // UTF-8 с немногими битыми байтами (0.5.1, encoding.js): разобран как UTF-8, в результате они станут «�» — предупреждение
  if (enc.replaced) warnings.push({ code: 'TEXT_BAD_BYTES', count: enc.replaced });
  let blocks;
  let delimiter = null;
  if (format === 'json') {
    try {
      blocks = jsonBlocks(text);
    } catch {
      warnings.push({ code: 'JSON_INVALID' });
      blocks = lineBlocks(text);
    }
  } else if (format === 'csv') {
    delimiter = detectDelimiter(text) || ',';
    blocks = csvBlocks(text, delimiter).blocks;
  } else blocks = lineBlocks(text);

  /** @type {any[]} */
  const streams = [];
  /** @type {any[]} */
  const paragraphs = [];
  let n = 0;
  let k = 0;
  for (const b of blocks) {
    if (!b.stream) {
      b.pid = `k${k++}`; // ключ JSON: только метка таблицы, без потока
      continue;
    }
    const pid = `p${n++}`;
    b.pid = pid;
    const id = `${pid}:live`;
    // число JSON под ключом-идентификатором — поток-значение (attr): не идёт в NER, правка — строкой (предупреждение)
    streams.push(
      b.number
        ? { id, part: MAIN, pid, type: 'attr', attrKind: 'json-number', text: b.text, pos: b.start, order: n - 1 }
        : { id, part: MAIN, pid, type: 'live', text: b.text, pos: b.start, order: n - 1, ...(b.key ? { jsonKey: true } : {}) },
    );
    paragraphs.push({ pid, part: MAIN, depth: b.kind === 'cell' ? 1 : 0, pos: b.start, streams: { live: id }, kind: b.kind });
  }
  // таблица для заголовков (detect/tables.js): CSV — ячейки, первая строка из ≥ 2 ячеек без цифр — шапка без «метки слева»
  // (core/table-blocks.js); JSON — пары «ключ | значение», ключ — метка строки
  let h = 0;
  const tables =
    format === 'csv'
      ? tableBlocks(
          blocks.filter((b) => b.table).map((b) => ({ pid: b.pid, text: b.text, row: b.table.row, col: b.table.col })),
          { index: 0, minHeader: 2, scanRows: 1, fakePid: () => `h${h++}` },
        )
      : blocks.filter((b) => b.table).map((b) => ({ pid: b.pid, kind: 'cell', text: b.text, table: b.table }));
  return {
    kind: 'plain',
    format,
    name,
    entries: [],
    parts: new Map(),
    streams,
    streamById: new Map(streams.map((s) => [s.id, s])),
    paragraphs,
    blocks: tables,
    plain: { text, encoding: enc.encoding, bom: enc.bom, delimiter, items: blocks.filter((b) => b.stream) },
    warnings,
    // язык — по значениям и ключам на кириллице: латинские ключи JSON («fio», «phone») не делают русскую выгрузку английской,
    // а ФИО только в ключах — даёт русские метки
    language: detectLanguage(streams, (s) => s.type === 'live' && (!s.jsonKey || /[А-Яа-яЁё]/.test(s.text))),
    size: bytes.length,
  };
}

/* ---------- запись ---------- */

/**
 * Правки → тот же формат и кодировка. Неизменённые куски файла — символ в символ. JSON внутри строки JSON — собирается заново
 * и кладётся обратно строкой. `options.restore` (восстановление, ревью WP12-B) — пометки из карты: метки, бывшие числами, снова
 * пишутся числами; ключи, получившие суффикс « (2)», возвращают исходный текст.
 * @param {ReturnType<typeof parsePlain>} doc
 * @param {import('../ooxml/serialize.js').TextEdit[]} edits
 * @param {{restore?: {numbers?: string[], keys?: [string, string][]}}} [options]
 * @returns {{bytes: Uint8Array, text: string, changedParts: string[], removedParts: string[], mime: string, restore?: {numbers: string[], keys: [string, string][]}}}
 */
export function serializePlain(doc, edits, options = {}) {
  /** @type {Map<string, import('../ooxml/serialize.js').TextEdit[]>} */
  const byStream = new Map();
  for (const e of edits) {
    const s = doc.streamById.get(e.streamId);
    if (!s) throw new CoreError('INTERNAL', `Неизвестный поток ${e.streamId}`);
    if (e.start < 0 || e.end > s.text.length || e.start > e.end) throw new CoreError('INTERNAL', `Диапазон вне потока ${e.streamId}`);
    let arr = byStream.get(e.streamId);
    if (!arr) byStream.set(e.streamId, (arr = []));
    arr.push(e);
  }
  const delim = doc.plain.delimiter || ',';
  const back = options.restore || {};
  const wasNumber = new Set(back.numbers || []);
  const keyBack = new Map(back.keys || []);
  /** пометки для восстановления (кладутся в карту, core/apply.js) */
  const notes = { numbers: [], keys: [] };
  /** правки по «текстам»: файл (null) и строки с JSON внутри (nest) */
  /** @type {Map<any, {from: number, to: number, text: string}[]>} */
  const raws = new Map([[null, []]]);
  const push = (nest, r) => {
    if (!raws.has(nest)) raws.set(nest, []);
    /** @type {any[]} */ (raws.get(nest)).push(r);
  };
  // ключи JSON по объектам: новый ключ не должен совпасть с другим ключом того же объекта (иначе JSON с дублем)
  /** @type {Map<number, Set<string>>} */
  const keysOf = new Map();
  for (const b of doc.plain.items) if (b.key) (keysOf.get(b.obj) || keysOf.set(b.obj, new Set()).get(b.obj)).add(b.text);
  for (const b of doc.plain.items) {
    const s = doc.streamById.get(`${b.pid}:live`);
    const list = byStream.get(s.id) || [];
    list.sort((a, c) => a.start - c.start || a.end - c.end);
    for (let i = 1; i < list.length; i++) if (list[i].start < list[i - 1].end) throw new CoreError('INTERNAL', `Пересекающиеся правки в потоке ${s.id}`);
    if (b.key && keyBack.has(s.text)) {
      const keys = /** @type {Set<string>} */ (keysOf.get(b.obj));
      keys.delete(s.text);
      keys.add(/** @type {string} */ (keyBack.get(s.text)));
      push(b.nest, { from: b.start, to: b.end, text: JSON.stringify(keyBack.get(s.text)) });
      continue;
    }
    if (!list.length) continue;
    let t = s.text;
    for (let i = list.length - 1; i >= 0; i--) t = t.slice(0, list[i].start) + list[i].newText + t.slice(list[i].end);
    if (b.write === 'raw') {
      for (const e of list) push(null, { from: b.start + e.start, to: b.start + e.end, text: e.newText });
    } else if (b.write === 'csv') {
      const needQuote = b.quoted || t.includes(delim) || /["\r\n]/.test(t);
      push(null, { from: b.start, to: b.end, text: needQuote ? `"${t.replace(/"/g, '""')}"` : t });
    } else if (b.key) {
      const keys = /** @type {Set<string>} */ (keysOf.get(b.obj));
      keys.delete(s.text);
      let k = t;
      for (let n = 2; keys.has(k); n++) k = `${t} (${n})`;
      keys.add(k);
      if (k !== t) notes.keys.push([k, s.text]);
      push(b.nest, { from: b.start, to: b.end, text: JSON.stringify(k) });
    } else if (wasNumber.has(s.text) && /^-?\d+(?:\.\d+)?$/.test(t)) {
      push(b.nest, { from: b.start, to: b.end, text: t }); // метка была числом — восстанавливается числом
    } else {
      if (b.number && /^\[[^\]]+\]$/.test(t)) notes.numbers.push(t);
      push(b.nest, { from: b.start, to: b.end, text: JSON.stringify(t) });
    }
  }
  // строки с JSON внутри — от самых вложенных: новый внутренний текст кладётся строкой в объемлющий
  const nests = [...raws.keys()].filter(Boolean).sort((a, c) => c.depth - a.depth);
  for (const n of nests) push(n.parent, { from: n.start, to: n.end, text: JSON.stringify(applyRaw(n.text, /** @type {any[]} */ (raws.get(n)))) });
  const top = /** @type {any[]} */ (raws.get(null));
  const out = applyRaw(doc.plain.text, top);
  const changed = top.length ? [MAIN] : [];
  /** @type {any} */
  const res = { bytes: encodeText(out, doc.plain), text: out, changedParts: changed, removedParts: [], mime: MIME[doc.format] || 'text/plain' };
  if (notes.numbers.length || notes.keys.length) res.restore = notes;
  return res;
}

/** Замены диапазонов текста (не пересекаются). */
function applyRaw(text, list) {
  const sorted = [...list].sort((a, b) => a.from - b.from);
  let out = '';
  let pos = 0;
  for (const r of sorted) {
    out += text.slice(pos, r.from) + r.text;
    pos = r.to;
  }
  return out + text.slice(pos);
}

/**
 * Предупреждения: число JSON под ключом-идентификатором станет строкой (тип значения меняется).
 * @param {ReturnType<typeof parsePlain>} doc
 * @param {import('../contracts/entity.js').EntityGroup[]} groups
 */
export function plainWarnings(doc, groups) {
  const ids = new Set();
  for (const g of groups) {
    if (!g.enabled) continue;
    const excluded = new Set(g.excludedOccurrences || []);
    for (const o of g.occurrences) if (!excluded.has(o.id) && doc.streamById.get(o.streamId)?.attrKind === 'json-number') ids.add(o.streamId);
  }
  return ids.size ? [{ code: 'JSON_NUMBER_AS_STRING', count: ids.size }] : [];
}

/** @type {import('../ooxml/adapter.js').DocumentAdapter & {analysisWarnings: typeof plainWarnings}} */
export const PLAIN_ADAPTER = Object.freeze({
  kind: 'plain',
  extensions: EXTENSIONS,
  mime: 'text/plain',
  detect: (bytes, name) => hasExtension(name, EXTENSIONS),
  parse: (bytes, name) => parsePlain(bytes, name),
  serialize: (doc, edits, options) => serializePlain(/** @type {any} */ (doc), edits, /** @type {any} */ (options)),
  parts: () => [],
  analysisWarnings: plainWarnings,
});

registerAdapter(PLAIN_ADAPTER);

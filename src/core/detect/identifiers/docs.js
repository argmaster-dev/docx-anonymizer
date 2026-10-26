// Документные идентификаторы: PASSPORT (и его части, 0.5), BIRTHDATE, CONTRACT, AMOUNT.
import { passport, birthdate } from '../../validators.js';
import { NB, NA, intervals, labelState, labelsOf, scan } from './labels.js';
import { docContext } from './papers.js';

const NBSP = '\\u00a0';
const cand = (start, end, confidence, validator, extra) => ({ start, end, confidence, ...(validator ? { validator } : {}), ...(extra || {}) });

const RU_MONTHS = 'январ[яь]|феврал[яь]|март[а]?|апрел[яь]|ма[яй]|июн[яь]|июл[яь]|август[а]?|сентябр[яь]|октябр[яь]|ноябр[яь]|декабр[яь]';
const EN_MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const MONTH = `(?:${RU_MONTHS}|${EN_MONTHS})\\.?`;

/* ---------- ПАСПОРТ ---------- */
// С 0.5 (WP12-C, К6, §8.7) части паспорта — разные категории: серия и номер (PASSPORT), кем выдан (PASSPORT_ISSUER),
// дата выдачи (PASSPORT_DATE), код подразделения (PASSPORT_DEPT) — у каждой своя метка, восстановление подставляет в каждое
// место своё значение. Загранпаспорт — INTL_PASSPORT (papers.js); номер берётся, только если ближе всех назван паспорт.
const NUM_MARK = `(?:[ ${NBSP}]*(?:№|N|No\\.?|номер)[ ${NBSP}:]*|[ ${NBSP}]?)`;
// серия+номер РФ: 45 05 123456 | 4505 123456 | 4505123456 | 4505 № 123456
const PASSPORT_RU_RE = new RegExp(`${NB}\\d{2}[ ${NBSP}]?\\d{2}${NUM_MARK}\\d{6}${NA}`, 'giu');
// 9 цифр «71 1234567» (загранпаспорт РФ под общей меткой «паспорт»)
const PASSPORT_FOREIGN_RF_RE = new RegExp(`${NB}\\d{2}[ ${NBSP}]?\\d{7}${NA}`, 'gu');
// иностранный: буквы/цифры 6–12 с хотя бы одной цифрой
const PASSPORT_ALNUM_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?=[A-Z0-9]*\\d)[A-Z0-9]{6,12}(?![\\p{L}\\p{N}])`, 'gu');
const ISSUED_RE = new RegExp(`^[,;.)\\s]*(?:кем[ ${NBSP}]+выдан|выдан[аы]?|issued[ ${NBSP}]+by)[ ${NBSP}:]*`, 'iu');
// «12.03.2006», «12 марта 2006», «“12” марта 2006» (день в кавычках — так пишут в бланках)
const DATE_IN_TEXT_RE = new RegExp(`\\d{1,2}[./]\\d{1,2}[./]\\d{2,4}|[«"“]?\\d{1,2}[»"”]?[ ${NBSP}]+(?:${MONTH})[ ${NBSP}]+\\d{4}`, 'iu');
const DATE_FIRST_RE = new RegExp(`^(?:${DATE_IN_TEXT_RE.source})(?:[ ${NBSP}]*(?:г\\.|года))?[ ${NBSP},]*`, 'iu');
// «770-001», «770 001», «770–001» и с неразрывным дефисом (U+2011)
const DEPT_RE = new RegExp(`${NB}\\d{3}[- \\u2010-\\u2013]\\d{3}${NA}`, 'gu');
/** Конец органа выдачи: «, код подразделения», «, дата выдачи». */
const ISSUER_END_RE = /[,;]?[ \t\u00a0]*(?:код[ \t\u00a0]+подр|к\/п|дата[ \t\u00a0]+выдачи)/iu;
const passportDoc = (text, start, ctx) => {
  const d = docContext(text, start, ctx);
  return !d || d === 'PASSPORT';
};
let lastScan = { text: null, ctx: null, parts: [] };

/**
 * Серия и номер, орган выдачи, дата выдачи и код подразделения одного потока (кэш на один поток: четыре детектора
 * вызываются подряд с тем же текстом).
 * @returns {{cat: string, start: number, end: number}[]}
 */
function passportParts(text, ctx) {
  if (lastScan.text === text && lastScan.ctx === ctx?.stream) return lastScan.parts;
  const parts = [];
  lastScan = { text, ctx: ctx?.stream, parts };
  // все части — только по метке: поток без меток паспорта (и не ячейка таблицы) не сканируется
  const has = (id) => labelsOf(id, text, ctx).length > 0;
  const cell = !!(ctx?.stream?.rowHeader || ctx?.stream?.columnHeader);
  if (!cell && !['PASSPORT', 'PASSPORT_ISSUER', 'PASSPORT_DATE', 'PASSPORT_DEPT'].some(has)) return parts;
  const taken = intervals();
  const free = (a, b) => taken.free(a, b);
  const add = (cat, start, end) => {
    if (end <= start || !free(start, end)) return;
    taken.add(start, end);
    parts.push({ cat, start, end });
  };
  const nums = [];
  const own = (c) => labelState(text, c.start, ctx, 'PASSPORT').mine && passportDoc(text, c.start, ctx);
  for (const re of [PASSPORT_RU_RE, PASSPORT_FOREIGN_RF_RE, PASSPORT_ALNUM_RE]) {
    for (const c of scan(text, re)) {
      if (re === PASSPORT_ALNUM_RE && !/[A-Z]/.test(c.text)) continue;
      if (free(c.start, c.end) && own(c) && passport(c.text.replace(re === PASSPORT_RU_RE ? /[^\d]/g : /[\s\u00a0]/g, ''))) {
        add('PASSPORT', c.start, c.end);
        nums.push(c.end);
      }
    }
  }
  /** Орган выдачи с позиции `at` до даты, «код подразделения» или запятой; дата в той же строке — дата выдачи. */
  const issuer = (at) => {
    let line = text.slice(at, at + 200).split('\n')[0];
    const df = DATE_FIRST_RE.exec(line);
    if (df) {
      const d = DATE_IN_TEXT_RE.exec(line);
      add('PASSPORT_DATE', at + d.index, at + d.index + d[0].length);
      at += df[0].length;
      line = line.slice(df[0].length);
    }
    const d = DATE_IN_TEXT_RE.exec(line);
    const e = ISSUER_END_RE.exec(line);
    let org;
    if (d && d.index > 0 && (!e || d.index < e.index)) org = line.slice(0, d.index);
    else if (e) org = line.slice(0, e.index);
    else {
      const cut = line.search(/[,;]/);
      org = cut >= 0 ? line.slice(0, cut) : line;
    }
    org = org.replace(/[\s,;]+$/, '');
    if (org.length >= 3 && /\p{L}/u.test(org)) add('PASSPORT_ISSUER', at, at + org.length);
    if (d && d.index > 0 && !df) add('PASSPORT_DATE', at + d.index, at + d.index + d[0].length);
  };
  // «…, выдан ОВД … 12.03.2005» сразу после номера
  for (const end of nums) {
    const m = ISSUED_RE.exec(text.slice(end, end + 60));
    if (m) issuer(end + m[0].length);
  }
  // «Кем выдан: …» и «Дата выдачи: …» по метке — в тексте и в ячейке таблицы
  for (const [at, end] of labelsOf('PASSPORT_ISSUER', text, ctx))
    if (passportDoc(text, at, ctx)) issuer(end + /^[ \u00a0:–—-]*/u.exec(text.slice(end))[0].length);
  const s0 = text.search(/\S/u);
  if (s0 >= 0 && labelState(text, s0, ctx, 'PASSPORT_ISSUER').mine && passportDoc(text, s0, ctx)) issuer(s0);
  // «Дата выдачи: …» в тексте — только если ближе всех назван паспорт (иначе это дата справки, доверенности…); в ячейке
  // под меткой строки «Дата выдачи» паспорт назван в соседних строках анкеты — достаточно, что другой документ не назван
  for (const c of scan(text, DATE_RE)) {
    if (labelState(text, c.start, ctx, 'PASSPORT_DATE').mine !== 'strict') continue;
    const d = docContext(text, c.start, ctx);
    if (d === 'PASSPORT' || (!d && cell && c.start === s0)) add('PASSPORT_DATE', c.start, c.end);
  }
  for (const c of scan(text, DEPT_RE)) if (labelState(text, c.start, ctx, 'PASSPORT_DEPT').mine) add('PASSPORT_DEPT', c.start, c.end);
  return parts;
}

/** Детектор части паспорта `cat` (все уровни — `labeled`). */
const passportPart = (cat) => (text, ctx) =>
  passportParts(text, ctx)
    .filter((p) => p.cat === cat)
    .map((p) => cand(p.start, p.end, 'labeled', cat === 'PASSPORT' ? 'passport' : undefined));

export const detectPassport = passportPart('PASSPORT');
export const detectPassportIssuer = passportPart('PASSPORT_ISSUER');
export const detectPassportDate = passportPart('PASSPORT_DATE');
export const detectPassportDept = passportPart('PASSPORT_DEPT');

/* ---------- ДАТА РОЖДЕНИЯ ---------- */
const DATE_RE = new RegExp(
  `${NB}(?:\\d{1,2}[./-]\\d{1,2}[./-]\\d{4}|\\d{1,2}(?:st|nd|rd|th)?[ ${NBSP}]+${MONTH},?[ ${NBSP}]+\\d{4}|(?:${EN_MONTHS})\\.?[ ${NBSP}]+\\d{1,2}(?:st|nd|rd|th)?,?[ ${NBSP}]+\\d{4})(?![\\p{L}\\p{N}])(?![-./]\\d)`,
  'giu',
);
const AFTER_DOB_RE = new RegExp(`^[ ${NBSP}]*(?:г\\.?[ ${NBSP}]*р\\.?|года[ ${NBSP}]+рождения|г\\.[ ${NBSP}]+рождения|\\(д\\.?р\\.?\\))`, 'iu');

export function detectBirthdate(text, ctx) {
  const out = [];
  for (const c of scan(text, DATE_RE)) {
    if (!birthdate(c.text)) continue;
    const before = labelState(text, c.start, ctx, 'BIRTHDATE').mine;
    const after = AFTER_DOB_RE.test(text.slice(c.end, c.end + 30));
    if (before || after) out.push(cand(c.start, c.end, 'labeled', 'birthdate'));
  }
  return out;
}

/* ---------- НОМЕР ДОГОВОРА ---------- */
const CONTRACT_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:договор(?:а|у|ом|е)?|контракт(?:а|у|ом|е)?|соглашени(?:е|я|ю|ем|и)|agreement|contract)` +
    `(?:[ ${NBSP}]+[\\p{L}-]+){0,4}[ ${NBSP}]*(?:№|#|N[oо]\\.?|nr\\.?)[ ${NBSP}:]*` +
    `((?=[\\p{L}\\p{N}\\/._-]*\\d)[\\p{L}\\p{N}]+(?:[-/._][\\p{L}\\p{N}]+)*)`,
  'giu',
);

export function detectContract(text) {
  const out = [];
  for (const c of scan(text, CONTRACT_RE)) {
    const code = c.m[1];
    if (code.length > 40) continue;
    out.push(cand(c.end - code.length, c.end, 'labeled'));
  }
  return out;
}

/* ---------- СУММА ---------- */
const NUMBER = `(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d{1,3}(?:[ ${NBSP}\\u202f]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)`;
const CUR_WORD = `(?:руб(?:\\.|л(?:ей|я|ь))?|₽|RUB|USD|EUR|GBP|CNY|долл(?:\\.|аров|ара|ар)?|евро|\\$|€|£|¥)`;
const CUR_AFTER = new RegExp(`^[ ${NBSP}]*${CUR_WORD}(?![\\p{L}])`, 'iu');
const CUR_BEFORE = new RegExp(`(?:\\$|€|£|¥|USD|EUR|GBP|RUB|CNY)[ ${NBSP}]*$`, 'iu');
const KOPECKS = new RegExp(`^[ ${NBSP}]*\\d{1,2}[ ${NBSP}]*коп(?:\\.|еек|ейки|ейка)?(?![\\p{L}])`, 'iu');
const WORDS_IN_PARENS = new RegExp(`^[ ${NBSP}]*\\(([^()\\n]{3,250})\\)`, 'u');
const AMOUNT_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?<!\\d[ ${NBSP}.,])${NUMBER}(?![\\p{L}\\p{N}])(?!\\d)`, 'gu');

export function detectAmount(text) {
  const out = [];
  for (const c of scan(text, AMOUNT_RE)) {
    let start = c.start;
    let end = c.end;
    // валюта: после числа или перед ним
    let cur = false;
    const after = CUR_AFTER.exec(text.slice(end, end + 30));
    if (after) {
      cur = true;
      end += after[0].length;
      // «руб.» — точка принадлежит сумме только перед скобкой/копейками
      if (text[end - 1] === '.' && !/^[ \u00a0]*(?:\(|\d)/.test(text.slice(end, end + 5))) end--;
      const kop = KOPECKS.exec(text.slice(end, end + 30));
      if (kop) end += kop[0].length;
    } else {
      const bm = CUR_BEFORE.exec(text.slice(Math.max(0, start - 8), start));
      if (bm) {
        cur = true;
        start -= bm[0].length;
      }
    }
    // расшифровка прописью — одна сущность с суммой
    if (cur) {
      const w = WORDS_IN_PARENS.exec(text.slice(end, end + 270));
      if (w && /\p{L}{3}/u.test(w[1])) end += w[0].length;
    }
    const hasLabel = amountLabel(text, c.start);
    const shaped = /[ \u00a0\u202f,]\d{3}|[.,]\d{1,2}$|\d{4,}/.test(c.text);
    if (cur && hasLabel) out.push(cand(start, end, 'labeled'));
    else if (cur) out.push(cand(start, end, 'weak'));
    else if (hasLabel && shaped) out.push(cand(start, end, 'labeled'));
  }
  return out;
}

// «цена», «стоимость», «сумма» (+ до трёх слов) / price, amount, fee
const AMOUNT_LABEL_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:цен[аыуе]|стоимост[ьи]|сумм[аыуе]|price|amount|fee|total)(?:[ ${NBSP}]+[\\p{L}.«»"'()-]+){0,3}[ ${NBSP}:–—-]*(?:составля[а-я]+[ ${NBSP}:]*)?$`,
  'iu',
);
function amountLabel(text, start) {
  const raw = text.slice(Math.max(0, start - 40), start);
  return AMOUNT_LABEL_RE.test(raw.slice(raw.lastIndexOf('\n') + 1));
}

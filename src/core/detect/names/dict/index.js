// Словари ФИО для словарного детектора (WP7, FR-23, ступень 1 NER): ленивое декодирование и морфологические запросы.
// С 0.5 (WP12-A) словари — не код, а файлы пакета vendor/dict/*.txt (генерирует scripts/make-dicts.mjs; источники и лицензии —
// vendor/dict/NOTICE.md): их один раз на жизнь воркера читает и передаёт сюда names/dict/load.js (`loadDicts`). Запросы
// остаются синхронными; до загрузки getDicts() бросает ошибку. Сбой загрузки — пустые списки (остаются курируемые имена
// lexicon.js), анализ идёт без словарного детектора, хост выдаёт предупреждение DICT_FAILED (docs/contracts.md §2).
// Списки ставятся один раз до первого анализа: кэши разборов слов в детекторах (person-dict.js) не сбрасываются.

import { decodeList } from './codec.js';
import { declineFirstName, declineSurname, lemmaCandidates } from '../morph.js';
import { lowerE, MALE_NAMES_RU, FEMALE_NAMES_RU, AMBIGUOUS_NAMES_RU, COMMON_NOUNS } from '../lexicon.js';

/**
 * Упакованные списки (строки codec.js) — содержимое секций файлов vendor/dict/*.txt.
 * @typedef {object} DictSources
 * @property {string} ruSurnames  ru-surnames.txt #=SURNAMES
 * @property {string} male        ru-first.txt #=MALE
 * @property {string} female      ru-first.txt #=FEMALE
 * @property {string} unisex      ru-first.txt #=UNISEX
 * @property {string} ambiguous   ru-first.txt #=AMBIGUOUS
 * @property {string} enFirst     en-first.txt #=FIRST
 * @property {string} enSurnames  en-surnames.txt #=SURNAMES
 */

/** Пустые списки: словари не загрузились — остаются только курируемые имена lexicon.js. */
export const EMPTY_DICT_SOURCES = Object.freeze({ ruSurnames: 'R', male: 'R', female: 'R', unisex: 'R', ambiguous: 'R', enFirst: 'L', enSurnames: 'L' });

/** @type {DictSources | null} */
let SRC = null;

/**
 * Устанавливает упакованные списки (load.js; тесты). Кэш декодирования и разборов сбрасывается.
 * @param {DictSources | null} src  null — снова «не загружены»
 */
export function setDictSources(src) {
  SRC = src;
  D = null;
  surnameMemo.clear();
  suffixMemo.clear();
}

/** @typedef {'m'|'f'} Gender */
/** @typedef {{lemma: string, gender: Gender, cases: number[]}} FormInfo */

/**
 * @typedef {object} Dicts
 * @property {Set<string>} ruSurnames мужские леммы
 * @property {Map<string, 'm'|'f'|'u'>} ruFirst лемма → род
 * @property {Map<string, FormInfo[]>} ruFirstForms падежная форма → разборы
 * @property {Set<string>} ruAmbiguous имена-омонимы нарицательных
 * @property {Set<string>} enFirst
 * @property {Set<string>} enSurnames
 * @property {number} decodeMs время декодирования
 */

/** @type {Dicts | null} */
let D = null;

/** @returns {Dicts} */
export function getDicts() {
  if (D) return D;
  if (!SRC) throw new Error('Словари ФИО не загружены: до анализа вызовите loadDicts() (names/dict/load.js)');
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  /** @type {Map<string, 'm'|'f'|'u'>} */
  const ruFirst = new Map();
  for (const [list, g] of /** @type {[string, 'm'|'f'|'u'][]} */ ([
    [SRC.male, 'm'],
    [SRC.female, 'f'],
    [SRC.unisex, 'u'],
  ])) {
    for (const w of decodeList(list)) ruFirst.set(w, g);
  }
  for (const n of MALE_NAMES_RU) if (!ruFirst.has(lowerE(n))) ruFirst.set(lowerE(n), 'm');
  for (const n of FEMALE_NAMES_RU) if (!ruFirst.has(lowerE(n))) ruFirst.set(lowerE(n), 'f');

  /** @type {Map<string, FormInfo[]>} */
  const ruFirstForms = new Map();
  const addForms = (lemma, g) => {
    declineFirstName(lemma, g).forEach((f, i) => {
      let arr = ruFirstForms.get(f);
      if (!arr) ruFirstForms.set(f, (arr = []));
      let rec = arr.find((x) => x.lemma === lemma && x.gender === g);
      if (!rec) arr.push((rec = { lemma, gender: g, cases: [] }));
      if (!rec.cases.includes(i)) rec.cases.push(i);
    });
  };
  for (const [lemma, g] of ruFirst) {
    if (g !== 'f') addForms(lemma, 'm');
    if (g !== 'm') {
      addForms(lemma, 'f');
      // «Зульфие», «Гульнарие»: у тюркских имён на -ия дат./предл. падеж часто пишут через -ие
      const alt = altIyaForm(lemma);
      if (alt) {
        let arr = ruFirstForms.get(alt);
        if (!arr) ruFirstForms.set(alt, (arr = []));
        if (!arr.some((x) => x.lemma === lemma)) arr.push({ lemma, gender: 'f', cases: [2, 5] });
      }
    }
  }
  const ruAmbiguous = new Set(decodeList(SRC.ambiguous));
  for (const w of AMBIGUOUS_NAMES_RU) ruAmbiguous.add(w);

  D = {
    ruSurnames: new Set(decodeList(SRC.ruSurnames)),
    ruFirst,
    ruFirstForms,
    ruAmbiguous,
    enFirst: new Set(decodeList(SRC.enFirst)),
    enSurnames: new Set(decodeList(SRC.enSurnames)),
    decodeMs: 0,
  };
  D.decodeMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return D;
}

/**
 * Имя из большого словаря в любой падежной форме.
 * `ambiguous` — омоним нарицательного (лемма или сама форма).
 * @param {string} word
 * @returns {{lemma: string, gender: Gender, cases: number[], ambiguous: boolean}[]}
 */
export function bigFirstNameInfo(word) {
  const d = getDicts();
  const w = lowerE(word);
  const infos = d.ruFirstForms.get(w);
  if (!infos) return [];
  const formCommon = COMMON_NOUNS.has(w);
  return infos.map((x) => ({ ...x, ambiguous: formCommon || d.ruAmbiguous.has(x.lemma) || COMMON_NOUNS.has(x.lemma) }));
}

/** Альтернативная форма дат./предл. падежа женского имени на -ия («Зульфие»). */
const altIyaForm = (lemma) => (/[^и]ия$/.test(lemma) ? lemma.slice(0, -1) + 'е' : null);

/**
 * Падежные формы имени с учётом словарных вариантов (для записей базы лиц, kb.js).
 * @param {string} lemma
 * @param {Gender} g
 * @returns {string[]}
 */
export function firstNameForms(lemma, g) {
  const forms = declineFirstName(lemma, g);
  const alt = g === 'f' ? altIyaForm(lemma) : null;
  return alt ? [...forms, alt] : forms;
}

/* ---------------- фамилии ---------------- */

const FEM_TO_MASC = [
  [/ова$/, 'ов'],
  [/ева$/, 'ев'],
  [/ина$/, 'ин'],
  [/ына$/, 'ын'],
  [/ская$/, 'ский'],
  [/цкая$/, 'цкий'],
];
/** Мужская лемма для женской формы фамилии в им. падеже («иванова» → «иванов»). */
const mascOf = (w) => {
  for (const [re, rep] of FEM_TO_MASC) if (re.test(w)) return w.replace(re, rep);
  return w;
};
/** Окончания, невозможные у женской фамилии в им. падеже. */
const MASC_ONLY = /(?:ов|ев|ин|ын|ий|ый|ой)$/;

const MEMO_MAX = 50000;
/** @type {Map<string, FormInfo[]>} */
const surnameMemo = new Map();
/** @type {Map<string, FormInfo[]>} */
const suffixMemo = new Map();

function memo(map, key, fn) {
  let v = map.get(key);
  if (v) return v;
  if (map.size >= MEMO_MAX) map.clear();
  v = fn();
  map.set(key, v);
  return v;
}

/**
 * Разборы одного слова (без дефиса) как фамилии, принятые предикатом `accept(lemma, gender)`.
 * Лемма — им. падеж в своём роде («ивановой» → «иванова», f).
 * @returns {FormInfo[]}
 */
function parseSurnamePart(w, accept) {
  /** @type {FormInfo[]} */
  const out = [];
  for (const g of /** @type {Gender[]} */ (['m', 'f'])) {
    for (const cand of lemmaCandidates(w, 'surname', g)) {
      if (g === 'f' && MASC_ONLY.test(cand)) continue;
      if (!accept(cand, g)) continue;
      const cases = [];
      declineSurname(cand, g).forEach((f, i) => {
        if (f === w && !cases.includes(i)) cases.push(i);
      });
      if (cases.length) out.push({ lemma: cand, gender: g, cases });
    }
  }
  return out;
}

/** Дефисная фамилия: все части — фамилии, род общий, падежи пересекаются. */
function parseHyphenated(w, partFn) {
  const parts = w.split('-');
  const infos = parts.map(partFn);
  if (infos.some((x) => !x.length)) return [];
  /** @type {FormInfo[]} */
  const out = [];
  for (const g of /** @type {Gender[]} */ (['m', 'f'])) {
    const per = infos.map((arr) => arr.filter((x) => x.gender === g));
    if (per.some((x) => !x.length)) continue;
    let cases = [0, 1, 2, 3, 4, 5];
    for (const arr of per) {
      const u = new Set(arr.flatMap((x) => x.cases));
      cases = cases.filter((c) => u.has(c));
    }
    if (!cases.length) continue;
    const lemma = per.map((arr) => arr.find((x) => x.cases.some((c) => cases.includes(c)))?.lemma || arr[0].lemma).join('-');
    out.push({ lemma, gender: g, cases });
  }
  return out;
}

const inSurnameDict = (cand, g) => {
  const d = getDicts();
  return g === 'm' ? d.ruSurnames.has(cand) : d.ruSurnames.has(mascOf(cand));
};

/**
 * Словарная фамилия в любой падежной форме и роде.
 * @param {string} word
 * @returns {FormInfo[]} пусто — не словарная
 */
export function surnameLemmas(word) {
  const w = lowerE(word);
  return memo(surnameMemo, w, () => {
    const part = (p) => (p.length >= 2 ? parseSurnamePart(p, inSurnameDict) : []);
    return w.includes('-') ? parseHyphenated(w, part) : part(w);
  });
}

const SUF_M = /(?:ов|ев|ин|ын|ский|цкий|ской|цкой)$/;
const SUF_F = /(?:ова|ева|ина|ына|ская|цкая)$/;
const SUF_ANY = /(?:ых|их|енко|ко|ук|юк|ич|дзе|швили|ян)$/;
const suffixOk = (cand, g) => cand.length >= 4 && ((g === 'm' ? SUF_M : SUF_F).test(cand) || SUF_ANY.test(cand));

/**
 * Фамилия по типичному суффиксу (-ов, -ин, -ский, -енко, -ук, -дзе, -ян…) в любой падежной форме.
 * @param {string} word
 * @returns {FormInfo[] | null} null — не похоже на фамилию
 */
export function surnameSuffixInfo(word) {
  const w = lowerE(word);
  const r = memo(suffixMemo, w, () => {
    const part = (p) => parseSurnamePart(p, suffixOk);
    return w.includes('-') ? parseHyphenated(w, part) : part(w);
  });
  return r.length ? r : null;
}

/** Латиница без диакритики для словарей EN (WP11-D): «Wiśniewski» → «wisniewski», «Müller» → «muller». */
const foldLatin = (word) => {
  const w = word.toLowerCase();
  return /^[a-z'’-]*$/.test(w)
    ? w
    : w
        .normalize('NFD')
        .replace(/\p{Mn}/gu, '')
        .replace(/ł/g, 'l')
        .replace(/ø/g, 'o')
        .replace(/ß/g, 'ss');
};
/** @param {string} word */
export const isEnFirst = (word) => getDicts().enFirst.has(foldLatin(word));
/** @param {string} word */
export const isEnSurname = (word) => getDicts().enSurnames.has(foldLatin(word));

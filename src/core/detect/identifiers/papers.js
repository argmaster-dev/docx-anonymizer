// Категории версии 0.5 (WP12-C, `docs/concept-0.5.md` п. 5, Ц3, К5; `docs/contracts.md` §8.7): документы личности и ЗАГС,
// полис ОМС, транспорт (СТС/ПТС, VIN, госномер), IP/MAC, ники; кадастр и ЕГРН, суды и исполнительные производства,
// доверенности и реестр нотариуса; коммерческие номера по метке; сведения о здоровье и особые категории ПДн — только по метке.
// Два способа поиска (FR-18):
//   - «формат → метка»: регулярка значения, затем метка перед ним (`labelHits`) и тип документа рядом (`docContext`);
//     без метки — только форматы с жёсткой структурой (уровень `validated`): VIN, госномер кириллицей, IP, MAC, кадастр,
//     запись ЕГРН, арбитражное дело, УИД, исполнительное производство, серия свидетельства ЗАГС;
//   - «метка → значение»: метка в тексте (или метка строки/заголовок столбца таблицы), за ней код с цифрой (`labeled`)
//     или, для HEALTH и SPECIAL, текст до конца фразы после «:».
// Чистые функции; значения документа никуда не пишутся (NFR-14).
import { ipv4, ipv6, oms, passport, roman, vin } from '../../validators.js';
import { NB, NA, EXTRA_RX, foreignHit, labelHits, labelsOf, labelWindows, scan } from './labels.js';

const SP = '[ \\t\\u00a0]';
/** Между серией и номером: «№», «N», «No.» или один пробел. */
const NO = `(?:${SP}*(?:№|N|No\\.?|номер)${SP}*|${SP}?)`;
const CYR = 'А-ЯЁ';
const cand = (start, end, confidence, validator) => (validator ? { start, end, confidence, validator } : { start, end, confidence });
const rx = (src, flags = 'gu') => new RegExp(src, flags);

/* ---------- какой документ назван ближе к номеру ---------- */

/** Документы с похожими номерами («серия 77 12 № 345678»): решает ближайшее название документа перед номером. */
const DOC_IDS = [
  'PASSPORT',
  'INTL_PASSPORT',
  'DRIVER_LICENSE',
  'MILITARY_ID',
  'RESIDENCE_PERMIT',
  'MIGRATION_CARD',
  'CIVIL_CERT',
  'OMS',
  'VEHICLE_DOC',
  'POA',
  'ENFORCEMENT',
];
let docRes = null;

/**
 * Ближайший к `start` тип документа личности (последнее название в окне 60 символов строки, иначе в метке ячейки);
 * при равном конце — более длинное название («паспорт транспортного средства», «заграничный паспорт»). null — не назван.
 * @param {string} text
 * @param {number} start
 * @param {any} [ctx]
 */
export function docContext(text, start, ctx) {
  docRes ||= DOC_IDS.map((id) => [id, rx(`(?<![\\p{L}\\p{N}])(?:${id === 'PASSPORT' ? 'паспорт\\p{L}*|passport' : EXTRA_RX[id]})`, 'giu')]);
  for (const w of labelWindows(text, start, ctx, 60)) {
    let best = null;
    let end = -1;
    let len = 0;
    for (const [id, re] of docRes) {
      re.lastIndex = 0;
      for (let m; (m = re.exec(w));) {
        if (!m[0]) re.lastIndex++;
        const e = m.index + m[0].length;
        if (e > end || (e === end && m[0].length > len)) [best, end, len] = [id, e, m[0].length];
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * Число стоит после серии документа личности («разрешение на работу 77 № 1900012345»): это номер документа, а не ИНН,
 * даже если сходится контрольная сумма (детектор ИНН без своей метки такое число не берёт).
 * @param {string} text
 * @param {number} start
 * @param {any} [ctx]
 */
export function docSeriesTail(text, start, ctx) {
  const m = /(?:\d{2}|\d{4}|[\p{Lu}]{2})[ \t\u00a0]*(?:№|N|No\.?|номер)?[ \t\u00a0]*$/u.exec(text.slice(Math.max(0, start - 14), start));
  if (!m || m[0] === '') return false;
  const at = start - m[0].length;
  return !!docContext(text, at, ctx) && [...labelHits(text, at, ctx, 64).keys()].some((k) => DOC_IDS.includes(k));
}

/* ---------- «формат → метка» ---------- */

/**
 * @typedef {object} Fmt
 * @property {RegExp} re           формат значения (флаг g)
 * @property {(v: string, text: string, start: number, ctx: any) => boolean} [bare]  жёсткая структура: берётся без метки (`validated`)
 * @property {(v: string) => boolean} [chk]  обязательная проверка (контрольная сумма)
 * @property {boolean} [doc]       тип документа личности: метка засчитывается, только если ближе всех назван этот документ
 * @property {boolean} [only]      только с меткой (формат, который сам по себе не отличить)
 * @property {boolean} [hard]      формат не спутать ни с чем: чужая метка рядом («серия VII-МЮ») не мешает
 */

/**
 * @param {string} id
 * @param {Fmt[]} fmts
 * @param {string} [v] имя проверки для `validator`
 * @param {Function} [more] дополнительный поиск «метка → значение»
 */
function detector(id, fmts, v, more) {
  const bareFmt = fmts.some((f) => f.bare && !f.only);
  return (text, ctx) => {
    if (ctx?.stream?.attrKind === 'rel-target') return []; // адрес ссылки — целиком URL (FR-13)
    if (!(id === 'NICKNAME' ? /[@/]/ : /\d/).test(text)) return []; // все форматы, кроме ника, — с цифрами
    // только по метке, а меток в потоке нет (и это не ячейка таблицы) — искать нечего
    if (!bareFmt && !more && !ctx?.stream?.rowHeader && !ctx?.stream?.columnHeader && !labelsOf(id, text, ctx).length) return [];
    const out = [];
    const free = (a, b) => !out.some((c) => a < c.end && c.start < b);
    for (const f of fmts) {
      for (const c of scan(text, f.re)) {
        const val = c.text.replace(/[.\s]+$/u, '');
        const end = c.start + val.length;
        if (!free(c.start, end) || (f.chk && !f.chk(val))) continue;
        const hits = labelHits(text, c.start, ctx, f.doc ? 64 : undefined);
        const doc = f.doc ? docContext(text, c.start, ctx) : null;
        const mine = hits.has(id) && (!f.doc || doc === id);
        const bare = !f.only && !!f.bare?.(val, text, c.start, ctx);
        if (mine) out.push(cand(c.start, end, bare ? 'validated' : 'labeled', v));
        else if (bare && (f.hard || !foreignHit(hits, id))) out.push(cand(c.start, end, 'validated', v));
      }
    }
    if (more) for (const c of more(text, ctx)) if (free(c.start, c.end)) out.push(c);
    return out.sort((a, b) => a.start - b.start);
  };
}

/* ---------- «метка → значение» ---------- */

const DATE_SRC = '\\d{1,2}[./]\\d{1,2}[./]\\d{2,4}';
/** «№», «#», «No.», «Nr.» — но не начало слова («none», «Normal»). */
const MARK = '(?:№|#|N[oо]\\.|Nr\\.|N[oо]?(?![\\p{L}]))';
/** До трёх слов между меткой и номером («Счёт на оплату № 245», «доверенность от 01.02.2026 № 15»). */
const FILL = rx(`(?:${SP}+(?:[\\p{L}«»"'().-]+|${DATE_SRC}(?:${SP}?г\\.)?)){0,3}?(?=${SP}*${MARK})`, 'iuy');
const GAP = rx(`${SP}*(?:[:–—-]${SP}*)?(?:${MARK}${SP}*:?${SP}*)?`, 'iuy');
const TOK = rx('[\\p{L}\\p{N}]+(?:[-/._:№][\\p{L}\\p{N}]+)*', 'uy');
/** Слово-номер в самой метке: «номер заказа», «код клиента», «ИКЗ» — знак «№» после неё не обязателен. */
const NUMBERISH = /номер|number|код|\bno\b|\bid\b|икз|кусп|уид|енп|№|#/iu;

/**
 * Начала значений после меток категории: [позиция, метка или null для ячейки таблицы, был ли маркер «№/:/#», начало метки].
 * @returns {[number, string|null, boolean, number][]}
 */
function valueStarts(id, text, ctx) {
  const out = [];
  for (const [at, end] of labelsOf(id, text, ctx)) {
    let p = end;
    FILL.lastIndex = p;
    const f = FILL.exec(text);
    if (f) p += f[0].length;
    GAP.lastIndex = p;
    const g = GAP.exec(text)[0];
    out.push([p + g.length, text.slice(at, end), /[№#:]|N[oо]|Nr/iu.test(g), at]);
  }
  // ячейка таблицы под меткой строки или столбца («Диагноз | J45.0 …», «Номер клиента | 100234»)
  const s0 = text.search(/\S/u);
  // (ячейка, которая сама начинается с метки, — заголовок: «Диагноз | Код МКБ-10»)
  if (s0 >= 0 && !out.some((x) => x[3] === s0) && (ctx?.stream?.rowHeader || ctx?.stream?.columnHeader) && labelHits(text, s0, ctx).has(id))
    out.push([s0, null, true, s0]);
  return out;
}

/**
 * Код после метки: один токен с цифрой (или формат `fmt` с пробелами внутри), не дата.
 * @param {string} id
 * @param {{fmt?: RegExp, ok?: (v: string) => boolean}} [o] fmt — особый формат значения (флаг y), ok — дополнительный фильтр
 */
const tokens =
  (id, o = {}) =>
  (text, ctx) => {
    const out = [];
    for (const [p, lab, marked] of valueStarts(id, text, ctx)) {
      let v = null;
      if (o.fmt) {
        o.fmt.lastIndex = p;
        v = o.fmt.exec(text)?.[0] || null;
      }
      if (!v) {
        if (!marked && lab !== null && !NUMBERISH.test(lab)) continue;
        TOK.lastIndex = p;
        v = TOK.exec(text)?.[0];
        if (!v || !/\d/.test(v) || v.length > 40 || rx(`^${DATE_SRC}$`, 'u').test(v)) continue;
        v = v.replace(/[.:]+$/u, '');
      }
      if (o.ok && !o.ok(v)) continue;
      if (!out.some((c) => c.start === p)) out.push(cand(p, p + v.length, 'labeled'));
    }
    return out;
  };

const ICD = `[A-Z${CYR}]\\d{2}(?:\\.\\d{1,2})?`;
const TXT_STOP = /\n|;|[.!?](?=[ \t\u00a0]+[\p{Lu}«"])|[.!?]$/u;

/**
 * Текст после метки до конца фразы, строки или следующей такой же метки («Национальность: …, вероисповедание: …»):
 * HEALTH и SPECIAL. Нужен разделитель «:», «—» или табуляция (или ячейка под меткой); диагноз — ещё и сразу код МКБ-10.
 */
const freeText = (id) => (text, ctx) => {
  const next = [...labelsOf('HEALTH', text, ctx), ...labelsOf('SPECIAL', text, ctx)].map(([at]) => at);
  const out = [];
  for (const [p0, lab, , at] of valueStarts(id, text, ctx)) {
    let p = p0;
    if (lab !== null) {
      // особые категории — только метка поля (начало строки, после «,», «;», «:»): не «национальность и вероисповедание — …»
      if (id === 'SPECIAL' && !/(?:^|[\n,;.(:\t•·—–-])[ \t\u00a0]*$/u.test(text.slice(0, at))) continue;
      const sep = text.slice(0, p).match(/[ \t\u00a0:–—-]*$/u)[0];
      if (!/[:–—\t-]/u.test(sep) && !(id === 'HEALTH' && rx(`^${ICD}(?![\\p{L}\\p{N}])`, 'u').test(text.slice(p)))) continue;
    }
    while (/[ \t\u00a0]/u.test(text[p] || '')) p++;
    let end = Math.min(text.length, p + 300);
    const stop = TXT_STOP.exec(text.slice(p, end));
    if (stop) end = p + stop.index;
    const nl = next.find((x) => x > p && x < end);
    if (nl !== undefined) end = nl;
    while (end > p && /[\s,.;:–—-]/u.test(text[end - 1])) end--;
    if (end - p >= 2 && /[\p{L}\p{N}]/u.test(text.slice(p, end))) out.push(cand(p, end, 'labeled'));
  }
  return out;
};

/* ---------- форматы ---------- */

const f = (src, o = {}) => ({ re: rx(`${NB}(?:${src})${NA}`), ...o });
const PL = '[АВЕКМНОРСТУХABEKMHOPCTYX]';
/** Номер версии, пункта, раздела или кода перед «IP»: «версия 1.2.10.4», «п. 4.1.2.3», «ОКПД2 62.01.11.000». */
const NOT_IP_CTX =
  /(?:верси\p{L}*|ver\.?|v|п\.|пункт\p{L}*|раздел\p{L}*|разд\.|глав\p{L}*|ст\.|стать\p{L}*|гост|оквэд|окпд\d?|кбк|oid|version|release|build)[ \t\u00a0]*$/iu;
const NICK_CTX = /telegram|телеграм|(?<![\p{L}])(?:тг|tg|вк|vk|инст|ник)(?![\p{L}])|instagram|инстаграм|вконтакте|twitter|tiktok|тикток|discord|t\.me/iu;

const plateBare = (v) => {
  const s = v.replace(/[\s\u00a0]*RUS$/u, '');
  return !/[A-Z]/.test(s) && !/(?<!\d)000(?!\d)/.test(s) && !/\D00$/.test(s);
};
const vinBare = (v) =>
  /\d/.test(v) && /[A-Z]/.test(v) && (vin(v) || (/[A-Z]/.test(v.slice(0, 3)) && /^\d{4}$/.test(v.slice(-4)) && v.replace(/\D/g, '').length >= 6));
const ipBare = (v, text, start) =>
  !NOT_IP_CTX.test(text.slice(Math.max(0, start - 20), start)) && (v.includes(':') || v.split(/[./]/).some((x) => x.length > 1));
const handleCtx = (v, text, start) => {
  const ls = text.lastIndexOf('\n', start - 1) + 1;
  const le = text.indexOf('\n', start);
  return NICK_CTX.test(text.slice(Math.max(ls, start - 60), Math.min(le < 0 ? text.length : le, start + v.length + 40)));
};

/** Потоковые детекторы категорий 0.5 (кроме частей паспорта — `docs.js`). */
export const PAPER_DETECTORS = {
  INTL_PASSPORT: detector('INTL_PASSPORT', [f(`\\d{2}${NO}\\d{7}`, { doc: true, chk: (v) => passport(v.replace(/\D/g, '')) })], 'passport'),
  DRIVER_LICENSE: detector('DRIVER_LICENSE', [f(`\\d{2}${SP}?(?:\\d{2}|[${CYR}]{2})${NO}\\d{6}`, { doc: true })]),
  MILITARY_ID: detector('MILITARY_ID', [f(`[${CYR}]{2}${NO}\\d{7}`, { doc: true })]),
  RESIDENCE_PERMIT: detector('RESIDENCE_PERMIT', [f(`(?:\\d{2}|[${CYR}A-Z]{2})${NO}\\d{6,10}`, { doc: true })]),
  MIGRATION_CARD: detector('MIGRATION_CARD', [f(`\\d{2}${SP}?\\d{2}${NO}\\d{7}`, { doc: true })]),
  // «I-МЮ № 123456»: римская серия, дефис, две буквы, номер — жёсткая структура (и паспорт СССР); запись акта — по метке
  CIVIL_CERT: detector(
    'CIVIL_CERT',
    [
      {
        re: rx(`(?<![\\p{L}\\p{N}])([IVXІХ]{1,6})${SP}?[-–]${SP}?[${CYR}]{2}${NO}\\d{6}${NA}`),
        doc: true,
        hard: true,
        bare: (v) => roman(v.split(/[\s\u00a0]*[-–]/u)[0]),
      },
    ],
    'roman',
    tokens('CIVIL_CERT', { ok: (v) => /^\d{3,22}$/.test(v) }),
  ),
  OMS: detector('OMS', [f(`\\d{4}(?:${SP}?\\d{4}){3}`, { doc: true, chk: oms })], 'oms'),
  VEHICLE_DOC: detector('VEHICLE_DOC', [f(`\\d{2}${SP}?(?:\\d{2}|[${CYR}A-Z]{2})${NO}\\d{6}`, { doc: true }), f('\\d{15}', { doc: true })]),
  VIN: detector('VIN', [{ re: rx('(?<![\\p{L}\\p{N}])[A-HJ-NPR-Z0-9]{17}(?![\\p{L}\\p{N}])'), bare: vinBare }], 'vin'),
  // госномер: «А123ВС77», «А 123 ВС 777 RUS»; без метки — только кириллицей; прицеп, мотоцикл, такси — по метке
  PLATE: detector(
    'PLATE',
    [
      f(`${PL}${SP}?\\d{3}${SP}?${PL}{2}${SP}?\\d{2,3}(?:${SP}?RUS)?(?![-/])`, { bare: plateBare }),
      f(`${PL}{2}${SP}?\\d{3,4}${SP}?\\d{2,3}|\\d{4}${SP}?${PL}{2}${SP}?\\d{2,3}`, { only: true }),
    ],
    'plate',
  ),
  IP: detector(
    'IP',
    [
      { re: rx('(?<![\\p{L}\\p{N}.:])\\d{1,3}(?:\\.\\d{1,3}){3}(?:\\/\\d{1,2})?(?![\\p{L}\\p{N}]|\\.\\d)'), chk: (v) => ipv4(v.split('/')[0]), bare: ipBare },
      { re: rx('(?<![\\p{L}\\p{N}:])[0-9A-Fa-f]{0,4}(?::[0-9A-Fa-f]{0,4}){2,7}(?![\\p{L}\\p{N}:])'), chk: ipv6, bare: ipBare },
    ],
    'ip',
  ),
  MAC: detector(
    'MAC',
    [
      {
        re: rx('(?<![\\p{L}\\p{N}:-])[0-9A-Fa-f]{2}([:-])[0-9A-Fa-f]{2}(?:\\1[0-9A-Fa-f]{2}){4}(?![\\p{L}\\p{N}]|[:-][0-9A-Fa-f])'),
        bare: (v) => v[2] === ':' || /[A-F]/i.test(v),
      },
      { re: rx('(?<![\\p{L}\\p{N}.])[0-9A-Fa-f]{4}\\.[0-9A-Fa-f]{4}\\.[0-9A-Fa-f]{4}(?![\\p{L}\\p{N}]|\\.[0-9A-Fa-f])'), bare: (v) => /[A-F]/i.test(v) },
    ],
    'mac',
  ),
  // ник: ссылка на профиль — всегда; «@ник» — по метке или рядом с названием мессенджера (не e-mail: перед «@» нет имени)
  NICKNAME: detector(
    'NICKNAME',
    [
      {
        re: rx(
          '(?<![\\p{L}\\p{N}@./-])(?:https?:\\/\\/)?(?:www\\.)?(?:t\\.me|telegram\\.me|vk\\.(?:com|ru)|instagram\\.com|ok\\.ru|facebook\\.com|fb\\.com|twitter\\.com|x\\.com|tiktok\\.com|youtube\\.com)\\/@?[A-Za-z0-9_][A-Za-z0-9_.]{1,63}',
        ),
        hard: true,
        bare: () => true,
      },
      {
        re: rx("(?<![\\p{L}\\p{N}._%+'@-])@[A-Za-z][A-Za-z0-9_.]{2,31}(?![\\p{L}\\p{N}@])(?!\\.[a-z]{2,4}\\b)"),
        chk: (v) => !/\.[a-z]{2,4}$/i.test(v),
        bare: handleCtx,
      },
    ],
    'handle',
  ),
  CADASTRAL: detector(
    'CADASTRAL',
    [f('\\d{2}:\\d{2}:\\d{6,7}:\\d{1,6}', { hard: true, bare: () => true }), f('\\d{2}:\\d{2}:\\d{6,7}(?!:\\d)', { only: true })],
    'cadastral',
  ),
  EGRN_RECORD: detector(
    'EGRN_RECORD',
    [f('\\d{2}:\\d{2}:\\d{6,7}:\\d{1,6}-\\d{2}\\/\\d{3}\\/\\d{4}-\\d{1,6}', { hard: true, bare: () => true })],
    'cadastral',
    tokens('EGRN_RECORD', { ok: (v) => (v.match(/[/:]/g) || []).length >= 2 && v.replace(/\D/g, '').length >= 8 }),
  ),
  ENFORCEMENT: detector(
    'ENFORCEMENT',
    [f('\\d{1,7}\\/\\d{2}\\/\\d{5}-(?:ИП|СД)', { hard: true, bare: () => true })],
    'enforcement',
    tokens('ENFORCEMENT', { ok: (v) => v.replace(/\D/g, '').length >= 6 }),
  ),
  // дело: арбитраж «А40-12345/2026» и УИД «77RS0001-02-2026-001234-56» — без метки; «2-1545/2026», КУСП, уголовное — по метке
  COURT_CASE: detector(
    'COURT_CASE',
    [
      f('[АA]\\d{2}-\\d{1,7}\\/(?:\\d{4}|\\d{2})', { hard: true, bare: () => true }),
      f('\\d{2}[A-Z]{2}\\d{4}-\\d{2}-\\d{4}-\\d{6}-\\d{2}', { hard: true, bare: () => true }),
    ],
    'courtCase',
    tokens('COURT_CASE', { fmt: rx(`(?:\\d{1,2}[а-яa-z]?|[${CYR}A-Z])-\\d{1,7}\\/\\d{2,4}(?:\\/\\d{1,4})?(?![\\p{L}\\p{N}])`, 'uy') }),
  ),
  POA: tokens('POA', { fmt: rx(`\\d{2}${SP}?[${CYR}]{2}${SP}?\\d{7}(?!\\d)`, 'uy') }),
  NOTARY_REG: tokens('NOTARY_REG'),
  TENDER: tokens('TENDER', { ok: (v) => v.replace(/\D/g, '').length >= 6 }),
  ORDER_NO: tokens('ORDER_NO'),
  INVOICE_NO: tokens('INVOICE_NO', { ok: (v) => !/^\d{20}$/.test(v) }),
  CLIENT_NO: tokens('CLIENT_NO'),
  IP_REG: tokens('IP_REG', { fmt: rx(`(?:RU|US|EP|WO)${SP}?\\d{6,10}(?:${SP}?[A-Z${CYR}]\\d)?(?![\\p{L}\\p{N}])`, 'uy') }),
  HEALTH: freeText('HEALTH'),
  SPECIAL: freeText('SPECIAL'),
};

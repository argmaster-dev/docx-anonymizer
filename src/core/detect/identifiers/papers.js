// Категории версии 0.5 (WP12-C, `docs/concept-0.5.md` п. 5, Ц3, К5; `docs/contracts.md` §8.7): документы личности и ЗАГС,
// полис ОМС, транспорт (СТС/ПТС, VIN, госномер), IP/MAC, ники; кадастр и ЕГРН, суды и исполнительные производства,
// доверенности и реестр нотариуса; коммерческие номера по метке; сведения о здоровье и особые категории ПДн — только по метке.
// Два способа поиска (FR-18):
//   - «формат → метка»: регулярка значения, затем метка перед ним (`labelHits`) и тип документа рядом (`docContext`);
//     без метки — только форматы с жёсткой структурой (уровень `validated`): VIN, госномер кириллицей, IP, MAC, кадастр,
//     запись ЕГРН, арбитражное дело, УИД, исполнительное производство, серия свидетельства ЗАГС;
//   - «метка → значение»: метка в тексте (или метка строки/заголовок столбца таблицы), за ней код с цифрой (`labeled`)
//     или, для HEALTH и SPECIAL, текст до конца фразы, следующей метки или поля после «:».
// Чистые функции; значения документа никуда не пишутся (NFR-14).
import { ipv4, ipv6, oms, passport, roman, vin } from '../../validators.js';
import { isCategoryEnabled } from '../../categories.js';
import { getDetectors } from '../../contracts/detector.js';
import { NB, NA, EXTRA_RX, foreignHit, intervals, labelHits, labelStarts, labelsOf, labelWindows, lowerBound, scan } from './labels.js';
import { trimUrl } from './contact.js';

const SP = '[ \\t\\u00a0]';
/** Дефис в номере: обычный, неразрывный (`w:noBreakHyphen` → U+2011), «‐», «‒», короткое тире и мягкий перенос. */
const DASH = '[-\\u2010-\\u2013\\u00ad]';
/** Между серией и номером: «№», «N», «No.», «номер» или один пробел. */
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
 * @property {(v: string) => string} [trim]  обрезка хвоста значения (ссылка — как `detectUrl`)
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
    const taken = intervals();
    const push = (c) => {
      taken.add(c.start, c.end);
      out.push(c);
    };
    for (const f of fmts) {
      for (const c of scan(text, f.re)) {
        const val = f.trim ? f.trim(c.text) : c.text.replace(/[.\s]+$/u, '');
        const end = c.start + val.length;
        if (!taken.free(c.start, end) || (f.chk && !f.chk(val))) continue;
        const hits = labelHits(text, c.start, ctx, f.doc ? 64 : undefined);
        const doc = f.doc ? docContext(text, c.start, ctx) : null;
        const mine = hits.has(id) && (!f.doc || doc === id);
        const bare = !f.only && !!f.bare?.(val, text, c.start, ctx);
        if (mine) push(cand(c.start, end, bare ? 'validated' : 'labeled', v));
        else if (bare && (f.hard || !foreignHit(hits, id))) push(cand(c.start, end, 'validated', v));
      }
    }
    if (more) for (const c of more(text, ctx)) if (taken.free(c.start, c.end)) push(c);
    return out.sort((a, b) => a.start - b.start);
  };
}

/* ---------- «метка → значение» ---------- */

const DATE_SRC = '\\d{1,2}[./]\\d{1,2}[./]\\d{2,4}';
/** «№», «#», «No.», «Nr.» — но не начало слова («none», «Normal»). */
const MARK = '(?:№|#|N[oо]\\.|Nr\\.|N[oо]?(?![\\p{L}]))';
/** До трёх слов между меткой и номером («Счёт на оплату № 245», «доверенность от 01.02.2026 № 15»). */
const FILL = rx(`(?:${SP}+(?:[\\p{L}«»"'().-]+|${DATE_SRC}(?:${SP}?г\\.)?)){0,3}?(?=${SP}*${MARK})`, 'iuy');
// после метки — пояснение в скобках («Вероисповедание (при желании): …»), затем «:» / тире и «№»
const GAP = rx(`${SP}*(?:\\([^()\\n]{1,30}\\)${SP}*)?(?:[:–—-]${SP}*)?(?:${MARK}${SP}*:?${SP}*)?`, 'iuy');
const TOK = rx('[\\p{L}\\p{N}]+(?:[-/._:№\\u2010-\\u2013\\u00ad][\\p{L}\\p{N}]+)*', 'uy');
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
  // ячейка таблицы под меткой строки или столбца («Диагноз | J45.0 …», «Номер клиента | 100234»); ячейка, которая сама
  // начинается с метки, — заголовок («Диагноз | Код МКБ-10», «Диагноз | Госномер»)
  const s0 = text.search(/\S/u);
  if (s0 >= 0 && labelStarts(text, ctx)[0] !== s0 && (ctx?.stream?.rowHeader || ctx?.stream?.columnHeader) && labelHits(text, s0, ctx).has(id))
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
      if (!out.length || out[out.length - 1].start !== p) out.push(cand(p, p + v.length, 'labeled'));
    }
    return out;
  };

const ICD = `[A-Z${CYR}]\\d{2}(?:\\.\\d{1,2})?`;
const ICD_START = rx(`^${ICD}(?![\\p{L}\\p{N}])`, 'u');
/**
 * Конец значения HEALTH/SPECIAL: строка, табуляция, черта бланка («Подпись ______»), поле бланка не о здоровье («Врач:», «Дата:»,
 * «Подпись:», «Пациент:»…). Медицинские подполя («основное заболевание:», «Стадия:», «сопутствующий:»), «;» и точки после
 * сокращений («II ст. Риск 4. ХСН IIА») значение продолжают; дальше режут метки других категорий и вложенные находки.
 */
const TXT_STOP =
  /\n|\t|(?:[ \u00a0]+\p{Lu}\p{Ll}+)?[ \u00a0]*_{2,}|(?<![\p{L}])(?:Лечащий врач|Врач|Подпись|Дата|ФИО|Ф\.[ \u00a0]?И\.[ \u00a0]?О\.|Фамилия|Пациент|Место рождения|Гражданство|Образование|Пол)[ \u00a0]*:/u;
/** Метка в начале обычной фразы («Инвалидность — это не приговор», «Национальности: все равны…») — не поле. */
const NOT_VALUE = /^(?:это|все|всё|каждый|каждая|любой|любая|никто|ничто|не[ \u00a0]+является)(?![\p{L}])/iu;
/** Метка поля: перед ней начало строки или «, ; . ( : •» и тире (без поиска по всему потоку — окно 40 символов). */
const fieldStart = (text, at) => {
  let i = at - 1;
  while (i >= 0 && at - i <= 40 && /[ \t\u00a0]/u.test(text[i])) i--;
  return i < 0 || /[\n,;.(:\t•·—–-]/u.test(text[i]);
};
let inner = { text: null, stream: null, list: [] };

/**
 * Находки других категорий (правила идентификаторов и адреса) в потоке: значение HEALTH/SPECIAL обрезается до первой
 * из них, иначе длинный `labeled`-кандидат целиком проиграл бы ИНН или телефону внутри и ушёл открытым (FR-20). Считается
 * только для потоков, где нашлась метка здоровья или особой категории (кэш на поток).
 */
function innerStarts(text, ctx) {
  if (inner.text === text && inner.stream === ctx?.stream) return inner.list;
  const list = [];
  for (const [cat, ds] of getDetectors()) {
    if (cat === 'HEALTH' || cat === 'SPECIAL') continue;
    const c = ctx?.catalog?.byId.get(cat);
    if (!c || !isCategoryEnabled(c, ctx.settings || {})) continue;
    for (const d of ds) {
      try {
        for (const x of d.fn(text, { ...ctx, category: c }) || [])
          if ((x.confidence === 'validated' || x.confidence === 'labeled') && c.allowedLevels.includes(x.confidence)) list.push(x.start);
      } catch {
        /* сбой чужого детектора здесь не важен: его покажет сам анализ (DETECTOR_FAILED) */
      }
    }
  }
  inner = { text, stream: ctx?.stream, list: list.sort((a, b) => a - b) };
  return inner.list;
}

/**
 * Текст после метки до конца фразы, строки, следующей метки любой категории или первой вложенной находки:
 * HEALTH и SPECIAL. Нужен разделитель «:», «—» или табуляция (или ячейка под меткой); код МКБ («МКБ-10», «Код МКБ») —
 * только сам код в начале значения; диагноз без разделителя — если сразу код МКБ-10.
 */
const freeText = (id) => (text, ctx) => {
  const starts = valueStarts(id, text, ctx);
  if (!starts.length) return [];
  const labels = labelStarts(text, ctx);
  const nested = innerStarts(text, ctx);
  const out = [];
  for (const [p0, lab, , at] of starts) {
    let p = p0;
    if (lab !== null) {
      // особые категории — только метка поля (с заглавной или после «, ; : …»): не «национальность и вероисповедание — …»
      if (id === 'SPECIAL' && !/^\p{Lu}/u.test(lab) && !fieldStart(text, at)) continue;
      const sep = text.slice(Math.max(at, p - 40), p).match(/[ \t\u00a0:–—-]*$/u)[0];
      const icd = ICD_START.test(text.slice(p, p + 8));
      if (/мкб|icd/iu.test(lab) && !icd) continue; // «МКБ-10 — международная классификация»
      // метка в кавычках — название графы, а не поле: «В графе «Национальность:» ничего не пишем»
      if (/[«"“„]/u.test(text[at - 1] || '') || /^[ \t\u00a0]*[»"”]/u.test(text.slice(p, p + 4))) continue;
      if (NOT_VALUE.test(text.slice(p, p + 20).trimStart())) continue;
      if (!/[:–—\t-]/u.test(sep) && !(id === 'HEALTH' && icd)) continue;
    }
    while (/[ \t\u00a0]/u.test(text[p] || '')) p++;
    let end = Math.min(text.length, p + 300);
    const stop = TXT_STOP.exec(text.slice(p, end));
    if (stop) end = p + stop.index;
    const k = lowerBound(labels, p + 1);
    if (k < labels.length && labels[k] < end) end = labels[k];
    const n = lowerBound(nested, p + 1);
    if (n < nested.length && nested[n] < end) end = nested[n];
    while (end > p && /[\s,.;:–—-]/u.test(text[end - 1])) end--;
    if (end - p < 2 || !/[\p{L}\p{N}]/u.test(text.slice(p, end))) continue;
    out.push(cand(p, end, 'labeled'));
    // запасные части — части через запятую и слова: если значение целиком проиграет находке документного детектора
    // (ФИО правил уровня validated), останутся закрытыми остальные части, а не всё значение (FR-20 выбрасывает проигравшего
    // целиком); без конфликта целое сильнее частей (раньше начинается или длиннее) и они отпадают
    const value = text.slice(p, end);
    if (!/[\s,]/u.test(value)) continue;
    for (const re of [/[^,;]+/gu, /[\p{L}\p{N}][\p{L}\p{N}.-]*/gu])
      for (const m of value.matchAll(re)) {
        const lead = m[0].length - m[0].trimStart().length;
        const t = m[0].trim();
        if (t && t.length < value.length) out.push(cand(p + m.index + lead, p + m.index + lead + t.length, 'labeled'));
      }
  }
  return out;
};

/* ---------- форматы ---------- */

const f = (src, o = {}) => ({ re: rx(`${NB}(?:${src})${NA}`), ...o });
/** Номер дела по метке: «2-1545/2026», «02-1545/2026», «2а-123/2026», «М-123/2026», «33-4567/26»; номер после дефиса — от двух цифр. */
const COURT_NO = `(?:\\d{1,2}[а-яa-z]?${DASH}\\d{2,7}|[${CYR}A-Z]\\d{0,2}${DASH}\\d{1,7})\\/\\d{2,4}(?:\\/\\d{1,4})?`;
const PL = '[АВЕКМНОРСТУХABEKMHOPCTYX]';
/**
 * IP без метки не берётся, только если НЕПОСРЕДСТВЕННО перед числом (без промежуточных слов, допустимы «:», «№», тире) стоит
 * слово номера версии, пункта, раздела, таблицы, рисунка, приложения, кода (ОКПД2, ГОСТ), браузера или маски подсети:
 * «версия 1.2.10.4», «п. 4.1.2.3», «Таблица 3.12.4.1», «Firefox 115.0.2.1», «ОКПД2 — 26.20.11.110», «Маска подсети 255.255.255.0».
 * «Сервер доступен по адресу 192.168.10.25», «Табл. доступа: 95.31.18.119» — IP (лишнее маскирование дешевле утечки).
 */
const NOT_IP_CTX =
  /(?<![\p{L}])(?:верси\p{L}*|ver|version|release|build|сборк\p{L}*|п\.|пп\.|пункт\p{L}*|подпункт\p{L}*|раздел\p{L}*|разд\.|глав\p{L}*|гл\.|ст\.|стать\p{L}*|табл\.|таблиц\p{L}*|рис\.|рисун\p{L}*|прил\.|приложени\p{L}*|гост(?:[ \t\u00a0]?р)?|оквэд\d*|окпд\d*|кбк|oid|firefox|chrome|chromium|safari|opera|маск\p{L}*(?:[ \t\u00a0]+подсети)?|netmask|subnet[ \t\u00a0]+mask)[ \t\u00a0]*[:№–—-]?[ \t\u00a0]*$/iu;
/** Заголовок столбца с кодами и версиями: «Код ОКПД2», «Версия», «№ п/п». */
const NOT_IP_COL = /окпд|оквэд|вэд|верси|version|артикул|пункт|раздел/iu;
const NICK_CTX = /telegram|телеграм|(?<![\p{L}])(?:тг|tg|вк|vk|инст|ник)(?![\p{L}])|instagram|инстаграм|вконтакте|twitter|tiktok|тикток|discord|t\.me/iu;
/** Непосредственно перед VIN без метки — артикул, серийный номер, партия: это не VIN («партия автомобилей: XTA…» — VIN). */
const NOT_VIN_CTX =
  /(?<![\p{L}])(?:арт\.|артикул\p{L}*|s\/n|sn|серийн\p{L}*(?:[ \t\u00a0]+номер\p{L}*)?|зав\.|заводск\p{L}*[ \t\u00a0]+номер\p{L}*|партия|lot|sku)[ \t\u00a0]*[:№#–—-]?[ \t\u00a0]*$/iu;
/** WMI заводов, чьи VIN часто без проверочной цифры (Россия, Европа, Азия): без метки — ещё и по ним. */
const WMI =
  /^(?:XTA|XTT|XTH|X96|X7L|X9F|XW8|XWE|XUF|X4X|Z94|Z8T|Z8N|ZFA|ZAR|WVW|WV1|WV2|WBA|WBS|WDB|WDD|WAU|WF0|WP0|VF1|VF3|VF7|VSS|TMB|YV1|SAL|SJN|JTD|JTM|JMB|JN1|KMH|KNA|LVS|LGX)/;
const VIN_MAP = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X', О: 'O' };
/** VIN по метке: кириллические двойники латиницы, строчные, пробелы между группами → 17 знаков без I/O/Q. */
const vinNorm = (v) =>
  v
    .toUpperCase()
    .replace(/[АВЕКМНРСТУХО]/gu, (ch) => VIN_MAP[ch])
    .replace(/[\s\u00a0\-\u2010-\u2013\u00ad]/gu, '');
const vinOk = (v) => {
  const s = vinNorm(v);
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(s) && /\d/.test(s) && /[A-Z]/.test(s);
};

const plateBare = (v) => {
  const s = v.replace(/[\s\u00a0]*RUS$/u, '');
  return !/[A-Z]/.test(s) && !/(?<!\d)000(?!\d)/.test(s) && !/\D00$/.test(s);
};
const vinBare = (v, text, start) => /\d/.test(v) && /[A-Z]/.test(v) && (vin(v) || WMI.test(v)) && !NOT_VIN_CTX.test(text.slice(Math.max(0, start - 40), start));
const ipBare = (v, text, start, ctx) =>
  !NOT_IP_CTX.test(text.slice(Math.max(0, start - 40), start)) &&
  !NOT_IP_COL.test(ctx?.stream?.columnHeader || '') &&
  (v.includes(':') || (ipv4(v.split('/')[0]) && v.split(/[./]/).some((x) => x.length > 1)));
const handleCtx = (v, text, start) => {
  const w = text.slice(Math.max(0, start - 60), Math.min(text.length, start + v.length + 40));
  const at = start - Math.max(0, start - 60);
  const ls = w.lastIndexOf('\n', at - 1) + 1;
  const le = w.indexOf('\n', at);
  return NICK_CTX.test(w.slice(ls, le < 0 ? w.length : le));
};
/** Пути площадок, которые не профиль: публикации, видео, поиск («youtube.com/watch», «vk.com/wall-…»); YouTube — только «@ник». */
const NOT_PROFILE =
  /^(?:watch|wall|video|photo|album|audio|feed|share|search|explore|reels?|p|s|joinchat|hashtag|groups|events|pages|login|signup|help|about|settings|music|clips?|stories|shorts|playlist|results|channel|c|user|tv|group|home|i|explore|messages|im|feed)$/i;
const nickLink = (v) => {
  const m = /^(?:https?:\/\/)?(?:www\.|m\.)?([^/]+)\/(@?[\w.]+)/i.exec(v);
  if (!m) return false;
  if (/youtube/i.test(m[1]) && !m[2].startsWith('@')) return false;
  return !NOT_PROFILE.test(m[2]) && !/^(?:doc|wall|video|photo|album|audio|topic|market|note|club|public|event)[-\d_]/i.test(m[2]);
};
/** Без ведущих нулей — без метки; по метке («IP 192.168.001.010») октеты с нулями тоже. */
const ipv4Loose = (v) => {
  const p = v.split('/')[0].split('.');
  return p.length === 4 && p.every((x) => /^\d{1,3}$/.test(x) && +x <= 255);
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
        re: rx(`(?<![\\p{L}\\p{N}])([IVXІХ]{1,6})${SP}?${DASH}${SP}?[${CYR}]{2}${NO}\\d{6}${NA}`),
        doc: true,
        hard: true,
        bare: (v) => roman(v.split(/[\s\u00a0]*[-\u2010-\u2013\u00ad]/u)[0]),
      },
    ],
    'roman',
    tokens('CIVIL_CERT', { ok: (v) => /^\d{3,22}$/.test(v) }),
  ),
  OMS: detector('OMS', [f(`\\d{4}(?:${SP}?\\d{4}){3}`, { doc: true, chk: oms })], 'oms'),
  VEHICLE_DOC: detector('VEHICLE_DOC', [f(`\\d{2}${SP}?(?:\\d{2}|[${CYR}A-Z]{2})${NO}\\d{6}`, { doc: true }), f('\\d{15}', { doc: true })]),
  // VIN без метки — верная проверочная цифра или известный WMI; по метке — и кириллица, строчные, пробелы между группами
  VIN: detector(
    'VIN',
    [
      { re: rx('(?<![\\p{L}\\p{N}])[A-HJ-NPR-Z0-9]{17}(?![\\p{L}\\p{N}])'), bare: vinBare },
      {
        re: rx(`(?<![\\p{L}\\p{N}])(?:[A-HJ-NPR-Z0-9АВЕКМНРСТУХ]{2,14}(?:${SP}|${DASH})){0,3}[A-HJ-NPR-Z0-9АВЕКМНРСТУХ]{2,17}(?![\\p{L}\\p{N}])`, 'giu'),
        only: true,
        chk: vinOk,
      },
    ],
    'vin',
  ),
  // госномер: «А123ВС77», «А 123 ВС 777 RUS»; без метки — только кириллицей и прописными; строчные, латинские двойники,
  // прицеп, мотоцикл, такси — по метке
  PLATE: detector(
    'PLATE',
    [
      f(`${PL}${SP}?\\d{3}${SP}?${PL}{2}${SP}?\\d{2,3}(?:${SP}?RUS)?(?![-/])`, { bare: plateBare }),
      { re: rx(`${NB}(?:${PL}${SP}?\\d{3}${SP}?${PL}{2}${SP}?\\d{2,3}(?:${SP}?RUS)?)${NA}(?![-/])`, 'giu'), only: true },
      f(`${PL}{2}${SP}?\\d{3,4}${SP}?\\d{2,3}|\\d{4}${SP}?${PL}{2}${SP}?\\d{2,3}`, { only: true }),
    ],
    'plate',
  ),
  IP: detector(
    'IP',
    [
      { re: rx('(?<![\\p{L}\\p{N}.:])\\d{1,3}(?:\\.\\d{1,3}){3}(?:\\/\\d{1,2})?(?![\\p{L}\\p{N}]|\\.\\d)'), chk: ipv4Loose, bare: ipBare },
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
  // ник: ссылка на профиль целиком с путём и параметрами (как URL) — всегда; публикации, видео и поиск — не ник, это URL;
  // «@ник» — по метке или рядом с названием мессенджера (не e-mail: перед «@» нет имени)
  NICKNAME: detector(
    'NICKNAME',
    [
      {
        re: rx(
          '(?<![\\p{L}\\p{N}@./-])(?:https?:\\/\\/)?(?:www\\.|m\\.)?(?:t\\.me|telegram\\.me|vk\\.(?:com|ru)|instagram\\.com|ok\\.ru|facebook\\.com|fb\\.com|twitter\\.com|x\\.com|tiktok\\.com|youtube\\.com)\\/@?[A-Za-z0-9_][A-Za-z0-9_.]{1,63}(?:[/?#][^\\s<>"«»\\u00a0\\uFFFC]*)?',
        ),
        trim: trimUrl,
        chk: nickLink,
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
    [f(`\\d{2}:\\d{2}:\\d{6,7}:\\d{1,6}${DASH}\\d{2}\\/\\d{3}\\/\\d{4}${DASH}\\d{1,6}`, { hard: true, bare: () => true })],
    'cadastral',
    tokens('EGRN_RECORD', { ok: (v) => (v.match(/[/:]/g) || []).length >= 2 && v.replace(/\D/g, '').length >= 8 }),
  ),
  ENFORCEMENT: detector(
    'ENFORCEMENT',
    [f(`\\d{1,7}\\/\\d{2}\\/\\d{5}${DASH}(?:ИП|СД)`, { hard: true, bare: () => true })],
    'enforcement',
    tokens('ENFORCEMENT', { ok: (v) => v.replace(/\D/g, '').length >= 6 }),
  ),
  // дело: арбитраж «А40-12345/2026» (год из четырёх цифр, без продолжения «-ПД») и УИД — без метки; двузначный год,
  // «2-1545/2026», «02-…», «33-…», КУСП, уголовное — по метке
  COURT_CASE: detector(
    'COURT_CASE',
    [
      f(`[АA]\\d{2}${DASH}\\d{1,7}\\/(?:\\d{4}|\\d{2})(?!${DASH}[\\p{L}\\p{N}])`, { hard: true, bare: (v) => /\/\d{4}$/.test(v) }),
      f(`\\d{2}[A-Z]{2}\\d{4}${DASH}\\d{2}${DASH}\\d{4}${DASH}\\d{6}${DASH}\\d{2}`, { hard: true, bare: () => true }),
    ],
    'courtCase',
    tokens('COURT_CASE', {
      fmt: rx(`${COURT_NO}(?![\\p{L}\\p{N}])`, 'uy'),
      // «дело № 5 в описи», «в деле № 5–7 листов», «5–7/12» — не номер дела: только формат дела или не меньше четырёх цифр
      // (КУСП, уголовное дело)
      ok: (v) => rx(`^${COURT_NO}$`, 'u').test(v) || /^\d{4,22}$/.test(v),
    }),
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

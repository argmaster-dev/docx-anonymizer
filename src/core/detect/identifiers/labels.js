// Общие средства детекторов идентификаторов: лейблы (§4.3) и границы цифровых идентификаторов.
//
// Лейбл — слово/фраза в пределах 40 символов перед кандидатом (в той же строке потока), после которой допускаются
// `:`, `№`, `#`, пробелы, табуляция («strict»). «lenient» — между лейблом и кандидатом допустимы 1–3 слова без цифр
// («ИНН Покупателя 5004001234»). Лейблы берутся из каталога (`category.labels`) плюс локальные дополнения.
import { buildCatalog } from '../../categories.js';

/** Окно просмотра перед кандидатом (символов). */
export const LABEL_WINDOW = 40;

/** Не внутри слова/числа и не продолжение «цифры-разделителя» (12-7736050003, 1.7736050003). */
export const NB = '(?<![\\p{L}\\p{N}])(?<!\\d[-./])';
/** Не продолжается буквой/цифрой и не «цифра-разделитель-цифра» (7736050003-1, 7736050003.5). */
export const NA = '(?![\\p{L}\\p{N}])(?![-.,]\\d)';

/** Дополнительные лейблы (данные каталога менять не нужно). */
const EXTRA_LABELS = {
  INN: {
    ru: ['идентификационный номер налогоплательщика', 'инн/кпп', 'инн / кпп'],
    en: ['inn/kpp', 'tax identification number', 'taxpayer identification number'],
  },
  KPP: { ru: [], en: [] },
  OGRN: { ru: ['огрн/огрнип', 'основной государственный регистрационный номер'], en: ['ogrnip'] },
  ACCOUNT: {
    ru: [
      'р/сч',
      'р/с',
      'расч. счет',
      'расч. счёт',
      'расчётный счёт №',
      'л/с',
      'лицевой счет',
      'лицевой счёт',
      'счет получателя',
      'счёт получателя',
      'номер счета',
      'номер счёта',
      'счёт',
      'счет',
    ],
    en: ['account number', 'account #', 'bank account', 'a/c', 'acct'],
  },
  BIK: { ru: ['бик банка'], en: [] },
  CARD: { ru: ['банковская карта', 'карта №', 'номер банковской карты', 'pan'], en: ['card number', 'credit card', 'debit card', 'pan'] },
  IBAN: { ru: [], en: ['iban no.', 'iban number'] },
  SWIFT: { ru: ['свифт'], en: ['swift/bic', 'bic/swift', 'swift bic'] },
  SNILS: { ru: ['страховое свидетельство', 'снилс №'], en: [] },
  PASSPORT: { ru: ['паспорт №', 'серия и номер', 'серии', 'паспорт гражданина рф', 'паспортные данные'], en: ['passport number', 'passport #'] },
  SSN: { ru: [], en: ['ssn #', 'social security no.'] },
  TAXID: {
    ru: ['vat no.'],
    en: [
      'vat no.',
      'vat number',
      'vat id',
      'vat reg.',
      'vat reg. no.',
      'vat registration number',
      'vat registration no.',
      'tax number',
      'tax identification',
      // европейские метки (WP11-E): Германия, Австрия, Швейцария, Франция, Испания и Португалия, Италия
      'ust-idnr.',
      'ust-id-nr.',
      'ust-id',
      'ust.-idnr.',
      'umsatzsteuer-identifikationsnummer',
      'uid',
      'uid-nr.',
      'steuernummer',
      'steuer-nr.',
      'tva',
      'n° tva',
      'nif',
      'nipc',
      'p.iva',
      'p. iva',
      'partita iva',
    ],
  },
  PHONE: {
    ru: ['тел', 'тел./факс', 'т/ф', 'моб', 'контактный телефон', 'номер телефона', 'whatsapp', 'viber', 'telegram'],
    en: ['telephone', 'cell', 'whatsapp', 'tel.', 'phone no.', 'phone number', 'mob'],
  },
  BIRTHDATE: {
    ru: ['д/р', 'дата рожд.', 'рожд.', 'день рождения'],
    en: ['birth date', 'birthday', 'birth', 'born'],
  },
};

/**
 * Метки категорий 0.5 (WP12-C, §8.7) — регулярными основами, чтобы покрыть падежи («водительского удостоверения»,
 * «миграционной карты»). Основы документов личности — и в `docContext` (papers.js): кто из документов назван ближе к номеру.
 */
const W = '[ \\t\\u00a0]+';
const A = '\\p{L}*';
const S = '[ \\t\\u00a0]*';
/** «…: серия», «…, серия и номер» после названия документа */
const SER = `(?:${S}[:,]?${S}(?:сери[яи](?:${W}и${W}номер)?|номер))?`;
export const EXTRA_RX = {
  PASSPORT_DEPT: `код${W}подр(?:азделени${A}|\\.)?|к\\/п|department${W}code`,
  PASSPORT_ISSUER: `кем${W}выдан${A}|орган${A}(?:,?${W}выдавш${A}(?:${W}документ)?|${W}выдачи)|issued${W}by|issuing${W}authority`,
  PASSPORT_DATE: `дат${A}${W}выдачи(?:${W}паспорта)?|когда${W}выдан|date${W}of${W}issue|issue${W}date`,
  INTL_PASSPORT: `(?:загранпаспорт${A}|загран\\.?${W}паспорт${A}|заграничн${A}${W}паспорт${A}|(?:international|foreign)${W}passport)${SER}`,
  DRIVER_LICENSE: `(?:водительск${A}(?:${W}(?:удостоверени${A}|прав${A}))?|в\\/у|driver'?s?${W}licen[cs]e|driving${W}licen[cs]e)${SER}`,
  MILITARY_ID: `(?:военн${A}${W}билет${A}|military${W}id)${SER}`,
  RESIDENCE_PERMIT: `(?:вид${A}${W}на${W}жительство|внж|рвп|разрешени${A}${W}на${W}(?:работу|временное${W}проживание)|патент${A}${W}на${W}работу|(?:residence|work)${W}permit)${SER}`,
  MIGRATION_CARD: `(?:миграционн${A}${W}карт${A}|migration${W}card)${SER}`,
  CIVIL_CERT: `(?:свидетельств${A}${W}об?${W}(?:рождени|браке|заключени|расторжени|смерти|перемен|установлени)${A}(?:${W}(?:брака|имени|отцовства))?|запис${A}${W}акта|актов${A}${W}запис${A}|(?:birth|marriage|death|divorce)${W}certificate)${SER}`,
  OMS: `(?:(?:полис${A}${W})?обязательн${A}${W}медицинск${A}${W}страховани${A}|полис${A}(?:${W}омс)?|омс|енп|единый${W}номер${W}полиса|(?:health${W}insurance|oms)${W}policy)${SER}`,
  VEHICLE_DOC: `(?:паспорт${A}${W}(?:транспортн${A}${W}средств${A}|тс)|эптс|птс|стс|свидетельств${A}${W}о${W}регистрации${W}(?:тс|транспортн${A}(?:${W}средств${A})?)|vehicle${W}(?:registration|passport))${SER}`,
  VIN: `кузов${A}(?:${S}№)?|номер${W}кузова|шасси(?:${S}\\(рам${A}\\))?(?:${S}№)?|рам${A}${S}№|vin(?:-?код)?|идентификационн${A}${W}номер${W}(?:тс|транспортного${W}средства|\\(vin\\))|vehicle${W}identification${W}number`,
  PLATE: `гос\\.?${S}(?:рег\\.?${S})?(?:номер|знак)${A}|государственн${A}${W}(?:регистрационн${A}${W})?знак${A}|регистрационн${A}${W}знак${A}|номерн${A}${W}знак${A}|грз|г\\/н|(?:license|registration)${W}plate|plate${W}(?:no\\.?|number)`,
  IP: `ip(?:-?${S}адрес${A}|${W}address)?`,
  MAC: `mac(?:-?${S}адрес${A}|${W}address)?`,
  NICKNAME: `telegram|телеграм${A}|тг|tg|instagram|инстаграм${A}|инст|вконтакте|вк|vk|ник(?:нейм)?|twitter|tiktok|тикток|discord|skype|скайп|handle|username`,
  CADASTRAL: `кадастров${A}${W}(?:номер${A}|квартал${A})|cadastral${W}(?:number|no\\.?)`,
  EGRN_RECORD: `номер${W}(?:государственн${A}${W})?регистрации(?:${W}права)?|регистрационн${A}${W}запис${A}|запис${A}${W}(?:о${W}регистрации|в${W}егрн|егрн)|номер${W}записи(?:${W}в${W}егрн)?`,
  ENFORCEMENT: `исполнительн${A}${W}(?:производств${A}|лист${A})`,
  COURT_CASE: `(?:номер${W})?дел(?:ом|о|а|у|е)|кусп|уид|case${W}(?:no\\.?|number)`,
  POA: `доверенност${A}|power${W}of${W}attorney`,
  NOTARY_REG: `(?:зарегистрирован${A}${W})?в${W}реестре(?:${W}за)?|реестров${A}${W}(?:номер${A}(?!${W}закупк)|№)|номер${W}в${W}реестре|notarial${W}register`,
  TENDER: `(?:номер${W}|реестров${A}${W}номер${W})?(?:закупк${A}|извещени${A}|тендер${A}|аукцион${A})|икз|идентификационн${A}${W}код${W}закупки|tender|procurement`,
  ORDER_NO: `(?:номер${W})?заказ(?:ам|ах|ов|ом|а|у|е|ы)?(?:-наряд${A})?|purchase${W}order|order`,
  INVOICE_NO: `(?:номер${W})?сч[её]т${A}(?:-фактур${A}|${W}на${W}оплату)?|упд|invoice`,
  CLIENT_NO: `(?:номер|код)${W}(?:клиента|абонента|покупателя)|клиент${A}|абонент${A}|(?:client|customer|account)${W}(?:id|no\\.?|number|#)`,
  IP_REG: `патент${A}(?:${W}на${W}(?:изобретение|полезную${W}модель|промышленный${W}образец))?|товарн${A}${W}знак${A}|знак${A}${W}обслуживания|программ${A}${W}для${W}эвм|баз${A}${W}данных|trademark|patent`,
  HEALTH: `(?:основн${A}${W}|сопутствующ${A}${W}|клиническ${A}${W}|заключительн${A}${W})?диагноз${A}(?:${W}(?:основн|сопутствующ|клиническ|заключительн|окончательн|направительн)${A}|${W}при${W}поступлении)?|(?:основн|сопутствующ)${A}(?=${S}:)|(?:код${W})?мкб(?:-?10)?|анамнез${A}|аллерги(?:я|и|ю|ей)(?![\\p{L}])|(?:основн|хроническ|сопутствующ)${A}${W}заболевани${A}|групп${A}${W}крови|сведения${W}о${W}здоровье|состояни${A}${W}здоровья|группа${W}инвалидности|инвалидност${A}|diagnosis|icd(?:-?10)?(?:${W}code)?|medical${W}condition`,
  SPECIAL: `вероисповедани${A}|религи${A}|религиозн${A}${W}(?:убеждени${A}|взгляд${A})|национальност${A}|этническ${A}${W}(?:принадлежност${A}|происхождени${A})|политическ${A}${W}(?:взгляд${A}|убеждени${A})|партийност${A}|судимост${A}|сведения${W}о${W}судимости|religion|ethnicity|ethnic${W}origin|political${W}(?:views|opinions)|criminal${W}record|convictions`,
};

/** Категории, чьи лейблы участвуют в разрешении «чей это лейбл» (CONTRACT/AMOUNT — нет). */
const LABEL_CATEGORIES = [
  ...['PASSPORT', 'SNILS', 'INN', 'OGRN', 'ACCOUNT', 'CARD', 'IBAN', 'SWIFT', 'BIK', 'KPP', 'SSN', 'TAXID', 'PHONE', 'BIRTHDATE'],
  ...Object.keys(EXTRA_RX),
];

const GAP = '[ \\t\\u00a0:–—-]*(?:(?:№|#|N[oо]\\.?)[ \\t\\u00a0:]*)?';
const FILLER = '(?:[ \\t\\u00a0]+[\\p{L}.«»"\'()-]+){1,3}';

const labelSrc = (l) =>
  l
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/[её]/gi, '[её]')
    .replace(/\\\./g, '\\.?')
    .replace(/\s+/g, '[ \\t\\u00a0]+');

/** @type {WeakMap<object, {cat: string, strict: RegExp, lenient: RegExp}[]>} */
const cache = new WeakMap();
let memo = { text: null, stream: null, catalog: null, map: new Map(), starts: null };
let defaultCatalog = null;

function compile(catalog) {
  const out = [];
  const alts = [];
  for (const id of LABEL_CATEGORIES) {
    const cat = catalog.byId.get(id);
    if (!cat) continue;
    const alt = labelAlt(id, catalog);
    if (!alt) continue;
    alts.push(alt);
    const head = `(?<![\\p{L}\\p{N}])(?:${alt})`;
    out.push({
      cat: id,
      at: new RegExp(`${head}(?![\\p{L}\\p{N}])`, 'uy'),
      strict: new RegExp(`${head}${GAP}$`, 'iu'),
      lenient: new RegExp(`${head}${FILLER}${GAP}$`, 'iu'),
    });
  }
  // быстрый отказ (0.5, 43 категории с метками): окно без единой метки не проверяется по каждой категории
  const any = `(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{N}])`;
  return Object.assign(out, { any: new RegExp(any, 'iu'), anyG: new RegExp(any, 'gu') });
}

/**
 * Альтернатива меток категории без якорей: литералы каталога и `EXTRA_LABELS` (длинные первыми) и основы `EXTRA_RX`.
 * @param {string} id
 * @param {any} [catalog]
 */
export function labelAlt(id, catalog) {
  const cat = (catalog || (defaultCatalog ||= buildCatalog({}))).byId.get(id);
  const extra = EXTRA_LABELS[id] || { ru: [], en: [] };
  const all = [...new Set([...(cat?.labels?.ru || []), ...(cat?.labels?.en || []), ...extra.ru, ...extra.en])].filter(Boolean);
  all.sort((a, b) => b.length - a.length);
  return [...all.map((l) => labelSrc(l.toLowerCase())), ...(EXTRA_RX[id] ? [EXTRA_RX[id]] : [])].join('|');
}

function compiled(catalog) {
  const c = catalog || (defaultCatalog ||= buildCatalog({}));
  let v = cache.get(c);
  if (!v) cache.set(c, (v = compile(c)));
  return v;
}

/**
 * Окна поиска метки перед позицией `start`: до 40 символов той же строки; значение в начале ячейки таблицы — ещё и ячейка
 * слева в строке («Дата рождения | 17.11.1993») и заголовок столбца («Телефон» над «(999) 004-55-17»), WP11-E.
 * @param {string} text
 * @param {number} start
 * @param {any} [ctx]
 * @param {number} [size]
 */
export function labelWindows(text, start, ctx, size = LABEL_WINDOW) {
  // окно — не дальше `size` символов назад, начало строки ищется только в нём: длинный абзац обрабатывается линейно (0.5)
  const from = Math.max(0, start - size);
  const raw = text.slice(from, start);
  const nl = raw.lastIndexOf('\n');
  const w = nl >= 0 ? raw.slice(nl + 1) : raw;
  const windows = [w];
  if ((nl >= 0 || from === 0) && /^[\s:—–-]*$/u.test(w)) {
    const row = ctx?.stream?.rowHeader;
    const col = ctx?.stream?.columnHeader;
    if (row) windows.push(`${String(row).trim().slice(-size)} ${w}`);
    if (col && String(col).length <= LABEL_WINDOW) windows.push(`${String(col).trim()} ${w}`);
  }
  return windows;
}

/**
 * Какие категории имеют лейбл прямо перед позицией `start` (в пределах 40 символов, в той же строке).
 * @param {string} text
 * @param {number} start
 * @param {{catalog?: any}} [ctx]
 * @returns {Map<string, 'strict'|'lenient'>}
 */
export function labelHits(text, start, ctx = {}, size = LABEL_WINDOW) {
  // детекторы одного потока спрашивают про одни и те же позиции (ИНН, ОГРН, карта, СНИЛС, документы 0.5): кэш на поток
  const m = streamMemo(text, ctx);
  const key = `${start}:${size}`;
  const done = m.map.get(key);
  if (done) return done;
  const hits = new Map();
  m.map.set(key, hits);
  const list = compiled(ctx.catalog);
  const windows = labelWindows(text, start, ctx, size);
  const from = start - windows[0].length;
  for (const [i, x] of windows.entries()) {
    // окно строки — только категории, чья метка начинается в нём (позиции меток потока); окна с меткой ячейки — все,
    // если в окне есть хоть какая-то метка
    let cands = list;
    if (i === 0) {
      const set = new Set();
      const starts = labelStarts(text, ctx);
      for (let k = lowerBound(starts, from); k < starts.length && starts[k] < start; k++) for (const c of catsAt(text, starts[k], ctx)) set.add(c);
      cands = list.filter((c) => set.has(c));
    } else if (!list.any.test(x)) cands = [];
    for (const c of cands) {
      if (c.strict.test(x)) hits.set(c.cat, 'strict');
      else if (c.lenient.test(x) && !hits.has(c.cat)) hits.set(c.cat, 'lenient');
    }
  }
  return hits;
}

/**
 * Текст потока в нижнем регистре (кэш): метки ищутся без флага `i` — с ним объединённая регулярка 43 категорий в 2–3 раза
 * медленнее. Метки пишутся строчными (литералы приводятся, основы `EXTRA_RX` — строчные, тест). Если длина меняется
 * (редкие символы вроде «İ»), позиции не совпали бы — тогда ищем по исходному тексту.
 */
const lower = (m) => {
  if (m.low === undefined) {
    const low = m.text.toLowerCase();
    m.low = low.length === m.text.length ? low : m.text;
  }
  return m.low;
};

/** Кэш на поток: ответы `labelHits` и позиции меток. */
function streamMemo(text, ctx) {
  const stream = ctx?.stream || null;
  if (memo.text !== text || memo.stream !== stream || memo.catalog !== ctx?.catalog)
    memo = { text, stream, catalog: ctx?.catalog, map: new Map(), starts: null };
  return memo;
}

/**
 * Позиции, с которых в тексте начинается метка хоть какой-то категории (один проход объединённой регулярки на поток, с
 * перекрытием): окно без них не проверяется по каждой из 43 категорий, детекторы «метка → значение» без них не ищут метку.
 * @param {string} text
 * @param {any} [ctx]
 * @returns {number[]}
 */
export function labelStarts(text, ctx) {
  const m = streamMemo(text, ctx);
  if (!m.starts) {
    const re = compiled(ctx?.catalog).anyG;
    m.starts = [];
    re.lastIndex = 0;
    const low = lower(m);
    for (let x; (x = re.exec(low)); re.lastIndex = x.index + 1) m.starts.push(x.index);
  }
  return m.starts;
}

/** Первый индекс отсортированного массива со значением ≥ x (двоичный поиск). */
export function lowerBound(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Набор непересекающихся отрезков [a, b) с проверкой «свободно ли» за O(log n): у отсортированных по началу
 * непересекающихся отрезков концы тоже отсортированы, поэтому пересечь [a, b) может только последний, начавшийся до b.
 */
export function intervals() {
  const starts = [];
  const ends = [];
  return {
    free(a, b) {
      const i = lowerBound(starts, b);
      return i === 0 || ends[i - 1] <= a;
    },
    add(a, b) {
      const i = lowerBound(starts, a);
      starts.splice(i, 0, a);
      ends.splice(i, 0, b);
    },
  };
}

/** Категории, чья метка начинается в позиции `p` потока (кэш на поток). */
function catsAt(text, p, ctx) {
  const m = streamMemo(text, ctx);
  let v = (m.at ||= new Map()).get(p);
  if (!v) {
    v = compiled(ctx?.catalog).filter((c) => {
      c.at.lastIndex = p;
      return c.at.test(lower(m));
    });
    m.at.set(p, v);
  }
  return v;
}

/**
 * Метки категории `id` в тексте потока: [начало, конец] (по позициям `labelStarts`, кэш на поток); метка — целое слово.
 * @param {string} id
 * @param {string} text
 * @param {any} [ctx]
 * @returns {[number, number][]}
 */
export function labelsOf(id, text, ctx) {
  const m = streamMemo(text, ctx);
  // кэш на поток: каждая категория спрашивает о своих метках из нескольких мест (ранний выход детектора, значения после
  // метки, поля здоровья) — без кэша длинный абзац с метками обходился квадратично (третье ревью WP12-C)
  const done = (m.of ||= new Map()).get(id);
  if (done) return done;
  const out = [];
  m.of.set(id, out);
  for (const p of labelStarts(text, ctx))
    for (const c of catsAt(text, p, ctx)) {
      if (c.cat !== id) continue;
      c.at.lastIndex = p;
      const end = p + c.at.exec(lower(m))[0].length;
      if (!/[\p{L}\p{N}]/u.test(text[end] || '')) out.push([p, end]);
    }
  return out;
}

/**
 * Состояние лейблов для кандидата категории `own`: `mine` — свой лейбл есть; `foreign` — прямо перед кандидатом
 * стоит (strict) лейбл ДРУГОЙ категории, а своего нет (кандидат без лейбла в таком случае не берём).
 */
export function labelState(text, start, ctx, own, value) {
  const hits = labelHits(text, start, ctx);
  const mine = hits.get(own) || null;
  return { mine, foreign: !mine && foreignHit(hits, own, value) };
}

/**
 * Метки 0.5, которые не делают число «чужим» для других детекторов: коммерческие номера и текст по метке ищутся от метки
 * сами, а «с расчётного счёта 4070…» или «TG: +7 …» не должны терять счёт и телефон (WP12-C).
 */
const NOT_FOREIGN = new Set([
  'PASSPORT_ISSUER',
  'PASSPORT_DATE',
  'NICKNAME',
  'IP',
  'MAC',
  'HEALTH',
  'SPECIAL',
  'TENDER',
  'ORDER_NO',
  'INVOICE_NO',
  'CLIENT_NO',
  'IP_REG',
]);
/**
 * Номера документов 0.5: метка документа делает значение «чужим» для ИНН, СНИЛС, ОГРН, телефона, карты, только если значение
 * похоже на номер этого документа («полис ОМС 4000 0000 1234 5676» — полис, а не карта; «полис ОМС +7 (495) 123-45-67» —
 * телефон). Метки остальных категорий 0.5 (госномер, VIN, кадастр, дело, доверенность…) значение «чужим» не делают вовсе:
 * проверенный телефон или ИНН после них получает свою категорию (второе ревью WP12-C: регрессия к 0.4).
 */
const DOC_SHAPE = {
  INTL_PASSPORT: /^\d{2}\s?(?:№\s?)?\d{7}$/u,
  DRIVER_LICENSE: /^\d{2}\s?(?:\d{2}|[А-ЯЁ]{2})\s?(?:№\s?)?\d{5,6}$/u,
  MILITARY_ID: /^[А-ЯЁ]{2}\s?(?:№\s?)?\d{7}$/u,
  RESIDENCE_PERMIT: /^(?:\d{2}|[А-ЯЁA-Z]{2})\s?(?:№\s?)?\d{6,10}$/u,
  MIGRATION_CARD: /^\d{2}\s?\d{2}\s?(?:№\s?)?\d{7}$/u,
  OMS: /^\d{4}(?:\s?\d{4}){3}$/u,
  VEHICLE_DOC: /^(?:\d{2}\s?(?:\d{2}|[А-ЯЁA-Z]{2})\s?(?:№\s?)?\d{6}|\d{15})$/u,
  PASSPORT_DEPT: /^\d{3}[-\s\u2010-\u2013]\d{3}$/u,
};
const LABELS_05 = new Set(Object.keys(EXTRA_RX));
/** Есть ли прямо перед значением (strict) метка другой категории, которая его «забирает». */
export const foreignHit = (hits, own, value) =>
  [...hits].some(
    ([c, k]) =>
      c !== own &&
      k === 'strict' &&
      !NOT_FOREIGN.has(c) &&
      (!LABELS_05.has(c) || (DOC_SHAPE[c] && (value === undefined || DOC_SHAPE[c].test(String(value).trim())))),
  );
/** Категории, чьи метки начинаются в позиции `p` потока (для HEALTH/SPECIAL: своя метка или чужая). */
export const labelCatsAt = (text, p, ctx) => catsAt(text, p, ctx).map((c) => c.cat);

/** Кандидаты по регулярке (с флагом g) → [{start, end, text, groups}]. */
export function* scan(text, re) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m[0] === '') {
      re.lastIndex++;
      continue;
    }
    yield { start: m.index, end: m.index + m[0].length, text: m[0], m };
  }
}

/**
 * Коды товаров (WP11-D, корпус жанров: код ТН ВЭД «8471300000» проходит контрольную сумму ИНН, EAN-13 — ОГРН). Группа
 * ключевых слов задаёт длины кода, которые подавляются: ТН ВЭД и HS — 10 цифр, штрихкод/EAN/GTIN — 8, 13, 14 (12-значный
 * UPC совпал бы с ИНН физлица — при сомнении ИНН маскируется), артикул/SKU/«код товара» — любая длина. ОКПД2 и ОКВЭД
 * пишутся с точками и с ИНН не путаются — не подавляют ничего.
 */
const SP = '[ \\t\\u00a0]';
// before — ключевое слово сразу перед числом: между ними только «:», «№», «#», тире и, может быть, предыдущие коды списка
// («Код ТН ВЭД 8471300000 8528521000»); слово или «.»/«;» между ними обрывают контекст («Арт. 15. Получатель …»)
const GOODS_KEYWORDS = [
  { lengths: new Set([10]), src: `тн${SP}*вэд(?:${SP}*еаэс)?|hs(?:${SP}*-?${SP}*code)?|commodity${SP}+code` },
  { lengths: new Set([8, 13, 14]), src: 'штрих-?код\\p{L}*|баркод\\p{L}*|ean(?:-?(?:8|13))?|gtin|barcode' },
  {
    lengths: null,
    src: `артикул\\p{L}*|арт\\.|sku|код\\p{L}*${SP}+(?:товар|продукци|издели|номенклатур)\\p{L}*|номенклатурн\\p{L}*${SP}+номер\\p{L}*|part${SP}+(?:no\\.?|number)|item${SP}+code`,
  },
].map((g) => ({
  lengths: g.lengths,
  before: new RegExp(`(?<![\\p{L}\\p{N}])(?:${g.src})${SP}*(?:[:№#—–-]${SP}*)*(?:[A-Za-z]*\\d[\\w-]*${SP}*,?${SP}+)*$`, 'iu'),
  word: new RegExp(`(?<![\\p{L}\\p{N}])(?:${g.src})(?![\\p{L}])`, 'giu'),
}));
/** Служебные слова заголовка столбца вокруг ключевого слова: «Код ТН ВЭД», «Номер артикула», «HS code». */
const HEADER_FILLER_RE = /(?<![\p{L}])(?:код|кода|номер|номера|code|no|number|№)(?![\p{L}])/giu;

/**
 * Число длины `len` стоит в контексте кода товара: ключевое слово сразу перед ним (окно 40 символов той же строки) или
 * заголовок столбца (`ctx.stream.columnHeader`, раннер) — только код товара, без других слов («Код ТН ВЭД», «Артикул»;
 * не «ИНН / ОКВЭД», не «Артикул/Получатель»). Детектор ИНН/ОГРН без своего лейбла такое число не берёт; при сомнении
 * (другое слово между ключевым и числом, смешанный заголовок, длина не кода) — берёт: лучше замаскировать код, чем
 * открыть ИНН (решение владельца 1).
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @param {{stream?: {columnHeader?: string}}} [ctx]
 */
export function goodsCodeContext(text, start, end, ctx = {}) {
  const len = text.slice(start, end).replace(/\D/g, '').length;
  const fits = (g) => !g.lengths || g.lengths.has(len);
  const raw = text.slice(Math.max(0, start - LABEL_WINDOW), start);
  const left = raw.slice(raw.lastIndexOf('\n') + 1);
  if (GOODS_KEYWORDS.some((g) => fits(g) && g.before.test(left))) return true;
  const header = ctx?.stream?.columnHeader;
  if (!header) return false;
  // «ВЭД» один в заголовке столбца — код ТН ВЭД (в PDF «Код ТН» бывает склеен с соседним заголовком, WP11-E)
  if (/^\s*вэд\s*$/iu.test(header)) return len === 10;
  const hits = GOODS_KEYWORDS.filter((g) => {
    g.word.lastIndex = 0;
    return g.word.test(header);
  });
  if (!hits.length || !hits.every(fits)) return false;
  let rest = header;
  for (const g of GOODS_KEYWORDS) rest = rest.replace(g.word, ' ');
  return !/\p{L}/u.test(rest.replace(HEADER_FILLER_RE, ' '));
}

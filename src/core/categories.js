// ЕДИНСТВЕННЫЙ каталог встроенных категорий (FR-17). Только данные — реализации детекторов
// регистрируются отдельно через registerDetector (src/core/contracts/detector.js).
// Порядок массива = приоритет категорий FR-20 (выше в списке — важнее).

/**
 * @typedef {'validated'|'labeled'|'kb'|'ner'|'weak'} Level
 * @typedef {'text'|'lower'|'alnum'|'alnumUpper'} NormalizeKind
 * @typedef {'pii'|'ids'|'commercial'} CategoryGroup
 *
 * @typedef {object} CategoryDef
 * @property {string} id                     'PERSON' | … | 'custom:<slug>'
 * @property {{ru: string, en: string}} label
 * @property {{ru: string, en: string}} placeholderPrefix   без скобок и номера: 'ФИО' → [ФИО_1]
 * @property {string} color                  цвет метки в UI
 * @property {boolean} defaultOn
 * @property {CategoryGroup} group        группа политики 0.4: 'pii' и 'ids' маскируются всегда, 'commercial' — по переключателю `commercial`
 * @property {Level[]} allowedLevels         кандидаты других уровней отбрасываются ядром
 * @property {{ru: string[], en: string[]}} labels  лейблы-подсказки для детекторов
 * @property {string|null} validator         имя валидатора в core/validators.js (WP1)
 * @property {number} priority               меньше = важнее (FR-20 шаг 3)
 * @property {boolean} builtin
 * @property {NormalizeKind} normalize       правило нормализации значения (FR-25)
 * @property {boolean} [numeric]             маска/режимы для числовых идентификаторов
 */

const L = (ru, en) => ({ ru, en });

/**
 * Категория версии 0.5 (WP12-C, `docs/concept-0.5.md` п. 5, `docs/contracts.md` §8.7) в одну строку: метки детекторам —
 * в `detect/identifiers/labels.js` (`EXTRA_RX`), здесь — по одной-две для справки. `levels` — строго: без метки (`validated`)
 * только форматы с жёсткой структурой, остальное — `labeled`.
 */
const N = (id, group, label, prefix, color, allowedLevels, normalize = 'alnumUpper', validator = null, defaultOn = true) => ({
  id,
  group,
  label,
  placeholderPrefix: prefix,
  color,
  defaultOn,
  allowedLevels,
  validator,
  normalize,
  labels: L([], []),
});
const LB = ['labeled'];
const VL = ['validated', 'labeled'];

/** @type {Omit<CategoryDef, 'priority'|'builtin'>[]} */
const BUILTIN = [
  {
    id: 'PASSPORT',
    group: 'pii',
    label: L('Паспорт', 'Passport'),
    placeholderPrefix: L('ПАСПОРТ', 'PASSPORT'),
    color: '#c0392b',
    defaultOn: true,
    allowedLevels: ['labeled'],
    validator: 'passport',
    normalize: 'alnumUpper',
    numeric: true,
    labels: L(['паспорт', 'серия'], ['passport', 'passport no.']),
  },
  // части паспорта (0.5, К6): у каждой своя метка — восстановление подставляет в каждое место своё значение
  N('PASSPORT_DEPT', 'pii', L('Паспорт: код подразделения', 'Passport: department code'), L('ПАСП_КОД', 'PASSPORT_CODE'), '#cd6155', LB, 'alnum'),
  N('PASSPORT_ISSUER', 'pii', L('Паспорт: кем выдан', 'Passport: issued by'), L('ПАСП_ВЫДАН', 'PASSPORT_ISSUER'), '#d98880', LB, 'lower'),
  N('PASSPORT_DATE', 'pii', L('Паспорт: дата выдачи', 'Passport: date of issue'), L('ПАСП_ДАТА', 'PASSPORT_DATE'), '#e6b0aa', LB, 'text'),
  N('INTL_PASSPORT', 'pii', L('Загранпаспорт', 'International passport'), L('ЗАГРАН', 'INTL_PASSPORT'), '#a93226', LB, 'alnumUpper', 'passport'),
  N('DRIVER_LICENSE', 'pii', L('Водительское удостоверение', "Driver's license"), L('ВУ', 'DRIVER_LICENSE'), '#922b21', LB),
  N('MILITARY_ID', 'pii', L('Военный билет', 'Military ID'), L('ВОЕН_БИЛЕТ', 'MILITARY_ID'), '#7b241c', LB),
  N('RESIDENCE_PERMIT', 'pii', L('ВНЖ / разрешение на работу', 'Residence / work permit'), L('ВНЖ', 'RESIDENCE_PERMIT'), '#b03a2e', LB),
  N('MIGRATION_CARD', 'pii', L('Миграционная карта', 'Migration card'), L('МИГР_КАРТА', 'MIGRATION_CARD'), '#943126', LB),
  N('CIVIL_CERT', 'pii', L('Свидетельство ЗАГС', 'Civil status certificate'), L('ЗАГС', 'CIVIL_CERT'), '#78281f', VL, 'alnumUpper', 'civilCert'),
  N('OMS', 'pii', L('Полис ОМС', 'Health insurance policy'), L('ПОЛИС_ОМС', 'OMS_POLICY'), '#cb4335', LB, 'alnum', 'oms'),
  N('VEHICLE_DOC', 'pii', L('СТС / ПТС', 'Vehicle registration'), L('СТС_ПТС', 'VEHICLE_DOC'), '#6e2c00', LB),
  N('VIN', 'pii', L('VIN', 'VIN'), L('VIN', 'VIN'), '#873600', VL, 'alnumUpper', 'vin'),
  N('PLATE', 'pii', L('Госномер', 'License plate'), L('ГОСНОМЕР', 'PLATE'), '#a04000', VL, 'alnumUpper', 'plate'),
  {
    id: 'SNILS',
    group: 'pii',
    label: L('СНИЛС', 'SNILS'),
    placeholderPrefix: L('СНИЛС', 'SNILS'),
    color: '#d35400',
    defaultOn: true,
    allowedLevels: ['validated', 'labeled'],
    validator: 'snils',
    normalize: 'alnum',
    numeric: true,
    labels: L(['снилс'], ['snils']),
  },
  {
    id: 'INN',
    group: 'ids',
    label: L('ИНН', 'INN'),
    placeholderPrefix: L('ИНН', 'INN'),
    color: '#e67e22',
    defaultOn: true,
    allowedLevels: ['validated', 'labeled'],
    validator: 'inn',
    normalize: 'alnum',
    numeric: true,
    labels: L(['инн'], ['inn', 'taxpayer id']),
  },
  {
    id: 'OGRN',
    group: 'ids',
    label: L('ОГРН / ОГРНИП', 'OGRN'),
    placeholderPrefix: L('ОГРН', 'OGRN'),
    color: '#f39c12',
    defaultOn: true,
    allowedLevels: ['validated', 'labeled'],
    validator: 'ogrn',
    normalize: 'alnum',
    numeric: true,
    labels: L(['огрн', 'огрнип'], ['ogrn', 'psrn']),
  },
  {
    id: 'ACCOUNT',
    group: 'ids',
    label: L('Банковский счёт', 'Bank account'),
    placeholderPrefix: L('СЧЕТ', 'ACCOUNT'),
    color: '#16a085',
    defaultOn: true,
    allowedLevels: ['validated', 'labeled'],
    validator: 'account',
    normalize: 'alnum',
    numeric: true,
    labels: L(
      ['р/с', 'расчётный счёт', 'расчетный счет', 'к/с', 'корр. счёт', 'корр. счет', 'корреспондентский счёт', 'счёт №', 'счет №'],
      ['account no.', 'acc.', 'account'],
    ),
  },
  {
    id: 'CARD',
    group: 'pii',
    label: L('Банковская карта', 'Card'),
    placeholderPrefix: L('КАРТА', 'CARD'),
    color: '#1abc9c',
    defaultOn: true,
    allowedLevels: ['validated', 'labeled'],
    validator: 'luhn',
    normalize: 'alnum',
    numeric: true,
    labels: L(['карта', 'номер карты'], ['card', 'card no.']),
  },
  {
    id: 'IBAN',
    group: 'ids',
    label: L('IBAN', 'IBAN'),
    placeholderPrefix: L('IBAN', 'IBAN'),
    color: '#27ae60',
    defaultOn: true,
    allowedLevels: ['validated', 'labeled'],
    validator: 'iban',
    normalize: 'alnumUpper',
    numeric: true,
    labels: L(['iban'], ['iban']),
  },
  {
    id: 'SWIFT',
    group: 'ids',
    label: L('SWIFT', 'SWIFT'),
    placeholderPrefix: L('SWIFT', 'SWIFT'),
    color: '#2ecc71',
    defaultOn: true,
    allowedLevels: ['labeled'],
    validator: 'swift',
    normalize: 'alnumUpper',
    numeric: true,
    labels: L(['swift', 'swift-код', 'bic'], ['swift', 'bic', 'swift code']),
  },
  {
    id: 'BIK',
    group: 'ids',
    label: L('БИК', 'BIK'),
    placeholderPrefix: L('БИК', 'BIK'),
    color: '#2980b9',
    defaultOn: true,
    allowedLevels: ['labeled', 'validated'],
    validator: 'bik',
    normalize: 'alnum',
    numeric: true,
    labels: L(['бик'], ['bic', 'bik']),
  },
  {
    id: 'KPP',
    group: 'ids',
    label: L('КПП', 'KPP'),
    placeholderPrefix: L('КПП', 'KPP'),
    color: '#3498db',
    defaultOn: true,
    allowedLevels: ['labeled'],
    validator: 'kpp',
    normalize: 'alnumUpper',
    numeric: true,
    labels: L(['кпп'], ['kpp']),
  },
  {
    id: 'SSN',
    group: 'pii',
    label: L('SSN', 'SSN'),
    placeholderPrefix: L('SSN', 'SSN'),
    color: '#8e44ad',
    defaultOn: true,
    allowedLevels: ['validated', 'labeled'],
    validator: 'ssn',
    normalize: 'alnum',
    numeric: true,
    labels: L(['ssn', 'social security'], ['ssn', 'social security', 'social security number']),
  },
  {
    id: 'TAXID',
    group: 'ids',
    label: L('Налоговый ID (иностр.)', 'Tax ID'),
    placeholderPrefix: L('НАЛОГ_ID', 'TAXID'),
    color: '#9b59b6',
    defaultOn: true,
    allowedLevels: ['labeled'],
    validator: 'taxid',
    normalize: 'alnumUpper',
    numeric: true,
    labels: L(['ein', 'tax id', 'vat', 'utr', 'tin'], ['ein', 'tax id', 'vat', 'utr', 'tin']),
  },
  // идентификаторы 0.5: недвижимость, суды, нотариат
  N('EGRN_RECORD', 'ids', L('Запись ЕГРН', 'Land registry record'), L('ЕГРН', 'EGRN'), '#5b2c6f', VL, 'alnumUpper', 'cadastral'),
  N('CADASTRAL', 'ids', L('Кадастровый номер', 'Cadastral number'), L('КАДАСТР', 'CADASTRAL'), '#6c3483', VL, 'alnumUpper', 'cadastral'),
  N('ENFORCEMENT', 'ids', L('Исполнительное производство', 'Enforcement proceedings'), L('ИСП_ПРОИЗВ', 'ENFORCEMENT'), '#7d3c98', VL),
  N('COURT_CASE', 'ids', L('Номер дела', 'Case number'), L('ДЕЛО', 'CASE'), '#8e44ad', VL),
  N('POA', 'ids', L('Доверенность', 'Power of attorney'), L('ДОВЕРЕННОСТЬ', 'POA'), '#a569bd', LB),
  N('NOTARY_REG', 'ids', L('Реестр нотариуса', 'Notarial register No.'), L('НОТ_РЕЕСТР', 'NOTARY_REG'), '#bb8fce', LB),
  {
    id: 'EMAIL',
    group: 'pii',
    label: L('Эл. почта', 'Email'),
    placeholderPrefix: L('EMAIL', 'EMAIL'),
    color: '#2c3e50',
    defaultOn: true,
    allowedLevels: ['validated'],
    validator: 'email',
    normalize: 'lower',
    labels: L([], []),
  },
  // сеть и мессенджеры (0.5): ник перед URL — «t.me/ник» и «vk.com/ник» становятся ником, а не ссылкой (FR-20, приоритет)
  N('NICKNAME', 'pii', L('Ник в мессенджере', 'Messenger handle'), L('НИК', 'HANDLE'), '#566573', VL, 'lower', 'handle'),
  {
    id: 'URL',
    group: 'ids',
    label: L('Ссылка', 'URL'),
    placeholderPrefix: L('URL', 'URL'),
    color: '#34495e',
    defaultOn: true,
    allowedLevels: ['validated'],
    validator: 'url',
    normalize: 'lower',
    labels: L([], []),
  },
  N('IP', 'pii', L('IP-адрес', 'IP address'), L('IP', 'IP'), '#5d6d7e', VL, 'lower', 'ip'),
  N('MAC', 'pii', L('MAC-адрес', 'MAC address'), L('MAC', 'MAC'), '#85929e', VL, 'alnumUpper', 'mac'),
  {
    id: 'PHONE',
    group: 'pii',
    label: L('Телефон', 'Phone'),
    placeholderPrefix: L('ТЕЛ', 'PHONE'),
    color: '#7f8c8d',
    defaultOn: true,
    allowedLevels: ['validated', 'labeled'],
    validator: 'phone',
    normalize: 'alnum',
    numeric: true,
    labels: L(['тел.', 'телефон', 'факс', 'моб.'], ['tel', 'phone', 'fax', 'mobile']),
  },
  {
    id: 'BIRTHDATE',
    group: 'pii',
    label: L('Дата рождения', 'Date of birth'),
    placeholderPrefix: L('ДАТА_РОЖД', 'DOB'),
    color: '#e84393',
    defaultOn: true,
    allowedLevels: ['labeled'],
    validator: 'birthdate',
    normalize: 'text',
    labels: L(['дата рождения', 'д.р.', 'родился', 'родилась', 'г.р.'], ['date of birth', 'dob', 'born on']),
  },
  {
    id: 'PERSON',
    group: 'pii',
    label: L('ФИО', 'Person'),
    placeholderPrefix: L('ФИО', 'PERSON'),
    color: '#d63031',
    defaultOn: true,
    allowedLevels: ['validated', 'labeled', 'ner', 'kb'],
    validator: null,
    normalize: 'lower',
    labels: L(['в лице', 'генеральный директор', 'фио', 'на имя', 'исполнитель:', 'подпись'], ['represented by', 'name:', 'attn:', 'signed by']),
  },
  {
    id: 'COMPANY',
    group: 'commercial',
    label: L('Организация', 'Company'),
    placeholderPrefix: L('КОМПАНИЯ', 'COMPANY'),
    color: '#0984e3',
    defaultOn: true,
    allowedLevels: ['labeled', 'ner', 'kb'],
    validator: 'legalForm',
    normalize: 'lower',
    labels: L(['поставщик:', 'покупатель:', 'именуемое в дальнейшем', 'банк получателя'], ['supplier:', 'buyer:', 'hereinafter', 'beneficiary bank']),
  },
  {
    id: 'ADDRESS',
    group: 'pii',
    label: L('Адрес', 'Address'),
    placeholderPrefix: L('АДРЕС', 'ADDRESS'),
    color: '#00b894',
    defaultOn: true,
    allowedLevels: ['labeled', 'ner', 'weak'],
    validator: 'address',
    normalize: 'lower',
    labels: L(['адрес', 'юридический адрес', 'место нахождения', 'зарегистрирован по адресу'], ['address', 'registered office', 'located at']),
  },
  // только по явной метке строки, ячейки или заголовку столбца: без метки не ищутся (ограничение README)
  N('HEALTH', 'pii', L('Сведения о здоровье', 'Health data'), L('ЗДОРОВЬЕ', 'HEALTH'), '#16a085', LB, 'lower'),
  N('SPECIAL', 'pii', L('Особые категории ПДн', 'Special category data'), L('ОСОБЫЕ_ПДН', 'SPECIAL_PD'), '#117a65', LB, 'lower'),
  {
    id: 'CONTRACT',
    group: 'commercial',
    label: L('Номер договора', 'Contract No.'),
    placeholderPrefix: L('ДОГОВОР', 'CONTRACT'),
    color: '#636e72',
    defaultOn: false,
    allowedLevels: ['labeled'],
    validator: null,
    normalize: 'alnumUpper',
    labels: L(['договор №', 'контракт №', 'соглашение №'], ['agreement no.', 'contract no.']),
  },
  N('TENDER', 'commercial', L('Номер закупки', 'Tender No.'), L('ЗАКУПКА', 'TENDER'), '#7b7d7d', LB),
  N('ORDER_NO', 'commercial', L('Номер заказа', 'Order No.'), L('ЗАКАЗ', 'ORDER'), '#909497', LB),
  N('INVOICE_NO', 'commercial', L('Номер счёта на оплату', 'Invoice No.'), L('НОМ_СЧЕТА', 'INVOICE'), '#a6acaf', LB),
  N('CLIENT_NO', 'commercial', L('Номер клиента', 'Customer No.'), L('КЛИЕНТ', 'CUSTOMER'), '#bdc3c7', LB),
  N('IP_REG', 'commercial', L('Патент, товарный знак, программа для ЭВМ', 'Patent, trademark, software registration'), L('РИД', 'IP_REG'), '#626567', LB),
  {
    id: 'AMOUNT',
    group: 'commercial',
    label: L('Сумма', 'Amount'),
    placeholderPrefix: L('СУММА', 'AMOUNT'),
    color: '#b2bec3',
    defaultOn: false,
    allowedLevels: ['labeled', 'weak'],
    validator: null,
    normalize: 'text',
    labels: L(['цена', 'стоимость', 'сумма'], ['price', 'amount', 'fee']),
  },
];

/** @type {readonly CategoryDef[]} */
export const BUILTIN_CATEGORIES = Object.freeze(BUILTIN.map((c, i) => Object.freeze({ ...c, priority: i + 1, builtin: true })));

export const BUILTIN_IDS = Object.freeze(BUILTIN_CATEGORIES.map((c) => c.id));

/**
 * Группы политики маскирования (версия 0.4, `docs/concept-0.4.md` п. 1): состав и порядок показа в настройках.
 * `pii` (персональные данные) и `ids` (идентификаторы компаний) маскируются безусловно — переключателей у них нет;
 * `commercial` (названия организаций, номера договоров, суммы) включается одним переключателем `settings.commercial`
 * (по умолчанию выключен), внутри действуют прежние переключатели `settings.categories[id]`.
 * @type {Readonly<Record<CategoryGroup, readonly string[]>>}
 */
export const CATEGORY_GROUPS = Object.freeze({
  pii: Object.freeze(BUILTIN_CATEGORIES.filter((c) => c.group === 'pii').map((c) => c.id)),
  ids: Object.freeze(BUILTIN_CATEGORIES.filter((c) => c.group === 'ids').map((c) => c.id)),
  commercial: Object.freeze(BUILTIN_CATEGORIES.filter((c) => c.group === 'commercial').map((c) => c.id)),
});

/** Категории, которые нельзя выключить (группы `pii` и `ids`). */
export const ALWAYS_ON_IDS = Object.freeze([...CATEGORY_GROUPS.pii, ...CATEGORY_GROUPS.ids]);

/** Уровни уверенности по убыванию (FR-20 шаг 2). */
export const LEVEL_RANK = Object.freeze({ validated: 0, labeled: 1, kb: 2, ner: 3, weak: 4 });

/**
 * Эффективный каталог = встроенные + пользовательские категории (FR-17, FR-44).
 * Пользовательские: priority 'aboveBuiltin' → 0 (выше всех), иначе после всех встроенных.
 * @param {{customCategories?: any[]}} [settings]
 * @returns {{list: CategoryDef[], byId: Map<string, CategoryDef>}}
 */
export function buildCatalog(settings = {}) {
  const list = [...BUILTIN_CATEGORIES];
  const n = BUILTIN_CATEGORIES.length;
  (settings.customCategories || []).forEach((cc, i) => {
    if (!cc || !cc.id) return;
    list.push(
      Object.freeze({
        id: cc.id,
        label: { ru: cc.label?.ru || cc.id, en: cc.label?.en || cc.label?.ru || cc.id },
        placeholderPrefix: { ru: cc.placeholderPrefix?.ru || 'ПРОЧЕЕ', en: cc.placeholderPrefix?.en || 'OTHER' },
        color: cc.color || '#8e44ad',
        defaultOn: cc.enabled !== false,
        allowedLevels: ['validated', 'labeled', 'kb', 'weak'],
        labels: { ru: cc.labeled?.labels?.ru || [], en: cc.labeled?.labels?.en || [] },
        validator: cc.pattern?.validator && cc.pattern.validator !== 'none' ? cc.pattern.validator : null,
        priority: cc.priority === 'aboveBuiltin' ? 0 : n + 1 + i,
        builtin: false,
        normalize: 'lower',
        custom: cc,
      }),
    );
  });
  return { list, byId: new Map(list.map((c) => [c.id, c])) };
}

/**
 * Включена ли категория с учётом настроек (политика 0.4, Ц1/К1):
 * группы `pii` и `ids` — всегда; `commercial` — только при `settings.commercial === true`, дальше
 * `settings.categories[id] ?? defaultOn`; пользовательские — поле enabled.
 */
export function isCategoryEnabled(cat, settings = {}) {
  if (!cat.builtin) return cat.defaultOn;
  if (cat.group === 'pii' || cat.group === 'ids') return true;
  if (cat.group === 'commercial' && settings.commercial !== true) return false;
  const v = settings.categories?.[cat.id];
  return typeof v === 'boolean' ? v : cat.defaultOn;
}

/**
 * Нормализация значения для склейки «одно значение → один плейсхолдер» (FR-25).
 * @param {CategoryDef|undefined} cat
 * @param {string} text
 */
export function normalizeValue(cat, text) {
  const base = text.replace(/\s+/g, ' ').trim();
  switch (cat?.normalize) {
    case 'lower':
      return base.toLowerCase().replace(/ё/g, 'е');
    case 'alnum':
      return base.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
    case 'alnumUpper':
      return base.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase();
    default:
      return base;
  }
}

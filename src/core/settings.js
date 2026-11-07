// КОНТРАКТ: настройки (FR-34, таблица §4.8). Хранятся в chrome.storage.local под ключом 'settings'.
// Ядро не знает про chrome.* — обёртка хранилища в src/shared/settings-store.js.
import { ALWAYS_ON_IDS, BUILTIN_CATEGORIES } from './categories.js';

export const SETTINGS_KEY = 'settings';
export const SETTINGS_SCHEMA_VERSION = 5;

export const DEFAULT_ALLOWLIST = Object.freeze([
  'https://chatgpt.com',
  'https://claude.ai',
  'https://gemini.google.com',
  'https://chat.deepseek.com',
  'https://www.perplexity.ai',
]);

const PROFILE_FIELDS = [
  'categories',
  'commercial',
  'mode',
  'language',
  'placeholderLanguage',
  'keepMetadata',
  'stripEmbedded',
  'govEntities',
  'dictNames',
  'nerThreshold',
  'nerThresholdOrg',
];

/** Категории групп `pii`/`ids` всегда `true` (политика 0.4, К1); `commercial` — по `defaultOn` внутри группы. */
function defaultCategories() {
  return Object.fromEntries(BUILTIN_CATEGORIES.map((c) => [c.id, ALWAYS_ON_IDS.includes(c.id) || c.defaultOn]));
}

/**
 * Дополняет объект категорий категориями 0.5, которых в нём нет (миграция 3 → 4): `pii`/`ids` — `true`, `commercial` —
 * `defaultOn` (действует при включённом переключателе группы). Заданные значения и отсутствующие ключи 0.4 не трогает.
 */
function addMissingCategories(categories) {
  const defaults = defaultCategories();
  return { ...Object.fromEntries(CATEGORIES_05.map((id) => [id, defaults[id]])), ...categories };
}

/** Категории, добавленные в 0.5 (схема 4): миграция 3 → 4 дописывает только их — частичный профиль не получает ключи 0.4. */
export const CATEGORIES_05 = Object.freeze([
  ...['PASSPORT_DEPT', 'PASSPORT_ISSUER', 'PASSPORT_DATE', 'INTL_PASSPORT', 'DRIVER_LICENSE', 'MILITARY_ID', 'RESIDENCE_PERMIT', 'MIGRATION_CARD'],
  ...['CIVIL_CERT', 'OMS', 'VEHICLE_DOC', 'VIN', 'PLATE', 'NICKNAME', 'IP', 'MAC', 'HEALTH', 'SPECIAL', 'EGRN_RECORD', 'CADASTRAL', 'ENFORCEMENT'],
  ...['COURT_CASE', 'POA', 'NOTARY_REG', 'TENDER', 'ORDER_NO', 'INVOICE_NO', 'CLIENT_NO', 'IP_REG'],
]);

/** Скрытые данные (0.5, WP12-D, ooxml/hidden.js): флаг выбора → ключ настроек; выбор запоминается. */
export const HIDDEN_SETTINGS = Object.freeze({
  comments: 'removeComments',
  revisions: 'acceptRevisions',
  hiddenText: 'removeHiddenText',
  hiddenSheets: 'removeHiddenSheets',
  hiddenSlides: 'removeHiddenSlides',
});

/**
 * Выбор по скрытым данным из настроек (HiddenFlags, ooxml/hidden.js): по умолчанию всё выключено.
 * @param {Record<string, any>} settings
 * @returns {import('./ooxml/hidden.js').HiddenFlags}
 */
export function hiddenFlagsFrom(settings) {
  return Object.fromEntries(Object.entries(HIDDEN_SETTINGS).map(([flag, key]) => [flag, settings?.[key] === true]));
}

/**
 * Расширения форматов, которые расширение проверяет (0.5.2, FR-04б): = `fileKind` из content/files.js (равенство — в тесте).
 * В список «не спрашивать» (`skipExtensions`) не добавляются: иначе ключ восстановления (.json, .txt, *.mapping.json) ушёл бы без проверки.
 */
export const SUPPORTED_EXTENSIONS = Object.freeze('docx docm pdf xlsx xlsm pptx pptm txt text log md markdown csv json'.split(' '));

/** Расширение для списка «не спрашивать»: строчные латиница и цифры (и `_+-`), без точки, до 16 символов, не поддерживаемый формат. */
export const isSkipExtension = (x) => typeof x === 'string' && /^[a-z0-9][a-z0-9_+-]{0,15}$/.test(x) && !SUPPORTED_EXTENSIONS.includes(x);

/**
 * Разбор поля «не спрашивать» на странице настроек (0.5.2, FR-04в): «.JPG, png; *.zip» → ['jpg', 'png', 'zip'].
 * @param {string} text
 * @returns {{list: string[], supported: string[], invalid: string[]}} supported — поддерживаемые форматы (отклоняются), invalid — не расширения
 */
export function parseExtensionList(text) {
  const list = [];
  const supported = [];
  const invalid = [];
  for (const raw of String(text || '').split(/[\s,;]+/)) {
    const x = raw.replace(/^\*?\.+/, '').toLowerCase();
    if (!x) continue;
    const to = SUPPORTED_EXTENSIONS.includes(x) ? supported : isSkipExtension(x) ? list : invalid;
    if (!to.includes(x)) to.push(x);
  }
  return { list, supported, invalid };
}

/** Включает категории `pii`/`ids` в объекте категорий (миграция 2 → 3 и импорт старых конфигураций). */
function forceAlwaysOn(categories) {
  return { ...categories, ...Object.fromEntries(ALWAYS_ON_IDS.map((id) => [id, true])) };
}

/**
 * @typedef {object} Settings
 * @property {number} schemaVersion
 * @property {boolean} interceptEnabled
 * @property {'all'|'allowlist'} siteMode
 * @property {string[]} allowlist
 * @property {string[]} blocklist
 * @property {Record<string, boolean>} categories  переключатели внутри группы `commercial`; для `pii`/`ids` значения всегда true (К1 0.4)
 * @property {boolean} commercial         группа «Коммерческая информация» (COMPANY, CONTRACT, AMOUNT) включена (0.4, Ц1); по умолчанию выключена
 * @property {{name: string, aliases: string[]}[]} maskedCompanies  список компаний для маскирования (0.4, Ц3, FR списка компаний); ищутся всегда
 * @property {boolean} orgPolicyHintPending  показать один раз подсказку «организации теперь по желанию» (0.4, миграция 2 → 3); не экспортируется
 * @property {'placeholder'|'mask'|'delete'} mode
 * @property {'auto'|'ru'|'en'|'both'} language
 * @property {'document'|'ru'|'en'} placeholderLanguage
 * @property {boolean} nerEnabled
 * @property {number} nerThreshold       порог модели для PER/LOC
 * @property {number} nerThresholdOrg    порог модели для ORG (0.4, концепция п. 4; по умолчанию 0.85)
 * @property {string[]} nerStoplist      пользовательское дополнение стоп-списка модельных организаций (0.4, К10)
 * @property {string} nerModel           id установленного пакета модели NER ('' — нет; WP8), не экспортируется
 * @property {string} bundledModelSha    sha256 встроенного пакета, который профиль уже обработал ('' — ни одного; WP10-C, Ц7), не экспортируется
 * @property {string} bundledModelError  код последней неудачной автоустановки встроенного пакета ('' — нет; WP10-C, К15), не экспортируется
 * @property {boolean} keepMetadata
 * @property {boolean} stripEmbedded
 * @property {boolean} removeComments      скрытые данные (0.5, WP12-D, К7): удалить комментарии (Word, Excel, PowerPoint); по умолчанию нет
 * @property {boolean} acceptRevisions     принять исправления Word (история правок); по умолчанию нет
 * @property {boolean} removeHiddenText    удалить скрытый текст Word; по умолчанию нет
 * @property {boolean} removeHiddenSheets  удалить скрытые листы, строки и столбцы Excel; по умолчанию нет
 * @property {boolean} removeHiddenSlides  удалить скрытые слайды PowerPoint; по умолчанию нет
 * @property {number} maxFileSizeMB
 * @property {'auto'|'ru'|'en'} uiLanguage
 * @property {{value: string, category: string}[]} exclusions
 * @property {boolean} govEntities
 * @property {boolean} dictNames          словарный детектор ФИО третьих лиц (WP7, FR-23)
 * @property {Record<string, {x: number, y: number}>} panelPosition
 * @property {boolean} hintMappingShown   подсказка о ключе восстановления уже показана (WP10-D, FR-28); не экспортируется
 * @property {object[]} customCategories   CustomCategory (FR-44)
 * @property {{id: string, name: {ru: string, en: string}, builtin: boolean, values: object}[]} profiles
 * @property {string} activeProfile
 * @property {'folder'|'zip'|'files'} batchOutput
 * @property {string} outputSuffix
 * @property {'markdown'|'text'|'off'} pdfMode  PDF (версия 0.3): в чат уходит .anon.md / .anon.txt; 'off' — PDF не обезличивается (с 0.5.2 — предупреждение, FR-04б)
 * @property {string[]} skipExtensions  расширения «не спрашивать» (0.5.2, FR-04в): файлы уходят без предупреждения, как до 0.5.2; по умолчанию пусто
 */

/**
 * Значения по умолчанию. Пояснения — здесь, а не внутри литерала (бюджет размера content.js, см. MIGRATIONS):
 * - `commercial: false` — политика 0.4: названия организаций, номера договоров и суммы — по желанию; у всех после обновления выключено;
 * - `nerThreshold: 0.7` = recommendedThreshold пакета rubert-tiny2-ner-ruen (WP9, калибровка tools/ner-train/calibrate.py; docs/contracts.md §6.7);
 * - `nerThresholdOrg: 0.85` — порог для ORG выше: модель 1.0.0 на жанрах вне договоров давала десятки ложных организаций (концепция 0.4, п. 4);
 * - `bundledModelSha` (WP10-C) пишет только background по ответу MODEL_INSTALLED; удаление модели пользователем поле не трогает (модель не вернётся сама);
 * - `bundledModelError` (WP10-C) тоже пишет только background — код ошибки MODEL_INSTALLED failed (карточка «не удалось / повторить»); очищается успехом;
 * - скрытые данные (`removeComments` … `removeHiddenSlides`; 0.5, WP12-D): документ меняется только по явному выбору в панели, выбор запоминается
 *   здесь; новые ключи со значением по умолчанию — миграция схемы не нужна (migrateSettings дополняет дефолтами);
 * - `skipExtensions: []` (0.5.2, FR-04в) — список «не спрашивать» пуст: о каждом неподдерживаемом файле панель спрашивает.
 * @returns {Settings}
 */
export function defaultSettings() {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    interceptEnabled: false,
    siteMode: 'allowlist',
    allowlist: [...DEFAULT_ALLOWLIST],
    blocklist: [],
    categories: defaultCategories(),
    commercial: false,
    maskedCompanies: [],
    orgPolicyHintPending: false,
    mode: 'placeholder',
    language: 'auto',
    placeholderLanguage: 'document',
    nerEnabled: true,
    nerThreshold: 0.7,
    nerThresholdOrg: 0.85,
    nerStoplist: [],
    nerModel: '',
    bundledModelSha: '',
    bundledModelError: '',
    keepMetadata: false,
    stripEmbedded: false,
    removeComments: false,
    acceptRevisions: false,
    removeHiddenText: false,
    removeHiddenSheets: false,
    removeHiddenSlides: false,
    maxFileSizeMB: 50,
    uiLanguage: 'auto',
    exclusions: [],
    govEntities: true,
    dictNames: true,
    panelPosition: {},
    hintMappingShown: false,
    customCategories: [],
    profiles: [
      { id: 'llm', name: { ru: 'Для LLM', en: 'For LLM' }, builtin: true, values: {} },
      {
        id: 'external',
        name: { ru: 'Для внешней передачи', en: 'For external sharing' },
        builtin: true,
        values: {
          categories: Object.fromEntries(BUILTIN_CATEGORIES.map((c) => [c.id, true])),
          govEntities: false,
          stripEmbedded: true,
        },
      },
    ],
    activeProfile: 'llm',
    batchOutput: 'folder',
    outputSuffix: '.anon',
    pdfMode: 'markdown',
    skipExtensions: [],
  };
}

/**
 * Проверки полей: (value) => true если валидно. Используется миграцией и страницей настроек (FR-42).
 * `nerModel` — = PACK_ID_RE из core/ner/pack.js (не импортируется, чтобы не тянуть разбор пакета в content.js; равенство — в тесте);
 * `bundledModelError` — код ошибки как в schemas/protocol.schema.json (MODEL_INSTALLED.code): только A-Z и _, без значений документа;
 * `skipExtensions` — до 50 расширений `isSkipExtension` (0.5.2, FR-04в): поддерживаемый формат список не принимает.
 */
export const VALIDATORS = Object.freeze({
  schemaVersion: (v) => Number.isInteger(v),
  interceptEnabled: (v) => typeof v === 'boolean',
  siteMode: (v) => v === 'all' || v === 'allowlist',
  allowlist: (v) => Array.isArray(v) && v.every(isOriginPattern),
  blocklist: (v) => Array.isArray(v) && v.every(isOriginPattern),
  categories: (v) => isPlainObject(v) && Object.values(v).every((x) => typeof x === 'boolean'),
  commercial: (v) => typeof v === 'boolean',
  maskedCompanies: (v) => Array.isArray(v) && v.length <= 200 && v.every(isMaskedCompany),
  orgPolicyHintPending: (v) => typeof v === 'boolean',
  mode: (v) => ['placeholder', 'mask', 'delete'].includes(v),
  language: (v) => ['auto', 'ru', 'en', 'both'].includes(v),
  placeholderLanguage: (v) => ['document', 'ru', 'en'].includes(v),
  nerEnabled: (v) => typeof v === 'boolean',
  nerThreshold: (v) => typeof v === 'number' && v >= 0 && v <= 1,
  nerThresholdOrg: (v) => typeof v === 'number' && v >= 0 && v <= 1,
  nerStoplist: (v) => Array.isArray(v) && v.length <= 500 && v.every((x) => typeof x === 'string' && x.length <= 80),
  nerModel: (v) => v === '' || (typeof v === 'string' && /^[a-z0-9][a-z0-9-]{1,40}$/.test(v)),
  bundledModelSha: (v) => v === '' || (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)),
  bundledModelError: (v) => v === '' || (typeof v === 'string' && /^[A-Z_]{1,40}$/.test(v)),
  keepMetadata: (v) => typeof v === 'boolean',
  stripEmbedded: (v) => typeof v === 'boolean',
  removeComments: (v) => typeof v === 'boolean',
  acceptRevisions: (v) => typeof v === 'boolean',
  removeHiddenText: (v) => typeof v === 'boolean',
  removeHiddenSheets: (v) => typeof v === 'boolean',
  removeHiddenSlides: (v) => typeof v === 'boolean',
  maxFileSizeMB: (v) => Number.isInteger(v) && v >= 1 && v <= 100,
  uiLanguage: (v) => ['auto', 'ru', 'en'].includes(v),
  exclusions: (v) => Array.isArray(v) && v.every((x) => isPlainObject(x) && typeof x.value === 'string' && typeof x.category === 'string'),
  govEntities: (v) => typeof v === 'boolean',
  dictNames: (v) => typeof v === 'boolean',
  panelPosition: (v) => isPlainObject(v),
  hintMappingShown: (v) => typeof v === 'boolean',
  customCategories: (v) => Array.isArray(v) && v.length <= 100 && v.every((x) => isPlainObject(x) && typeof x.id === 'string'),
  profiles: (v) => Array.isArray(v) && v.every((x) => isPlainObject(x) && typeof x.id === 'string'),
  activeProfile: (v) => typeof v === 'string',
  batchOutput: (v) => ['folder', 'zip', 'files'].includes(v),
  outputSuffix: (v) => typeof v === 'string' && v.length <= 32 && !/[\\/:*?"<>|]/.test(v),
  pdfMode: (v) => ['markdown', 'text', 'off'].includes(v),
  skipExtensions: (v) => Array.isArray(v) && v.length <= 50 && v.every(isSkipExtension),
});

/** Применяет `fn` к `values.categories` каждого сохранённого профиля, где они есть; прочие записи не трогает. */
function mapProfileCategories(profiles, fn) {
  return profiles.map((p) =>
    isPlainObject(p) && isPlainObject(p.values) && isPlainObject(p.values.categories)
      ? { ...p, values: { ...p.values, categories: fn(p.values.categories) } }
      : p,
  );
}

// Комментарии к миграциям — над функциями, а не внутри объекта MIGRATIONS: esbuild без minify сохраняет комментарии внутри
// литералов, а settings.js входит в content.js с бюджетом размера (pack.spec.js, 0.5.2).

/** 0 → 1: исходная версия; объекты без schemaVersion считаются версией 0. */
const toV1 = (s) => ({ ...s, schemaVersion: 1 });

/**
 * 1 → 2 (0.2, WP9): порог NER по умолчанию 0.6 → 0.7. В 0.1 модели не было, поэтому 0.6 — это всегда прежний
 * дефолт, а не выбор пользователя; другие значения не трогаем. Профили со своим порогом тоже не трогаем.
 */
const toV2 = (s) => ({ ...s, schemaVersion: 2, ...(s.nerThreshold === 0.6 ? { nerThreshold: 0.7 } : {}) });

/**
 * 2 → 3 (0.4, политика маскирования): категории групп pii/ids включаются принудительно — и в настройках, и в
 * сохранённых профилях; группа commercial у всех выключена (нового ключа в объекте нет → дефолт false, политика
 * едина). Существующий профиль (есть `categories`) получает одноразовую подсказку о смене политики.
 */
function toV3(s) {
  const out = { ...s, schemaVersion: 3 };
  if (isPlainObject(s.categories)) {
    out.categories = forceAlwaysOn(s.categories);
    out.orgPolicyHintPending = true;
  }
  if (Array.isArray(s.profiles)) out.profiles = mapProfileCategories(s.profiles, forceAlwaysOn);
  return out;
}

/**
 * 3 → 4 (0.5, WP12-C): новые встроенные категории (части паспорта, документы, транспорт, сеть, суды, недвижимость,
 * коммерческие номера) — в настройках и в сохранённых профилях по правилам групп; `pii`/`ids` всё равно всегда включены
 * (`isCategoryEnabled`), а у `commercial` значение по умолчанию начинает действовать при включённом переключателе группы.
 * Частичный объект без `categories` (патч импорта) — только версия.
 */
function toV4(s) {
  const out = { ...s, schemaVersion: 4 };
  if (isPlainObject(s.categories)) out.categories = addMissingCategories(s.categories);
  if (Array.isArray(s.profiles)) out.profiles = mapProfileCategories(s.profiles, addMissingCategories);
  return out;
}

/**
 * 4 → 5 (0.5.2, FR-04б, FR-04в): неподдерживаемые файлы больше не уходят молча; новое поле `skipExtensions` — пустой список.
 * Ключ дописывает migrateSettings (дефолт), здесь — только версия: частичный патч импорта не должен затирать список пользователя.
 */
const toV5 = (s) => ({ ...s, schemaVersion: 5 });

/**
 * Миграции: MIGRATIONS[n] переводит объект версии n в версию n+1.
 * Чтобы добавить поле/переименовать — увеличьте SETTINGS_SCHEMA_VERSION и добавьте функцию.
 * @type {Record<number, (s: any) => any>}
 */
export const MIGRATIONS = { 0: toV1, 1: toV2, 2: toV3, 3: toV4, 4: toV5 };

/**
 * Прогоняет MIGRATIONS над объектом настроек версии `fromVersion` (целым или частичным — патчем из файла импорта,
 * FR-47) до SETTINGS_SCHEMA_VERSION. Чистая функция: вход не меняется. Миграции обязаны работать и на частичном
 * объекте (трогать только присутствующие поля). Версия больше текущей или нецелая (кроме отсутствующей — это 0) — без
 * изменений. Возвращает объект со `schemaVersion` той версии, до которой дошли.
 * @param {Record<string, any>} obj
 * @param {number} [fromVersion]  по умолчанию obj.schemaVersion, без него — 0
 */
export function applyMigrations(obj, fromVersion = obj?.schemaVersion) {
  let s = { ...obj };
  let v = fromVersion === undefined ? 0 : fromVersion;
  if (!Number.isInteger(v)) return s;
  while (v < SETTINGS_SCHEMA_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) break;
    s = m(s);
    v = s.schemaVersion;
  }
  return s;
}

/**
 * Приводит сохранённый объект (любой версии, в т.ч. undefined) к текущей схеме:
 * миграции → дополнение дефолтами → отбрасывание невалидных полей.
 * @param {any} stored
 * @returns {{settings: Settings, changed: boolean}}
 */
export function migrateSettings(stored) {
  const defaults = defaultSettings();
  if (!isPlainObject(stored)) return { settings: defaults, changed: true };
  const s = applyMigrations(stored, Number.isInteger(stored.schemaVersion) ? stored.schemaVersion : 0);
  /** @type {any} */
  const out = {};
  for (const [k, def] of Object.entries(defaults)) {
    const val = s[k];
    out[k] = val !== undefined && VALIDATORS[k]?.(val) ? val : def;
  }
  // Новые встроенные категории получают defaultOn; pii/ids всегда включены (К1 0.4) — даже если сохранённый объект
  // текущей версии был изменён вручную
  out.categories = forceAlwaysOn({ ...defaults.categories, ...out.categories });
  out.schemaVersion = SETTINGS_SCHEMA_VERSION;
  const changed = JSON.stringify(out) !== JSON.stringify(stored);
  return { settings: out, changed };
}

/**
 * Проверяет патч настроек. Возвращает список невалидных ключей (пустой — всё хорошо).
 * @param {Partial<Settings>} patch
 */
export function validateSettingsPatch(patch) {
  const bad = [];
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in VALIDATORS) || !VALIDATORS[k](v)) bad.push(k);
  }
  return bad;
}

/**
 * Эффективные настройки обработки = настройки + значения активного профиля (FR-52).
 * @param {Settings} settings
 * @param {string} [profileId]
 */
export function effectiveSettings(settings, profileId = settings.activeProfile) {
  const p = settings.profiles.find((x) => x.id === profileId);
  if (!p) return settings;
  const values = Object.fromEntries(Object.entries(p.values || {}).filter(([k]) => PROFILE_FIELDS.includes(k)));
  return { ...settings, ...values, categories: { ...settings.categories, ...(values.categories || {}) } };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Запись списка компаний (0.4): название 1–120 символов, до 20 псевдонимов. */
function isMaskedCompany(x) {
  return (
    isPlainObject(x) &&
    typeof x.name === 'string' &&
    x.name.trim().length >= 1 &&
    x.name.length <= 120 &&
    (x.aliases === undefined || (Array.isArray(x.aliases) && x.aliases.length <= 20 && x.aliases.every((a) => typeof a === 'string' && a.length <= 120)))
  );
}

function isOriginPattern(v) {
  return typeof v === 'string' && /^https?:\/\/(\*\.)?[^/\s]+$/.test(v);
}

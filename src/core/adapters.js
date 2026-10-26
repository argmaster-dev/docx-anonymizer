// Реестр адаптеров форматов документов (DocumentAdapter, ТЗ §5.3; версия 0.5, WP12-A/WP12-B, docs/contracts.md §9).
// PDF (версия 0.3) — не адаптер: извлечение текста асинхронное и требует pdf.js из окружения (env.extractPdf хоста),
// результат — текстовая модель kind 'text' (core/text/).
// Word — в коде воркера целиком. Excel, PowerPoint и текстовые форматы (WP12-B) — модули по требованию (бюджет worker.js, К14):
// в реестре лёгкая запись {kind, extensions, mime, detect, load}, код формата — в offscreen/chunks/ (esbuild splitting).
// Хост после распознавания делает `await loadAdapter(entry)`; синхронный applyDecisions берёт уже загруженный адаптер
// (adapterForKind), не загружен — null → INTERNAL. Модуль формата при загрузке сам записывает себя сюда (registerAdapter):
// так работает и прямой импорт адаптера (тесты, скрипты).
import { DOCX_ADAPTER } from './docx/adapter.js';
import { zipHasEntry, hasExtension } from './ooxml/adapter.js';

/**
 * Лёгкая запись реестра для формата по требованию: распознавание без кода формата, загрузка — динамическим import().
 * @typedef {object} LazyAdapterEntry
 * @property {string} kind
 * @property {string[]} extensions
 * @property {string} mime
 * @property {(bytes: Uint8Array, name?: string) => boolean} detect
 * @property {() => Promise<import('./ooxml/adapter.js').DocumentAdapter>} load
 */

const XLSX_EXT = ['.xlsx', '.xlsm'];
const PPTX_EXT = ['.pptx', '.pptm'];
const PLAIN_EXT = ['.txt', '.log', '.md', '.csv', '.json'];

/** @type {LazyAdapterEntry} */
const XLSX_ENTRY = Object.freeze({
  kind: 'xlsx',
  extensions: XLSX_EXT,
  mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  detect: (bytes, name) => zipHasEntry(bytes, 'xl/workbook.xml') || hasExtension(name, XLSX_EXT),
  load: () => import('./xlsx/xlsx-adapter.js').then((m) => m.XLSX_ADAPTER),
});

/** @type {LazyAdapterEntry} */
const PPTX_ENTRY = Object.freeze({
  kind: 'pptx',
  extensions: PPTX_EXT,
  mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  detect: (bytes, name) => zipHasEntry(bytes, 'ppt/presentation.xml') || hasExtension(name, PPTX_EXT),
  load: () => import('./pptx/pptx-adapter.js').then((m) => m.PPTX_ADAPTER),
});

/** Текстовые форматы — только по имени (сигнатуры у них нет); ZIP с таким именем сюда не попадает: его раньше узнаёт OOXML. */
/** @type {LazyAdapterEntry} */
const PLAIN_ENTRY = Object.freeze({
  kind: 'plain',
  extensions: PLAIN_EXT,
  mime: 'text/plain',
  detect: (bytes, name) => hasExtension(name, PLAIN_EXT),
  load: () => import('./plain/plain-adapter.js').then((m) => m.PLAIN_ADAPTER),
});

/** Порядок = приоритет распознавания: сигнатура OOXML-пакета важнее имени. */
/** @type {readonly (import('./ooxml/adapter.js').DocumentAdapter | LazyAdapterEntry)[]} */
export const DOCUMENT_ADAPTERS = Object.freeze([DOCX_ADAPTER, XLSX_ENTRY, PPTX_ENTRY, PLAIN_ENTRY]);

/** Загруженные адаптеры форматов по требованию: kind → адаптер. */
/** @type {Map<string, import('./ooxml/adapter.js').DocumentAdapter>} */
const loaded = new Map();

/**
 * Модуль формата записывает свой адаптер при загрузке (импорт из load() или напрямую).
 * @param {import('./ooxml/adapter.js').DocumentAdapter} adapter
 */
export function registerAdapter(adapter) {
  loaded.set(adapter.kind, adapter);
}

/**
 * Адаптер по виду модели (doc.kind); модель без kind — Word (модели до 0.5). Формат по требованию, ещё не загруженный, — null.
 * @param {string | undefined} kind
 * @returns {import('./ooxml/adapter.js').DocumentAdapter | null}
 */
export function adapterForKind(kind) {
  const k = kind || 'docx';
  const a = DOCUMENT_ADAPTERS.find((x) => x.kind === k);
  if (!a) return null;
  return 'parse' in a ? a : loaded.get(k) || null;
}

/**
 * Адаптер файла: сначала по сигнатуре и содержимому, затем по имени (первый подошедший в порядке реестра).
 * Для форматов по требованию — лёгкая запись: перед разбором её загружает loadAdapter.
 * @param {Uint8Array} bytes
 * @param {string} [name]
 * @returns {import('./ooxml/adapter.js').DocumentAdapter | LazyAdapterEntry | null}  null — формат не распознан
 */
export function detectAdapter(bytes, name) {
  // два прохода: сначала только содержимое (книга Excel с именем .docx — всё равно Excel), затем имя
  return DOCUMENT_ADAPTERS.find((a) => a.detect(bytes)) || DOCUMENT_ADAPTERS.find((a) => a.detect(bytes, name)) || null;
}

/**
 * Полный адаптер по записи реестра или виду: Word — сразу, формат по требованию — после загрузки модуля.
 * Сбой загрузки не кэшируется (следующий файл попробует снова) и становится CoreError FORMAT_LOAD_FAILED у хоста.
 * @param {import('./ooxml/adapter.js').DocumentAdapter | LazyAdapterEntry | string} entryOrKind
 * @returns {Promise<import('./ooxml/adapter.js').DocumentAdapter>}
 */
export async function loadAdapter(entryOrKind) {
  const entry = typeof entryOrKind === 'string' ? DOCUMENT_ADAPTERS.find((a) => a.kind === entryOrKind) : entryOrKind;
  if (!entry) throw new Error('Неизвестный вид документа');
  if ('parse' in entry) return entry;
  const ready = loaded.get(entry.kind);
  if (ready) return ready;
  const adapter = await entry.load();
  loaded.set(entry.kind, adapter);
  return adapter;
}

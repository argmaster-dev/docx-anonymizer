// Реестр адаптеров форматов документов (DocumentAdapter, ТЗ §5.3; версия 0.5, WP12-A, docs/contracts.md §9).
// PDF (версия 0.3) — не адаптер: извлечение текста асинхронное и требует pdf.js из окружения (env.extractPdf хоста),
// результат — текстовая модель kind 'text' (core/text/). WP12-B добавляет сюда Excel и PowerPoint.
import { DOCX_ADAPTER } from './docx/adapter.js';

/** @type {readonly import('./ooxml/adapter.js').DocumentAdapter[]} */
export const DOCUMENT_ADAPTERS = Object.freeze([DOCX_ADAPTER]);

/**
 * Адаптер по виду модели (doc.kind); модель без kind — Word (модели до 0.5).
 * @param {string | undefined} kind
 * @returns {import('./ooxml/adapter.js').DocumentAdapter | null}
 */
export function adapterForKind(kind) {
  return DOCUMENT_ADAPTERS.find((a) => a.kind === (kind || 'docx')) || null;
}

/**
 * Адаптер файла: сначала по сигнатуре и содержимому, затем по имени (первый подошедший в порядке реестра).
 * @param {Uint8Array} bytes
 * @param {string} [name]
 * @returns {import('./ooxml/adapter.js').DocumentAdapter | null}  null — формат не распознан (хост пробует Word и отдаёт NOT_DOCX)
 */
export function detectAdapter(bytes, name) {
  return DOCUMENT_ADAPTERS.find((a) => a.detect(bytes, name)) || null;
}

// Адаптер Word (DocumentAdapter, ТЗ §5.3; версия 0.5, WP12-A, docs/contracts.md §9): первый адаптер общего слоя OOXML.
import { parseDocx, docxParts } from './model.js';
import { serializeDocx } from './replace.js';
import { zipHasEntry, hasExtension } from '../ooxml/adapter.js';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const EXTENSIONS = ['.docx', '.docm'];

/** @type {import('../ooxml/adapter.js').DocumentAdapter} */
export const DOCX_ADAPTER = Object.freeze({
  kind: 'docx',
  extensions: EXTENSIONS,
  mime: DOCX_MIME,
  // ZIP с word/document.xml или имя .docx/.docm (битый файл с таким именем дойдёт до parse и получит NOT_DOCX/PARSE_FAILED)
  detect: (bytes, name) => zipHasEntry(bytes, 'word/document.xml') || hasExtension(name, EXTENSIONS),
  parse: parseDocx,
  serialize: serializeDocx,
  parts: docxParts,
});

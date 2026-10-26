// Синтетические описания разметки для тестов общего слоя OOXML (WP12-A): другие имена элементов, чем у Word, — заготовка
// под адаптеры WP12-B. Не настоящие адаптеры: только то, что нужно потокам (ooxml/flow.js).
import { OBJ } from '../../../src/core/ooxml/flow.js';

/** SpreadsheetML: общая строка <si> (или inline <is>), текст <t> прямо в <si> или в ранах <r>; фонетика <rPh> — не текст. */
export const SML = Object.freeze({
  paragraph: 'si',
  paragraphs: new Set(['si', 'is']),
  run: 'r',
  text: { t: 'live' },
  textParents: new Set(['r', 'si', 'is']),
  specials: {},
  soft: new Set(),
  containers: new Set(),
  specialParents: new Set(['r']),
  deleted: new Set(),
  embeddedOpen: new Set(),
  embeddedSelf: new Set(),
  preserveSpace: true,
  specialReplacement: (escaped) => `<t xml:space="preserve">${escaped}</t>`,
});

/** DrawingML: абзац <a:p>, раны <a:r>, поля <a:fld>, разрыв строки <a:br> — МЕЖДУ ранами и со своим <a:rPr>, xml:space у <a:t> не ставится. */
export const DML = Object.freeze({
  paragraph: 'a:p',
  paragraphs: new Set(['a:p']),
  run: 'a:r',
  text: { 'a:t': 'live' },
  textParents: new Set(['a:r', 'a:fld']),
  specials: { 'a:br': '\n', 'a:tab': '\t' },
  openSpecials: true,
  soft: new Set(),
  containers: new Set(['a:pic']),
  specialParents: new Set(['a:p', 'a:r']),
  deleted: new Set(),
  embeddedOpen: new Set(['a:graphicData']),
  embeddedSelf: new Set(),
  preserveSpace: false,
  specialReplacement: (escaped) => `<a:r><a:t>${escaped}</a:t></a:r>`,
});

/** Выдуманная разметка «x:»: удалённый текст в <x:gone>, мягкий перенос <x:shy/>, контейнер <x:obj>. */
export const XML_X = Object.freeze({
  paragraph: 'x:para',
  paragraphs: new Set(['x:para']),
  run: 'x:run',
  text: { 'x:txt': 'live', 'x:old': 'deleted', 'x:code': 'field' },
  textParents: new Set(['x:run']),
  specials: { 'x:nl': '\n', 'x:ref': OBJ },
  soft: new Set(['x:shy']),
  containers: new Set(['x:obj']),
  specialParents: new Set(['x:run']),
  deleted: new Set(['x:gone']),
  embeddedOpen: new Set(['x:ole']),
  embeddedSelf: new Set(['x:chart']),
  preserveSpace: true,
  specialReplacement: (escaped) => `<x:txt xml:space="preserve">${escaped}</x:txt>`,
});

/** Части пакета для тестов: XML-строки → записи ZIP. */
export const enc = (s) => new TextEncoder().encode(s);

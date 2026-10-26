// Адаптер Excel (DocumentAdapter, ТЗ §5.3; версия 0.5, WP12-B, Ц1, К1, К3; docs/contracts.md §9.8). Модуль по требованию:
// воркер загружает его из offscreen/chunks/ при первой книге (core/adapters.js), в worker.js — только запись реестра.
// Сборка — общий сериализатор пакета (ooxml/serialize.js) и правки, которые знает только Excel (план `plan`):
//   - число-идентификатор в ячейке → строковая ячейка (inlineStr; у ячейки с формулой — кэш t="str"), стиль s сохраняется;
//   - имя листа с сущностью → безопасное имя (без [ ] : * ? / \, ≤ 31 символа), ссылки на лист в формулах, именах книги,
//     диаграммах, ссылках «#Лист!A1» и источнике сводной таблицы переименовываются согласованно;
//   - строковые литералы формул не меняются (формулы не трогаются — предупреждение);
//   - колонтитул: «&» в новом тексте удваивается (иначе Excel принял бы его за код);
//   - после правок ячеек книга пересчитывается при открытии (calcPr fullCalcOnLoad).
import { parseXlsx, xlsxParts } from './model.js';
import { renameSheets, safeSheetName, isReferenced } from './refs.js';
import { serializePackage } from '../ooxml/serialize.js';
import { zipHasEntry, hasExtension } from '../ooxml/adapter.js';
import { escapeText, escapeAttr, unescapeXml } from '../ooxml/xml.js';
import { registerAdapter } from '../adapters.js';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const EXTENSIONS = ['.xlsx', '.xlsm'];
/** Потоки, правки которых строит адаптер (а не общий сериализатор). */
const OWN_KINDS = new Set(['cell-number', 'formula-literal', 'header-footer', 'sheet-name']);
/** Встроенные объекты книги не удаляются: на них ссылаются листы (<oleObject r:id>), удаление сломало бы файл. */
const NO_EMBEDDED = /^$/;

/**
 * @param {ReturnType<typeof parseXlsx>} doc
 * @param {import('../ooxml/serialize.js').TextEdit[]} edits
 * @param {import('../ooxml/serialize.js').SerializeOptions} [options]
 */
export function serializeXlsx(doc, edits, options = {}) {
  const out = serializePackage(doc, edits, options, {
    embeddedParts: NO_EMBEDDED,
    plan: (d, byStream, push) => planXlsx(/** @type {any} */ (d), byStream, push),
  });
  // книга с макросами (.xlsm) — свой MIME
  const macro = doc.entries.some((e) => e.name === 'xl/vbaProject.bin');
  return { ...out, mime: macro ? 'application/vnd.ms-excel.sheet.macroEnabled.12' : XLSX_MIME };
}

/**
 * Правки Excel поверх общих: см. заголовок модуля. Обработанные потоки удаляются из byStream.
 * @param {ReturnType<typeof parseXlsx>} doc
 * @param {Map<string, import('../ooxml/serialize.js').TextEdit[]>} byStream
 * @param {(part: string, e: {from: number, to: number, text: string}) => void} push
 */
function planXlsx(doc, byStream, push) {
  const x = doc.xlsx;
  let cellsChanged = false;
  /** @type {Map<string, string>} */
  const renames = new Map();
  const taken = new Set(x.sheets.map((s) => s.name.toLowerCase()));
  for (const [id, list] of [...byStream]) {
    const s = /** @type {any} */ (doc.streamById.get(id));
    if (!OWN_KINDS.has(s.attrKind)) {
      if (s.part !== 'xl/workbook.xml' && !/^(?:docProps|xl\/(?:_rels|.*\/_rels))\//.test(s.part)) cellsChanged = true;
      continue;
    }
    byStream.delete(id);
    if (s.attrKind === 'formula-literal') continue; // формулы не меняются (концепция 0.5 п. 2)
    const value = applyEdits(s.text, list);
    if (s.attrKind === 'header-footer') {
      push(s.part, { from: s.valueStart, to: s.valueEnd, text: escapeText(value.replace(/&/g, '&&')) });
    } else if (s.attrKind === 'sheet-name') {
      taken.delete(s.text.toLowerCase());
      const name = safeSheetName(value, taken);
      if (name === s.text) continue;
      renames.set(s.text.toLowerCase(), name);
      push(s.part, { from: s.valueStart, to: s.valueEnd, text: escapeAttr(name) });
    } else {
      // число → строка: t="inlineStr" (с формулой — кэш t="str"), остальные атрибуты ячейки (стиль s) как были
      const c = s.cell;
      const part = /** @type {any} */ (doc.parts.get(s.part));
      const attrs = part.xml.slice(c.attrStart, c.attrEnd).replace(/\s+t\s*=\s*("[^"]*"|'[^']*')/, '');
      push(s.part, { from: c.openStart, to: c.openEnd, text: `<c${attrs} t="${c.formula ? 'str' : 'inlineStr'}">` });
      const space = /^\s|\s$/.test(value) ? ' xml:space="preserve"' : '';
      push(s.part, { from: c.v.elStart, to: c.v.elEnd, text: c.formula ? `<v>${escapeText(value)}</v>` : `<is><t${space}>${escapeText(value)}</t></is>` });
      cellsChanged = true;
    }
  }
  if (renames.size) {
    for (const site of x.sites) {
      const part = /** @type {any} */ (doc.parts.get(site.part));
      if (!part) continue;
      const raw = part.xml.slice(site.start, site.end);
      const old = unescapeXml(raw);
      let next;
      if (site.kind === 'sheet') next = renames.get(old.toLowerCase()) ?? old;
      else next = renameSheets(old, renames);
      if (next === old) continue;
      // формула — текст элемента; ссылка «#лист» и источник сводной — атрибут (в двойных кавычках апостроф не экранируется)
      const attrText = part.xml[site.start - 1] === "'" ? escapeAttr(next) : escapeText(next).replace(/"/g, '&quot;');
      push(site.part, { from: site.start, to: site.end, text: site.kind === 'formula' ? escapeText(next) : attrText });
    }
  }
  // значения ячеек изменились — Excel и LibreOffice пересчитают формулы при открытии (кэш формул от исходных значений устарел)
  if ((cellsChanged || renames.size) && x.calc) {
    const wb = /** @type {any} */ (doc.parts.get('xl/workbook.xml'));
    if (x.calc.attrEnd == null) push('xl/workbook.xml', { from: x.calc.at, to: x.calc.at, text: '<calcPr fullCalcOnLoad="1"/>' });
    else if (!/\bfullCalcOnLoad\s*=/.test(wb.xml.slice(x.calc.at, x.calc.attrEnd)))
      push('xl/workbook.xml', { from: x.calc.attrEnd, to: x.calc.attrEnd, text: ' fullCalcOnLoad="1"' });
  }
}

/** Правки значения потока (отсортированы, без пересечений). */
function applyEdits(text, list) {
  let t = text;
  for (const e of [...list].sort((a, b) => b.start - a.start)) t = t.slice(0, e.start) + e.newText + t.slice(e.end);
  return t;
}

/**
 * Предупреждения по найденному (К1, «Риски» концепции 0.5): число-идентификатор, на которое ссылаются формулы или диаграммы
 * (станет строкой — формула может дать #ЗНАЧ!), сущности в строковых литералах формул (формулы не меняются), имена листов
 * с сущностью (лист будет переименован). Значений в предупреждениях нет (NFR-14).
 * @param {ReturnType<typeof parseXlsx>} doc
 * @param {import('../contracts/entity.js').EntityGroup[]} groups
 * @returns {{code: string, count: number}[]}
 */
export function xlsxWarnings(doc, groups) {
  const referenced = new Set();
  const literals = new Set();
  const sheets = new Set();
  for (const g of groups) {
    if (!g.enabled) continue;
    const excluded = new Set(g.excludedOccurrences || []);
    for (const o of g.occurrences) {
      if (excluded.has(o.id)) continue;
      const s = /** @type {any} */ (doc.streamById.get(o.streamId));
      if (!s) continue;
      if (s.attrKind === 'cell-number' && isReferenced(doc.xlsx.refAreas, s.cell.sheet, s.cell.row, s.cell.col)) referenced.add(s.id);
      else if (s.attrKind === 'formula-literal') literals.add(s.id);
      else if (s.attrKind === 'sheet-name') sheets.add(s.id);
    }
  }
  const out = [];
  if (referenced.size) out.push({ code: 'XLSX_CELL_REFERENCED', count: referenced.size });
  if (literals.size) out.push({ code: 'XLSX_FORMULA_LITERAL', count: literals.size });
  if (sheets.size) out.push({ code: 'XLSX_SHEET_RENAMED', count: sheets.size });
  return out;
}

/** @type {import('../ooxml/adapter.js').DocumentAdapter & {analysisWarnings: typeof xlsxWarnings}} */
export const XLSX_ADAPTER = Object.freeze({
  kind: 'xlsx',
  extensions: EXTENSIONS,
  mime: XLSX_MIME,
  detect: (bytes, name) => zipHasEntry(bytes, 'xl/workbook.xml') || hasExtension(name, EXTENSIONS),
  parse: (bytes) => parseXlsx(bytes),
  serialize: serializeXlsx,
  parts: xlsxParts,
  analysisWarnings: xlsxWarnings,
});

registerAdapter(XLSX_ADAPTER);

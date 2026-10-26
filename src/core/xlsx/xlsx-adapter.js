// Адаптер Excel (DocumentAdapter, ТЗ §5.3; версия 0.5, WP12-B, Ц1, К1, К3; docs/contracts.md §9.8). Модуль по требованию:
// воркер загружает его из offscreen/chunks/ при первой книге (core/adapters.js), в worker.js — только запись реестра.
// Сборка — общий сериализатор пакета (ooxml/serialize.js) и правки, которые знает только Excel (план `plan`):
//   - число-идентификатор в ячейке → строковая ячейка (inlineStr; у ячейки с формулой — кэш t="str"), стиль s сохраняется;
//   - имя листа с сущностью → безопасное имя (без [ ] : * ? / \, ≤ 31 символа), ссылки на лист в формулах, именах книги,
//     диаграммах, ссылках «#Лист!A1» и источнике сводной таблицы переименовываются согласованно;
//   - строковые литералы формул ячеек не меняются (предупреждение); константы имён книги и списки проверки данных — заменяются;
//   - колонтитул: «&» в новом тексте удваивается (иначе Excel принял бы его за код);
//   - заголовок столбца умной таблицы — тот же текст, что в ячейке шапки (иначе Excel «восстанавливает» книгу);
//   - кэш сводной: число-идентификатор → строка, признаки типов и мин./макс. набора снимаются, кэш обновляется при открытии;
//   - путь внешней книги (file:///C:/Users/…) заменяется всегда; книга данных диаграммы — при «Удалять встроенные объекты»;
//   - после правок ячеек книга пересчитывается при открытии (calcPr fullCalcOnLoad).
import { parseXlsx, xlsxParts } from './model.js';
import { renameSheets, safeSheetName, isReferenced } from './refs.js';
import { serializePackage } from '../ooxml/serialize.js';
import { zipHasEntry, hasExtension } from '../ooxml/adapter.js';
import { escapeText, escapeAttr, unescapeXml } from '../ooxml/xml.js';
import { registerAdapter } from '../adapters.js';
import { parseChartPart } from '../ooxml/dml.js';
import { attachEmbeddedBooksWith } from '../embedded.js';
import { prepareXlsxHidden, applyXlsxHidden, REMOVED_SHEET, dropRemovedRefs } from './hidden.js';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const EXTENSIONS = ['.xlsx', '.xlsm'];
/** Потоки, правки которых строит адаптер (а не общий сериализатор). */
const OWN_KINDS = new Set([
  'cell-number',
  'formula-literal',
  'name-literal',
  'header-footer',
  'sheet-name',
  'table-column',
  'pivot-number',
  'pivot-minmax',
  'conn-string',
]);
/** Учётные данные в строке подключения ODBC/OLE DB. */
const CREDENTIALS_RE = /(\b(?:uid|user\s*id|user|username|pwd|password)\s*=)([^;]*)/gi;
/** Встроенные объекты листов (OLE) не удаляются: на них ссылаются листы (<oleObject r:id>); книги диаграмм — планом. */
const NO_EMBEDDED = /^$/;
/** Признаки типов набора значений сводной — снимаются, когда число в наборе стало строкой. */
const ITEMS_TYPE_ATTRS =
  /\s(?:containsSemiMixedTypes|containsString|containsNumber|containsInteger|containsNonDate|containsDate|containsMixedTypes|containsBlank|minValue|maxValue|minDate|maxDate)\s*=\s*("[^"]*"|'[^']*')/g;

/**
 * @param {ReturnType<typeof parseXlsx>} doc
 * @param {import('../ooxml/serialize.js').TextEdit[]} edits
 * @param {import('../ooxml/serialize.js').SerializeOptions} [options]
 */
export function serializeXlsx(doc, edits, options = {}) {
  const out = serializePackage(doc, edits, options, {
    embeddedParts: NO_EMBEDDED,
    plan: (d, byStream, push, ctx) => planXlsx(/** @type {any} */ (d), byStream, push, ctx),
  });
  // книга с макросами (.xlsm) — свой MIME
  const macro = doc.entries.some((e) => /(?:^|\/)vbaProject\.bin$/.test(e.name));
  return { ...out, mime: macro ? 'application/vnd.ms-excel.sheet.macroEnabled.12' : XLSX_MIME };
}

/**
 * Правки Excel поверх общих: см. заголовок модуля. Обработанные потоки удаляются из byStream.
 * @param {ReturnType<typeof parseXlsx> & {chartEmbeds?: any[]}} doc
 * @param {Map<string, import('../ooxml/serialize.js').TextEdit[]>} byStream
 * @param {(part: string, e: {from: number, to: number, text: string}) => void} push
 * @param {import('../ooxml/serialize.js').PlanContext} ctx
 */
function planXlsx(doc, byStream, push, ctx) {
  const x = doc.xlsx;
  const wbName = x.workbook;
  const xmlOf = (p) => /** @type {any} */ (doc.parts.get(p)).xml;
  let cellsChanged = false;

  // заголовки умных таблиц и ячейки шапки — одинаковые: правка одного становится правкой другого
  for (const tc of x.tableColumns) {
    if (!tc.headerStream) continue;
    const col = /** @type {any} */ (doc.streamById.get(tc.columnStream));
    const head = /** @type {any} */ (doc.streamById.get(tc.headerStream));
    if (!col || !head || col.text !== head.text) continue;
    if (byStream.has(tc.columnStream) && !byStream.has(tc.headerStream)) byStream.set(tc.headerStream, byStream.get(tc.columnStream));
    else if (byStream.has(tc.headerStream)) byStream.set(tc.columnStream, /** @type {any} */ (byStream.get(tc.headerStream)));
  }

  // кэш сводной — копия ячеек: число, заменённое на листе, заменяется и в кэше той же меткой (даже если в кэше его не нашли)
  const key = (t) => t.replace(/\D/g, '').replace(/^0+/, '');
  /** @type {Map<string, string>} */
  const replacedNumbers = new Map();
  for (const [id, list] of byStream) {
    const s = /** @type {any} */ (doc.streamById.get(id));
    if (s?.attrKind === 'cell-number' && list.length) replacedNumbers.set(key(s.text), applyEdits(s.text, list));
  }
  for (const s of /** @type {any[]} */ (doc.streams)) {
    if ((s.attrKind !== 'pivot-number' && s.attrKind !== 'pivot-minmax') || byStream.has(s.id) || /^e\d+\//.test(s.id)) continue;
    const v = replacedNumbers.get(key(s.text));
    if (v !== undefined) byStream.set(s.id, [{ streamId: s.id, start: 0, end: s.text.length, newText: v }]);
  }

  /** @type {Map<string, string>} */
  const renames = new Map();
  const taken = new Set(x.sheets.map((s) => s.name.toLowerCase()));
  /** константы с правкой: для пропуска переименования в той же формуле */
  const literalEdits = [];
  /** наборы значений сводной, где число стало строкой или мин./макс. выдал данные */
  const itemsToReset = new Set();
  const pivotsChanged = new Set();
  /** @type {Map<string, any[]>} */
  const connEdits = new Map();
  for (const [id, list] of [...byStream]) {
    if (doc.streamById.get(id)?.attrKind === 'conn-string') connEdits.set(id, list);
    const s = /** @type {any} */ (doc.streamById.get(id));
    if (!OWN_KINDS.has(s.attrKind)) {
      if (s.part !== wbName && !/^(?:docProps|xl\/(?:_rels|.*\/_rels))\//.test(s.part)) cellsChanged = true;
      continue;
    }
    byStream.delete(id);
    if (s.attrKind === 'formula-literal' || s.attrKind === 'conn-string') continue; // формулы ячеек не меняются; строка подключения — ниже
    const value = applyEdits(s.text, list);
    if (s.attrKind === 'header-footer') {
      push(s.part, { from: s.valueStart, to: s.valueEnd, text: escapeText(value.replace(/&/g, '&&')) });
    } else if (s.attrKind === 'name-literal') {
      push(s.part, { from: s.valueStart, to: s.valueEnd, text: escapeText(value.replace(/"/g, '""')) });
      literalEdits.push(s);
    } else if (s.attrKind === 'table-column') {
      push(s.part, { from: s.valueStart, to: s.valueEnd, text: escapeAttr(value) });
    } else if (s.attrKind === 'sheet-name') {
      taken.delete(s.text.toLowerCase());
      const name = safeSheetName(value, taken);
      if (name === s.text) continue;
      renames.set(s.text.toLowerCase(), name);
      push(s.part, { from: s.valueStart, to: s.valueEnd, text: escapeAttr(name) });
    } else if (s.attrKind === 'pivot-number') {
      // <n v="7707083893"/> → <s v="[ИНН_1]"/> (прочие атрибуты элемента — как были)
      const el = s.el;
      const attrs = xmlOf(s.part)
        .slice(el.attrStart, el.attrEnd)
        .replace(/\sv\s*=\s*("[^"]*"|'[^']*')/, '');
      push(s.part, { from: el.start, to: el.end, text: `<s v="${escapeAttr(value)}"${attrs.trimEnd()}/>` });
      const items = x.pivotItems.get(s.id);
      if (items) itemsToReset.add(items);
      pivotsChanged.add(s.part);
    } else if (s.attrKind === 'pivot-minmax') {
      const items = x.pivotItems.get(s.id);
      if (items) itemsToReset.add(items);
      pivotsChanged.add(s.part);
    } else {
      // число → строка: t="inlineStr" (с формулой и во внешней книге — кэш t="str"), остальные атрибуты (стиль s) как были
      const c = s.cell;
      const attrs = xmlOf(s.part)
        .slice(c.attrStart, c.attrEnd)
        .replace(/\s+t\s*=\s*("[^"]*"|'[^']*')/, '')
        .replace(/\s*\/$/, '');
      const str = c.formula || c.tag === 'cell';
      push(s.part, { from: c.openStart, to: c.openEnd, text: `<${c.tag || 'c'}${attrs} t="${str ? 'str' : 'inlineStr'}">` });
      const space = /^\s|\s$/.test(value) ? ' xml:space="preserve"' : '';
      push(s.part, { from: c.v.elStart, to: c.v.elEnd, text: str ? `<v>${escapeText(value)}</v>` : `<is><t${space}>${escapeText(value)}</t></is>` });
      cellsChanged = true;
    }
  }
  // набор значений сводной: признаки типов и мин./макс. (сами — данные) снимаются; кэш обновится при открытии
  for (const it of itemsToReset) {
    const xml = xmlOf(it.part);
    const tag = xml.slice(it.tagStart, it.tagEnd);
    const attrs = xml.slice(it.attrStart, it.attrEnd).replace(ITEMS_TYPE_ATTRS, '');
    const self = /\/>$/.test(tag);
    push(it.part, { from: it.tagStart, to: it.tagEnd, text: `<sharedItems${attrs.replace(/\s*\/$/, '')}${self ? '/>' : '>'}` });
  }
  for (const p of pivotsChanged) {
    const root = x.pivotRoots.get(p);
    if (root && !/\brefreshOnLoad\s*=/.test(xmlOf(p).slice(0, root.at))) push(p, { from: root.at, to: root.at, text: ' refreshOnLoad="1"' });
  }
  // скрытые листы, которые удаляются по выбору пользователя (WP12-D): ссылки на них в формулах, именах, диаграммах → #REF!
  const hidden = ctx.hidden ? prepareXlsxHidden(doc, ctx.hidden) : null;
  const siteRenames = new Map(renames);
  for (const s of hidden?.removed || []) siteRenames.set(s.name.toLowerCase(), REMOVED_SHEET);
  if (siteRenames.size) {
    for (const site of x.sites) {
      const part = /** @type {any} */ (doc.parts.get(site.part));
      if (!part) continue;
      // в формуле уже заменена константа — переименование в ней пропускается (правки не должны пересекаться)
      if (literalEdits.some((s) => s.part === site.part && s.valueStart >= site.start && s.valueEnd <= site.end)) continue;
      const raw = part.xml.slice(site.start, site.end);
      const old = unescapeXml(raw);
      let next;
      // источник сводной на удалённом листе остаётся как был (сводная обновится с ошибкой, файл открывается)
      if (site.kind === 'sheet') next = siteRenames.get(old.toLowerCase()) ?? old;
      else next = dropRemovedRefs(renameSheets(old, siteRenames));
      if (next === REMOVED_SHEET) next = old;
      if (next === old) continue;
      // формула — текст элемента; ссылка «#лист» и источник сводной — атрибут (в двойных кавычках апостроф не экранируется)
      const attrText = part.xml[site.start - 1] === "'" ? escapeAttr(next) : escapeText(next).replace(/"/g, '&quot;');
      push(site.part, { from: site.start, to: site.end, text: site.kind === 'formula' ? escapeText(next) : attrText });
    }
  }
  // строка подключения: найденное — метками, логин и пароль — всегда «***» (обновление данных потребует ввести их заново)
  for (const s of doc.streams) {
    if (s.attrKind !== 'conn-string' || /^e\d+\//.test(s.id)) continue; // потоки встроенных книг собирает их сериализатор
    const value = applyEdits(s.text, connEdits.get(s.id) || []).replace(CREDENTIALS_RE, '$1***');
    if (value !== s.text) push(s.part, { from: /** @type {number} */ (s.valueStart), to: /** @type {number} */ (s.valueEnd), text: escapeAttr(value) });
  }
  // скрытые данные по выбору пользователя (WP12-D): листы, строки и столбцы, примечания и цепочки комментариев
  if (hidden && applyXlsxHidden(doc, hidden, ctx, push)) cellsChanged = true;
  // «Удалять встроенные объекты»: книга данных диаграммы и ссылка на неё (диаграмма остаётся с кэшем значений)
  if (ctx.options.stripEmbedded) {
    for (const e of doc.chartEmbeds || []) {
      ctx.remove(e.embed);
      push(e.chart, { from: e.start, to: e.end, text: '' });
    }
  }
  // значения ячеек изменились — Excel и LibreOffice пересчитают формулы при открытии (кэш формул от исходных значений устарел)
  if ((cellsChanged || renames.size) && x.calc) {
    const wb = /** @type {any} */ (doc.parts.get(wbName));
    if (x.calc.attrEnd == null) push(wbName, { from: x.calc.at, to: x.calc.at, text: '<calcPr fullCalcOnLoad="1"/>' });
    else if (!/\bfullCalcOnLoad\s*=/.test(wb.xml.slice(x.calc.at, x.calc.attrEnd)))
      push(wbName, { from: x.calc.attrEnd, to: x.calc.attrEnd, text: ' fullCalcOnLoad="1"' });
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
 * (станет строкой — формула может дать #ЗНАЧ!), сущности в строковых литералах формул (формулы ячеек не меняются; константы
 * имён и списки проверки — заменены), имена листов с сущностью (лист будет переименован); всегда — внешние книги (путь заменён)
 * и подключения к данным (строка подключения может содержать логин и пароль). Значений в предупреждениях нет (NFR-14).
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
      if (s.attrKind === 'cell-number' && s.cell.tag !== 'cell' && isReferenced(doc.xlsx.refAreas, s.cell.sheet, s.cell.row, s.cell.col)) referenced.add(s.id);
      else if (s.attrKind === 'formula-literal' || s.attrKind === 'name-literal') literals.add(s.id);
      else if (s.attrKind === 'sheet-name') sheets.add(s.id);
    }
  }
  const out = [];
  if (referenced.size) out.push({ code: 'XLSX_CELL_REFERENCED', count: referenced.size });
  if (literals.size) out.push({ code: 'XLSX_FORMULA_LITERAL', count: literals.size });
  if (sheets.size) out.push({ code: 'XLSX_SHEET_RENAMED', count: sheets.size });
  if (doc.xlsx.externalPaths.length) out.push({ code: 'XLSX_EXTERNAL_LINKS', count: doc.xlsx.externalPaths.length });
  if (doc.xlsx.connections) out.push({ code: 'XLSX_CONNECTIONS', count: doc.xlsx.connections });
  return out;
}

/** @type {import('../ooxml/adapter.js').DocumentAdapter & {analysisWarnings: typeof xlsxWarnings}} */
export const XLSX_ADAPTER = Object.freeze({
  kind: 'xlsx',
  extensions: EXTENSIONS,
  mime: XLSX_MIME,
  detect: (bytes, name) => zipHasEntry(bytes, 'xl/workbook.xml') || hasExtension(name, EXTENSIONS),
  // встроенные книги (данные диаграмм, OLE-книги) — тем же адаптером, в той же модели (core/embedded.js)
  parse: (bytes) => {
    const doc = parseXlsx(bytes);
    attachEmbeddedBooksWith(doc, XLSX_ADAPTER);
    return doc;
  },
  serialize: serializeXlsx,
  parts: xlsxParts,
  analysisWarnings: xlsxWarnings,
  // разбор части диаграммы — для диаграмм Word (core/embedded.js attachDocxCharts)
  parseChartPart,
});

registerAdapter(XLSX_ADAPTER);

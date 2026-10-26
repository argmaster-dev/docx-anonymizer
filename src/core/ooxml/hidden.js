// Скрытые данные пакета OOXML (версия 0.5, WP12-D, Ц4, К7; docs/concept-0.5.md п. 6, docs/contracts.md §9.9): общее для Word,
// Excel и PowerPoint — счётчики и выбор пользователя, удаление диапазонов XML с приоритетом над правками сущностей,
// «осиротевшие» части пакета. Что именно скрыто, знает адаптер формата: Word — docx/hidden.js (комментарии, история правок,
// скрытый текст), Excel — xlsx/hidden.js (скрытые листы, строки и столбцы, примечания и цепочки комментариев), PowerPoint —
// pptx/hidden.js (скрытые слайды, комментарии). По умолчанию ничего не удаляется: документ меняется только по явному выбору
// (FR-12, FR-15 — тот же принцип «чистка по настройке»); найденное в скрытом маскируется в любом случае, как в 0.4.
// Значений документа здесь нет — только счётчики и смещения (NFR-14).
import { CoreError } from '../errors.js';

/**
 * Что скрыто в документе (`doc.hidden`, сообщение ENTITIES). Ключи — только у своего формата.
 * @typedef {object} HiddenCounts
 * @property {number} [comments]      комментарии (Word, PowerPoint), примечания и цепочки комментариев (Excel)
 * @property {number} [revisions]     элементы истории правок Word (вставки, удаления, перемещения, изменения свойств)
 * @property {number} [hiddenText]    раны скрытого текста Word (w:vanish в свойствах рана или стиле, w:specVanish)
 * @property {number} [hiddenSheets]  скрытые листы Excel (state="hidden|veryHidden")
 * @property {number} [hiddenRows]    скрытые строки Excel
 * @property {number} [hiddenCols]    скрытые столбцы Excel
 * @property {number} [hiddenSlides]  скрытые слайды PowerPoint (show="0")
 */

/**
 * Что удалить из результата (выбор пользователя; по умолчанию всё выключено).
 * @typedef {object} HiddenFlags
 * @property {boolean} [comments]      удалить комментарии (все форматы)
 * @property {boolean} [revisions]     принять исправления (Word)
 * @property {boolean} [hiddenText]    удалить скрытый текст (Word)
 * @property {boolean} [hiddenSheets]  удалить скрытые листы, строки и столбцы (Excel)
 * @property {boolean} [hiddenSlides]  удалить скрытые слайды (PowerPoint)
 */

/** Флаг → ключ настроек (core/settings.js): выбор запоминается. */
export const HIDDEN_SETTINGS = Object.freeze({
  comments: 'removeComments',
  revisions: 'acceptRevisions',
  hiddenText: 'removeHiddenText',
  hiddenSheets: 'removeHiddenSheets',
  hiddenSlides: 'removeHiddenSlides',
});

/**
 * Выбор из настроек.
 * @param {Record<string, any>} settings
 * @returns {HiddenFlags}
 */
export function hiddenFlagsFrom(settings) {
  return Object.fromEntries(Object.entries(HIDDEN_SETTINGS).map(([flag, key]) => [flag, settings?.[key] === true]));
}

/** Включён ли хоть один переключатель. @param {HiddenFlags | null | undefined} flags */
export function anyHidden(flags) {
  return !!flags && Object.keys(HIDDEN_SETTINGS).some((k) => flags[k] === true);
}

/** Связи части: 'xl/worksheets/sheet2.xml' → 'xl/worksheets/_rels/sheet2.xml.rels'. */
export function relsPartOf(name) {
  const i = name.lastIndexOf('/');
  return `${name.slice(0, i + 1)}_rels/${name.slice(i + 1)}.rels`;
}

/**
 * Правки части, среди которых есть удаления (`strip: true`): удаление важнее правок сущностей внутри него (текст в удалённом
 * комментарии, авторе исправления, скрытом ране не нужно заменять — его не будет). Вложенные удаления — внешнее; частично
 * пересекающиеся удаления без замены — объединение (абзац с удалённым знаком абзаца и следующий скрытый абзац). Правка, которая
 * пересекает удаление или вставка внутри него, отбрасывается.
 * @param {{from: number, to: number, text: string, strip?: boolean}[]} list
 * @returns {{from: number, to: number, text: string}[]}
 */
export function resolveStrips(list) {
  const strips = list.filter((e) => e.strip && e.to > e.from).sort((a, b) => a.from - b.from || b.to - a.to);
  /** @type {{from: number, to: number, text: string}[]} */
  const merged = [];
  for (const s of strips) {
    const last = merged[merged.length - 1];
    if (last && s.from < last.to) {
      if (s.to <= last.to) continue;
      if (last.text || s.text) throw new CoreError('INTERNAL', 'Пересекающиеся удаления скрытых данных');
      last.to = s.to;
      continue;
    }
    merged.push({ from: s.from, to: s.to, text: s.text || '' });
  }
  // первое удаление, которое кончается правее начала правки (удаления отсортированы и не пересекаются — концы тоже по порядку):
  // правка-диапазон пересекает его, если оно начинается до её конца; вставка — если лежит строго внутри
  const hit = (e) => {
    let lo = 0;
    let hi = merged.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (merged[mid].to > e.from) hi = mid;
      else lo = mid + 1;
    }
    const m = merged[lo];
    if (!m) return false;
    return e.from === e.to ? m.from < e.from : m.from < e.to;
  };
  return [...list.filter((e) => !e.strip && !hit(e)), ...merged];
}

/**
 * Части, на которые ссылаются только удалённые части (заметки скрытого слайда, рисунки и примечания скрытого листа, их
 * диаграммы и картинки): добавляются к удаляемым вместе со своими связями, транзитивно. Часть без входящих связей (типы
 * содержимого, связи пакета) и часть, на которую ссылается корень пакета или живая часть, остаются.
 * @param {{source: string, target: string, external: boolean}[]} relations  все связи пакета (ooxml/dml.js readRelations().all)
 * @param {Set<string>} removed   удаляемые части (дополняется)
 * @param {Set<string>} names     имена записей пакета
 * @returns {string[]}  добавленные части (без файлов связей)
 */
export function collectOrphans(relations, removed, names) {
  /** @type {Map<string, Set<string>>} */
  const incoming = new Map();
  for (const r of relations) {
    if (r.external || !names.has(r.target)) continue;
    if (!incoming.has(r.target)) incoming.set(r.target, new Set());
    /** @type {Set<string>} */ (incoming.get(r.target)).add(r.source);
  }
  const added = [];
  for (let changed = true; changed;) {
    changed = false;
    for (const [target, sources] of incoming) {
      if (removed.has(target)) continue;
      if ([...sources].every((s) => s !== '' && s !== target && removed.has(s))) {
        removed.add(target);
        added.push(target);
        changed = true;
      }
    }
  }
  return added;
}

/**
 * Значение логического свойства OOXML (`<w:vanish/>`, `<w:vanish w:val="0"/>`): без атрибута — включено.
 * @param {string | undefined | null} raw
 */
export function onOff(raw) {
  return raw == null || !/^(?:0|false|off)$/i.test(raw);
}

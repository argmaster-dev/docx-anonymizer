// Текстовые потоки OOXML по описанию разметки (ТЗ §6.1–6.3; общий слой с 0.5, WP12-A, docs/contracts.md §9):
// разбор части в параграфы → потоки (virtualText) → charMap (сегмент и смещение каждого символа) и обратная замена через раны
// с сохранением форматирования. Имена элементов не зашиты: Word (w:p/w:r/w:t) — src/core/docx/model.js `WORDML`;
// SpreadsheetML (<si>/<r>/<t>) и DrawingML (<a:p>/<a:r>/<a:t>) подключаются своим описанием (WP12-B).
import { tokenize, unescapeXml, escapeText, escapeAttr } from './xml.js';
import { CoreError } from '../errors.js';

/** Символ встроенного объекта в virtualText (сущность его не пересекает, §1.2). */
export const OBJ = '￼';

/**
 * Описание разметки текстовых потоков.
 * @typedef {object} FlowMarkup
 * @property {string} paragraph                  элемент параграфа: 'w:p' (Word), 'a:p' (DrawingML), 'si'/'is' (SpreadsheetML)
 * @property {Set<string>} paragraphs            все элементы-параграфы (обычно { paragraph }; SpreadsheetML — { 'si', 'is' })
 * @property {string} run                        элемент рана: 'w:r', 'a:r', 'r' — граница «встроенного объекта» (FR-15)
 * @property {Record<string, 'live'|'deleted'|'field'>} text  элементы текста → тип потока (Word: w:t → live, w:delText → deleted, w:instrText → field)
 * @property {Set<string>} textParents           родители, внутри которых элемент текста — текст (Word: w:r; SpreadsheetML: r, si, is — но не rPh)
 * @property {Record<string, string>} specials   спецэлементы → символ virtualText (w:tab → \t, w:br → \n, …); по умолчанию — только самозакрывающиеся
 * @property {boolean} [openSpecials]            спецэлемент может иметь содержимое (DrawingML: <a:br><a:rPr/></a:br>) — сегмент до закрывающего тега
 * @property {Set<string>} soft                  спецэлементы нулевой длины (w:softHyphen): удаляются, если попали в правку
 * @property {Set<string>} containers            контейнеры (рисунок, объект) → U+FFFC; правка через них запрещена
 * @property {Set<string>} specialParents        родители спецэлементов (Word: w:r; DrawingML: a:p — a:br стоит между ранами)
 * @property {Set<string>} deleted               обёртки удалённого текста (w:del, w:moveFrom): спецэлементы внутри — в поток 'deleted'
 * @property {Set<string>} embeddedOpen          открывающие теги, делающие ран «встроенным объектом» (w:object, c:chart)
 * @property {Set<string>} embeddedSelf          то же для самозакрывающихся (c:chart)
 * @property {boolean} preserveSpace             ставить xml:space="preserve", если у нового текста пробел по краям (Word, SpreadsheetML; не DrawingML)
 * @property {(escaped: string) => string} specialReplacement  разметка текста на месте диапазона из одних спецэлементов (Word: <w:t xml:space="preserve">…</w:t>)
 */

/**
 * Обработчики разбора, специфичные для формата (атрибуты-авторы, вид абзаца по свойствам и т.п.).
 * Вызываются для каждого открывающего и самозакрывающегося тега ДО разметки потоков.
 * @typedef {object} FlowHooks
 * @property {(t: import('./xml.js').Token, parent: string|undefined, para: import('./model.js').Paragraph|undefined, part: import('./model.js').Part) => void} [onElement]
 */

/**
 * Разбирает текстовую часть по описанию разметки: параграфы (с вложенностью), потоки live/deleted/field с сегментами и charMap,
 * раны со встроенными объектами. Атрибутные потоки добавляет `hooks.onElement`.
 * @param {string} name
 * @param {string} xml
 * @param {import('./model.js').ParseContext} ctx
 * @param {FlowMarkup} markup
 * @param {FlowHooks} [hooks]
 * @returns {import('./model.js').Part}
 */
export function parseFlowPart(name, xml, ctx, markup, hooks = {}) {
  /** @type {import('./model.js').Part} */
  const part = { name, kind: 'text', xml, streams: [], embeddedRuns: [], markup };
  const M = markup;
  /** стек имён элементов */
  const stack = [];
  /** стек открытых параграфов */
  const pStack = [];
  /** стек открытых ранов: {start, embedded} */
  const rStack = [];
  let delDepth = 0;
  /** открытый текстовый элемент */
  let openText = null;
  /** открытые контейнеры и спецэлементы с содержимым: depth → segment (elEnd — по закрывающему тегу) */
  const openContainers = [];

  const newParagraph = (pos) => {
    const pid = `p${ctx.pidCounter++}`;
    const para = { pid, part: name, depth: pStack.length, pos, streams: {}, kind: 'p', _builders: {} };
    ctx.paragraphs.push(para);
    pStack.push(para);
  };
  const builder = (para, type) => {
    let b = para._builders[type];
    if (!b) {
      b = { segments: [], len: 0 };
      para._builders[type] = b;
    }
    return b;
  };
  const addSeg = (type, seg) => {
    const para = pStack[pStack.length - 1];
    if (!para) return;
    const b = builder(para, type);
    seg.vStart = b.len;
    seg.vEnd = b.len + seg.text.length;
    b.len = seg.vEnd;
    b.segments.push(seg);
  };
  const specialStreamType = () => (delDepth > 0 ? 'deleted' : 'live');

  tokenize(xml, (t) => {
    const parent = stack[stack.length - 1];
    if (t.type === 'open' || t.type === 'selfclose') {
      const nm = t.name;
      if (hooks.onElement) hooks.onElement(t, parent, pStack[pStack.length - 1], part);

      if (t.type === 'open') {
        if (M.paragraphs.has(nm)) newParagraph(t.start);
        else if (nm === M.run) rStack.push({ start: t.start, embedded: false });
        else if (M.deleted.has(nm)) delDepth++;
        else if (nm in M.text && M.textParents.has(parent)) {
          openText = { type: M.text[nm], elStart: t.start, openEnd: t.end, elName: nm };
        } else if (M.containers.has(nm) && M.specialParents.has(parent)) {
          const seg = { kind: 'special', text: OBJ, elStart: t.start, elEnd: -1, elName: nm, container: true, vStart: 0, vEnd: 0 };
          addSeg(specialStreamType(), seg);
          openContainers.push({ depth: stack.length, seg });
        } else if (M.openSpecials && nm in M.specials && M.specialParents.has(parent)) {
          // спецэлемент с содержимым: конец сегмента — закрывающий тег (как у контейнера), но удалять его можно
          const seg = { kind: 'special', text: M.specials[nm], elStart: t.start, elEnd: -1, elName: nm, vStart: 0, vEnd: 0 };
          addSeg(specialStreamType(), seg);
          openContainers.push({ depth: stack.length, seg });
        }
        if (M.embeddedOpen.has(nm) && rStack.length) rStack[0].embedded = true;
        stack.push(nm);
      } else {
        // selfclose
        if (M.embeddedSelf.has(nm) && rStack.length) rStack[0].embedded = true;
        if (M.specialParents.has(parent)) {
          if (nm in M.specials) {
            addSeg(specialStreamType(), { kind: 'special', text: M.specials[nm], elStart: t.start, elEnd: t.end, elName: nm, vStart: 0, vEnd: 0 });
          } else if (M.soft.has(nm)) {
            addSeg(specialStreamType(), { kind: 'soft', text: '', elStart: t.start, elEnd: t.end, elName: nm, vStart: 0, vEnd: 0 });
          } else if (M.containers.has(nm)) {
            addSeg(specialStreamType(), { kind: 'special', text: OBJ, elStart: t.start, elEnd: t.end, elName: nm, container: true, vStart: 0, vEnd: 0 });
          }
        }
      }
    } else if (t.type === 'close') {
      const nm = t.name;
      stack.pop();
      if (openText && nm === openText.elName) {
        const raw = xml.slice(openText.openEnd, t.start);
        addSeg(openText.type, {
          kind: 'text',
          text: unescapeXml(raw),
          elStart: openText.elStart,
          elEnd: t.end,
          openEnd: openText.openEnd,
          contentStart: openText.openEnd,
          contentEnd: t.start,
          elName: nm,
          vStart: 0,
          vEnd: 0,
        });
        openText = null;
      } else if (M.paragraphs.has(nm)) {
        finishParagraph(/** @type {any} */ (pStack.pop()));
      } else if (nm === M.run) {
        const r = rStack.pop();
        if (r && r.embedded && rStack.length === 0) part.embeddedRuns.push({ start: r.start, end: t.end });
        else if (r && r.embedded && rStack.length) rStack[0].embedded = true;
      } else if (M.deleted.has(nm)) delDepth--;
      const oc = openContainers[openContainers.length - 1];
      if (oc && oc.depth === stack.length) {
        oc.seg.elEnd = t.end;
        openContainers.pop();
      }
    }
  });
  while (pStack.length) finishParagraph(pStack.pop());
  return part;

  function finishParagraph(para) {
    for (const type of ['live', 'deleted', 'field']) {
      const b = para._builders[type];
      if (!b || !b.segments.length) continue;
      const text = b.segments.map((s) => s.text).join('');
      if (!text.length) continue;
      const { segIndex, segOffset } = buildCharMap(b.segments, text.length);
      /** @type {import('./model.js').Stream} */
      const stream = { id: `${para.pid}:${type}`, part: name, pid: para.pid, type, text, pos: para.pos, order: 0, segments: b.segments, segIndex, segOffset };
      part.streams.push(stream);
      para.streams[type] = stream.id;
    }
    delete para._builders;
  }
}

/**
 * charMap потока: для каждого символа virtualText — индекс сегмента и смещение в его тексте.
 * @param {import('./model.js').Segment[]} segments  с заполненными vStart/vEnd
 * @param {number} length  длина virtualText
 */
export function buildCharMap(segments, length) {
  const segIndex = new Uint32Array(length);
  const segOffset = new Uint32Array(length);
  segments.forEach((s, i) => {
    for (let k = s.vStart; k < s.vEnd; k++) {
      segIndex[k] = i;
      segOffset[k] = k - s.vStart;
    }
  });
  return { segIndex, segOffset };
}

/**
 * Правки в потоке из ранов (§6.3 п.2–4): новый текст встаёт в первый затронутый сегмент текста, остальные затронутые части
 * текста удаляются, спецэлементы внутри диапазона удаляются (контейнер — ошибка), диапазон из одних спецэлементов заменяется
 * `markup.specialReplacement`. Форматирование ранов сохраняется: меняется только содержимое элементов текста.
 * @param {string} xml  исходный XML части
 * @param {import('./model.js').Stream} s
 * @param {{start: number, end: number, newText: string}[]} list  отсортированы, без пересечений
 * @param {FlowMarkup} markup
 * @param {(e: {from: number, to: number, text: string}) => void} push
 */
export function planRunEdits(xml, s, list, markup, push) {
  const segs = /** @type {import('./model.js').Segment[]} */ (s.segments);
  const segIndex = /** @type {Uint32Array} */ (s.segIndex);
  /** @type {Map<number, {from: number, to: number, insert: string}[]>} */
  const ops = new Map();
  const removeSeg = new Set();
  /** вставки на месте удаляемого спецэлемента, если в диапазоне нет текста */
  const replaceSeg = new Map();

  for (const e of list) {
    if (e.start === e.end) continue; // вставки без диапазона не поддерживаются
    const first = segIndex[e.start];
    const last = segIndex[e.end - 1];
    let inserted = false;
    for (let i = first; i <= last; i++) {
      const seg = segs[i];
      if (seg.kind === 'text') {
        const from = Math.max(e.start, seg.vStart) - seg.vStart;
        const to = Math.min(e.end, seg.vEnd) - seg.vStart;
        if (to < from) continue;
        let arr = ops.get(i);
        if (!arr) ops.set(i, (arr = []));
        arr.push({ from, to, insert: inserted ? '' : e.newText });
        inserted = true;
      } else {
        if (seg.container) throw new CoreError('INTERNAL', 'Правка пересекает встроенный объект');
        removeSeg.add(i);
      }
    }
    if (!inserted) {
      // Диапазон состоит только из спецэлементов: первый заменяем элементом текста с новым текстом
      replaceSeg.set(first, e.newText);
    }
  }

  for (const [i, arr] of ops) {
    const seg = segs[i];
    arr.sort((a, b) => b.from - a.from);
    let t = seg.text;
    for (const o of arr) t = t.slice(0, o.from) + o.insert + t.slice(o.to);
    let open = xml.slice(seg.elStart, seg.openEnd);
    const needPreserve = markup.preserveSpace && (t === '' || /^\s|\s$/.test(t));
    if (needPreserve && !/\sxml:space\s*=/.test(open)) open = open.slice(0, -1) + ' xml:space="preserve">';
    const close = `</${seg.elName}>`;
    push({ from: seg.elStart, to: seg.elEnd, text: open + escapeText(t) + close });
  }
  for (const i of removeSeg) {
    const seg = segs[i];
    const repl = replaceSeg.get(i);
    push({ from: seg.elStart, to: seg.elEnd, text: repl === undefined ? '' : markup.specialReplacement(escapeText(repl)) });
  }
}

/**
 * Правки атрибутов и метаданных: значение пересобирается целиком (§6.3 п.6); `meta` — текст элемента, `attr` — значение атрибута.
 * @param {import('./model.js').Stream} s
 * @param {{start: number, end: number, newText: string}[]} list
 * @param {(e: {from: number, to: number, text: string}) => void} push
 */
export function planValueEdits(s, list, push) {
  let t = s.text;
  for (const e of [...list].sort((a, b) => b.start - a.start)) t = t.slice(0, e.start) + e.newText + t.slice(e.end);
  const text = s.type === 'meta' ? escapeText(t) : escapeAttr(t);
  push({ from: /** @type {number} */ (s.valueStart), to: /** @type {number} */ (s.valueEnd), text });
}

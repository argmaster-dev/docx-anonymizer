// Скрытые данные Word (версия 0.5, WP12-D, Ц4, К7; docs/concept-0.5.md п. 6, docs/contracts.md §9.9): комментарии (части
// word/comments*.xml, якоря w:commentRangeStart/End и ссылки w:commentReference), история правок (w:ins, w:del, w:moveFrom,
// w:moveTo, w:rPrChange/w:pPrChange и прочие *Change, правки ячеек и строк таблиц), скрытый текст (w:vanish в свойствах рана
// или в стиле рана/абзаца, w:specVanish). При разборе — только счётчики (doc.hidden); при сборке — по выбору пользователя:
//   «Удалить комментарии» — части комментариев (и people.xml, если исправлений не остаётся), их связи и типы содержимого,
//     якоря и ссылки в тексте (ран из одной ссылки — целиком);
//   «Принять исправления» — w:ins/w:moveTo разворачиваются в обычный текст, w:del/w:moveFrom с содержимым удаляются, *Change —
//     удаляются (остаются текущие свойства), удалённый знак абзаца склеивает абзац со следующим, удалённая строка таблицы —
//     удаляется (все строки — вся таблица), метки вставки и удаления в свойствах — удаляются;
//   «Удалить скрытый текст» — раны со скрытым текстом; абзац, у которого скрыт и знак абзаца, и весь текст, — целиком (кроме
//     последнего абзаца ячейки, колонтитула, сноски и т.п. — без него файл не открылся бы).
// Найденное в скрытом маскируется в любом случае (общие потоки, как в 0.4). Значений документа здесь нет (NFR-14).
import { tokenize, getAttr } from '../ooxml/xml.js';
import { inflateEntry } from '../ooxml/zip.js';
import { onOff } from '../ooxml/hidden.js';

/** Части комментариев Word: сами комментарии, их расширения (решён/ответ), идентификаторы и даты. */
export const COMMENT_PART_RE = /^word\/comments(?:Extended|Ids|Extensible)?\.xml$/;
const PEOPLE = 'word/people.xml';
const STYLES = 'word/styles.xml';
/** Есть ли в части что-то скрытое (быстрая проверка перед полным обходом; без совпадения — ни счёта, ни правок). */
const QUICK_RE =
  /<w:(?:ins|del|moveFrom|moveTo|moveFromRange\w*|moveToRange\w*|cellIns|cellDel|cellMerge|vanish|specVanish|commentRangeStart|commentRangeEnd|commentReference)[\s/>]|<w:\w+Change[\s/>]/;
/** Свойства, в которых w:ins/w:del — метка (вставлен/удалён знак абзаца, строка, нумерация), а не обёртка текста. */
const PROPS = new Set(['w:rPr', 'w:trPr', 'w:tcPr', 'w:numPr', 'w:pPr']);
/** Метки диапазонов перемещения и пользовательского XML — удаляются вместе с историей правок, в счёт не идут. */
const RANGE_MARKS = /^w:(?:moveFromRange|moveToRange|customXml(?:Ins|Del|MoveFrom|MoveTo)Range)(?:Start|End)$/;
/** Контейнеры, которым нужен хотя бы один абзац или таблица: последний скрытый абзац в них остаётся. */
const NEEDS_BLOCK = new Set(['w:body', 'w:tc', 'w:txbxContent', 'w:hdr', 'w:ftr', 'w:footnote', 'w:endnote', 'w:comment', 'w:docPartBody']);

/**
 * Стили со скрытым текстом (w:vanish в свойствах рана стиля, с наследованием w:basedOn) и стиль абзаца по умолчанию.
 * @typedef {{vanish: Map<string, boolean>, defaultPara: string | null, defaultVanish: boolean | null, any: boolean}} WordStyles
 */

/** Пустые стили (нет styles.xml или в нём нет w:vanish). */
const NO_STYLES = Object.freeze({ vanish: new Map(), defaultPara: null, defaultVanish: null, any: false });

/**
 * Разбор styles.xml: у каких стилей (символа и абзаца) текст скрыт. Значение наследуется по w:basedOn, своё — важнее.
 * @param {string} xml
 * @returns {WordStyles}
 */
export function wordHiddenStyles(xml) {
  if (!xml || !/<w:(?:vanish|specVanish)[\s/>]/.test(xml)) return NO_STYLES;
  /** @type {Map<string, {own: boolean | null, based: string | null}>} */
  const raw = new Map();
  let defaultPara = null;
  let defaultVanish = null;
  /** @type {{id: string, own: boolean | null, based: string | null} | null} */
  let cur = null;
  const stack = [];
  let change = 0;
  tokenize(xml, (t) => {
    if (t.type === 'open' || t.type === 'selfclose') {
      const nm = t.name;
      const parent = stack[stack.length - 1];
      if (nm === 'w:style') {
        const id = getAttr(xml, t.attrStart, t.attrEnd, 'w:styleId')?.raw || '';
        const type = getAttr(xml, t.attrStart, t.attrEnd, 'w:type')?.raw || 'paragraph';
        cur = { id, own: null, based: null };
        if (type === 'paragraph' && onOffAttr(xml, t, 'w:default') === true) defaultPara = id;
      } else if (/Change$/.test(nm)) {
        if (t.type === 'open') change++;
      } else if (!change && (nm === 'w:vanish' || nm === 'w:specVanish') && parent === 'w:rPr') {
        const v = nm === 'w:specVanish' ? true : onOff(getAttr(xml, t.attrStart, t.attrEnd, 'w:val')?.raw);
        if (cur && stack[stack.length - 2] === 'w:style') cur.own = v;
        else if (!cur && stack.includes('w:rPrDefault')) defaultVanish = v;
      } else if (cur && nm === 'w:basedOn' && parent === 'w:style') cur.based = getAttr(xml, t.attrStart, t.attrEnd, 'w:val')?.raw || null;
      if (t.type === 'open') stack.push(nm);
    } else if (t.type === 'close') {
      stack.pop();
      if (/Change$/.test(t.name) && change) change--;
      else if (t.name === 'w:style' && cur) {
        raw.set(cur.id, { own: cur.own, based: cur.based });
        cur = null;
      }
    }
  });
  /** @type {Map<string, boolean>} */
  const vanish = new Map();
  for (const id of raw.keys()) {
    let v = null;
    const seen = new Set();
    for (let s = raw.get(id); s && v === null && !seen.has(s); s = s.based ? raw.get(s.based) : undefined) {
      seen.add(s);
      v = s.own;
    }
    if (v !== null) vanish.set(id, v);
  }
  return { vanish, defaultPara, defaultVanish, any: [...vanish.values()].some(Boolean) || defaultVanish === true };
}

function onOffAttr(xml, t, name) {
  const a = getAttr(xml, t.attrStart, t.attrEnd, name);
  return a ? onOff(a.raw) : null;
}

/**
 * Что скрыто в текстовой части Word и как это удалить.
 * @param {string} xml
 * @param {WordStyles} styles
 * @param {import('../ooxml/hidden.js').HiddenFlags} [flags]  что удалять (без флагов — только счёт)
 * @returns {{revisions: number, hiddenText: number, anchors: number, edits: {from: number, to: number, text: string}[]}}
 *   edits — удаления диапазонов XML (только по включённым флагам)
 */
export function scanWordPart(xml, styles, flags = {}) {
  const out = { revisions: 0, hiddenText: 0, anchors: 0, edits: /** @type {any[]} */ ([]) };
  const rev = !!flags.revisions;
  const com = !!flags.comments;
  const hid = !!flags.hiddenText;
  /** удаление диапазона; `dead` — отменено позже (последний абзац контейнера, строка внутри удалённой таблицы) */
  const strip = (from, to) => {
    const e = { from, to, text: '', dead: false };
    out.edits.push(e);
    return e;
  };
  /** @type {any[]} кадры открытых элементов */
  const stack = [];
  /** @type {any[]} открытые абзацы (бывают вложенными: надпись внутри рана) */
  const paras = [];
  /** @type {any[]} открытые раны */
  const runs = [];
  /** глубина внутри *Change (там прежние свойства — их w:vanish и стили не действуют) */
  let change = 0;
  /** абзац с удалённым знаком ждёт следующий абзац того же уровня: {from: начало </w:p>, depth} */
  let pendingMerge = null;
  const styleVanish = (id) => (id && styles.vanish.has(id) ? /** @type {boolean} */ (styles.vanish.get(id)) : null);

  tokenize(xml, (t) => {
    if (t.type === 'text' || t.type === 'other') return;
    const nm = t.name;
    if (t.type === 'close') {
      pendingMerge = nm === 'w:p' ? pendingMerge : null;
      const f = stack.pop();
      if (!f || f.name !== nm) return; // несбалансированная разметка — дальше по месту
      closeElement(f, t);
      return;
    }
    const parent = stack[stack.length - 1];
    const pName = parent?.name || '';
    const gpName = stack[stack.length - 2]?.name || '';
    const self = t.type === 'selfclose';
    const f = { name: nm, start: t.start, end: t.end, openEnd: t.end, blocks: null, kind: '' };

    // удалённый знак предыдущего абзаца: следующий элемент того же уровня — абзац → склеить
    if (pendingMerge) {
      if (nm === 'w:p' && !self && stack.length === pendingMerge.depth) f.mergeFrom = pendingMerge.from;
      pendingMerge = null;
    }
    // первый дочерний элемент абзаца-приёмника, не w:pPr: склейка до конца открывающего тега
    if (pName === 'w:p' && parent.para?.mergeFrom != null && parent.para.mergeEdit === undefined && nm !== 'w:pPr') finishMerge(parent.para, parent.openEnd);

    if (nm === 'w:p' && !self) {
      f.para = { start: t.start, mark: null, markDeleted: false, styleId: null, visible: false, sectPr: false, mergeFrom: f.mergeFrom ?? null };
      paras.push(f.para);
    } else if (nm === 'w:r' && !self) {
      f.run = { start: t.start, vanish: null, styleId: null, content: false, ref: null };
      runs.push(f.run);
    }
    const para = paras[paras.length - 1];
    const run = runs[runs.length - 1];
    const isChange = /^w:\w+Change$/.test(nm);

    if (isChange) {
      out.revisions++;
      f.kind = rev ? 'strip' : '';
      if (!self) change++;
    } else if (nm === 'w:ins' || nm === 'w:moveTo') {
      out.revisions++;
      if (PROPS.has(pName)) f.kind = rev ? 'strip' : '';
      else if (rev) {
        // обёртка вставленного текста — разворачивается: удаляются только теги
        strip(t.start, t.end);
        f.kind = self ? '' : 'unwrap';
      }
    } else if (nm === 'w:del' || nm === 'w:moveFrom') {
      out.revisions++;
      if (pName === 'w:rPr' && gpName === 'w:pPr' && para && !change) para.markDeleted = true;
      if (pName === 'w:trPr') {
        const tr = findFrame('w:tr');
        if (tr) tr.deleted = true;
      }
      f.kind = rev ? 'strip' : '';
    } else if (nm === 'w:cellIns' || nm === 'w:cellDel' || nm === 'w:cellMerge') {
      out.revisions++;
      f.kind = rev ? 'strip' : '';
    } else if (RANGE_MARKS.test(nm)) {
      f.kind = rev ? 'strip' : '';
    } else if (nm === 'w:commentRangeStart' || nm === 'w:commentRangeEnd') {
      out.anchors++;
      f.kind = com ? 'strip' : '';
    } else if (nm === 'w:commentReference') {
      out.anchors++;
      if (run && pName === 'w:r') run.ref = { start: t.start, end: self ? t.end : -1 };
      else f.kind = com ? 'strip' : '';
    } else if (!change) {
      if ((nm === 'w:vanish' || nm === 'w:specVanish') && pName === 'w:rPr') {
        const v = nm === 'w:specVanish' ? true : onOff(getAttr(xml, t.attrStart, t.attrEnd, 'w:val')?.raw);
        if (gpName === 'w:pPr' && para) para.mark = v;
        else if (gpName === 'w:r' && run) run.vanish = v;
      } else if (nm === 'w:rStyle' && pName === 'w:rPr' && gpName === 'w:r' && run) {
        run.styleId = getAttr(xml, t.attrStart, t.attrEnd, 'w:val')?.raw || null;
      } else if (nm === 'w:pStyle' && pName === 'w:pPr' && para) {
        para.styleId = getAttr(xml, t.attrStart, t.attrEnd, 'w:val')?.raw || null;
      } else if (nm === 'w:sectPr' && pName === 'w:pPr' && para) para.sectPr = true;
    }
    // содержимое рана — всё, кроме свойств и ссылки на комментарий
    if (run && pName === 'w:r' && nm !== 'w:rPr' && nm !== 'w:commentReference') run.content = true;

    if (self) {
      if (f.kind === 'strip') strip(t.start, t.end);
      return;
    }
    stack.push(f);
  });

  return {
    revisions: out.revisions,
    hiddenText: out.hiddenText,
    anchors: out.anchors,
    edits: out.edits.filter((e) => !e.dead).map(({ from, to, text }) => ({ from, to, text })),
  };

  function findFrame(name) {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].name === name) return stack[i];
    return null;
  }

  /** Блок (абзац, таблица) в ближайшем контейнере: контейнеру нужен хотя бы один неудалённый. */
  function addBlock(edit) {
    const c = stack[stack.length - 1];
    if (!c) return;
    (c.blocks ||= []).push(edit);
  }

  /** Склейка с предыдущим абзацем: удалить от его «</w:p>» до конца свойств (или открывающего тега) этого. */
  function finishMerge(p, to) {
    p.mergeEdit = p.sectPr ? null : strip(p.mergeFrom, to);
  }

  function closeElement(f, t) {
    const nm = f.name;
    if (/^w:\w+Change$/.test(nm) && change) change--;
    if (f.kind === 'strip') strip(f.start, t.end);
    else if (f.kind === 'unwrap') strip(t.start, t.end);
    if (nm === 'w:pPr' && stack[stack.length - 1]?.name === 'w:p') {
      const p = paras[paras.length - 1];
      if (p && p.mergeFrom != null && p.mergeEdit === undefined) finishMerge(p, t.end);
    } else if (nm === 'w:r' && f.run) {
      const r = runs.pop();
      const p = paras[paras.length - 1];
      const hidden = r.vanish ?? styleVanish(r.styleId) ?? styleVanish(p?.styleId ?? styles.defaultPara) ?? styles.defaultVanish ?? false;
      if (r.content && hidden) {
        out.hiddenText++;
        if (hid) strip(r.start, t.end);
      } else if (r.content && p) p.visible = true;
      if (r.ref && com && !(hid && hidden && r.content)) {
        // ран из одной ссылки на комментарий (и свойств) — целиком, иначе только ссылка
        if (!r.content) strip(r.start, t.end);
        else if (r.ref.end > 0) strip(r.ref.start, r.ref.end);
      }
    } else if (nm === 'w:commentReference') {
      const r = runs[runs.length - 1];
      if (r?.ref && r.ref.end < 0) r.ref.end = t.end;
    } else if (nm === 'w:p' && f.para) {
      const p = paras.pop();
      if (p.mergeFrom != null && p.mergeEdit === undefined) finishMerge(p, f.openEnd);
      const markHidden = p.mark ?? styleVanish(p.styleId ?? styles.defaultPara) ?? styles.defaultVanish ?? false;
      let edit = null;
      if (hid && markHidden && !p.visible && !p.sectPr) {
        edit = strip(f.start, t.end);
        // склейка с этим (удалённым) абзацем переходит на следующий: удаляется и этот абзац целиком
        if (p.mergeEdit) {
          p.mergeEdit.dead = true;
          pendingMerge = { from: p.mergeFrom, depth: stack.length };
        }
      } else if (rev && p.markDeleted && !p.sectPr) pendingMerge = { from: t.start, depth: stack.length };
      addBlock(edit || { dead: true, keep: true });
    } else if (nm === 'w:tr') {
      if (rev && f.deleted) f.rowEdit = strip(f.start, t.end);
      const tbl = findFrame('w:tbl');
      if (tbl) (tbl.rows ||= []).push(f.rowEdit || null);
    } else if (nm === 'w:tbl') {
      // удалены все строки — удаляется таблица
      const rows = f.rows || [];
      let edit = null;
      if (rows.length && rows.every(Boolean)) {
        for (const r of rows) r.dead = true;
        edit = strip(f.start, t.end);
      }
      addBlock(edit || { dead: true, keep: true });
    } else if (nm === 'w:sdt' || nm === 'w:sdtContent' || nm === 'w:customXml') {
      // блочный контейнер без своих требований: его блоки считаются блоками родителя
      for (const b of f.blocks || []) addBlock(b);
      return;
    }
    if (NEEDS_BLOCK.has(nm) && f.blocks?.length && f.blocks.every((b) => !b.keep && !b.dead)) {
      // все абзацы и таблицы контейнера удалены — последний абзац остаётся (ячейка, колонтитул без абзаца не открылись бы)
      const last = f.blocks[f.blocks.length - 1];
      last.dead = true;
    }
  }
}

/**
 * Стили документа (лениво: styles.xml читается, только если в нём есть w:vanish).
 * @param {import('../ooxml/model.js').DocModel} doc
 * @returns {WordStyles}
 */
function stylesOf(doc) {
  const any = /** @type {any} */ (doc);
  if (any._wordStyles) return any._wordStyles;
  const entry = doc.entries.find((e) => e.name === STYLES);
  let styles = NO_STYLES;
  if (entry) {
    try {
      styles = wordHiddenStyles(new TextDecoder('utf-8').decode(inflateEntry(entry)));
    } catch {
      styles = NO_STYLES;
    }
  }
  Object.defineProperty(any, '_wordStyles', { value: styles, enumerable: false });
  return styles;
}

/** Текстовые части Word с разметкой потоков (документ, колонтитулы, сноски, комментарии). */
function textParts(doc) {
  return [...doc.parts.values()].filter((p) => p.kind === 'text' && p.markup);
}

/**
 * Счётчики скрытого в документе Word (doc.hidden): комментарии, элементы истории правок, раны скрытого текста.
 * Часть без признаков скрытого (быстрая проверка) не обходится — разбор обычного договора не замедляется.
 * @param {import('../ooxml/model.js').DocModel} doc
 * @returns {import('../ooxml/hidden.js').HiddenCounts}
 */
export function countDocxHidden(doc) {
  const styles = stylesOf(doc);
  let revisions = 0;
  let hiddenText = 0;
  for (const part of textParts(doc)) {
    if (!styles.any && !QUICK_RE.test(part.xml)) continue;
    const r = scanWordPart(part.xml, styles);
    revisions += r.revisions;
    hiddenText += r.hiddenText;
  }
  const comments = doc.parts.get('word/comments.xml')?.xml.match(/<w:comment[\s>]/g)?.length || 0;
  return { comments, revisions, hiddenText };
}

/**
 * План сборки Word (ooxml/serialize.js `plan`): только скрытые данные по выбору пользователя (без выбора — ничего).
 * @param {import('../ooxml/model.js').DocModel & {hidden?: import('../ooxml/hidden.js').HiddenCounts}} doc
 * @param {import('../ooxml/serialize.js').PlanContext} ctx
 */
export function planDocxHidden(doc, ctx) {
  const flags = ctx.hidden;
  if (!flags) return;
  const styles = stylesOf(doc);
  const removeComments = !!flags.comments;
  const want = { comments: removeComments, revisions: !!flags.revisions, hiddenText: !!flags.hiddenText };
  for (const part of textParts(doc)) {
    if (removeComments && COMMENT_PART_RE.test(part.name)) continue; // часть удаляется целиком
    if (!styles.any && !QUICK_RE.test(part.xml)) continue;
    for (const e of scanWordPart(part.xml, styles, want).edits) ctx.strip(part.name, e);
  }
  if (removeComments) {
    for (const e of doc.entries) if (COMMENT_PART_RE.test(e.name)) ctx.remove(e.name);
    // люди (авторы) нужны и истории правок: people.xml удаляется, если исправлений нет или они приняты
    const revisions = doc.hidden ? doc.hidden.revisions || 0 : countDocxHidden(doc).revisions || 0;
    if ((!revisions || want.revisions) && doc.entries.some((e) => e.name === PEOPLE)) ctx.remove(PEOPLE);
  }
}

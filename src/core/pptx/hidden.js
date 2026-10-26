// Скрытые данные PowerPoint (версия 0.5, WP12-D, Ц4, К7; docs/concept-0.5.md п. 6, docs/contracts.md §9.9): скрытые слайды
// (<p:sld show="0">) и комментарии (обычные p:cmLst и современные p188:cmLst, их авторы). При разборе — счётчики (doc.hidden);
// при сборке — по выбору пользователя (план адаптера pptx-adapter.js, общий сериализатор ooxml/serialize.js):
//   «Удалить скрытые слайды» — часть слайда, его связи и всё, на что ссылался только он (заметки, комментарии, картинки,
//     диаграммы), <p:sldId> в презентации, слайд в произвольных показах и разделах, гиперссылки других слайдов на него;
//   «Удалить комментарии» — части комментариев и авторов, ссылка на современные комментарии в слайде (<p:ext> с p188:commentRel).
// Найденное в скрытом маскируется в любом случае. Значений документа здесь нет (NFR-14).
import { tokenize, parseAttrs } from '../ooxml/xml.js';
import { readRelations } from '../ooxml/dml.js';
import { collectOrphans } from '../ooxml/hidden.js';

/** Скрытый слайд: show="0" у корня. */
const HIDDEN_SLIDE_RE = /<p:sld\b[^>]*?\sshow\s*=\s*["'](?:0|false)["']/;

/**
 * Счётчики скрытого в презентации (doc.hidden).
 * @param {import('../ooxml/model.js').DocModel} doc
 * @param {(name: string) => string | null} roleOf  роль части (pptxRole по связям пакета)
 * @returns {import('../ooxml/hidden.js').HiddenCounts}
 */
export function countPptxHidden(doc, roleOf) {
  let hiddenSlides = 0;
  let comments = 0;
  for (const part of doc.parts.values()) {
    const role = roleOf(part.name);
    if (role === 'slide' && HIDDEN_SLIDE_RE.test(part.xml.slice(0, 4000))) hiddenSlides++;
    else if (role === 'comments') comments += part.xml.match(/<(?:p:cm|p188:cm)[\s>]/g)?.length || 0;
  }
  return { comments, hiddenSlides };
}

/** Атрибуты тега словарём (сырые значения). */
const attrsOf = (xml, t) => Object.fromEntries(parseAttrs(xml, t.attrStart, t.attrEnd).map((a) => [a.name, a.raw]));

/**
 * Удаление скрытого по выбору (план адаптера PowerPoint).
 * @param {any} doc
 * @param {import('../ooxml/serialize.js').PlanContext} ctx
 */
export function planPptxHidden(doc, ctx) {
  const flags = ctx.hidden;
  if (!flags) return;
  const rels = readRelations(doc.entries);
  const names = new Set(doc.entries.map((e) => e.name));
  const pres = rels.from('').find((r) => r.type === 'officeDocument' && names.has(r.target))?.target || 'ppt/presentation.xml';
  const gone = new Set();
  const remove = (n) => {
    if (!n || gone.has(n) || !names.has(n)) return;
    gone.add(n);
    ctx.remove(n);
  };
  const presRels = rels.from(pres);

  if (flags.hiddenSlides) {
    const slides = presRels.filter((r) => r.type === 'slide' && !r.external && doc.parts.has(r.target));
    const hidden = slides.filter((r) => HIDDEN_SLIDE_RE.test(doc.parts.get(r.target).xml.slice(0, 4000)));
    if (hidden.length) {
      const ids = new Set(hidden.map((r) => r.id));
      const targets = new Set(hidden.map((r) => r.target));
      for (const r of hidden) remove(r.target);
      stripPresentation(doc.parts.get(pres)?.xml || '', ids, pres, ctx);
      // гиперссылки других частей на удалённый слайд: связь уберёт общий сериализатор, ссылку на неё — здесь
      for (const r of rels.all) {
        if (r.external || !targets.has(r.target) || r.source === pres || targets.has(r.source) || !doc.parts.has(r.source)) continue;
        stripElements(doc.parts.get(r.source).xml, (name, a) => /(?:^|:)hlink(?:Click|Hover)$/.test(name) && a['r:id'] === r.id, r.source, ctx);
      }
    }
  }

  if (flags.comments) {
    for (const r of rels.all) {
      if (r.external || gone.has(r.source)) continue;
      if (r.type === 'comments') {
        remove(r.target);
        // современные комментарии: <p:ext uri="{6950BFC3-…}"><p188:commentRel r:id="…"/></p:ext> в слайде — тоже ссылка на связь
        if (doc.parts.has(r.source)) stripCommentRel(doc.parts.get(r.source).xml, r.id, r.source, ctx);
      } else if (r.type === 'commentAuthors' || r.type === 'authors') remove(r.target);
    }
  }

  if (gone.size) for (const n of collectOrphans(rels.all, gone, names)) ctx.remove(n);
}

/** Презентация без удалённых слайдов: <p:sldId> по связи, слайды произвольных показов, слайды разделов (по id). */
function stripPresentation(xml, relIds, pres, ctx) {
  const sldIds = new Set();
  tokenize(xml, (t) => {
    if ((t.type !== 'open' && t.type !== 'selfclose') || t.name !== 'p:sldId') return;
    const a = attrsOf(xml, t);
    if (relIds.has(a['r:id'])) sldIds.add(a.id);
  });
  stripElements(
    xml,
    (name, a, parent) =>
      (name === 'p:sldId' && relIds.has(a['r:id'])) ||
      (name === 'p:sld' && parent === 'p:sldLst' && relIds.has(a['r:id'])) ||
      (/(?:^|:)sldId$/.test(name) && name !== 'p:sldId' && sldIds.has(a.id)),
    pres,
    ctx,
  );
}

/** Удаляет элементы (самозакрывающиеся и с содержимым), для которых pred истинно. */
function stripElements(xml, pred, part, ctx) {
  const stack = [];
  let open = null;
  tokenize(xml, (t) => {
    if (t.type === 'open' || t.type === 'selfclose') {
      if (!open && pred(t.name, attrsOf(xml, t), stack[stack.length - 1])) {
        if (t.type === 'selfclose') ctx.strip(part, { from: t.start, to: t.end });
        else open = { name: t.name, start: t.start, depth: stack.length };
      }
      if (t.type === 'open') stack.push(t.name);
    } else if (t.type === 'close') {
      stack.pop();
      if (open && t.name === open.name && stack.length === open.depth) {
        ctx.strip(part, { from: open.start, to: t.end });
        open = null;
      }
    }
  });
}

/** Расширение слайда со ссылкой на часть современных комментариев. */
function stripCommentRel(xml, relId, part, ctx) {
  let ext = null;
  tokenize(xml, (t) => {
    if (t.type === 'open' && t.name === 'p:ext') ext = { start: t.start, hit: false };
    else if ((t.type === 'open' || t.type === 'selfclose') && ext && /(?:^|:)commentRel$/.test(t.name) && attrsOf(xml, t)['r:id'] === relId) ext.hit = true;
    else if (t.type === 'close' && t.name === 'p:ext' && ext) {
      if (ext.hit) ctx.strip(part, { from: ext.start, to: t.end });
      ext = null;
    }
  });
}

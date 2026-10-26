// Части пакета OPC, общие для Word, Excel и PowerPoint (общий слой OOXML с 0.5, WP12-A, docs/contracts.md §9):
// внешние ссылки в *.rels (FR-13), метаданные docProps (FR-12), удаление частей с чисткой [Content_Types].xml и связей (FR-12, FR-15).
import { tokenize, parseAttrs, applyRangeEdits } from './xml.js';
import { inflateEntry } from './zip.js';
import { addAttrStream } from './model.js';

/** Метаданные пакета (FR-12): одинаковы во всех форматах OOXML. */
export const META_PART_RE = /^docProps\/(core|app)\.xml$/;
/** Части, удаляемые при очистке метаданных вместе со ссылками на них. */
export const META_REMOVED_RE = /^docProps\/(custom\.xml|thumbnail\.[^/]+)$/;

const CORE_META = new Set(['dc:creator', 'cp:lastModifiedBy', 'dc:title', 'dc:subject', 'dc:description', 'cp:keywords', 'cp:category', 'dc:identifier']);
const APP_META = new Set(['Company', 'Manager', 'HyperlinkBase']);

/**
 * Связи части (FR-13): внешние ссылки (`TargetMode="External"`) — атрибутные потоки `rel-target` (гиперссылки) и `rel-external`
 * (прочие внешние цели — путь заменяется всегда, ooxml/serialize.js).
 * @param {string} name
 * @param {string} xml
 * @param {import('./model.js').ParseContext} ctx
 * @returns {import('./model.js').Part}
 */
export function parseRelsPart(name, xml, ctx) {
  /** @type {import('./model.js').Part} */
  const part = { name, kind: 'rels', xml, streams: [], embeddedRuns: [] };
  tokenize(xml, (t) => {
    if ((t.type !== 'open' && t.type !== 'selfclose') || t.name !== 'Relationship') return;
    const attrs = parseAttrs(xml, t.attrStart, t.attrEnd);
    const mode = attrs.find((x) => x.name === 'TargetMode');
    const target = attrs.find((x) => x.name === 'Target');
    if (mode && mode.raw === 'External' && target && target.raw) {
      // гиперссылка — `rel-target` (FR-13: метка в URL); прочие внешние цели (аудио, видео, рисунок, шаблон, внешняя книга:
      // file:///C:/Users/<логин>/…/Звонок Иванову.mp3) — `rel-external`: путь заменяется нейтральным именем всегда (ревью WP12-B)
      const type = String(attrs.find((x) => x.name === 'Type')?.raw || '').replace(/^.*\//, '');
      addAttrStream(part, ctx, target, type && type !== 'hyperlink' ? 'rel-external' : 'rel-target', 'Relationship/@Target');
    }
  });
  return part;
}

/**
 * docProps/core.xml и app.xml (FR-12): текст полей автора, названия, компании и т.п. — потоки `meta`.
 * @param {string} name
 * @param {string} xml
 * @param {import('./model.js').ParseContext} ctx
 * @returns {import('./model.js').Part}
 */
export function parseMetaPart(name, xml, ctx) {
  /** @type {import('./model.js').Part} */
  const part = { name, kind: 'meta', xml, streams: [], embeddedRuns: [] };
  const isCore = name.endsWith('core.xml');
  const stack = [];
  let open = null;
  tokenize(xml, (t) => {
    if (t.type === 'open') {
      stack.push(t.name);
      const inTitles = stack.includes('TitlesOfParts');
      if ((isCore && CORE_META.has(t.name)) || (!isCore && (APP_META.has(t.name) || (inTitles && t.name === 'vt:lpstr')))) {
        open = { name: t.name, start: t.end };
      }
    } else if (t.type === 'close') {
      stack.pop();
      if (open && t.name === open.name) {
        const raw = xml.slice(open.start, t.start);
        if (raw.length) {
          addAttrStream(part, ctx, { raw, valueStart: open.start, valueEnd: t.start }, 'meta', `${t.name}`, 'meta');
        }
        open = null;
      }
    }
  });
  return part;
}

/**
 * Удаляет ссылки на удалённые части из [Content_Types].xml и всех *.rels (FR-12, FR-15).
 * @param {import('./model.js').DocModel} doc
 * @param {Set<string>} removed
 * @param {Map<string, string>} newXml  новые тексты частей (дополняется)
 */
export function cleanupReferences(doc, removed, newXml) {
  const dec = new TextDecoder();
  const getXml = (name) => {
    if (newXml.has(name)) return newXml.get(name);
    if (doc.parts.has(name)) return /** @type {any} */ (doc.parts.get(name)).xml;
    const e = doc.entries.find((x) => x.name === name);
    if (!e) return null;
    return dec.decode(inflateEntry(e));
  };
  // [Content_Types].xml
  const ct = getXml('[Content_Types].xml');
  if (ct != null) {
    const out = removeElements(ct, 'Override', (attrs) => {
      const pn = attrs.PartName || '';
      return removed.has(pn.replace(/^\//, ''));
    });
    if (out !== ct) newXml.set('[Content_Types].xml', out);
  }
  // Все .rels: связи, указывающие на удалённые части
  for (const e of doc.entries) {
    if (!/\.rels$/.test(e.name) || removed.has(e.name)) continue;
    const base = relsBaseDir(e.name);
    const x = getXml(e.name);
    if (x == null) continue;
    const out = removeElements(x, 'Relationship', (attrs) => {
      if (attrs.TargetMode === 'External') return false;
      return removed.has(resolveTarget(base, attrs.Target || ''));
    });
    if (out !== x) newXml.set(e.name, out);
  }
}

/** 'word/_rels/document.xml.rels' → 'word/'; '_rels/.rels' → '' */
export function relsBaseDir(relsName) {
  const i = relsName.indexOf('_rels/');
  return relsName.slice(0, i);
}

/** Разрешает Target связи относительно каталога источника. */
export function resolveTarget(baseDir, target) {
  if (target.startsWith('/')) return target.slice(1);
  const segs = (baseDir + target).split('/');
  const out = [];
  for (const s of segs) {
    if (s === '..') out.pop();
    else if (s !== '.' && s !== '') out.push(s);
  }
  return out.join('/');
}

/** Удаляет самозакрывающиеся/парные элементы с данным именем, для которых pred(attrs) истинно. */
export function removeElements(xml, name, pred) {
  const edits = [];
  let open = null;
  tokenize(xml, (t) => {
    if (t.name !== name) return;
    if (t.type === 'selfclose' || t.type === 'open') {
      const attrs = Object.fromEntries(parseAttrs(xml, t.attrStart, t.attrEnd).map((a) => [a.name, a.raw]));
      if (t.type === 'selfclose') {
        if (pred(attrs)) edits.push({ from: t.start, to: t.end, text: '' });
      } else open = { start: t.start, hit: pred(attrs) };
    } else if (t.type === 'close' && open) {
      if (open.hit) edits.push({ from: open.start, to: t.end, text: '' });
      open = null;
    }
  });
  return applyRangeEdits(xml, edits);
}

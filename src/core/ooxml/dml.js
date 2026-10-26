// DrawingML и общие для Excel и PowerPoint части пакета (версия 0.5, WP12-B, docs/contracts.md §9.8): описание разметки
// текста фигур <a:p>/<a:r>/<a:t> (слайды, заметки, надписи на листах, SmartArt, заголовки диаграмм), alt-тексты
// <*:cNvPr descr/title>, кэш строк диаграмм <c:v> и элементы с текстом без ранов (автор примечания, текст комментария
// PowerPoint) — потоки, правка которых пересобирает значение целиком (§6.3 п.6). Используют xlsx/ и pptx/ (модули по требованию).
import { tokenize, parseAttrs } from './xml.js';
import { addAttrStream, readXmlEntry } from './model.js';
import { parseFlowPart } from './flow.js';
import { relsBaseDir, resolveTarget } from './opc.js';

/**
 * DrawingML: абзац <a:p>, раны <a:r>, поле <a:fld> (номер слайда, дата) — тоже текст, разрыв строки <a:br> стоит между ранами
 * и имеет своё <a:rPr> (openSpecials), xml:space у <a:t> не бывает. Табуляция в DrawingML — символ внутри <a:t>.
 * @type {import('./flow.js').FlowMarkup}
 */
export const DML = Object.freeze({
  paragraph: 'a:p',
  paragraphs: new Set(['a:p']),
  run: 'a:r',
  text: { 'a:t': 'live' },
  textParents: new Set(['a:r', 'a:fld']),
  specials: { 'a:br': '\n' },
  openSpecials: true,
  soft: new Set(),
  containers: new Set(),
  specialParents: new Set(['a:p']),
  deleted: new Set(),
  embeddedOpen: new Set(),
  embeddedSelf: new Set(),
  preserveSpace: false,
  specialReplacement: (escaped) => `<a:r><a:t>${escaped}</a:t></a:r>`,
});

/** Элементы-описания фигур и рисунков: alt-текст (descr, title) — поток `alt` (FR-15: текст рядом с объектом тоже данные). */
const CNVPR_RE = /^(?:p|xdr|dsp|pic|wps|a):cNvPr$/;

/**
 * Часть DrawingML: потоки абзацев по `DML` + alt-тексты фигур (`descr`, `title`; у рисунка — и `name`: имя вставленного файла).
 * @param {string} name
 * @param {string} xml
 * @param {import('./model.js').ParseContext} ctx
 * @param {{onElement?: import('./flow.js').FlowHooks['onElement']}} [extra]
 * @returns {import('./model.js').Part}
 */
export function parseDrawingPart(name, xml, ctx, extra = {}) {
  return parseFlowPart(name, xml, ctx, DML, {
    onElement(t, parent, para, part) {
      if (CNVPR_RE.test(t.name)) {
        const pic = parent === 'p:nvPicPr' || parent === 'xdr:nvPicPr' || parent === 'pic:nvPicPr';
        for (const a of parseAttrs(xml, t.attrStart, t.attrEnd)) {
          if (!a.raw) continue;
          if (a.name === 'descr' || a.name === 'title' || (pic && a.name === 'name')) addAttrStream(part, ctx, a, 'alt', `${t.name}/@${a.name}`);
        }
      } else if (t.name === 'a:hlinkClick' || t.name === 'a:hlinkHover') {
        // всплывающая подсказка ссылки («Написать Иванову») — тоже текст документа
        const a = parseAttrs(xml, t.attrStart, t.attrEnd).find((x) => x.name === 'tooltip');
        if (a && a.raw) addAttrStream(part, ctx, a, 'alt', `${t.name}/@tooltip`);
      }
      extra.onElement?.(t, parent, para, part);
    },
  });
}

/**
 * Потоки из текста элементов без ранов (значение целиком): `pick(name, stack)` возвращает attrKind или null.
 * Пустые элементы и элементы с дочерними тегами пропускаются. Поток — тип `attr` (не `meta`: очистка метаданных его не трогает).
 * @param {import('./model.js').Part} part
 * @param {import('./model.js').ParseContext} ctx
 * @param {(name: string, stack: string[]) => string | null} pick
 * @param {(s: import('./model.js').Stream, attrs: Record<string, string>) => void} [onStream]  атрибуты открывающего тега
 * @returns {import('./model.js').Stream[]}
 */
export function addElementTextStreams(part, ctx, pick, onStream) {
  const xml = part.xml;
  const out = [];
  const stack = [];
  /** @type {{name: string, kind: string, start: number, attrs: Record<string, string>, child: boolean} | null} */
  let open = null;
  tokenize(xml, (t) => {
    if (t.type === 'open') {
      if (open) open.child = true;
      const kind = pick(t.name, stack);
      stack.push(t.name);
      if (kind)
        open = {
          name: t.name,
          kind,
          start: t.end,
          attrs: Object.fromEntries(parseAttrs(xml, t.attrStart, t.attrEnd).map((a) => [a.name, a.raw])),
          child: false,
        };
    } else if (t.type === 'selfclose') {
      if (open) open.child = true;
    } else if (t.type === 'close') {
      stack.pop();
      if (open && t.name === open.name) {
        if (!open.child && t.start > open.start) {
          const s = addAttrStream(part, ctx, { raw: xml.slice(open.start, t.start), valueStart: open.start, valueEnd: t.start }, open.kind, open.name);
          out.push(s);
          onStream?.(s, open.attrs);
        }
        open = null;
      }
    }
  });
  return out;
}

/**
 * Атрибутные потоки по списку `{элемент: [атрибуты]}` (имена людей в списках авторов, отображаемый текст ссылок и т.п.).
 * @param {import('./model.js').Part} part
 * @param {import('./model.js').ParseContext} ctx
 * @param {Record<string, Record<string, string>>} spec  элемент → {атрибут → attrKind}
 * @returns {{el: number, stream: import('./model.js').Stream, attr: string, attrs: Record<string, string>}[]}  el — начало тега (связь атрибутов одного элемента)
 */
export function addAttrStreams(part, ctx, spec) {
  const xml = part.xml;
  const out = [];
  tokenize(xml, (t) => {
    if (t.type !== 'open' && t.type !== 'selfclose') return;
    const want = spec[t.name];
    if (!want) return;
    const attrs = parseAttrs(xml, t.attrStart, t.attrEnd);
    const all = Object.fromEntries(attrs.map((a) => [a.name, a.raw]));
    for (const a of attrs) {
      const kind = want[a.name];
      if (kind && a.raw) out.push({ el: t.start, stream: addAttrStream(part, ctx, a, kind, `${t.name}/@${a.name}`), attr: a.name, attrs: all });
    }
  });
  return out;
}

/**
 * Связка автора с инициалами и идентификатором (FR-11): потоки одного элемента с attrKind `initials`/`author-id`
 * получают `linkedTo` потока `author` того же элемента (раннер даёт им плейсхолдер автора); без автора — сами по себе.
 * @param {{el: number, stream: import('./model.js').Stream}[]} list
 */
export function linkAuthors(list) {
  const authorAt = new Map(list.filter((x) => x.stream.attrKind === 'author').map((x) => [x.el, x.stream.id]));
  for (const x of list) if (x.stream.attrKind !== 'author' && authorAt.has(x.el)) x.stream.linkedTo = authorAt.get(x.el);
}

/**
 * Предупреждение о встроенных объектах (FR-15): OLE-объекты, картинки и пакеты внутри книги или презентации не разбираются.
 * @param {import('./zip.js').ZipEntry[]} entries
 * @param {string} root  'xl/' или 'ppt/'
 */
export function embeddedWarning(entries, root) {
  const counts = { embeddings: 0, media: 0 };
  for (const e of entries) {
    if (e.name.startsWith(`${root}embeddings/`)) counts.embeddings++;
    else if (e.name.startsWith(`${root}media/`)) counts.media++;
  }
  const n = counts.embeddings + counts.media;
  return n ? [{ code: 'EMBEDDED_NOT_PROCESSED', count: n, details: counts }] : [];
}

/**
 * Связь пакета OPC.
 * @typedef {{source: string, id: string, type: string, target: string, external: boolean}} Relation
 */

/**
 * Все связи пакета (ревью WP12-B: части Excel и PowerPoint находятся по типу связи, а не по шаблону пути — openpyxl пишет
 * примечания в xl/comments/comment1.xml, LibreOffice и другие инструменты — свои имена). `type` — последнее звено URI типа
 * («comments», «threadedComment», «worksheet», «package»…); источник «_rels/.rels» — пустая строка.
 * @param {import('./zip.js').ZipEntry[]} entries
 * @returns {{all: Relation[], typesOf: (part: string) => string[], from: (source: string) => Relation[]}}
 */
export function readRelations(entries) {
  /** @type {Relation[]} */
  const all = [];
  for (const e of entries) {
    if (!/(?:^|\/)_rels\/[^/]*\.rels$/.test(e.name)) continue;
    let xml;
    try {
      xml = readXmlEntry(e);
    } catch {
      continue;
    }
    const base = relsBaseDir(e.name);
    const source = base + e.name.slice(e.name.lastIndexOf('/') + 1).replace(/\.rels$/, '');
    tokenize(xml, (t) => {
      if ((t.type !== 'open' && t.type !== 'selfclose') || t.name !== 'Relationship') return;
      const a = Object.fromEntries(parseAttrs(xml, t.attrStart, t.attrEnd).map((x) => [x.name, x.raw]));
      const external = a.TargetMode === 'External';
      const type = String(a.Type || '').replace(/^.*\//, '');
      all.push({
        source: source === base ? '' : source,
        id: a.Id || '',
        type,
        target: external ? a.Target || '' : resolveTarget(base, a.Target || ''),
        external,
      });
    });
  }
  const byTarget = new Map();
  for (const r of all) {
    if (r.external) continue;
    if (!byTarget.has(r.target)) byTarget.set(r.target, []);
    byTarget.get(r.target).push(r.type);
  }
  return { all, typesOf: (part) => byTarget.get(part) || [], from: (source) => all.filter((r) => r.source === source) };
}

/**
 * Встроенная книга данных диаграммы (`<c:externalData r:id>` → ../embeddings/*.xlsx): что удалить при «Удалять встроенные
 * объекты» — запись книги (связи и тип содержимого чистит общий сериализатор) и сам элемент в диаграмме (диаграмма остаётся
 * с кэшем значений, но без книги для правки данных).
 * @param {string} name  часть диаграммы
 * @param {string} xml
 * @param {Relation[]} rels  связи этой диаграммы
 * @returns {{chart: string, embed: string, start: number, end: number} | null}
 */
export function chartExternalData(name, xml, rels) {
  let open = null;
  let out = null;
  tokenize(xml, (t) => {
    if (out) return;
    if ((t.type === 'open' || t.type === 'selfclose') && t.name === 'c:externalData') {
      const id = parseAttrs(xml, t.attrStart, t.attrEnd).find((a) => a.name === 'r:id')?.raw;
      const rel = rels.find((r) => r.id === id && !r.external);
      if (!rel) return;
      if (t.type === 'selfclose') out = { chart: name, embed: rel.target, start: t.start, end: t.end };
      else open = { embed: rel.target, start: t.start };
    } else if (t.type === 'close' && t.name === 'c:externalData' && open) {
      out = { chart: name, embed: open.embed, start: open.start, end: t.end };
    }
  });
  return out;
}

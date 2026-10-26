// Минимальный детерминированный писатель книг Excel и презентаций PowerPoint для фикстур версии 0.5 (WP12-B, К1, К2):
// свой OOXML поверх ZIP ядра (src/core/ooxml/zip.js — дата 1980-01-01, DEFLATE 6), без внешних библиотек и сети.
// Данные — только вымышленные (их задаёт scripts/gen-office-fixtures.mjs). Файлы открываются в Excel/PowerPoint и LibreOffice:
// части, связи и типы содержимого — по ECMA-376; тема — минимальная полная (без неё PowerPoint просит восстановление).
import { writeZip } from '../src/core/ooxml/zip.js';

const enc = new TextEncoder();
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** Экранирование текста и атрибута XML. */
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const rels = (list) =>
  `${XML_HEAD}<Relationships xmlns="${PKG_REL}">${list
    .map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`)
    .join('')}</Relationships>`;

const contentTypes = (defaults, overrides) =>
  `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
  defaults.map(([e, t]) => `<Default Extension="${e}" ContentType="${t}"/>`).join('') +
  overrides.map(([p, t]) => `<Override PartName="/${p}" ContentType="${t}"/>`).join('') +
  '</Types>';

/** docProps/core.xml и app.xml: автор, название, компания (FR-12 — их очищает keepMetadata: false). */
function docProps(core = {}, app = {}, titles = []) {
  const coreXml =
    `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
    'xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    (core.title ? `<dc:title>${esc(core.title)}</dc:title>` : '') +
    (core.creator ? `<dc:creator>${esc(core.creator)}</dc:creator>` : '') +
    (core.lastModifiedBy ? `<cp:lastModifiedBy>${esc(core.lastModifiedBy)}</cp:lastModifiedBy>` : '') +
    '<dcterms:created xsi:type="dcterms:W3CDTF">2026-10-01T09:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-10-01T09:00:00Z</dcterms:modified>' +
    '</cp:coreProperties>';
  const appXml =
    `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
    `<Application>${esc(app.application || 'Microsoft Office')}</Application>` +
    (titles.length
      ? `<TitlesOfParts><vt:vector size="${titles.length}" baseType="lpstr">${titles.map((t) => `<vt:lpstr>${esc(t)}</vt:lpstr>`).join('')}</vt:vector></TitlesOfParts>`
      : '') +
    (app.company ? `<Company>${esc(app.company)}</Company>` : '') +
    '</Properties>';
  return { coreXml, appXml };
}

const zip = (files) => writeZip(Object.entries(files).map(([name, d]) => ({ name, data: typeof d === 'string' ? enc.encode(d) : d })));

/* ======================= Excel ======================= */

/** Номер столбца → буквы (1 → A). */
export function colName(n) {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

/**
 * Ячейка спецификации: строка (общая строка), число, null (пусто) или объект
 * {s?: строка, n?: число, f?: формула, v?: кэш формулы, str?: true (кэш — строка), inline?: true, rich?: [[текст, жирный]], style?: номер}.
 * @typedef {string | number | null | {s?: string, n?: number, f?: string, v?: string|number, str?: boolean, inline?: boolean, rich?: [string, boolean][], style?: number, shared?: {ref: string, si: number, master: boolean}}} XCell
 */

/**
 * Книга Excel по спецификации листов.
 * @param {{sheets: {name: string, rows: XCell[][], cols?: number[], merges?: string[], header?: string, footer?: string, hidden?: boolean,
 *   hiddenRows?: number[], comments?: {ref: string, author: string, text: string}[], threaded?: {ref: string, person: string, text: string}[],
 *   hyperlinks?: {ref: string, url?: string, location?: string, display?: string}[], drawingText?: string[]}[],
 *   definedNames?: {name: string, ref: string}[], core?: object, app?: object, persons?: {name: string, userId: string}[]}} spec
 * @returns {Uint8Array}
 */
export function buildXlsx(spec) {
  const files = {};
  const strings = [];
  const sIndex = new Map();
  const shared = (key, xml) => {
    if (!sIndex.has(key)) {
      sIndex.set(key, strings.length);
      strings.push(xml);
    }
    return sIndex.get(key);
  };
  const tText = (s) => `<t${/^\s|\s$|\n/.test(s) ? ' xml:space="preserve"' : ''}>${esc(s)}</t>`;
  const ctOverrides = [
    ['xl/workbook.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'],
    ['xl/styles.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml'],
    ['xl/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml'],
    ['docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'],
    ['docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml'],
  ];
  const ctDefaults = [];
  const wbRels = [];
  let rid = 1;
  const persons = spec.persons || [];
  const personId = (name) => `{${String(persons.findIndex((p) => p.name === name) + 1).padStart(8, '0')}-0000-4000-8000-000000000000}`;

  spec.sheets.forEach((sh, si) => {
    const n = si + 1;
    const sheetRels = [];
    const rows = sh.rows
      .map((row, ri) => {
        const r = ri + 1;
        const cells = row
          .map((v, ci) => {
            if (v === null || v === undefined) return '';
            const ref = `${colName(ci + 1)}${r}`;
            const o = typeof v === 'object' ? v : typeof v === 'number' ? { n: v } : { s: v };
            const st = o.style != null ? ` s="${o.style}"` : typeof v === 'number' ? ' s="2"' : '';
            if (o.f !== undefined) {
              const fx = o.shared
                ? o.shared.master
                  ? `<f t="shared" ref="${o.shared.ref}" si="${o.shared.si}">${esc(o.f)}</f>`
                  : `<f t="shared" si="${o.shared.si}"/>`
                : `<f>${esc(o.f)}</f>`;
              return `<c r="${ref}"${st}${o.str ? ' t="str"' : ''}>${fx}${o.v !== undefined ? `<v>${esc(o.v)}</v>` : ''}</c>`;
            }
            if (o.n !== undefined) return `<c r="${ref}"${st}><v>${o.n}</v></c>`;
            const body = o.rich ? o.rich.map(([t, b]) => `<r>${b ? '<rPr><b/><sz val="11"/></rPr>' : ''}${tText(t)}</r>`).join('') : tText(o.s);
            if (o.inline) return `<c r="${ref}"${st} t="inlineStr"><is>${body}</is></c>`;
            return `<c r="${ref}"${st} t="s"><v>${shared(o.rich ? JSON.stringify(o.rich) : `s:${o.s}`, body)}</v></c>`;
          })
          .join('');
        const hidden = sh.hiddenRows?.includes(r) ? ' hidden="1"' : '';
        return `<row r="${r}"${hidden}>${cells}</row>`;
      })
      .join('');
    const width = Math.max(1, ...sh.rows.map((x) => x.length));
    const cols = (sh.cols || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    let tail = '';
    if (sh.merges?.length) tail += `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`;
    if (sh.hyperlinks?.length) {
      tail += `<hyperlinks>${sh.hyperlinks
        .map((h) => {
          if (h.url) {
            const id = `rId${sheetRels.length + 1}`;
            sheetRels.push({ id, type: `${REL}/hyperlink`, target: h.url, external: true });
            return `<hyperlink ref="${h.ref}" r:id="${id}"${h.display ? ` display="${esc(h.display)}"` : ''}/>`;
          }
          return `<hyperlink ref="${h.ref}" location="${esc(h.location)}"${h.display ? ` display="${esc(h.display)}"` : ''}/>`;
        })
        .join('')}</hyperlinks>`;
    }
    tail += '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>';
    if (sh.header || sh.footer)
      tail += `<headerFooter>${sh.header ? `<oddHeader>${esc(sh.header)}</oddHeader>` : ''}${sh.footer ? `<oddFooter>${esc(sh.footer)}</oddFooter>` : ''}</headerFooter>`;
    if (sh.drawingText?.length) {
      const id = `rId${sheetRels.length + 1}`;
      sheetRels.push({ id, type: `${REL}/drawing`, target: `../drawings/drawing${n}.xml` });
      tail += `<drawing r:id="${id}"/>`;
      files[`xl/drawings/drawing${n}.xml`] = xlsxDrawing(sh.drawingText);
      ctOverrides.push([`xl/drawings/drawing${n}.xml`, 'application/vnd.openxmlformats-officedocument.drawing+xml']);
    }
    const comments = [...(sh.comments || [])];
    // цепочка комментариев: Excel пишет и обычное примечание-заглушку с тем же текстом (для старых версий)
    for (const t of sh.threaded || [])
      comments.push({
        ref: t.ref,
        author: `tc=${personId(t.person)}`,
        text: `[Threaded comment]\n\nYour version of Excel allows you to read this threaded comment.\n\nComment:\n    ${t.text}`,
      });
    if (comments.length) {
      const authors = [...new Set(comments.map((c) => c.author))];
      files[`xl/comments${n}.xml`] =
        `${XML_HEAD}<comments xmlns="${NS_MAIN}"><authors>${authors.map((a) => `<author>${esc(a)}</author>`).join('')}</authors><commentList>` +
        comments
          .map(
            (c) =>
              `<comment ref="${c.ref}" authorId="${authors.indexOf(c.author)}"><text>` +
              (c.author.startsWith('tc=')
                ? `<t xml:space="preserve">${esc(c.text)}</t>`
                : `<r><rPr><b/><sz val="9"/><rFont val="Tahoma"/></rPr><t xml:space="preserve">${esc(c.author)}:</t></r><r><rPr><sz val="9"/><rFont val="Tahoma"/></rPr><t xml:space="preserve">\n${esc(c.text)}</t></r>`) +
              '</text></comment>',
          )
          .join('') +
        '</commentList></comments>';
      ctOverrides.push([`xl/comments${n}.xml`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml']);
      const vid = `rId${sheetRels.length + 1}`;
      sheetRels.push({ id: vid, type: `${REL}/vmlDrawing`, target: `../drawings/vmlDrawing${n}.vml` });
      sheetRels.push({ id: `rId${sheetRels.length + 1}`, type: `${REL}/comments`, target: `../comments${n}.xml` });
      files[`xl/drawings/vmlDrawing${n}.vml`] = vmlComments(comments.map((c) => c.ref));
      if (!ctDefaults.some(([e]) => e === 'vml')) ctDefaults.push(['vml', 'application/vnd.openxmlformats-officedocument.vmlDrawing']);
      tail += `<legacyDrawing r:id="${vid}"/>`;
    }
    if (sh.threaded?.length) {
      files[`xl/threadedComments/threadedComment${n}.xml`] =
        `${XML_HEAD}<ThreadedComments xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments" xmlns:x="${NS_MAIN}">` +
        sh.threaded
          .map(
            (t, k) =>
              `<threadedComment ref="${t.ref}" dT="2026-10-01T09:00:00.00" personId="${personId(t.person)}" id="{${String(n * 100 + k).padStart(8, '0')}-0000-4000-8000-000000000001}"><text>${esc(t.text)}</text></threadedComment>`,
          )
          .join('') +
        '</ThreadedComments>';
      ctOverrides.push([`xl/threadedComments/threadedComment${n}.xml`, 'application/vnd.ms-excel.threadedcomments+xml']);
      sheetRels.push({
        id: `rId${sheetRels.length + 1}`,
        type: 'http://schemas.microsoft.com/office/2017/10/relationships/threadedComment',
        target: `../threadedComments/threadedComment${n}.xml`,
      });
    }
    files[`xl/worksheets/sheet${n}.xml`] =
      `${XML_HEAD}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_R}"><dimension ref="A1:${colName(width)}${Math.max(1, sh.rows.length)}"/>` +
      `<sheetViews><sheetView workbookViewId="0"${si === 0 ? ' tabSelected="1"' : ''}/></sheetViews><sheetFormatPr defaultRowHeight="15"/>` +
      (cols ? `<cols>${cols}</cols>` : '') +
      `<sheetData>${rows}</sheetData>${tail}</worksheet>`;
    ctOverrides.push([`xl/worksheets/sheet${n}.xml`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml']);
    if (sheetRels.length) files[`xl/worksheets/_rels/sheet${n}.xml.rels`] = rels(sheetRels);
    wbRels.push({ id: `rId${rid++}`, type: `${REL}/worksheet`, target: `worksheets/sheet${n}.xml` });
  });

  wbRels.push({ id: `rId${rid++}`, type: `${REL}/styles`, target: 'styles.xml' });
  wbRels.push({ id: `rId${rid++}`, type: `${REL}/theme`, target: 'theme/theme1.xml' });
  if (strings.length) {
    wbRels.push({ id: `rId${rid++}`, type: `${REL}/sharedStrings`, target: 'sharedStrings.xml' });
    ctOverrides.push(['xl/sharedStrings.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml']);
    // count — число ячеек со ссылкой на общие строки; для фикстур достаточно uniqueCount
    files['xl/sharedStrings.xml'] =
      `${XML_HEAD}<sst xmlns="${NS_MAIN}" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((x) => `<si>${x}</si>`).join('')}</sst>`;
  }
  if (persons.length) {
    wbRels.push({ id: `rId${rid++}`, type: 'http://schemas.microsoft.com/office/2017/10/relationships/person', target: 'persons/person.xml' });
    ctOverrides.push(['xl/persons/person.xml', 'application/vnd.ms-excel.person+xml']);
    files['xl/persons/person.xml'] =
      `${XML_HEAD}<personList xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments" xmlns:x="${NS_MAIN}">` +
      persons.map((p) => `<person displayName="${esc(p.name)}" id="${personId(p.name)}" userId="${esc(p.userId)}" providerId="None"/>`).join('') +
      '</personList>';
  }
  const names = (spec.definedNames || []).map((d) => `<definedName name="${esc(d.name)}">${esc(d.ref)}</definedName>`).join('');
  files['xl/workbook.xml'] =
    `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_R}"><workbookPr defaultThemeVersion="164011"/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="12300"/></bookViews>` +
    `<sheets>${spec.sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')}</sheets>` +
    (names ? `<definedNames>${names}</definedNames>` : '') +
    '<calcPr calcId="191029"/></workbook>';
  files['xl/_rels/workbook.xml.rels'] = rels(wbRels);
  files['xl/styles.xml'] = XLSX_STYLES;
  files['xl/theme/theme1.xml'] = theme();
  const { coreXml, appXml } = docProps(
    spec.core,
    { application: 'Microsoft Excel', ...spec.app },
    spec.sheets.map((s) => s.name),
  );
  files['docProps/core.xml'] = coreXml;
  files['docProps/app.xml'] = appXml;
  files['_rels/.rels'] = rels([
    { id: 'rId1', type: `${REL}/officeDocument`, target: 'xl/workbook.xml' },
    { id: 'rId2', type: `${PKG_REL}/metadata/core-properties`, target: 'docProps/core.xml' },
    { id: 'rId3', type: `${REL}/extended-properties`, target: 'docProps/app.xml' },
  ]);
  return zip({ '[Content_Types].xml': contentTypes(ctDefaults, ctOverrides), ...files });
}

/** Стили: 0 — обычный, 1 — жирный заголовок с заливкой, 2 — целое «0» (номера счетов и ИНН числом), 3 — денежный «# ##0,00». */
const XLSX_STYLES =
  `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>` +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

/** Надпись (текстовое поле) на листе: xdr:sp с txBody. */
function xlsxDrawing(texts) {
  const shapes = texts
    .map(
      (t, i) =>
        `<xdr:twoCellAnchor><xdr:from><xdr:col>6</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${1 + i * 4}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
        `<xdr:to><xdr:col>10</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${4 + i * 4}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
        `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${i + 2}" name="TextBox ${i + 1}"/><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr>` +
        '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2438400" cy="571500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>' +
        `<xdr:txBody><a:bodyPr vertOverflow="clip" wrap="square" rtlCol="0" anchor="t"/><a:lstStyle/><a:p><a:r><a:rPr lang="ru-RU" sz="1100"/><a:t>${esc(t)}</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>`,
    )
    .join('');
  return `${XML_HEAD}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${NS_A}">${shapes}</xdr:wsDr>`;
}

/** VML для примечаний (без него Excel не показывает примечания). */
function vmlComments(refs) {
  const shapes = refs
    .map((ref, i) => {
      const m = /^([A-Z]+)(\d+)$/.exec(ref);
      const col = m ? [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 : 0;
      const row = m ? Number(m[2]) - 1 : 0;
      return (
        `<v:shape id="_x0000_s${1025 + i}" type="#_x0000_t202" style="position:absolute;margin-left:59.25pt;margin-top:1.5pt;width:108pt;height:59.25pt;z-index:${i + 1};visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto">` +
        '<v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox>' +
        `<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:AutoFill>False</x:AutoFill><x:Row>${row}</x:Row><x:Column>${col}</x:Column></x:ClientData></v:shape>`
      );
    })
    .join('');
  return (
    '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">' +
    '<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>' +
    '<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>' +
    `${shapes}</xml>`
  );
}

/** Минимальная полная тема Office (цвета, шрифты, стили заливок/линий/эффектов — по три). */
function theme() {
  const clr = (n, v) => `<a:${n}><a:srgbClr val="${v}"/></a:${n}>`;
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const ln = (w) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>`;
  return (
    `${XML_HEAD}<a:theme xmlns:a="${NS_A}" name="Office"><a:themeElements><a:clrScheme name="Office">` +
    '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
    clr('dk2', '44546A') +
    clr('lt2', 'E7E6E6') +
    clr('accent1', '4472C4') +
    clr('accent2', 'ED7D31') +
    clr('accent3', 'A5A5A5') +
    clr('accent4', 'FFC000') +
    clr('accent5', '5B9BD5') +
    clr('accent6', '70AD47') +
    clr('hlink', '0563C1') +
    clr('folHlink', '954F72') +
    '</a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
    '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office">' +
    `<a:fillStyleLst>${fill}${fill}${fill}</a:fillStyleLst><a:lnStyleLst>${ln(6350)}${ln(12700)}${ln(19050)}</a:lnStyleLst>` +
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
    `<a:bgFillStyleLst>${fill}${fill}${fill}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`
  );
}

/* ======================= PowerPoint ======================= */

const EMU = 12700; // 1 pt

/**
 * Фигура слайда: надпись, заголовок, группа, таблица, SmartArt-подобный блок текста не делаем — только то, что в a:t.
 * @typedef {{type: 'text', x: number, y: number, w: number, h: number, paras: (string | [string, boolean][])[], title?: boolean, alt?: string}
 *   | {type: 'group', items: SlideShape[]}
 *   | {type: 'table', x: number, y: number, w: number, rows: string[][]}} SlideShape
 */

/**
 * Презентация по спецификации слайдов.
 * @param {{slides: {shapes: SlideShape[], notes?: string[], comments?: {author: string, text: string}[], modernComments?: {author: string, text: string, replies?: {author: string, text: string}[]}[], hidden?: boolean}[],
 *   authors?: {name: string, initials: string, userId?: string}[], core?: object, app?: object, layoutText?: string}} spec
 * @returns {Uint8Array}
 */
export function buildPptx(spec) {
  const files = {};
  const ct = [
    ['ppt/presentation.xml', 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'],
    ['ppt/slideMasters/slideMaster1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml'],
    ['ppt/slideLayouts/slideLayout1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml'],
    ['ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml'],
    ['docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'],
    ['docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml'],
  ];
  const presRels = [
    { id: 'rId1', type: `${REL}/slideMaster`, target: 'slideMasters/slideMaster1.xml' },
    { id: 'rId2', type: `${REL}/theme`, target: 'theme/theme1.xml' },
  ];
  const authors = spec.authors || [];
  const hasNotes = spec.slides.some((s) => s.notes?.length);
  const hasLegacy = spec.slides.some((s) => s.comments?.length);
  const hasModern = spec.slides.some((s) => s.modernComments?.length);
  if (hasNotes) {
    presRels.push({ id: 'rId3', type: `${REL}/notesMaster`, target: 'notesMasters/notesMaster1.xml' });
    files['ppt/notesMasters/notesMaster1.xml'] = notesMaster();
    files['ppt/notesMasters/_rels/notesMaster1.xml.rels'] = rels([{ id: 'rId1', type: `${REL}/theme`, target: '../theme/theme2.xml' }]);
    files['ppt/theme/theme2.xml'] = theme();
    ct.push(['ppt/notesMasters/notesMaster1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml']);
    ct.push(['ppt/theme/theme2.xml', 'application/vnd.openxmlformats-officedocument.theme+xml']);
  }
  if (hasLegacy) {
    presRels.push({ id: 'rId4', type: `${REL}/commentAuthors`, target: 'commentAuthors.xml' });
    files['ppt/commentAuthors.xml'] =
      `${XML_HEAD}<p:cmAuthorLst xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}">` +
      authors.map((a, i) => `<p:cmAuthor id="${i}" name="${esc(a.name)}" initials="${esc(a.initials)}" lastIdx="9" clrIdx="${i}"/>`).join('') +
      '</p:cmAuthorLst>';
    ct.push(['ppt/commentAuthors.xml', 'application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml']);
  }
  if (hasModern) {
    presRels.push({ id: 'rId5', type: 'http://schemas.microsoft.com/office/2018/10/relationships/authors', target: 'authors.xml' });
    files['ppt/authors.xml'] =
      `${XML_HEAD}<p188:authorLst xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p188="http://schemas.microsoft.com/office/powerpoint/2018/8/main">` +
      authors
        .map(
          (a, i) =>
            `<p188:author id="{${String(i + 1).padStart(8, '0')}-AAAA-4000-8000-000000000000}" name="${esc(a.name)}" initials="${esc(a.initials)}" userId="${esc(a.userId || a.name)}" providerId="None"/>`,
        )
        .join('') +
      '</p188:authorLst>';
    ct.push(['ppt/authors.xml', 'application/vnd.ms-powerpoint.authors+xml']);
  }
  const authorGuid = (name) => `{${String(authors.findIndex((a) => a.name === name) + 1).padStart(8, '0')}-AAAA-4000-8000-000000000000}`;
  let rid = 10;
  const sldIds = [];
  spec.slides.forEach((sl, i) => {
    const n = i + 1;
    const id = `rId${rid++}`;
    presRels.push({ id, type: `${REL}/slide`, target: `slides/slide${n}.xml` });
    sldIds.push(`<p:sldId id="${256 + i}" r:id="${id}"/>`);
    const sRels = [{ id: 'rId1', type: `${REL}/slideLayout`, target: '../slideLayouts/slideLayout1.xml' }];
    let shapeId = 2;
    const tree = sl.shapes.map((s) => shapeXml(s, () => shapeId++)).join('');
    files[`ppt/slides/slide${n}.xml`] =
      `${XML_HEAD}<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"${sl.hidden ? ' show="0"' : ''}><p:cSld><p:spTree>` +
      '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
      `${tree}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    ct.push([`ppt/slides/slide${n}.xml`, 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml']);
    if (sl.notes?.length) {
      sRels.push({ id: `rId${sRels.length + 1}`, type: `${REL}/notesSlide`, target: `../notesSlides/notesSlide${n}.xml` });
      files[`ppt/notesSlides/notesSlide${n}.xml`] = notesSlide(sl.notes);
      files[`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`] = rels([
        { id: 'rId1', type: `${REL}/notesMaster`, target: '../notesMasters/notesMaster1.xml' },
        { id: 'rId2', type: `${REL}/slide`, target: `../slides/slide${n}.xml` },
      ]);
      ct.push([`ppt/notesSlides/notesSlide${n}.xml`, 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml']);
    }
    if (sl.comments?.length) {
      sRels.push({ id: `rId${sRels.length + 1}`, type: `${REL}/comments`, target: `../comments/comment${n}.xml` });
      files[`ppt/comments/comment${n}.xml`] =
        `${XML_HEAD}<p:cmLst xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}">` +
        sl.comments
          .map(
            (c, k) =>
              `<p:cm authorId="${authors.findIndex((a) => a.name === c.author)}" dt="2026-10-01T09:00:00.000" idx="${k + 1}"><p:pos x="10" y="10"/><p:text>${esc(c.text)}</p:text></p:cm>`,
          )
          .join('') +
        '</p:cmLst>';
      ct.push([`ppt/comments/comment${n}.xml`, 'application/vnd.openxmlformats-officedocument.presentationml.comments+xml']);
    }
    if (sl.modernComments?.length) {
      const file = `modernComment_${(256 + i).toString(16).toUpperCase()}_${String(n).padStart(8, '0')}.xml`;
      sRels.push({ id: `rId${sRels.length + 1}`, type: 'http://schemas.microsoft.com/office/2018/10/relationships/comments', target: `../comments/${file}` });
      const body = (text) => `<p188:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="ru-RU"/><a:t>${esc(text)}</a:t></a:r></a:p></p188:txBody>`;
      files[`ppt/comments/${file}`] =
        `${XML_HEAD}<p188:cmLst xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p188="http://schemas.microsoft.com/office/powerpoint/2018/8/main">` +
        sl.modernComments
          .map(
            (c, k) =>
              `<p188:cm id="{${String(n * 100 + k).padStart(8, '0')}-BBBB-4000-8000-000000000000}" authorId="${authorGuid(c.author)}" created="2026-10-01T09:00:00.000">` +
              `<pc:sldMkLst xmlns:pc="http://schemas.microsoft.com/office/powerpoint/2013/main/command"><pc:docMk/><pc:sldMk cId="0" sldId="${256 + i}"/></pc:sldMkLst>` +
              (c.replies?.length
                ? `<p188:replyLst>${c.replies
                    .map(
                      (r, j) =>
                        `<p188:reply id="{${String(n * 100 + k).padStart(8, '0')}-CCCC-4000-8000-${String(j).padStart(12, '0')}}" authorId="${authorGuid(r.author)}" created="2026-10-01T10:00:00.000">${body(r.text)}</p188:reply>`,
                    )
                    .join('')}</p188:replyLst>`
                : '') +
              `${body(c.text)}</p188:cm>`,
          )
          .join('') +
        '</p188:cmLst>';
      ct.push([`ppt/comments/${file}`, 'application/vnd.ms-powerpoint.comments+xml']);
    }
    files[`ppt/slides/_rels/slide${n}.xml.rels`] = rels(sRels);
  });
  files['ppt/presentation.xml'] =
    `${XML_HEAD}<p:presentation xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" saveSubsetFonts="1">` +
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
    (hasNotes ? '<p:notesMasterIdLst><p:notesMasterId r:id="rId3"/></p:notesMasterIdLst>' : '') +
    `<p:sldIdLst>${sldIds.join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>` +
    '<p:defaultTextStyle><a:defPPr><a:defRPr lang="ru-RU"/></a:defPPr></p:defaultTextStyle></p:presentation>';
  files['ppt/_rels/presentation.xml.rels'] = rels(presRels);
  files['ppt/slideMasters/slideMaster1.xml'] = slideMaster();
  files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = rels([
    { id: 'rId1', type: `${REL}/slideLayout`, target: '../slideLayouts/slideLayout1.xml' },
    { id: 'rId2', type: `${REL}/theme`, target: '../theme/theme1.xml' },
  ]);
  files['ppt/slideLayouts/slideLayout1.xml'] = slideLayout(spec.layoutText);
  files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = rels([{ id: 'rId1', type: `${REL}/slideMaster`, target: '../slideMasters/slideMaster1.xml' }]);
  files['ppt/theme/theme1.xml'] = theme();
  const { coreXml, appXml } = docProps(spec.core, { application: 'Microsoft Office PowerPoint', ...spec.app });
  files['docProps/core.xml'] = coreXml;
  files['docProps/app.xml'] = appXml;
  files['_rels/.rels'] = rels([
    { id: 'rId1', type: `${REL}/officeDocument`, target: 'ppt/presentation.xml' },
    { id: 'rId2', type: `${PKG_REL}/metadata/core-properties`, target: 'docProps/core.xml' },
    { id: 'rId3', type: `${REL}/extended-properties`, target: 'docProps/app.xml' },
  ]);
  return zip({ '[Content_Types].xml': contentTypes([], ct), ...files });
}

const para = (p) => {
  const runs = typeof p === 'string' ? [[p, false]] : p;
  return `<a:p>${runs.map(([t, b]) => `<a:r><a:rPr lang="ru-RU" sz="1800"${b ? ' b="1"' : ''} dirty="0"/><a:t>${esc(t)}</a:t></a:r>`).join('')}</a:p>`;
};

/** Фигура слайда → XML (id — счётчик фигур слайда). */
function shapeXml(s, nextId) {
  if (s.type === 'group') {
    const id = nextId();
    return (
      `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="Group ${id}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
      '<p:grpSpPr><a:xfrm><a:off x="457200" y="3657600"/><a:ext cx="6096000" cy="1828800"/><a:chOff x="457200" y="3657600"/><a:chExt cx="6096000" cy="1828800"/></a:xfrm></p:grpSpPr>' +
      `${s.items.map((x) => shapeXml(x, nextId)).join('')}</p:grpSp>`
    );
  }
  if (s.type === 'table') {
    const id = nextId();
    const cols = s.rows[0].length;
    const cw = Math.floor((s.w * EMU) / cols);
    const rows = s.rows
      .map((r) => `<a:tr h="370840">${r.map((c) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${para(c)}</a:txBody><a:tcPr/></a:tc>`).join('')}</a:tr>`)
      .join('');
    return (
      `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>` +
      `<p:xfrm><a:off x="${s.x * EMU}" y="${s.y * EMU}"/><a:ext cx="${cw * cols}" cy="${370840 * s.rows.length}"/></p:xfrm>` +
      `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${'<a:gridCol w="' + cw + '"/>'.repeat(cols)}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
    );
  }
  const id = nextId();
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${s.title ? 'Title' : 'TextBox'} ${id}"${s.alt ? ` descr="${esc(s.alt)}"` : ''}/>` +
    (s.title ? '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>' : '<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>') +
    `<p:spPr><a:xfrm><a:off x="${s.x * EMU}" y="${s.y * EMU}"/><a:ext cx="${s.w * EMU}" cy="${s.h * EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" rtlCol="0"/><a:lstStyle/>${s.paras.map(para).join('')}</p:txBody></p:sp>`
  );
}

const spTreeHead =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const CLR_MAP =
  'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"';

function slideMaster() {
  return (
    `${XML_HEAD}<p:sldMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${spTreeHead}` +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>' +
    '<p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
    '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="ru-RU"/><a:t>Образец заголовка</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>' +
    `<p:clrMap ${CLR_MAP}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>` +
    '<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>'
  );
}

function slideLayout(text) {
  const extra = text
    ? '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Footer 2"/><p:cNvSpPr txBox="1"/><p:nvPr userDrawn="1"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="6356350"/><a:ext cx="6000000" cy="365125"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
      `<p:txBody><a:bodyPr/><a:lstStyle/>${para(text)}</p:txBody></p:sp>`
    : '';
  return (
    `${XML_HEAD}<p:sldLayout xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" type="blank" preserve="1"><p:cSld name="Пустой слайд"><p:spTree>${spTreeHead}${extra}</p:spTree></p:cSld>` +
    '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'
  );
}

function notesMaster() {
  return (
    `${XML_HEAD}<p:notesMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${spTreeHead}` +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>' +
    '<p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="ru-RU"/></a:p></p:txBody></p:sp>' +
    `</p:spTree></p:cSld><p:clrMap ${CLR_MAP}/><p:notesStyle><a:lvl1pPr><a:defRPr sz="1200"/></a:lvl1pPr></p:notesStyle></p:notesMaster>`
  );
}

function notesSlide(paras) {
  return (
    `${XML_HEAD}<p:notes xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree>${spTreeHead}` +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>' +
    `<p:txBody><a:bodyPr/><a:lstStyle/>${paras.map(para).join('')}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`
  );
}

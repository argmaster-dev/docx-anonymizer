#!/usr/bin/env node
// Фикстуры скрытых данных (версия 0.5, WP12-D, Ц4, К7; docs/concept-0.5.md п. 6, docs/contracts.md §9.9) — tests/fixtures/hidden/:
//   contract-hidden.docx — договор с тремя комментариями (comments, commentsExtended, commentsIds, people.xml), историей правок
//     (вставка, удаление, перемещение, изменения свойств рана и абзаца, удалённый и вставленный знак абзаца, удалённая строка
//     таблицы, правка ячейки) и скрытым текстом (w:vanish в ране, стиль символа и стиль абзаца со скрытым текстом, w:specVanish);
//   book-hidden.xlsx — книга со скрытым и «очень скрытым» листами, скрытыми строкой и столбцом, примечанием и цепочкой комментариев,
//     формулой и именем книги со ссылкой на скрытый лист, локальными именами листов (localSheetId);
//   deck-hidden.pptx — презентация со скрытым слайдом (заметки, гиперссылка на него, произвольный показ и раздел), обычными
//     и современными комментариями;
//   expected.json — счётчики (считаются здесь, при сборке, независимо от разбора) и значения, которые лежат только в скрытом.
// Реальные файлы LibreOffice (tests/fixtures/hidden/real/lo-*.docx|xlsx|pptx) — из плоских ODF ниже, `--real` (нужен soffice;
// результат зависит от версии LibreOffice, поэтому в --check не сверяется). Все люди, номера и адреса вымышленные. Без сети.
//
//   node scripts/gen-hidden-fixtures.mjs            — записать
//   node scripts/gen-hidden-fixtures.mjs --check    — сверить с репозиторием (код 1 при расхождении)
//   node scripts/gen-hidden-fixtures.mjs --real     — пересобрать файлы LibreOffice (локально)
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZip, readZip, inflateEntry } from '../src/core/ooxml/zip.js';
import { buildXlsx, buildPptx } from './office-writer.mjs';
import { NS, DECL, esc, inn10, snils } from './make-sample.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const HIDDEN_DIR = join(root, 'tests/fixtures/hidden');
const enc = new TextEncoder();
const dec = new TextDecoder();
const zip = (files) => writeZip(Object.entries(files).map(([name, d]) => ({ name, data: typeof d === 'string' ? enc.encode(d) : d })));
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const D = '2026-10-01T10:00:00Z';

/** Значения, которые в документе лежат только в скрытом (обезличиваются в любом режиме). */
const INN_HIDDEN = inn10('770708389');
const SNILS_HIDDEN = snils('112233445');
/** ИНН в скрытом столбце книги. */
const INN_COLUMN = inn10('500100732');

/* ---------------- Word ---------------- */

/**
 * Договор со скрытым: счётчики ведутся по мере сборки — это ожидание теста, а не результат разбора.
 * @returns {{bytes: Uint8Array, counts: {comments: number, revisions: number, hiddenText: number}, secrets: string[], visible: string[]}}
 */
export function buildHiddenDocx() {
  let rev = 0;
  let hiddenRuns = 0;
  let id = 10;
  const author = 'Лаптев Игорь Семёнович';
  const ch = () => `w:id="${id++}" w:author="${author}" w:date="${D}"`;
  const t = (text) => `<w:t xml:space="preserve">${esc(text)}</w:t>`;
  const run = (text, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${t(text)}</w:r>`;
  const hiddenRun = (text, rPr) => {
    hiddenRuns++;
    return run(text, rPr);
  };
  const ins = (inner) => {
    rev++;
    return `<w:ins ${ch()}>${inner}</w:ins>`;
  };
  const del = (text) => {
    rev++;
    return `<w:del ${ch()}><w:r><w:delText xml:space="preserve">${esc(text)}</w:delText></w:r></w:del>`;
  };
  const change = (name, inner) => {
    rev++;
    return `<w:${name} ${ch()}>${inner}</w:${name}>`;
  };
  const mark = (name) => {
    rev++;
    return `<w:${name} ${ch()}/>`;
  };
  const para = (inner, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inner}</w:p>`;
  const anchor = (n, inner) => `<w:commentRangeStart w:id="${n}"/>${inner}<w:commentRangeEnd w:id="${n}"/>` + ref(n);
  const ref = (n) => `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${n}"/></w:r>`;

  const body = [
    para(run('ДОГОВОР ПОСТАВКИ № 15/26', '<w:b/>'), '<w:jc w:val="center"/>'),
    // комментарий 0 — на названии стороны
    para(run('Поставщик: ') + anchor(0, run('ООО «Северный ветер»')) + run(', в лице директора Громова Степана Аркадьевича.')),
    // вставка: новый покупатель (ФИО только во вставке — маскируется и без «Принять исправления»)
    para(run('Покупатель: ') + ins(run('Зайцева Ольга Викторовна')) + run(', действующая от своего имени.')),
    // удаление: прежний телефон остался в истории правок
    para(run('Телефон для связи: ') + del('+7 916 204-55-81') + run('+7 916 204-55-82.')),
    // перемещение текста с метками диапазона
    para(
      `<w:moveFromRangeStart w:id="${id++}" w:author="${author}" w:date="${D}" w:name="move1"/>` +
        `<w:moveFrom ${(rev++, ch())}><w:r>${t('Срок поставки — 10 дней. ')}</w:r></w:moveFrom>` +
        `<w:moveFromRangeEnd w:id="${id - 2}"/>` +
        run('Оплата — в течение 5 дней.'),
    ),
    para(
      run('Порядок: ') +
        `<w:moveToRangeStart w:id="${id++}" w:author="${author}" w:date="${D}" w:name="move1"/>` +
        `<w:moveTo ${(rev++, ch())}><w:r>${t('Срок поставки — 10 дней.')}</w:r></w:moveTo>` +
        `<w:moveToRangeEnd w:id="${id - 2}"/>`,
    ),
    // изменение свойств рана и абзаца
    para(
      `<w:r><w:rPr><w:b/>${change('rPrChange', '<w:rPr/>')}</w:rPr>${t('Цена включает НДС.')}</w:r>`,
      `<w:jc w:val="both"/>${change('pPrChange', '<w:pPr/>')}`,
    ),
    // удалённый знак абзаца: абзац склеивается со следующим
    para(run('Адрес доставки: г. Тверь, ул. Озёрная, д. 7'), `<w:rPr>${mark('del')}</w:rPr>`),
    para(run(', склад № 2.')),
    // вставленный знак абзаца
    para(run('Приёмка — по акту.'), `<w:rPr>${mark('ins')}</w:rPr>`),
    // комментарий 1 — на абзаце с паспортом
    para(anchor(1, run('Паспорт представителя: 4510 381946, выдан ОВД района Сокол.'))),
    // скрытый текст: напрямую, стилем символа, w:specVanish
    para(run('Реквизиты сторон — в приложении. ') + hiddenRun(`Служебно: ИНН ${INN_HIDDEN}.`, '<w:vanish/>')),
    para(run('Контакт: ') + hiddenRun(`СНИЛС ${SNILS_HIDDEN}`, '<w:rStyle w:val="HiddenChar"/>') + run(' — уточняется.')),
    para(hiddenRun('Метка раздела', '<w:specVanish/>') + run('Раздел 2. Ответственность сторон.')),
    // абзац целиком скрыт стилем абзаца
    para(hiddenRun('Резервный контакт: Белова Ирина Олеговна, ') + hiddenRun('irina.belova@example.net'), '<w:pStyle w:val="HiddenPara"/>'),
    // таблица: удалённая строка, вставленная ячейка, комментарий 2 в ячейке
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>' +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${para(run('Сторона'))}</w:tc><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${para(run('Подписант'))}</w:tc></w:tr>` +
      `<w:tr><w:trPr>${mark('del')}</w:trPr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${para(del('Гарант'))}</w:tc><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${para(del('Кравцов Олег Юрьевич'))}</w:tc></w:tr>` +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/>${mark('cellIns')}</w:tcPr>${para(run('Покупатель'))}</w:tc><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${para(anchor(2, run('Зайцева О. В.')))}</w:tc></w:tr>` +
      '</w:tbl>',
    para(run('Подписи сторон.')),
  ].join('');

  const sect =
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>';
  const comment = (n, who, initials, text, paraId) =>
    `<w:comment w:id="${n}" w:author="${who}" w:date="${D}" w:initials="${initials}"><w:p w14:paraId="${paraId}"><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>` +
    `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>${run(text)}</w:p></w:comment>`;
  const comments = [
    comment(0, 'Сидорова Анна Петровна', 'СА', 'Сверить с выпиской: директор Громов С. А., телефон +7 903 718-40-26.', '1A2B3C01'),
    comment(1, 'Сидорова Анна Петровна', 'СА', 'Паспорт проверен, прописка: г. Тверь, ул. Лесная, д. 3, кв. 14.', '1A2B3C02'),
    comment(2, author, 'ЛИ', 'Подписант заменён по письму от 01.10.2026.', '1A2B3C03'),
  ];
  const ct = (part, type) => `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/>`;
  const files = {
    '[Content_Types].xml':
      `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      ct('word/document.xml', 'document.main') +
      ct('word/styles.xml', 'styles') +
      ct('word/settings.xml', 'settings') +
      ct('word/comments.xml', 'comments') +
      ct('word/commentsExtended.xml', 'commentsExtended') +
      ct('word/commentsIds.xml', 'commentsIds') +
      ct('word/people.xml', 'people') +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
    '_rels/.rels':
      `${DECL}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>` +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
    'docProps/core.xml':
      `${DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
      `<dc:creator>${author}</dc:creator></cp:coreProperties>`,
    'word/_rels/document.xml.rels':
      `${DECL}<Relationships xmlns="${PKG_REL}">` +
      `<Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/>` +
      `<Relationship Id="rId2" Type="${REL}/settings" Target="settings.xml"/>` +
      `<Relationship Id="rId3" Type="${REL}/comments" Target="comments.xml"/>` +
      '<Relationship Id="rId4" Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"/>' +
      '<Relationship Id="rId5" Type="http://schemas.microsoft.com/office/2016/09/relationships/commentsIds" Target="commentsIds.xml"/>' +
      '<Relationship Id="rId6" Type="http://schemas.microsoft.com/office/2011/relationships/people" Target="people.xml"/></Relationships>',
    'word/document.xml': `${DECL}<w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`,
    'word/styles.xml':
      `${DECL}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="HiddenBase"><w:name w:val="Hidden base"/><w:basedOn w:val="Normal"/><w:rPr><w:vanish/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="HiddenPara"><w:name w:val="Hidden para"/><w:basedOn w:val="HiddenBase"/></w:style>' +
      '<w:style w:type="character" w:styleId="HiddenChar"><w:name w:val="Hidden char"/><w:rPr><w:vanish/></w:rPr></w:style>' +
      '<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/></w:style></w:styles>',
    'word/settings.xml': `${DECL}<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:trackRevisions/></w:settings>`,
    'word/comments.xml': `${DECL}<w:comments ${NS}>${comments.join('')}</w:comments>`,
    'word/commentsExtended.xml':
      `${DECL}<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">` +
      ['1A2B3C01', '1A2B3C02', '1A2B3C03'].map((x, i) => `<w15:commentEx w15:paraId="${x}" w15:done="${i === 2 ? 1 : 0}"/>`).join('') +
      '</w15:commentsEx>',
    'word/commentsIds.xml':
      `${DECL}<w16cid:commentsIds xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid">` +
      ['1A2B3C01', '1A2B3C02', '1A2B3C03'].map((x, i) => `<w16cid:commentId w16cid:paraId="${x}" w16cid:durableId="${7000 + i}"/>`).join('') +
      '</w16cid:commentsIds>',
    'word/people.xml':
      `${DECL}<w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">` +
      ['Сидорова Анна Петровна', author]
        .map((x) => `<w15:person w15:author="${x}"><w15:presenceInfo w15:providerId="None" w15:userId="${x}"/></w15:person>`)
        .join('') +
      '</w15:people>',
  };
  return {
    bytes: zip(files),
    counts: { comments: comments.length, revisions: rev, hiddenText: hiddenRuns },
    // только в скрытом: комментарии, удалённый текст, скрытые раны, удалённая строка таблицы, авторы
    secrets: [
      '+7 903 718-40-26',
      'ул. Лесная, д. 3, кв. 14',
      '+7 916 204-55-81',
      INN_HIDDEN,
      SNILS_HIDDEN,
      'Белова Ирина Олеговна',
      'irina.belova@example.net',
      'Кравцов Олег Юрьевич',
      'Сидорова Анна Петровна',
      author,
    ],
    // текст, который после «Принять исправления» обязан остаться (вставки, перемещение — на новом месте)
    accepted: ['действующая от своего имени', 'Срок поставки — 10 дней.', 'склад № 2', 'Подписи сторон.'],
  };
}

/* ---------------- Excel ---------------- */

/** Книга со скрытым: листы, строка, столбец, примечание и цепочка, ссылки на скрытый лист, локальные имена. */
export function buildHiddenXlsx() {
  const people = [{ name: 'Лаптев Игорь Семёнович', userId: 'laptev@example.org' }];
  const base = buildXlsx({
    persons: people,
    sheets: [
      {
        name: 'Клиенты',
        cols: [28, 18, 14, 12],
        hiddenRows: [3],
        rows: [
          ['ФИО', 'Телефон', 'ИНН', 'Город'],
          ['Громов Степан Аркадьевич', '+7 916 204-55-82', { s: INN_COLUMN, inline: true }, 'Тверь'],
          ['Белова Ирина Олеговна', '+7 903 111-22-33', 'нет', 'Омск'],
          ['Итого', { f: "'Резерв'!A1", v: 'Кравцов Олег Юрьевич', str: true }, null, null],
        ],
        comments: [{ ref: 'B2', author: 'Сидорова Анна Петровна', text: 'Паспорт 4510 381946, звонить после 18:00' }],
        threaded: [{ ref: 'A2', person: 'Лаптев Игорь Семёнович', text: 'Уточнить у Кравцова, тел. +7 903 718-40-26' }],
      },
      { name: 'Резерв', hidden: true, rows: [['Кравцов Олег Юрьевич', `ИНН ${INN_HIDDEN}`]] },
      { name: 'Итоги', rows: [['Всего клиентов', { f: 'COUNTA(Клиенты!A2:A3)', v: 2 }]] },
      { name: 'Служебный', hidden: true, rows: [[`СНИЛС ${SNILS_HIDDEN}`]] },
    ],
    definedNames: [{ name: 'Резервный', ref: "'Резерв'!$A$1:$B$1" }],
  });
  const files = unzipFiles(base);
  // скрытый столбец C (ИНН — секрет только там), четвёртый лист — «очень скрытый», локальные имена листов 2 и 3
  files['xl/worksheets/sheet1.xml'] = files['xl/worksheets/sheet1.xml'].replace(
    '<col min="3" max="3" width="14" customWidth="1"/>',
    '<col min="3" max="3" width="14" customWidth="1" hidden="1"/>',
  );
  files['xl/workbook.xml'] = files['xl/workbook.xml']
    .replace('<sheet name="Служебный" sheetId="4" state="hidden"', '<sheet name="Служебный" sheetId="4" state="veryHidden"')
    .replace(
      '</definedNames>',
      '<definedName name="_xlnm.Print_Area" localSheetId="1">\'Резерв\'!$A$1:$B$1</definedName>' +
        '<definedName name="_xlnm.Print_Area" localSheetId="2">Итоги!$A$1:$B$1</definedName></definedNames>',
    )
    .replace('<workbookView ', '<workbookView activeTab="2" ');
  return {
    bytes: zip(files),
    counts: { comments: 2, hiddenSheets: 2, hiddenRows: 1, hiddenCols: 1 },
    secrets: [
      'Белова Ирина Олеговна',
      '+7 903 111-22-33',
      INN_COLUMN,
      'Кравцов Олег Юрьевич',
      INN_HIDDEN,
      SNILS_HIDDEN,
      '4510 381946',
      '+7 903 718-40-26',
      'Сидорова Анна Петровна',
      'Лаптев Игорь Семёнович',
    ],
  };
}

/* ---------------- PowerPoint ---------------- */

/** Презентация со скрытым слайдом и комментариями обоих видов. */
export function buildHiddenPptx() {
  const box = (text, y = 1) => ({ x: 1, y, w: 8, h: 1, paras: [text] });
  const base = buildPptx({
    authors: [
      { name: 'Сидорова Анна Петровна', initials: 'СА' },
      { name: 'Лаптев Игорь Семёнович', initials: 'ЛИ', userId: 'laptev@example.org' },
    ],
    slides: [
      {
        shapes: [{ ...box('Проект поставки', 0.5), title: true }, box('Заказчик — ООО «Северный ветер». Подробности — на слайде резерва.', 2)],
        comments: [
          { author: 'Сидорова Анна Петровна', text: 'Директор Громов, телефон +7 903 718-40-26' },
          { author: 'Лаптев Игорь Семёнович', text: 'Согласовано' },
        ],
      },
      {
        hidden: true,
        shapes: [box(`Резерв: Кравцов Олег Юрьевич, ИНН ${INN_HIDDEN}`)],
        notes: [`Не показывать: СНИЛС ${SNILS_HIDDEN}`],
      },
      {
        shapes: [box('Сроки и оплата')],
        modernComments: [
          { author: 'Лаптев Игорь Семёнович', text: 'Паспорт 4510 381946 приложить', replies: [{ author: 'Сидорова Анна Петровна', text: 'Готово' }] },
        ],
      },
    ],
  });
  const files = unzipFiles(base);
  // гиперссылка первого слайда на скрытый, произвольный показ и раздел со скрытым слайдом, ссылка на современные комментарии
  files['ppt/slides/_rels/slide1.xml.rels'] = files['ppt/slides/_rels/slide1.xml.rels'].replace(
    '</Relationships>',
    `<Relationship Id="rId9" Type="${REL}/slide" Target="slide2.xml"/></Relationships>`,
  );
  files['ppt/slides/slide1.xml'] = files['ppt/slides/slide1.xml'].replace(
    /(<a:r><a:rPr[^>]*?)\/>(<a:t>Заказчик)/,
    '$1><a:hlinkClick r:id="rId9" action="ppaction://hlinksldjump"/></a:rPr>$2',
  );
  const rels3 = files['ppt/slides/_rels/slide3.xml.rels'];
  const modernId = /Id="(rId\d+)"[^>]*2018\/10\/relationships\/comments/.exec(rels3)?.[1];
  files['ppt/slides/slide3.xml'] = files['ppt/slides/slide3.xml'].replace(
    '</p:sld>',
    '<p:extLst><p:ext uri="{6950BFC3-D8DA-4A85-94F7-54DA5524770B}"><p188:commentRel xmlns:p188="http://schemas.microsoft.com/office/powerpoint/2018/8/main" ' +
      `r:id="${modernId}"/></p:ext></p:extLst></p:sld>`,
  );
  files['ppt/presentation.xml'] = files['ppt/presentation.xml']
    .replace(
      '<p:defaultTextStyle>',
      '<p:custShowLst><p:custShow name="Кратко" id="0"><p:sldLst><p:sld r:id="rId10"/><p:sld r:id="rId11"/></p:sldLst></p:custShow></p:custShowLst><p:defaultTextStyle>',
    )
    .replace(
      '</p:presentation>',
      '<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">' +
        '<p14:section name="Основной" id="{11111111-2222-4333-8444-555555555555}"><p14:sldIdLst><p14:sldId id="256"/><p14:sldId id="257"/><p14:sldId id="258"/></p14:sldIdLst></p14:section>' +
        '</p14:sectionLst></p:ext></p:extLst></p:presentation>',
    );
  if (!files['ppt/slides/slide1.xml'].includes('hlinkClick') || !modernId) throw new Error('gen-hidden-fixtures: шаблон презентации изменился');
  return {
    bytes: zip(files),
    counts: { comments: 3, hiddenSlides: 1 },
    secrets: ['Кравцов Олег Юрьевич', INN_HIDDEN, SNILS_HIDDEN, '+7 903 718-40-26', '4510 381946', 'Сидорова Анна Петровна', 'Лаптев Игорь Семёнович'],
  };
}

/** Записи zip → {имя: текст} (бинарных записей в шаблонах office-writer нет). */
function unzipFiles(bytes) {
  return Object.fromEntries(readZip(bytes).map((e) => [e.name, dec.decode(inflateEntry(e))]));
}

/* ---------------- LibreOffice (настоящие файлы) ---------------- */

const ODF_NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" ' +
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2" xmlns:officeooo="http://openoffice.org/2009/office"';

/** Плоские ODF-исходники: документ с правками и комментарием, книга со скрытым листом/строкой/столбцом и примечанием, презентация. */
export const REAL_SOURCES = {
  'lo-contract.fodt': {
    out: 'lo-contract.docx',
    filter: 'docx:MS Word 2007 XML',
    xml:
      `<?xml version="1.0" encoding="UTF-8"?><office:document ${ODF_NS} office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">` +
      '<office:automatic-styles><style:style style:name="T1" style:family="text"><style:text-properties text:display="none"/></style:style></office:automatic-styles>' +
      '<office:body><office:text><text:tracked-changes text:track-changes="true">' +
      '<text:changed-region xml:id="ct1" text:id="ct1"><text:insertion><office:change-info><dc:creator>Лаптев Игорь Семёнович</dc:creator><dc:date>2026-10-01T10:00:00</dc:date></office:change-info></text:insertion></text:changed-region>' +
      '<text:changed-region xml:id="ct2" text:id="ct2"><text:deletion><office:change-info><dc:creator>Лаптев Игорь Семёнович</dc:creator><dc:date>2026-10-01T10:05:00</dc:date></office:change-info><text:p>телефон +7 916 204-55-81</text:p></text:deletion></text:changed-region>' +
      '</text:tracked-changes>' +
      '<text:p>Договор поставки. <text:change-start text:change-id="ct1"/>Почта для связи: zaitseva.olga@example.org.<text:change-end text:change-id="ct1"/> Прежний <text:change text:change-id="ct2"/>указан.</text:p>' +
      '<text:p>Поставщик<office:annotation><dc:creator>Сидорова Анна Петровна</dc:creator><dc:date>2026-10-02T09:00:00</dc:date><text:p>Проверить паспорт 4510 381946</text:p></office:annotation> — Громов Степан Аркадьевич.</text:p>' +
      `<text:p>Видимый текст. <text:span text:style-name="T1">Служебно: ИНН ${INN_HIDDEN}</text:span></text:p>` +
      '</office:text></office:body></office:document>',
    counts: { comments: 1, revisions: 2, hiddenText: 1 },
    secrets: ['+7 916 204-55-81', 'zaitseva.olga@example.org', '4510 381946', 'Сидорова Анна Петровна', 'Лаптев Игорь Семёнович', INN_HIDDEN],
  },
  'lo-book.fods': {
    out: 'lo-book.xlsx',
    filter: 'xlsx:Calc MS Excel 2007 XML',
    xml:
      `<?xml version="1.0" encoding="UTF-8"?><office:document ${ODF_NS} office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">` +
      '<office:automatic-styles><style:style style:name="ta1" style:family="table"><style:table-properties table:display="true"/></style:style>' +
      '<style:style style:name="ta2" style:family="table"><style:table-properties table:display="false"/></style:style></office:automatic-styles>' +
      '<office:body><office:spreadsheet><table:table table:name="Клиенты" table:style-name="ta1">' +
      '<table:table-column/><table:table-column table:visibility="collapse"/><table:table-column/>' +
      '<table:table-row><table:table-cell office:value-type="string"><text:p>ФИО</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Телефон</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Город</text:p></table:table-cell></table:table-row>' +
      '<table:table-row><table:table-cell office:value-type="string"><text:p>Громов Степан Аркадьевич</text:p><office:annotation><dc:creator>Сидорова Анна Петровна</dc:creator><dc:date>2026-10-02T09:00:00</dc:date><text:p>Паспорт 4510 381946</text:p></office:annotation></table:table-cell><table:table-cell office:value-type="string"><text:p>+7 916 204-55-81</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Тверь</text:p></table:table-cell></table:table-row>' +
      '<table:table-row table:visibility="collapse"><table:table-cell office:value-type="string"><text:p>Белова Ирина Олеговна</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>+7 903 111-22-33</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Омск</text:p></table:table-cell></table:table-row>' +
      '<table:table-row><table:table-cell office:value-type="string"><text:p>Итого</text:p></table:table-cell><table:table-cell table:formula="of:=[$Резерв.A1]" office:value-type="string" office:string-value="Кравцов Олег Юрьевич"><text:p>Кравцов Олег Юрьевич</text:p></table:table-cell></table:table-row>' +
      '</table:table><table:table table:name="Резерв" table:style-name="ta2">' +
      `<table:table-row><table:table-cell office:value-type="string"><text:p>Кравцов Олег Юрьевич</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>ИНН ${INN_HIDDEN}</text:p></table:table-cell></table:table-row>` +
      '</table:table></office:spreadsheet></office:body></office:document>',
    counts: { comments: 1, hiddenSheets: 1, hiddenRows: 1, hiddenCols: 1 },
    secrets: ['Белова Ирина Олеговна', '+7 903 111-22-33', '+7 916 204-55-81', 'Кравцов Олег Юрьевич', INN_HIDDEN, '4510 381946', 'Сидорова Анна Петровна'],
  },
  'lo-deck.fodp': {
    out: 'lo-deck.pptx',
    filter: 'pptx:Impress MS PowerPoint 2007 XML',
    xml:
      `<?xml version="1.0" encoding="UTF-8"?><office:document ${ODF_NS} office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.presentation">` +
      '<office:automatic-styles><style:style style:name="dp1" style:family="drawing-page"/>' +
      '<style:style style:name="dp2" style:family="drawing-page"><style:drawing-page-properties presentation:visibility="hidden"/></style:style></office:automatic-styles>' +
      '<office:master-styles><style:master-page style:name="Default"/></office:master-styles>' +
      '<office:body><office:presentation>' +
      '<draw:page draw:name="page1" draw:style-name="dp1" draw:master-page-name="Default"><draw:frame svg:width="20cm" svg:height="3cm" svg:x="2cm" svg:y="2cm"><draw:text-box><text:p>Проект для ООО «Северный ветер»</text:p></draw:text-box></draw:frame>' +
      '<officeooo:annotation svg:x="1cm" svg:y="1cm"><dc:creator>Сидорова Анна Петровна</dc:creator><dc:date>2026-10-02T09:00:00</dc:date><text:p>Телефон клиента +7 916 204-55-81</text:p></officeooo:annotation></draw:page>' +
      '<draw:page draw:name="page2" draw:style-name="dp2" draw:master-page-name="Default"><draw:frame svg:width="20cm" svg:height="3cm" svg:x="2cm" svg:y="2cm"><draw:text-box>' +
      `<text:p>Резерв: Кравцов Олег Юрьевич, ИНН ${INN_HIDDEN}</text:p></draw:text-box></draw:frame></draw:page>` +
      '</office:presentation></office:body></office:document>',
    counts: { comments: 1, hiddenSlides: 1 },
    secrets: ['+7 916 204-55-81', 'Кравцов Олег Юрьевич', INN_HIDDEN, 'Сидорова Анна Петровна'],
  },
};

/** Пересборка настоящих файлов LibreOffice (snap-LibreOffice не видит /tmp и скрытые каталоги — работаем в test-output/). */
function buildReal() {
  const soffice = ['soffice', 'libreoffice'].find((b) => spawnSync('which', [b]).status === 0);
  if (!soffice) throw new Error('нет soffice/libreoffice');
  const work = join(root, 'test-output', 'hidden-real');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(join(work, 'out'), { recursive: true });
  const outDir = join(HIDDEN_DIR, 'real');
  mkdirSync(outDir, { recursive: true });
  for (const [src, spec] of Object.entries(REAL_SOURCES)) {
    writeFileSync(join(work, src), spec.xml);
    const res = spawnSync(
      soffice,
      [`-env:UserInstallation=file://${join(work, 'profile')}`, '--headless', '--convert-to', spec.filter, join(work, src), '--outdir', join(work, 'out')],
      { encoding: 'utf8', timeout: 300000 },
    );
    const made = join(work, 'out', spec.out);
    if (res.status !== 0 || !existsSync(made)) throw new Error(`LibreOffice: ${src} не сконвертирован`);
    copyFileSync(made, join(outDir, spec.out));
    writeFileSync(join(outDir, src), spec.xml);
  }
}

/** Все синтетические фикстуры и ожидания. */
export function buildAll() {
  const docx = buildHiddenDocx();
  const xlsx = buildHiddenXlsx();
  const pptx = buildHiddenPptx();
  const expected = {
    'contract-hidden.docx': { counts: docx.counts, secrets: docx.secrets, accepted: docx.accepted },
    'book-hidden.xlsx': { counts: xlsx.counts, secrets: xlsx.secrets },
    'deck-hidden.pptx': { counts: pptx.counts, secrets: pptx.secrets },
    ...Object.fromEntries(Object.values(REAL_SOURCES).map((s) => [`real/${s.out}`, { counts: s.counts, secrets: s.secrets }])),
  };
  return {
    'contract-hidden.docx': docx.bytes,
    'book-hidden.xlsx': xlsx.bytes,
    'deck-hidden.pptx': pptx.bytes,
    'expected.json': enc.encode(`${JSON.stringify(expected, null, 2)}\n`),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check');
  if (process.argv.includes('--real')) buildReal();
  mkdirSync(HIDDEN_DIR, { recursive: true });
  let bad = 0;
  for (const [name, bytes] of Object.entries(buildAll())) {
    const path = join(HIDDEN_DIR, name);
    if (check) {
      if (!existsSync(path) || Buffer.compare(readFileSync(path), Buffer.from(bytes)) !== 0) {
        console.error(`расходится: ${name}`);
        bad++;
      }
    } else writeFileSync(path, bytes);
  }
  if (bad) process.exit(1);
  console.log(check ? 'фикстуры скрытых данных совпадают' : `записано в ${HIDDEN_DIR}`);
}

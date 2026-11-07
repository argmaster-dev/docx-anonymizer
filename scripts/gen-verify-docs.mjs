#!/usr/bin/env node
// Контрольные документы для самостоятельной проверки (версия 0.5.2, WP14-A, docs/concept-0.5.2.md Ц5, К7): договор (.docx),
// реестр клиентов (.xlsx), справка (PDF с текстовым слоем), «фото паспорта» (.png — формат не проверяется) и служебная записка
// с намеренно трудными случаями (одиночная фамилия без метки, иностранное имя вне словарей). Все данные ВЫМЫШЛЕННЫЕ; номера
// с контрольными суммами (ИНН, СНИЛС, ОГРН, счета) посчитаны для несуществующих значений. Сети не требует.
//
// Пишет в docs/verify/ сами документы и expected.json — что должно замаскироваться (`mayMiss: true` — трудный случай, расширение
// может его пропустить; такое маскируют вручную на вкладке «Текст» панели). README с таблицами — docs/verify/README.md (вручную).
// PDF и PNG рисует Chromium Playwright (page.pdf / screenshot): байты PDF недетерминированы (дата создания), это не важно.
//
// Использование:
//   node scripts/gen-verify-docs.mjs            — записать документы и expected.json
//   node scripts/gen-verify-docs.mjs --check    — прогнать записанные документы через конвейер ядра (тот же анализ и замена, что
//                                                 в расширении; настройки по умолчанию) и сверить с expected.json: что найдено,
//                                                 что пропущено, что осталось в результате; NER_MODEL_DIR=<каталог модели> — с моделью
//   --out=<каталог>                             — другой каталог (по умолчанию docs/verify)
// Код выхода --check: 1, если пропущено или утекло значение без mayMiss.
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pack, cell, tbl, title } from './gen-fixtures.mjs';
import { inn10, inn12, ogrn13, snils, account, r, p, B } from './make-sample.mjs';
import { buildXlsx, esc } from './office-writer.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const OUT = resolve(args.find((a) => a.startsWith('--out='))?.slice(6) || join(root, 'docs/verify'));

/* ---------- вымышленные реквизиты ---------- */
const BIK = '044525901';
const V = {
  // договор: заказчик — физическое лицо, исполнитель — ООО (организации по умолчанию не маскируются)
  belov: 'Белов Андрей Викторович',
  belovShort: 'Белов А. В.',
  passport: '45 12 345678',
  passportDept: '770-045',
  passportDate: '12.03.2015',
  passportIssuer: 'ГУ МВД России по г. Москве',
  belovAddress: 'г. Москва, ул. Садовая, д. 14, кв. 27',
  belovPhone: '+7 (916) 555-12-34',
  belovEmail: 'a.belov@example.com',
  belovSnils: snils('112233445'),
  belovInn: inn12('7701234567'),
  company: 'ООО «Вектор Плюс»',
  companyInn: inn10('770912345'),
  companyOgrn: ogrn13('102770012345'),
  companyAcc: account(BIK, '40702810000000012345', 'rs'),
  companyKs: account(BIK, '30101810000000000901', 'ks'),
  director: 'Кравцова Ирина Олеговна',
  directorShort: 'Кравцова И. О.',
  // справка (PDF)
  sokolova: 'Соколова Марина Андреевна',
  sokolovaDat: 'Соколовой Марине Андреевне',
  sokolovaBirth: '14.05.1988',
  sokolovaPassport: '46 09 876543',
  sokolovaAddress: 'г. Тверь, ул. Озёрная, д. 3, кв. 41',
  hrPhone: '+7 (495) 123-45-67',
  hrEmail: 'kadry@example.org',
  hrHead: 'Мельникова Ольга Петровна',
  // служебная записка с трудными случаями
  zakharova: 'Захарова Елена Павловна',
  zakharovaPhone: '+7 (921) 444-33-22',
  lagunov: 'Лагунов', // одиночная фамилия без имени и метки
  foreign: 'Tenzing Norbu', // иностранное имя вне словарей
  courierEmail: 'logist@example.net',
};
// реестр клиентов (Excel): ФИО, дата рождения, телефон, e-mail, ИНН, СНИЛС
const CLIENTS = [
  ['Гусева Анна Сергеевна', '03.02.1979', '+7 (903) 111-22-33', 'a.guseva@example.com', inn12('5001112223'), snils('123456789')],
  ['Ершов Павел Ильич', '21.11.1985', '+7 (903) 222-33-44', 'p.ershov@example.com', inn12('5002223334'), snils('234567891')],
  ['Тихонова Вера Николаевна', '09.07.1992', '+7 (903) 333-44-55', 'v.tikhonova@example.com', inn12('5003334445'), snils('345678912')],
  ['Фомин Глеб Аркадьевич', '30.12.1968', '+7 (903) 444-55-66', 'g.fomin@example.com', inn12('5004445556'), snils('456789123')],
];

/** Ожидания: value — как в документе, category — категория расширения, mayMiss — может пропустить (трудный случай). */
const e = (value, category, mayMiss = false) => ({ value, category, ...(mayMiss ? { mayMiss: true } : {}) });

/* ---------- 1. Договор (.docx) ---------- */
function contract() {
  const body = [
    title('ДОГОВОР ОКАЗАНИЯ УСЛУГ № 17/26'),
    p(r('г. Москва, 2 ноября 2026 г.')),
    p(
      r(
        `${V.company}, ИНН ${V.companyInn}, ОГРН ${V.companyOgrn}, именуемое в дальнейшем «Исполнитель», в лице генерального директора ${V.director}, действующей на основании Устава, с одной стороны, и гражданин РФ ${V.belov}, паспорт ${V.passport}, выдан ${V.passportIssuer} ${V.passportDate}, код подразделения ${V.passportDept}, зарегистрированный по адресу: ${V.belovAddress}, именуемый в дальнейшем «Заказчик», с другой стороны, заключили настоящий договор о нижеследующем.`,
      ),
    ),
    p(r('1. Предмет договора', B)),
    p(r('1.1. Исполнитель обязуется подготовить проект перепланировки квартиры Заказчика, а Заказчик — принять и оплатить работу.')),
    p(r('2. Связь сторон', B)),
    p(r(`2.1. Контакты Заказчика: телефон ${V.belovPhone}, электронная почта ${V.belovEmail}. СНИЛС Заказчика: ${V.belovSnils}, ИНН ${V.belovInn}.`)),
    p(r('3. Реквизиты и подписи сторон', B)),
    tbl([
      [cell('Исполнитель'), cell('Заказчик')],
      [
        cell(V.company, `ИНН ${V.companyInn}`, `ОГРН ${V.companyOgrn}`, `р/с ${V.companyAcc}`, `к/с ${V.companyKs}`, `БИК ${BIK}`),
        cell(V.belov, `Паспорт ${V.passport}`, `Адрес: ${V.belovAddress}`, `Тел.: ${V.belovPhone}`),
      ],
      [cell(`________ / ${V.directorShort} /`), cell(`________ / ${V.belovShort} /`)],
    ]),
  ].join('');
  const bytes = pack({
    body,
    core: '<dc:title>Договор оказания услуг</dc:title><dc:creator>Отдел договоров</dc:creator>',
    app: '<Application>Microsoft Office Word</Application>',
  });
  return {
    file: '01-dogovor.docx',
    title: 'Договор оказания услуг (Word)',
    bytes,
    expect: [
      e(V.belov, 'PERSON'),
      e(V.belovShort, 'PERSON'),
      e(V.director, 'PERSON'),
      e(V.directorShort, 'PERSON'),
      e(V.passport, 'PASSPORT'),
      e(V.passportIssuer, 'PASSPORT_ISSUER'),
      e(V.passportDate, 'PASSPORT_DATE'),
      e(V.passportDept, 'PASSPORT_DEPT'),
      e(V.belovAddress, 'ADDRESS'),
      e(V.belovPhone, 'PHONE'),
      e(V.belovEmail, 'EMAIL'),
      e(V.belovSnils, 'SNILS'),
      e(V.belovInn, 'INN'),
      e(V.companyInn, 'INN'),
      e(V.companyOgrn, 'OGRN'),
      e(V.companyAcc, 'ACCOUNT'),
      e(V.companyKs, 'ACCOUNT'),
      e(BIK, 'BIK'),
    ],
    // не маскируются при настройках по умолчанию: организация и номер договора — коммерческая информация (по желанию)
    stays: [V.company, '17/26'],
  };
}

/* ---------- 2. Реестр клиентов (.xlsx) ---------- */
function registry() {
  const head = ['ФИО', 'Дата рождения', 'Телефон', 'E-mail', 'ИНН', 'СНИЛС'];
  const bytes = buildXlsx({
    sheets: [{ name: 'Клиенты', rows: [head, ...CLIENTS], cols: [30, 14, 20, 26, 16, 16] }],
    core: { title: 'Реестр клиентов', creator: 'Отдел продаж' },
  });
  const cats = ['PERSON', 'BIRTHDATE', 'PHONE', 'EMAIL', 'INN', 'SNILS'];
  return {
    file: '02-reestr-klientov.xlsx',
    title: 'Реестр клиентов (Excel)',
    bytes,
    expect: CLIENTS.flatMap((row) => row.map((v, i) => e(v, cats[i]))),
    stays: head,
  };
}

/* ---------- 3. Справка (PDF с текстовым слоем) ---------- */
const PDF_HTML = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
body{font:13pt "Times New Roman",serif;margin:0;line-height:1.45}h1{font-size:15pt;text-align:center;margin:0 0 18pt}p{margin:0 0 9pt;text-align:justify}
</style></head><body>
<p>ООО «Северный ветер»<br>Отдел кадров</p>
<h1>СПРАВКА С МЕСТА РАБОТЫ</h1>
<p>Выдана ${esc(V.sokolovaDat)}, дата рождения: ${V.sokolovaBirth}, паспорт ${V.sokolovaPassport}, проживающей по адресу: ${esc(V.sokolovaAddress)}, в том, что она с 1 марта 2021 года по настоящее время работает в должности ведущего бухгалтера.</p>
<p>Справка выдана для предоставления по месту требования.</p>
<p>Контакты отдела кадров: телефон ${esc(V.hrPhone)}, e-mail ${V.hrEmail}.</p>
<p>Начальник отдела кадров ____________ ${esc(V.hrHead)}</p>
</body></html>`;

/* ---------- 4. «Фото паспорта» (.png): формат не проверяется ---------- */
const PNG_HTML = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
body{margin:0;background:#fff}#card{width:560px;padding:22px 26px;border:2px solid #8a6d3b;border-radius:10px;background:#f6efe1;font:15px Arial,sans-serif;color:#222}
h2{margin:0 0 12px;font-size:18px;letter-spacing:2px;text-align:center}td{padding:3px 10px 3px 0}.k{color:#6b5a3a}.mark{margin-top:12px;color:#b00;font-weight:bold;text-align:center}
</style></head><body><div id="card"><h2>ПАСПОРТ (ОБРАЗЕЦ)</h2><table>
<tr><td class="k">Фамилия</td><td>Орлова</td></tr><tr><td class="k">Имя</td><td>Светлана</td></tr><tr><td class="k">Отчество</td><td>Игоревна</td></tr>
<tr><td class="k">Дата рождения</td><td>17.08.1990</td></tr><tr><td class="k">Серия и номер</td><td>45 15 112233</td></tr>
<tr><td class="k">Код подразделения</td><td>770-012</td></tr></table>
<div class="mark">ВЫМЫШЛЕННЫЕ ДАННЫЕ — ДЛЯ ПРОВЕРКИ РАСШИРЕНИЯ</div></div></body></html>`;

/* ---------- 5. Служебная записка с трудными случаями (.docx) ---------- */
function hardCases() {
  const body = [
    title('СЛУЖЕБНАЯ ЗАПИСКА'),
    p(r('Кому: директору по логистике')),
    p(r(`От: ${V.zakharova}, руководитель отдела снабжения, тел. ${V.zakharovaPhone}`)),
    p(r('О передаче документов по поставке', B)),
    p(r(`Сообщаю, что оригиналы накладных по поставке за октябрь получены. Документы забрал ${V.lagunov}, отметка в журнале выдачи есть.`)),
    p(r(`Сверку остатков на складе провёл ${V.foreign}, акт сверки прилагаю.`)),
    p(r(`Вопросы по доставке — на адрес ${V.courierEmail}.`)),
    p(r(`${V.zakharova}`)),
  ].join('');
  const bytes = pack({ body, core: '<dc:title>Служебная записка</dc:title>', app: '<Application>Microsoft Office Word</Application>' });
  return {
    file: '05-trudnye-sluchai.docx',
    title: 'Служебная записка с трудными случаями (Word)',
    bytes,
    expect: [e(V.zakharova, 'PERSON'), e(V.zakharovaPhone, 'PHONE'), e(V.courierEmail, 'EMAIL'), e(V.lagunov, 'PERSON', true), e(V.foreign, 'PERSON', true)],
    stays: [],
  };
}

async function renderBrowserDocs() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(PDF_HTML);
    const pdf = await page.pdf({ format: 'A4', margin: { top: '20mm', bottom: '20mm', left: '25mm', right: '15mm' }, printBackground: false });
    await page.setViewportSize({ width: 640, height: 400 });
    await page.setContent(PNG_HTML);
    const png = await page.locator('#card').screenshot();
    return { pdf: new Uint8Array(pdf), png: new Uint8Array(png) };
  } finally {
    await browser.close();
  }
}

async function buildAll() {
  const { pdf, png } = await renderBrowserDocs();
  return [
    contract(),
    registry(),
    {
      file: '03-spravka.pdf',
      title: 'Справка с места работы (PDF с текстовым слоем)',
      bytes: pdf,
      expect: [
        // в тексте — дательный падеж: маскируется вся форма, значение для проверки — как в документе
        e(V.sokolovaDat, 'PERSON'),
        e(V.sokolovaBirth, 'BIRTHDATE'),
        e(V.sokolovaPassport, 'PASSPORT'),
        e(V.sokolovaAddress, 'ADDRESS'),
        e(V.hrPhone, 'PHONE'),
        e(V.hrEmail, 'EMAIL'),
        e(V.hrHead, 'PERSON'),
      ],
      stays: ['ООО «Северный ветер»'],
    },
    {
      file: '04-pasport-foto.png',
      title: '«Фото паспорта» (картинка — формат не проверяется)',
      bytes: png,
      expect: [],
      unsupported: true,
      stays: [],
    },
    hardCases(),
  ];
}

/* ---------- проверка через конвейер ядра (К7) ---------- */
async function check() {
  const { loadDoc, loadNerProvider } = await import('./eval-genres.mjs');
  const { analyze, applyDecisions, defaultSettings, registerBuiltinDetectors, BUILTIN_CATEGORIES } = await import('../src/core/index.js');
  const { getDetectors } = await import('../src/core/contracts/detector.js');
  const { fileKind } = await import('../src/content/files.js');
  const { unzipText } = await import('../tests/helpers/docx.js');
  const { unescapeXml } = await import('../src/core/docx/xml.js');
  if (!getDetectors().length) registerBuiltinDetectors();
  const nerProvider = await loadNerProvider(process.env.NER_MODEL_DIR);
  const prefix = new Map(BUILTIN_CATEGORIES.map((c) => [c.id, c.placeholderPrefix.ru]));
  const expected = JSON.parse(readFileSync(join(OUT, 'expected.json'), 'utf8'));
  const norm = (s) =>
    s
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[\s\u00a0]+/g, ' ');
  let bad = 0;
  console.log(`Конвейер ядра, настройки по умолчанию, модель NER: ${nerProvider ? nerProvider.label : 'нет'}`);
  for (const d of expected.docs) {
    const path = join(OUT, d.file);
    if (d.unsupported) {
      // картинка: перехват отдаёт её в панель строкой «Формат .png не проверяется» — конвейер её не разбирает
      console.log(`\n${d.file}: формат не проверяется (fileKind = ${fileKind(new File([], d.file))}) — панель предупреждает, уходит только «как есть»`);
      continue;
    }
    const doc = await loadDoc(path);
    const analysis = await analyze(doc, defaultSettings(), { nerProvider: nerProvider || undefined });
    const res = applyDecisions(doc, analysis.groups, { mode: 'placeholder', placeholderLanguage: 'ru', textFormat: 'md' });
    const out =
      doc.kind === 'text'
        ? new TextDecoder().decode(res.bytes)
        : Object.entries(unzipText(res.bytes))
            .filter(([n]) => /\.xml$/.test(n))
            .map(([, x]) => unescapeXml(x.replace(/<[^>]+>/g, ' ')))
            .join('\n');
    const outN = norm(out);
    console.log(`\n${d.file} (${d.title}): групп ${analysis.groups.length}`);
    for (const x of d.expect) {
      const left = outN.includes(norm(x.value));
      const status = left ? (x.mayMiss ? 'ПРОПУЩЕНО (трудный случай — замаскируйте вручную)' : 'УТЕЧКА') : `замаскировано [${prefix.get(x.category)}_…]`;
      if (left && !x.mayMiss) bad++;
      console.log(`  ${x.mayMiss ? '*' : ' '} ${x.value} — ${status}`);
    }
    for (const s of d.stays || []) console.log(`    остаётся (по умолчанию не маскируется): ${s} — ${outN.includes(norm(s)) ? 'да' : 'НЕТ, замаскировано'}`);
    const placeholders = [...new Set(out.match(/\[[A-ZА-ЯЁ_]+_\d+\]/g) || [])];
    console.log(`  метки в результате: ${placeholders.join(' ')}`);
  }
  console.log(bad ? `\nОшибок: ${bad}` : '\nВсе обязательные значения замаскированы; * — трудные случаи');
  if (bad) process.exitCode = 1;
}

if (args.includes('--check')) await check();
else {
  mkdirSync(OUT, { recursive: true });
  const docs = await buildAll();
  for (const d of docs) writeFileSync(join(OUT, d.file), d.bytes);
  const expected = {
    note: 'Вымышленные данные. mayMiss — трудный случай: расширение может пропустить, замаскируйте вручную. Сгенерировано scripts/gen-verify-docs.mjs.',
    docs: docs.map(({ bytes, ...rest }) => ({ ...rest, size: bytes.length })),
  };
  writeFileSync(join(OUT, 'expected.json'), JSON.stringify(expected, null, 2) + '\n');
  for (const d of docs) console.log(`${d.file}: ${d.bytes.length} байт, ожиданий ${d.expect.length}`);
  if (!existsSync(join(OUT, 'README.md'))) console.log('README.md в каталоге нет — напишите инструкцию вручную');
}

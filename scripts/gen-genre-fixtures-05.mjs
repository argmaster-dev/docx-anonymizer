// Корпус жанров 0.5 (WP12-C, `docs/concept-0.5.md` п. 10, К9; `docs/contracts.md` §8.7): анкеты (документы ЗАГС, водительское,
// ОМС, ВНЖ), судебные документы (номера дел, исполнительные производства, доверенности), договоры с недвижимостью (кадастр,
// ЕГРН), купля-продажа автомобиля (VIN, госномер, СТС/ПТС), медицинские справки и выписки (диагноз по метке, ОМС).
// Строители документов вызываются из scripts/gen-genre-fixtures.mjs (`buildGenreDocs`) с его общими помощниками `kit`
// (newDoc, per, co, address, phone, mobile, email, finish, H, CAPS, TITLE, negs…) — так документ 0.4 не меняется ни на байт.
// Все данные ВЫМЫШЛЕННЫЕ: номера сгенерированы ГПСЧ документа, контрольные суммы (ИНН, СНИЛС, ОМС, VIN) — верные.
import { inn12, snils, r, p } from './make-sample.mjs';
import { tbl, cell, title } from './gen-fixtures.mjs';

export const GENRES_05 = ['form', 'court', 'realty', 'vehicle', 'medical'];

const pad = (n) => String(n).padStart(2, '0');
const PLATE_LETTERS = 'АВЕКМНОРСТУХ';
const CYR_LETTERS = 'АБВГДЕЖИКЛМНОПРСТУФХЦЧШЭЮЯ';
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const REGIONS = ['Энской области', 'Северной области', 'Лесному району г. Энска', 'Заречному району г. Энска', 'Приозёрному району'];
const VIN_T = 'A1B2C3D4E5F6G7H8J1K2L3M4N5P7R9S2T3U4V5W6X7Y8Z9';
const VIN_W = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const VIN_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
// prettier-ignore
const ICD = [
  ['J45.0', 'Бронхиальная астма, лёгкое течение'], ['E11.9', 'Сахарный диабет 2 типа без осложнений'], ['I10', 'Эссенциальная гипертензия'],
  ['K29.5', 'Хронический гастрит'], ['M54.5', 'Боль внизу спины'], ['J06.9', 'Острая инфекция верхних дыхательных путей'],
];

/**
 * Отрицательный пример для правил (похожее на номер или код, но не то): `rules: true` — его не размечают стабы модели в
 * tests/integration/genres.spec.js (фильтры модельных ORG/PER/LOC — забота WP12-E), но ни одна находка анализа его не задевает.
 */
const neg = (d, value, category = 'COMPANY') => {
  d.neg(value, category);
  d.negatives.find((n) => n.value === value).rules = true;
  return value;
};
const letters = (d, n, set = CYR_LETTERS) => Array.from({ length: n }, () => set[d.rng.int(set.length)]).join('');
const date = (d, y0, y1) => `${pad(d.rng.range(1, 28))}.${pad(d.rng.range(1, 12))}.${d.rng.range(y0, y1)}`;
function luhn16(body15) {
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let x = Number(body15[14 - i]);
    if (i % 2 === 0) x = x * 2 > 9 ? x * 2 - 9 : x * 2;
    sum += x;
  }
  return body15 + ((10 - (sum % 10)) % 10);
}
function vinOf(d) {
  const v = ['X', 'T', 'A', ...Array.from({ length: 14 }, (_, i) => (i >= 10 ? String(d.rng.int(10)) : VIN_CHARS[d.rng.int(VIN_CHARS.length)]))];
  let sum = 0;
  for (let i = 0; i < 17; i++) if (i !== 8) sum += VIN_W[i] * (/\d/.test(v[i]) ? +v[i] : +VIN_T[VIN_T.indexOf(v[i]) + 1]);
  v[8] = sum % 11 === 10 ? 'X' : String(sum % 11);
  return v.join('');
}

/** Значения документов: каждое сразу записывается в gold своей категорией. */
const val = {
  passport: (d, city) => d.add('PASSPORT', `${city.reg}${d.rng.range(10, 24)} ${d.rng.range(100000, 999999)}`),
  issuer: (d) => d.add('PASSPORT_ISSUER', `${d.rng.pick(['ГУ МВД России по', 'УМВД России по', 'Отделом УФМС России по'])} ${d.rng.pick(REGIONS)}`),
  issued: (d) => d.add('PASSPORT_DATE', date(d, 2006, 2022)),
  dept: (d, city) => d.add('PASSPORT_DEPT', `${city.reg}${d.rng.int(10)}-0${d.rng.digits(2)}`),
  dl: (d, city) => d.add('DRIVER_LICENSE', `${city.reg} ${d.rng.range(10, 99)} ${d.rng.range(100000, 999999)}`),
  oms: (d) => d.add('OMS', luhn16(`${d.rng.range(1, 9)}${d.rng.digits(14)}`)),
  snils: (d) => d.add('SNILS', snils(`1${d.rng.digits(8)}`)),
  inn12: (d, city) => d.add('INN', inn12(city.reg + d.rng.digits(8))),
  civil: (d) => d.add('CIVIL_CERT', `${d.rng.pick(ROMAN)}-${letters(d, 2)} № ${d.rng.range(100000, 999999)}`),
  military: (d) => d.add('MILITARY_ID', `${letters(d, 2)} ${d.rng.range(1000000, 9999999)}`),
  vnzh: (d) => d.add('RESIDENCE_PERMIT', `82 № ${d.rng.range(1000000, 9999999)}`),
  patent: (d, city) => d.add('RESIDENCE_PERMIT', `${city.reg} № 26${d.rng.range(10000000, 99999999)}`),
  migr: (d) => d.add('MIGRATION_CARD', `${d.rng.range(4500, 4699)} ${d.rng.range(1000000, 9999999)}`),
  cad: (d, city) => d.add('CADASTRAL', `${city.reg}:${pad(d.rng.range(1, 30))}:${d.rng.range(1000000, 9999999)}:${d.rng.range(10, 9999)}`),
  egrn: (d, cad, city) => d.add('EGRN_RECORD', `${cad}-${city.reg}/${d.rng.range(100, 999)}/2026-${d.rng.range(1, 20)}`),
  arb: (d) => d.add('COURT_CASE', `А${d.rng.range(10, 83)}-${d.rng.range(1000, 99999)}/2026`),
  civilCase: (d) => d.add('COURT_CASE', `2-${d.rng.range(100, 9999)}/2026`),
  uid: (d, city) => d.add('COURT_CASE', `${city.reg}RS00${d.rng.range(10, 99)}-02-2026-00${d.rng.range(1000, 9999)}-${pad(d.rng.range(10, 99))}`),
  ip: (d, city) => d.add('ENFORCEMENT', `${d.rng.range(1000, 99999)}/26/${city.reg}0${pad(d.rng.range(10, 99))}-ИП`),
  writ: (d) => d.add('ENFORCEMENT', `0${d.rng.range(10000000, 99999999)}`),
  poa: (d, city) => d.add('POA', `${city.reg} АА ${d.rng.range(1000000, 9999999)}`),
  notary: (d, city) => d.add('NOTARY_REG', `${city.reg}/${d.rng.range(10, 300)}-н/${city.reg}-2026-${d.rng.range(1, 9)}-${d.rng.range(10, 999)}`),
  vin: (d) => d.add('VIN', vinOf(d)),
  plate: (d, city) =>
    d.add('PLATE', `${letters(d, 1, PLATE_LETTERS)}${d.rng.range(101, 989)}${letters(d, 2, PLATE_LETTERS)}${city.reg === '77' ? '799' : city.reg}`),
  sts: (d, city) => d.add('VEHICLE_DOC', `${city.reg} ${d.rng.range(10, 99)} ${d.rng.range(100000, 999999)}`),
  pts: (d, city) => d.add('VEHICLE_DOC', `${city.reg} ${letters(d, 2, PLATE_LETTERS)} ${d.rng.range(100000, 999999)}`),
  epts: (d) => d.add('VEHICLE_DOC', `1643010${d.rng.range(10000000, 99999999)}`),
};

/** Паспорт строкой: «паспорт 4512 334455, выдан …, 12.03.2015, код подразделения 770-012». */
const passportLine = (d, city) => `паспорт ${val.passport(d, city)}, выдан ${val.issuer(d)} ${val.issued(d)}, код подразделения ${val.dept(d, city)}`;
/** Паспорт таблицей анкеты: метка строки слева. */
const passportRows = (d, city) => [
  [cell('Паспорт: серия и номер'), cell(val.passport(d, city))],
  [cell('Кем выдан'), cell(val.issuer(d))],
  [cell('Дата выдачи'), cell(val.issued(d))],
  [cell('Код подразделения'), cell(val.dept(d, city))],
];

/* ---------- анкеты ---------- */

function form(kit, name, variant) {
  const { newDoc, per, address, mobile, email, finish, H } = kit;
  const d = newDoc('form', name);
  const city = d.city();
  const x = d.person();
  const kid = d.person((y) => y.f !== x.f);
  const rows = [
    [cell('ФИО'), cell(per(d, x))],
    [cell('Дата рождения'), cell(d.add('BIRTHDATE', date(d, 1975, 1999)))],
    ...passportRows(d, city),
    [cell('СНИЛС'), cell(val.snils(d))],
    [cell('ИНН'), cell(val.inn12(d, city))],
    [cell('Полис ОМС'), cell(val.oms(d))],
    [cell('Адрес регистрации'), cell(address(d, city, 'кв.'))],
    [cell('Телефон'), cell(mobile(d))],
    [cell('E-mail'), cell(email(d, x.lat, 'mail'))],
    [cell('Дата заполнения'), cell(neg(d, '15.10.2026', 'BIRTHDATE'))],
    [cell('Стаж работы'), cell(neg(d, '12 лет', 'PASSPORT'))],
  ];
  if (variant === 'employee') {
    rows.push(
      [cell('Водительское удостоверение'), cell(val.dl(d, city))],
      [cell(neg(d, 'Категория B')), cell('да')],
      [cell('Военный билет'), cell(val.military(d))],
      [cell('Загранпаспорт'), cell(d.add('INTL_PASSPORT', `7${d.rng.int(10)} ${d.rng.range(1000000, 9999999)}`))],
      [cell('Свидетельство о браке'), cell(val.civil(d))],
      [cell('Судимость'), cell(d.add('SPECIAL', 'не имеет'))],
      [cell('Telegram'), cell(d.add('NICKNAME', `@${x.lat.replace('.', '_')}`))],
    );
  } else if (variant === 'migrant') {
    rows.push(
      [cell('Вид на жительство'), cell(val.vnzh(d))],
      [cell('Патент на работу'), cell(val.patent(d, city))],
      [cell('Миграционная карта'), cell(val.migr(d))],
      [cell('Вероисповедание'), cell(d.add('SPECIAL', 'ислам'))],
    );
  } else {
    rows.push(
      [cell('Свидетельство о рождении ребёнка'), cell(val.civil(d))],
      [cell('Свидетельство о перемене имени'), cell(val.civil(d))],
      [cell('Национальность'), cell(d.add('SPECIAL', 'татарка'))],
    );
  }
  const body = [
    title(d.neg(variant === 'migrant' ? 'АНКЕТА ИНОСТРАННОГО РАБОТНИКА' : 'АНКЕТА')),
    H(d, 'Личные данные'),
    tbl(rows, 2),
    variant === 'family' ? p(r(`Ребёнок: ${per(d, kid)}, полис ОМС ${val.oms(d)}, СНИЛС ${val.snils(d)}.`)) : '',
    p(r(`${neg(d, 'Семейное положение')}: указывается по желанию.`)),
    p(r(`Подпись: ${per(d, x, 'short')}`)),
  ].join('');
  return finish(d, body, { docTitle: 'Анкета', creator: per(d, x) });
}

/* ---------- судебные документы ---------- */

function court(kit, name, variant) {
  const { newDoc, per, co, address, finish, TITLE, requisites } = kit;
  const d = newDoc('court', name);
  const city = d.city();
  const a = d.person();
  const b = d.person((y) => y.f !== a.f);
  const rep = d.person((y) => y.f !== a.f && y.f !== b.f);
  let body;
  if (variant === 'claim') {
    const plaintiff = d.company();
    const req = requisites(d, city, { bank: false });
    const arb = val.arb(d);
    body = [
      p(r('В Арбитражный суд Энской области')),
      p(r(`Истец: ${co(d, plaintiff)}, ИНН ${req.inn}, ОГРН ${req.ogrn}, адрес: ${address(d, city)}`)),
      p(r(`Ответчик: индивидуальный предприниматель ${per(d, b)}, ИНН ${val.inn12(d, city)}`)),
      TITLE(d, 'ИСКОВОЕ ЗАЯВЛЕНИЕ'),
      p(
        r(
          `По счёту № ${d.add('INVOICE_NO', String(d.rng.range(100, 999)))} ответчик не оплатил поставку по закупке № ${d.add('TENDER', `0373100${d.rng.digits(12)}`)}. ` +
            `Претензия оставлена без ответа (${neg(d, 'ст. 395 ГК РФ')}, ${neg(d, 'п. 2.1')} договора).`,
        ),
      ),
      p(r(`Ранее по делу № ${arb} суд принял обеспечительные меры.`)),
      p(
        r(
          `Вход в личный кабинет ответчика выполнен с IP-адреса ${d.add('IP', `95.${d.rng.range(100, 199)}.${d.rng.range(10, 99)}.${d.rng.range(10, 250)}`)}, MAC-адрес устройства ${d.add('MAC', Array.from({ length: 6 }, () => d.rng.int(256).toString(16).toUpperCase().padStart(2, '0')).join(':'))}; ` +
            `по заказу № ${d.add('ORDER_NO', `ЗК-${d.rng.range(1000, 9999)}`)} (номер клиента ${d.add('CLIENT_NO', String(d.rng.range(100000, 999999)))}) ответчик использовал товарный знак № ${d.add('IP_REG', String(d.rng.range(500000, 999999)))}.`,
        ),
      ),
      p(
        r(
          `Представитель истца ${per(d, rep)} действует по доверенности № ${val.poa(d, city)} от 12.01.2026, зарегистрировано в реестре № ${val.notary(d, city)}.`,
        ),
      ),
      p(r(`Подпись: ${per(d, rep, 'short')}`)),
      p(r(`Приложение: ${neg(d, 'копия претензии на 2 л.', 'POA')}`)),
    ];
  } else if (variant === 'ruling') {
    body = [
      p(r(`Дело № ${val.civilCase(d)}`)),
      p(r(`УИД ${val.uid(d, city)}`)),
      TITLE(d, 'РЕШЕНИЕ'),
      p(r(neg(d, 'Именем Российской Федерации', 'PERSON'))),
      p(r(`Районный суд в составе председательствующего судьи ${per(d, rep)} рассмотрел гражданское дело по иску ${per(d, a, 'gen')} к ${per(d, b, 'dat')}.`)),
      p(r(`Истец: ${per(d, a)}, ${d.add('BIRTHDATE', date(d, 1970, 1995))} г.р., ${passportLine(d, city)}.`)),
      p(r(`Материал проверки КУСП № ${d.add('COURT_CASE', String(d.rng.range(1000, 99999)))} от 03.02.2026 приобщён к делу (${neg(d, 'ГПК РФ')}).`)),
      p(r(`Уголовное дело № ${d.add('COURT_CASE', `1240145000${d.rng.digits(7)}`)} по ${neg(d, 'ч. 1 ст. 159 УК РФ', 'COURT_CASE')} прекращено.`)),
    ];
  } else {
    const debtor = d.person((y) => y.f !== a.f && y.f !== b.f && y.f !== rep.f);
    body = [
      TITLE(d, 'ПОСТАНОВЛЕНИЕ О ВОЗБУЖДЕНИИ ИСПОЛНИТЕЛЬНОГО ПРОИЗВОДСТВА'),
      p(r(`Судебный пристав-исполнитель ${per(d, rep)} рассмотрел исполнительный лист серии ФС № ${val.writ(d)}, выданный по делу № ${val.civilCase(d)}.`)),
      p(
        r(
          `Руководствуясь ${neg(d, 'ст. 30 Федерального закона № 229-ФЗ', 'COURT_CASE')}, возбудить исполнительное производство № ${val.ip(d, city)} в отношении должника ${per(d, debtor, 'gen')}.`,
        ),
      ),
      p(r(`Должник: ${per(d, debtor)}, дата рождения: ${d.add('BIRTHDATE', date(d, 1970, 1995))}, СНИЛС ${val.snils(d)}, адрес: ${address(d, city, 'кв.')}.`)),
      p(r(`Взыскатель: ${per(d, a)}, водительское удостоверение ${val.dl(d, city)}.`)),
      p(r(`Срок для добровольного исполнения — 5 дней (${neg(d, 'п. 2.1')} постановления).`)),
    ];
  }
  return finish(d, body.join(''), { docTitle: 'Судебный документ', creator: per(d, rep) });
}

/* ---------- недвижимость ---------- */

function realty(kit, name, variant) {
  const { newDoc, per, co, address, finish, TITLE, requisites } = kit;
  const d = newDoc('realty', name);
  const city = d.city();
  const a = d.person();
  const b = d.person((y) => y.f !== a.f);
  neg(d, 'п. 3.2');
  const cad = val.cad(d, city);
  const body = [];
  if (variant === 'lease') {
    body.push(
      TITLE(d, 'ДОГОВОР АРЕНДЫ КВАРТИРЫ'),
      p(r(`Арендодатель: ${per(d, a)}, ${passportLine(d, city)}, зарегистрирован по адресу: ${address(d, city, 'кв.')}.`)),
      p(r(`Арендатор: ${per(d, b)}, ${passportLine(d, city)}.`)),
      p(r(`1.1. Квартира площадью ${neg(d, '45,6 кв. м')}, кадастровый номер ${cad}, принадлежит Арендодателю (запись ЕГРН ${val.egrn(d, cad, city)}).`)),
      p(r('3.2. Плата вносится ежемесячно до 10 числа (п. 3.2 договора).')),
    );
  } else if (variant === 'sale') {
    const rep = d.person((y) => y.f !== a.f && y.f !== b.f);
    body.push(
      TITLE(d, 'ДОГОВОР КУПЛИ-ПРОДАЖИ КВАРТИРЫ'),
      p(r(`Продавец: ${per(d, a)}, ${passportLine(d, city)}, в лице представителя ${per(d, rep, 'gen')}, действующего по доверенности № ${val.poa(d, city)}.`)),
      p(r(`Доверенность удостоверена нотариусом, зарегистрировано в реестре № ${val.notary(d, city)}.`)),
      p(r(`Покупатель: ${per(d, b)}, ${passportLine(d, city)}.`)),
      p(r(`1.1. Продавец продал квартиру с кадастровым номером ${cad} площадью ${neg(d, '45,6 кв. м')} (${neg(d, 'ст. 556 ГК РФ')}).`)),
      p(r(`1.2. Право собственности зарегистрировано: номер государственной регистрации ${val.egrn(d, cad, city)}.`)),
      p(r('Расчёты — по п. 3.2 договора.')),
    );
  } else {
    const seller = d.company();
    const req = requisites(d, city, { bank: false });
    const cad2 = val.cad(d, city);
    const quarter = d.add('CADASTRAL', cad2.split(':').slice(0, 3).join(':'));
    body.push(
      TITLE(d, 'ДОГОВОР КУПЛИ-ПРОДАЖИ ЗЕМЕЛЬНОГО УЧАСТКА'),
      p(r(`Продавец: ${co(d, seller)}, ИНН ${req.inn}, ОГРН ${req.ogrn}, в лице генерального директора ${per(d, a, 'gen')}.`)),
      p(r(`Покупатель: ${per(d, b)}, ${passportLine(d, city)}.`)),
      p(r(`1.1. Участки с кадастровыми номерами ${cad} и ${cad2} (кадастровый квартал ${quarter}), площадь 12 соток, п. 3.2.`)),
      p(r(`1.2. Запись в ЕГРН № ${val.egrn(d, cad, city)}.`)),
      p(r(`Передача — по акту (${neg(d, 'ст. 556 ГК РФ')}).`)),
    );
  }
  body.push(
    p(r(`Объект: ${neg(d, 'этаж 5 из 9', 'CADASTRAL')}, ${neg(d, '2 комнаты', 'CADASTRAL')}.`)),
    p(r(`Подписи: ${per(d, a, 'short')} / ${per(d, b, 'short')}`)),
  );
  return finish(d, body.join(''), { docTitle: 'Договор', creator: per(d, a) });
}

/* ---------- автомобили ---------- */

function vehicle(kit, name, variant) {
  const { newDoc, per, co, address, mobile, finish, TITLE, requisites } = kit;
  const d = newDoc('vehicle', name);
  const city = d.city();
  const a = d.person();
  const b = d.person((y) => y.f !== a.f);
  for (const v of ['Лада Веста', 'объём двигателя 1,6 л', 'п. 2.4']) neg(d, v);
  const car = [`VIN ${val.vin(d)}`, `государственный регистрационный знак ${val.plate(d, city)}`];
  const docs = variant === 'epts' ? `ЭПТС № ${val.epts(d)}, СТС ${val.sts(d, city)}` : `ПТС ${val.pts(d, city)}, СТС ${val.sts(d, city)}`;
  const body = [TITLE(d, variant === 'lease' ? 'ДОГОВОР АРЕНДЫ ТРАНСПОРТНОГО СРЕДСТВА' : 'ДОГОВОР КУПЛИ-ПРОДАЖИ АВТОМОБИЛЯ')];
  if (variant === 'lease') {
    const lessor = d.company();
    const req = requisites(d, city, { bank: false });
    body.push(p(r(`Арендодатель: ${co(d, lessor)}, ИНН ${req.inn}, ОГРН ${req.ogrn}, адрес: ${address(d, city)}.`)));
  } else body.push(p(r(`Продавец: ${per(d, a)}, ${passportLine(d, city)}, тел. ${mobile(d)}.`)));
  body.push(
    p(r(`Покупатель: ${per(d, b)}, ${passportLine(d, city)}, водительское удостоверение ${val.dl(d, city)}.`)),
    p(r(`1.1. Автомобиль Лада Веста, ${car.join(', ')}, объём двигателя 1,6 л, ${neg(d, 'год выпуска 2019', 'VIN')}, ${neg(d, 'пробег 45 000 км', 'PLATE')}.`)),
    p(r(`1.2. Документы: ${docs} (п. 2.4).`)),
    p(r(`Подписи: ${per(d, b, 'short')}`)),
  );
  return finish(d, body.join(''), { docTitle: 'Договор', creator: per(d, b) });
}

/* ---------- медицина ---------- */

function medical(kit, name, variant) {
  const { newDoc, per, address, finish, TITLE } = kit;
  const d = newDoc('medical', name);
  const city = d.city();
  const x = d.person();
  const doc = d.person((y) => y.f !== x.f);
  neg(d, 'кабинет 214');
  const [code, text] = d.rng.pick(ICD);
  const [code2, text2] = d.rng.pick(ICD.filter(([c]) => c !== code));
  const body = [
    p(r('ГБУЗ «Городская поликлиника № 3», кабинет 214')),
    TITLE(d, variant === 'discharge' ? 'ВЫПИСНОЙ ЭПИКРИЗ' : 'МЕДИЦИНСКАЯ СПРАВКА'),
    p(r(variant === 'certificate' ? `Учётная ${neg(d, 'форма 086/у')}` : 'Отделение терапии')),
    p(r(`Пациент: ${per(d, x)}, дата рождения: ${d.add('BIRTHDATE', date(d, 1960, 2005))}`)),
    p(r(`Полис ОМС ${val.oms(d)}, СНИЛС ${val.snils(d)}.`)),
    p(r(`Адрес: ${address(d, city, 'кв.')}.`)),
    // до сведений о здоровье: в PDF абзацы склеиваются, а значение здоровья идёт до конца строки
    p(r(`${neg(d, 'Приём 12.03.2026 в 10:30', 'HEALTH')}, ${neg(d, 'рост 178 см', 'HEALTH')}.`)),
  ];
  if (variant === 'discharge') {
    body.push(
      p(r(`Основной диагноз: ${d.add('HEALTH', `${code} ${text}`)}.`)),
      // «;» и следующая фраза — продолжение сведений о здоровье (второе ревью WP12-C): значение до конца строки
      p(r(`Сопутствующий диагноз: ${d.add('HEALTH', `${text2}; рекомендовано наблюдение`)}.`)),
      p(r(`Код МКБ-10: ${d.add('HEALTH', code2)}`)),
    );
  } else if (variant === 'driver') {
    body.push(
      p(r(`Водительское удостоверение ${val.dl(d, city)}`)),
      p(r(`Состояние здоровья: ${d.add('HEALTH', 'медицинских противопоказаний к управлению не выявлено')}.`)),
    );
  } else {
    body.push(
      tbl(
        [
          [cell('Диагноз'), cell('Код МКБ-10')],
          [cell(d.add('HEALTH', text)), cell(d.add('HEALTH', code))],
        ],
        2,
      ),
    );
  }
  body.push(p(r(`Врач: ${per(d, doc)}`)));
  return finish(d, body.join(''), { docTitle: 'Справка', creator: per(d, doc) });
}

/**
 * Документы жанров 0.5 (по три на жанр, как в 0.4).
 * @param {object} kit помощники scripts/gen-genre-fixtures.mjs
 */
export function buildGenreDocs05(kit) {
  return [
    form(kit, 'form-employee', 'employee'),
    form(kit, 'form-migrant', 'migrant'),
    form(kit, 'form-family', 'family'),
    court(kit, 'court-claim', 'claim'),
    court(kit, 'court-ruling', 'ruling'),
    court(kit, 'court-enforcement', 'enforcement'),
    realty(kit, 'realty-lease', 'lease'),
    realty(kit, 'realty-sale', 'sale'),
    realty(kit, 'realty-land', 'land'),
    vehicle(kit, 'vehicle-sale', 'sale'),
    vehicle(kit, 'vehicle-epts', 'epts'),
    vehicle(kit, 'vehicle-lease', 'lease'),
    medical(kit, 'med-certificate', 'certificate'),
    medical(kit, 'med-discharge', 'discharge'),
    medical(kit, 'med-driver', 'driver'),
  ];
}

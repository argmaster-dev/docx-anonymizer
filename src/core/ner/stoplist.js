// Стоп-список модельных организаций (версия 0.4, концепция п. 4, К10; §5.2 NLP `docs/spec-full.md`): аббревиатуры
// деловых документов, названия программ и сервисов, которые модель NER (обученная на WikiANN) принимает за ORG.
// Дополняется из настроек (`settings.nerStoplist`). Сравнение — без учёта регистра, «ё» = «е», кириллица и латиница
// одного начертания совпадают (1С = 1C, ВЭД = BЭД), см. `stopKey`. Названия, которые пишутся по-разному
// (Яндекс/Yandex, Битрикс24/Bitrix24), перечислены обоими написаниями.
// Чистые данные: без chrome.* и DOM.
import { NEVER_MASK_ORGS, wordList } from '../detect/names/lexicon.js';

/** Аббревиатуры деловых и технических документов (не названия организаций). */
// Группы: документы и реквизиты; ИТ и маркетинг.
// prettier-ignore
export const STOP_ABBREVIATIONS = [
  ...wordList(`ЭДО|ВЭД|ТН ВЭД|УПД|УКД|ТЗ|ТКП|КП|ФИО|НДС|НДФЛ|ИНН|КПП|ОГРН|ОГРНИП|БИК|ОКПО|ОКВЭД|ОКТМО|ОКАТО
ТТН|ТН|ТОРГ-12|КС-2|КС-3|УСН|ОСНО|ПСН|ЕНС|ЕГРЮЛ|ЕГРИП|ЭЦП|ЭП|КЭП|УКЭП|НЭП|ПЭП|МЧД|СЧФ
р/с|к/с|ЛК|ПО|ИТ|ИИ|ГОСТ|СНиП|СанПиН|ПМИ|ПИР|СМР|ППР|ИД|ОТК|ТО|ЗИП|ГСМ|ДДУ|ЖКХ|ЦФО
РФ|РК|РБ|ЕАЭС|СНГ|ЕС|США|ЮЛ|ФЛ|ИП|НКО|СМИ|ЧаВо|FAQ|ПДн|ПД|СМС|NPS`),
  ...wordList(`MVP|API|CRM|ERP|SaaS|PaaS|IaaS|KPI|OKR|QR|PDF|DOCX|XLSX|PPTX|CSV|JSON|XML|HTML|CSS|SQL|URL
IT|AI|ML|LLM|BI|UX|UI|UX/UI|UI/UX|SEO|SMM|PR|HR|B2B|B2C|B2G|ROI|SLA|NDA|SDK|VPN|SSL
SMS|SMTP|HTTP|HTTPS|OCR|RPA|BPM|DevOps|QA|PM|CEO|CTO|CFO|ASAP|PS|TBD|N/A|Ltd|LLC|Inc|KYC|AML|MSc|MBA|BSc|PhD|Confidential Information
Tax ID|VAT|VAT ID|IBAN|SWIFT|BIC`),
];

/**
 * Программы, сервисы, платформы и модели ИИ (продукты, а не стороны документа). Отдельно от обращений: по нему же фильтр PER
 * узнаёт перечисление продуктов («в GigaChat, Алису, DeepSeek и другие модели», `filters-pl.js`). Голосовой помощник — только
 * составным названием («Яндекс Алиса»): «Алиса» одна — женское имя.
 */
// Последняя группа — модели и помощники ИИ (доработка 0.5 по прогону КП).
// prettier-ignore
export const PRODUCT_NAMES = [
  ...wordList(`Word|Excel|PowerPoint|Outlook|Teams|OneDrive|SharePoint|Office|Microsoft Office|MS Office|Microsoft 365|Office 365
MS Word|MS Excel|Microsoft Word|Microsoft Excel|Microsoft Teams|Microsoft|Windows|macOS|Linux|Android|iOS
Telegram|Телеграм|Телеграмм|WhatsApp|Ватсап|Вотсап|Viber|Вайбер|Zoom|Зум|Skype|Скайп|Slack|Discord
Google|Гугл|Google Docs|Google Drive|Google Sheets|Google Meet|Gmail|Chrome|Firefox|Safari|YouTube|Ютуб
Яндекс|Yandex|Яндекс.Диск|Яндекс Диск|Яндекс.Почта|Яндекс Почта|Яндекс.Телемост|Телемост|Яндекс 360|Яндекс.Директ
Яндекс.Метрика|Mail.ru|Почта Mail.ru|VK|ВК|ВКонтакте|VK Teams|VK WorkSpace|Одноклассники
1С|1С:Предприятие|1С:Бухгалтерия|1С:УНФ|1С:ERP|1С:Документооборот|1С:ЗУП|1С:УТ|1С:Фреш
Битрикс|Битрикс24|Bitrix|Bitrix24|amoCRM|АмоCRM|Мегаплан|Jira|Confluence|Notion|Trello|Miro|Figma|Фигма
Tilda|Тильда|WordPress|Photoshop|Illustrator|Acrobat|Adobe Acrobat|Adobe|Canva|ChatGPT|GPT|Claude|GigaChat
YandexGPT|Контур.Диадок|Диадок|Контур.Эльба|СБИС|Сбис|Госуслуги|Честный знак
Power BI|Tableau|Looker|Metabase|Grafana|Qlik|Excel-таблица|PDF-файл|Word-файл|GitHub|GitLab|Docker|Kubernetes|PostgreSQL|MySQL|Python|JavaScript|Postman`),
  ...wordList(`DeepSeek|Дипсик|Qwen|Gemini|Copilot|GitHub Copilot|Microsoft Copilot|Perplexity|Grok|Midjourney|Шедеврум|ГигаЧат
Яндекс GPT|Yandex GPT|GPT-4|GPT-4o|GPT-5|Яндекс Алиса|Яндекс.Алиса|Яндекс Станция|Яндекс.Станция|SaluteSpeech|Сбер Салют`),
];

/** Продукты, обращения и формулы вежливости, бренд владельца. */
// Группы: обращения и формулы вежливости в начале строки («Thank you», «Dear Ms. …»); бренд владельца не маскируется никогда (решение
// владельца 6, концепция 0.4) — общий список NEVER_MASK_ORGS (names/lexicon.js).
// prettier-ignore
export const STOP_PRODUCTS = [
  ...PRODUCT_NAMES,
  ...wordList(`Thank|Thanks|Dear|Sincerely|Regards|Best regards|Kind regards|Hello|Hi|Здравствуйте|Добрый день|Спасибо
Уважаемый|Уважаемая|Уважаемые|Коллеги|С уважением`),
  ...NEVER_MASK_ORGS,
];

/**
 * Документы, полисы, реестры, кодексы и коды версии 0.5 (WP12-C — новые категории; WP12-E): модель 1.1.0 называла их организациями
 * («СТС», «Полис ОМС», «MAC», «ФС», «Лада Веста»), а значения рядом с ними закрывают детекторы идентификаторов. Марки и модели
 * автомобилей — только целыми названиями модели («Лада» одна — ещё и женское имя, «Toyota» — и компания).
 * Одним словом — только аббревиатуры документов, реестров и кодексов, которые сами по себе не бывают названием стороны; слова,
 * с которых начинаются названия организаций («Почта России», «Почта Банк», «Полис-Гарант»), — только составными записями
 * («Полис ОМС», «Электронная почта»): стоп-список отбрасывает и спан из таких слов, и спан, где они — часть с нарицательными
 * (правило 2б), доработка 0.5 по прогону КП. Серия исполнительного листа («серия ФС № …») — правило обрывка кода (`filters.js`).
 */
// prettier-ignore
export const STOP_DOCS_05 = [
  ...wordList(`СТС|ПТС|ЭПТС|ОМС|Полис ОМС|полис ОМС|ДМС|Полис ДМС|ОСАГО|Полис ОСАГО|КАСКО|СНИЛС|MAC|MAC-адрес|IP-адрес|ЕГРН|ЕГРП
КУСП|ВНЖ|РВП|МКБ|МКБ-10|ГРЗ|VIN|ПТС/ЭПТС|СТС/ПТС|ЗАГС|УИД|Эл. почта|Электронная почта
ГПК|АПК|УПК|КоАП|КАС|ГК РФ|ГПК РФ|АПК РФ|УК РФ|УПК РФ|НК РФ|ТК РФ|ЖК РФ|СК РФ|ЗК РФ|КоАП РФ|КАС РФ`),
  ...wordList(`Лада Веста|Лада Гранта|Лада Ларгус|Лада Нива|Лада Приора|Лада Калина|Лада Иксрей|Lada Vesta|Lada Granta|Lada Largus
Lada Niva|Toyota Camry|Toyota Corolla|Toyota RAV4|Toyota Land Cruiser|Kia Rio|Kia Sportage|Kia Ceed|Hyundai Solaris|Hyundai Creta
Hyundai Tucson|Volkswagen Polo|Volkswagen Tiguan|Skoda Octavia|Skoda Rapid|Renault Logan|Renault Duster|Renault Sandero
Haval Jolion|Haval F7|Chery Tiggo|Geely Coolray|Geely Monjaro|Nissan Qashqai|Nissan X-Trail|Mitsubishi Outlander|Ford Focus
Mazda CX-5|BMW X5|Mercedes-Benz E200|ГАЗель Next|УАЗ Патриот|Тойота Камри|Киа Рио|Хендай Солярис|Шкода Октавия|Фольксваген Поло
Рено Логан|Чери Тигго|Хавал Джолион`),
];

// Кириллические буквы, совпадающие по начертанию с латинскими: «1С» и «1C», «ВЭД» с латинской «B» — одно слово.
const HOMOGLYPHS = { а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x' };

/**
 * Ключ сравнения стоп-списка: нижний регистр, «ё» → «е», кириллица одного начертания с латиницей → латиница,
 * пробелы и точки между словами — одним пробелом, кавычки и знаки по краям отброшены.
 * @param {string} s
 */
export function stopKey(s) {
  return String(s)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[авекмнорстух]/g, (c) => HOMOGLYPHS[c])
    .replace(/[«»"“”„'‘’]/g, '')
    .replace(/[\s\u00a0.]+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}+]+$/gu, '')
    .trim();
}

/** Встроенный стоп-список (ключи `stopKey`). */
export const BUILTIN_STOPLIST = Object.freeze(new Set([...STOP_ABBREVIATIONS, ...STOP_PRODUCTS, ...STOP_DOCS_05].map(stopKey)));

/**
 * Стоп-список документа: встроенный ∪ пользовательский (`settings.nerStoplist`).
 * @param {unknown} [extra]
 * @returns {Set<string>}
 */
export function buildStoplist(extra) {
  const set = new Set(BUILTIN_STOPLIST);
  if (Array.isArray(extra)) {
    for (const x of extra) {
      if (typeof x !== 'string') continue;
      const k = stopKey(x);
      if (k) set.add(k);
    }
  }
  return set;
}

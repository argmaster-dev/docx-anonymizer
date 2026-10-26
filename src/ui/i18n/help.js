// Строки справки. Факты — из README: что делает, как пользоваться, что данные не покидают компьютер.
// Версия 0.2: доступ к сайтам по запросу (К9), словарный поиск ФИО (FR-23), пакет модели NER (§5.2), склонение при восстановлении (FR-37).
// Версия 0.3: PDF с текстовым слоем (FR-54–FR-57), файл от ИИ (FR-36а), два архива — полный с моделью и лёгкий (§5.2, К12).
// Версия 0.4: политика маскирования (docs/concept-0.4.md, Ц1–Ц3, FR-58–FR-62): что всегда (ИП и обращения по имени — люди),
// что по желанию (организации модели — только в коммерческом режиме), список компаний, бренд Sitimlab не маскируется; модель 1.1.0.
// Версия 0.5 (WP12-B): Excel, PowerPoint и текстовые файлы — тем же форматом, восстановление .xlsx/.pptx/.csv/.json, сканы — в 0.6.
// Версия 0.5 (WP12-C): новые категории — паспорт по частям, документы, транспорт, суды, недвижимость; особые категории — только по метке.
export const HELP_DICT = {
  ru: {
    title: 'Справка',
    subtitle: 'DOCX Anonymizer: договор в ИИ-сервис без реквизитов и личных данных.',
    what_h: 'Что делает расширение',
    what_p1:
      'Перед тем как договор, таблица, презентация или выгрузка попадёт в ChatGPT, Claude или другой ИИ-сервис, расширение перехватывает файл (.docx, .xlsx, .pptx, PDF, .txt, .csv, .json, .md, .log), локально находит в нём персональные и коммерческие данные и заменяет их плейсхолдерами.',
    what_p2:
      'В сервис уходит обезличенный файл того же формата: форматирование, таблицы, листы, формулы, слайды, заметки, колонтитулы сохранены, метаданные файла очищены; из PDF — его текст с плейсхолдерами. Ответ ИИ — текстом или файлом — можно вернуть обратно с настоящими названиями и именами.',
    how_h: 'Как пользоваться',
    how_1:
      'Откройте меню расширения на сайте чата и включите «Перехват загрузки». Если сайта нет в списке, нажмите «Добавить …» и подтвердите запрос Chrome на доступ к сайту; для сайтов из списка по умолчанию нажмите «Разрешить доступ». По умолчанию перехват выключен, а доступа к сайтам у расширения нет.',
    how_2: 'Приложите файл в чате: кнопкой, перетаскиванием или вставкой. Расширение остановит файл и покажет панель: что найдено и где.',
    how_3:
      'Снимите лишние галочки и нажмите «Анонимизировать и загрузить» — в чат уйдёт файл того же формата (имя.anon.docx, имя.anon.xlsx, имя.anon.csv…), а для PDF — имя.anon.md.',
    how_4:
      'Ответ ИИ вставьте текстом или загрузите файлом от ИИ (.docx, .xlsx, .pptx, .csv, .json, .md, .txt) на странице «Восстановить текст»: расширение подставит настоящие значения из карты замен — ключа восстановления — и отдаст файл «имя.restored.*» с прежним форматированием; в файле заменяются только метки точно как в карте или в квадратных скобках. Ключ хранится только у вас, в памяти браузера до его перезапуска; сохранить его в файл можно на экране «готово» панели: «Ещё» → «Сохранить ключ восстановления». ФИО ставятся в нужный падеж по контексту, склонённые подстановки выделены зелёным — проверьте их.',
    policy_h: 'Что маскируется',
    policy_1:
      'Всегда: персональные данные — ФИО (в том числе «ИП Фамилия И.О.»: индивидуальный предприниматель — это человек, его ИНН и ОГРНИП тоже закрываются; и обращение по одному имени — «Елена, добрый день!»), паспорт (серия и номер, кем выдан, дата выдачи и код подразделения — каждое своей меткой), загранпаспорт, водительское удостоверение, военный билет, вид на жительство и разрешение на работу, миграционная карта, свидетельства ЗАГС, полис ОМС, СТС и ПТС, VIN и госномер, IP- и MAC-адрес, ники в мессенджерах, СНИЛС, SSN, телефон, электронная почта, адрес, дата рождения, банковская карта. Сведения о здоровье (диагноз, код МКБ-10) и особые категории — вероисповедание, национальность, политические взгляды, судимость — только по явной метке («Диагноз:», «Вероисповедание:») или в столбце таблицы с таким заголовком: без метки они не ищутся. Отключить эти категории в настройках нельзя; снять галочку с конкретной находки в панели можно.',
    policy_2:
      'Всегда: идентификаторы — ИНН, КПП, ОГРН/ОГРНИП, расчётный счёт, IBAN, БИК, SWIFT, иностранный налоговый номер, ссылки, кадастровые номера и записи ЕГРН, номера судебных дел и исполнительных производств, КУСП, доверенности и реестровые номера нотариуса — даже если название компании остаётся открытым.',
    policy_3:
      'По желанию: коммерческая информация — названия организаций, номера договоров, закупок ЕИС, заказов, счетов и клиентов, патенты, товарные знаки и регистрация программ для ЭВМ, суммы. По умолчанию выключена; включается переключателем «Коммерческая информация» в настройках, раздел «Что маскируется». Организации, найденные моделью NER, панель показывает только в этом режиме. Sitimlab — бренд разработчика расширения — не маскируется никогда.',
    policy_4:
      'Список компаний: названия, которые нужно скрывать всегда (свою фирму, ключевых клиентов), впишите в настройках, раздел «Компании для маскирования», или нажмите «Маскировать всегда» в строке организации панели. Они ищутся во всех падежах, с юридической формой и без, кириллицей и латиницей, и получают одну метку на компанию.',
    privacy_h: 'Данные не покидают ваш компьютер',
    privacy_1: 'Расширение не делает ни одного сетевого запроса: это закреплено политикой безопасности расширения и проверяется тестами.',
    privacy_2: 'Документ обрабатывается в изолированном окне самого браузера и никуда не отправляется.',
    privacy_3: 'Содержимое документа и карта замен живут только в памяти и не записываются в хранилище браузера.',
    privacy_4:
      'Модель NER не скачивается из сети: в полном архиве расширения она уже есть и при первом запуске сама копируется из архива, для лёгкого архива пакет вы скачиваете и импортируете сами. Её файлы хранятся в хранилище браузера на этом компьютере; документы и результаты распознавания туда не записываются.',
    check_h: 'Что стоит знать',
    check_1: 'Перед отправкой всегда просматривайте результат — ответственность за содержимое остаётся за вами.',
    check_2:
      'Имена и названия находятся правилами: по меткам, шаблонам, базе знаний сторон из реквизитов и словарям имён и фамилий — так находятся и третьи лица без подписи «в лице». Для остального есть модель NER (пакет 1.1.0 обучен и на деловых документах — письмах, коммерческих предложениях, счетах, переписке): в полном архиве расширения она уже есть и ставится сама при первом запуске, в том числе поверх прежней версии после обновления, в лёгком — скачайте пакет с GitHub Releases и импортируйте в настройках («Модель NER» → «Импортировать пакет…»); модель работает офлайн, на этом компьютере. Одиночная фамилия или редкое имя всё равно могут остаться.',
    check_3: 'Встроенные объекты (OLE-вложения) не обезличиваются — расширение предупреждает об этом или удаляет их по настройке.',
    check_4:
      'Работает с файлами Word (.docx, .docm), Excel (.xlsx, .xlsm), PowerPoint (.pptx, .pptm), PDF с текстовым слоем и текстовыми (.txt, .md, .csv, .json, .log). В Excel формулы не меняются: число-идентификатор (ИНН, счёт, телефон) становится текстовой ячейкой, лист с данными в названии переименовывается, данные внутри формул остаются — панель об этом предупреждает. В CSV сохраняются разделитель и кодировка, в JSON — ключи и структура. Из PDF в чат уходит текст с плейсхолдерами (имя.anon.md, по настройке — .txt), а не PDF: заголовки, списки и таблицы сохранены, колонтитулы и номера страниц убраны. Сканы и изображения не обрабатываются — распознавание сканов появится в следующей версии; такие файлы, PDF с паролем и пустые PDF можно загрузить как есть после подтверждения. Нужен Chrome или Edge версии 132 и новее.',
    open_options: 'Открыть настройки',
    open_restore: 'Восстановить текст',
  },
  en: {
    title: 'Help',
    subtitle: 'DOCX Anonymizer: send a contract to an AI service without requisites or personal data.',
    what_h: 'What the extension does',
    what_p1:
      'Before a contract, spreadsheet, presentation or data export reaches ChatGPT, Claude or another AI service, the extension intercepts the file (.docx, .xlsx, .pptx, PDF, .txt, .csv, .json, .md, .log), finds personal and commercial data in it locally and replaces it with placeholders.',
    what_p2:
      'The service receives an anonymized file of the same format: formatting, tables, sheets, formulas, slides, notes and headers are kept, file metadata is cleared; for a PDF it receives the PDF text with placeholders. The AI answer — text or a file — can be turned back into real names and titles.',
    how_h: 'How to use it',
    how_1:
      'Open the extension menu on the chat site and turn on "Upload interception". If the site is not listed, press "Add …" and accept Chrome\'s request for access to the site; for sites listed by default, press "Allow access". Interception is off by default and the extension has no access to sites until you allow it.',
    how_2:
      'Attach a file in the chat: with the button, by drag and drop or by pasting. The extension holds the file and shows a panel with what was found and where.',
    how_3:
      'Clear the checkmarks you do not need and press "Anonymize and upload" — the chat receives a file of the same format (name.anon.docx, name.anon.xlsx, name.anon.csv…), or name.anon.md for a PDF.',
    how_4:
      'Paste the AI answer as text or load the file the AI produced (.docx, .xlsx, .pptx, .csv, .json, .md, .txt) on the "Restore text" page: the extension puts the real values back from the replacement map (the recovery key) and gives you a "name.restored.*" file with the original formatting; in a file only markers written exactly as in the map or in square brackets are replaced. The key stays only with you, in browser memory until the browser restarts; save it to a file on the panel\'s "done" screen: "More" → "Save the recovery key". Russian names are put in the right case by context; declined values are highlighted in green — check them.',
    policy_h: 'What is masked',
    policy_1:
      'Always: personal data — names (including “IP Surname I.I.”: a sole trader is a person, so their INN and OGRNIP are masked too; and a greeting with a first name only — “Elena, good afternoon!”), passports (series and number, issuing authority, date of issue and department code — each with its own marker), international passports, driver’s licenses, military IDs, residence and work permits, migration cards, civil status certificates, health insurance (OMS) policies, vehicle registration documents, VINs and license plates, IP and MAC addresses, messenger handles, SNILS, SSN, phones, emails, addresses, dates of birth, bank cards. Health data (diagnosis, ICD-10 code) and special categories — religion, ethnicity, political views, criminal record — are found only by an explicit label (“Diagnosis:”, “Religion:”) or in a table column with such a header: without a label they are not searched. These categories cannot be turned off in the settings; you can still clear the checkmark of a particular finding in the panel.',
    policy_2:
      'Always: identifiers — INN, KPP, OGRN/OGRNIP, bank accounts, IBAN, BIK, SWIFT, foreign tax IDs, links, cadastral numbers and land registry records, court case and enforcement proceedings numbers, police report numbers, powers of attorney and notarial register numbers — even when the company name stays visible.',
    policy_3:
      'Optional: commercial information — company names, contract, tender, order, invoice and customer numbers, patents, trademarks and software registrations, amounts. Off by default; turn it on with the “Commercial information” switch in the settings, “What is masked”. Companies found by the NER model appear in the panel only in this mode. Sitimlab, the extension developer’s brand, is never masked.',
    policy_4:
      'Company list: names that must always be hidden (your own firm, key clients) — add them in the settings, “Companies to mask”, or press “Always mask” in a company row of the panel. They are found in every grammatical case, with or without the legal form, in Cyrillic and Latin, and get one label per company.',
    privacy_h: 'Your data never leaves your computer',
    privacy_1: 'The extension makes no network requests at all: this is enforced by the extension security policy and checked by tests.',
    privacy_2: 'The document is processed in an isolated browser window and is not sent anywhere.',
    privacy_3: 'Document content and the replacement map live in memory only and are not written to browser storage.',
    privacy_4:
      'The NER model is never downloaded from the network: the full extension archive already contains it and copies it from the archive on first run; for the lite archive you download and import the pack yourself. Its files are kept in browser storage on this computer; documents and recognition results are never written there.',
    check_h: 'Good to know',
    check_1: 'Always review the result before sending — you remain responsible for the content.',
    check_2:
      'Names and titles are found by rules: labels, patterns, the knowledge base of the parties from the requisites and first-name and surname dictionaries — this also finds third persons without a “represented by” label. For the rest there is the NER model (pack 1.1.0 is also trained on business documents — letters, proposals, invoices, chats): the full extension archive already contains it and installs it on first run, including over the previous version after an update; with the lite archive, download the pack from GitHub Releases and import it in the settings (“NER model” → “Import pack…”); the model runs offline, on this computer. A lone surname or a rare name may still remain.',
    check_3: 'Embedded objects (OLE attachments) are not anonymized — the extension warns about them or removes them, depending on settings.',
    check_4:
      'Works with Word (.docx, .docm), Excel (.xlsx, .xlsm), PowerPoint (.pptx, .pptm), PDF files that have a text layer and text files (.txt, .md, .csv, .json, .log). In Excel formulas are not changed: an identifier stored as a number (tax ID, account, phone) becomes a text cell, a sheet with data in its name is renamed, data inside formulas stays — the panel warns about it. CSV keeps its delimiter and encoding, JSON keeps its keys and structure. For a PDF the chat receives the text with placeholders (name.anon.md, or .txt in the settings) instead of the PDF: headings, lists and tables are kept, headers, footers and page numbers are removed. Scans and images are not processed — scan recognition is coming in the next version; such files, password-protected and empty PDFs can be uploaded as is after confirming. Chrome or Edge 132 or later is required.',
    open_options: 'Open settings',
    open_restore: 'Restore text',
  },
};

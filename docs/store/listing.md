# Тексты листинга: Chrome Web Store и Edge Add-ons (версия 0.5.1)

Подготовлено 27.10.2026 (WP12-F, концепция 0.5 п. 9, Ц7, К15). Подача — решение владельца. Целевой магазин — Chrome Web Store; поля Edge (поисковые запросы, «Notes for certification») — справочно, подача в Edge не планируется. Требования к полям и ссылки — [`checklist.md`](checklist.md).

Принятые решения по текстам:

- **Без названий ИИ-сервисов и чужих брендов** ни в кратком описании, ни в картинках: Chrome Web Store не советует ссылаться в кратком описании на похожие продукты, Edge требует не упоминать другие браузеры, а упоминание чужих товарных знаков в листинге — лишний повод для вопросов ревьюера. В полном описании сказано «ИИ-чаты и другие сайты»; список сайтов по умолчанию пользователь видит в настройках.
- **Без превосходных степеней** («лучший», «самый быстрый») и без повторов ключевых слов — правило о спаме ключевыми словами.
- **Ограничения названы прямо** (Edge 1.1.2 «Describe your extension»: важные ограничения — в описании): сканы не обрабатываются, особые категории — только по метке, проверяйте результат.

## Название

`DOCX Anonymizer` — из `_locales/*/messages.json` (`extName`), одно для обоих языков.

## Краткое описание (из манифеста, ≤ 132 символа)

Берётся из `extDescription` пакета; в Edge поле «Short description» только для чтения — меняется перезаливкой пакета.

- **ru** (127): Локально обезличивает документы Word, Excel, PowerPoint, PDF и текстовые файлы перед загрузкой в ИИ-чаты. Без сетевых запросов.
- **en** (119): Locally anonymizes Word, Excel, PowerPoint, PDF and text files before you upload them to AI chats. No network requests.

## Категория

- **Chrome Web Store:** «Конфиденциальность и безопасность» (Privacy & Security, группа «Make Chrome Yours»); если в форме её нет — «Производительность → Инструменты» (Productivity → Tools). Список категорий в официальной документации не опубликован — выбрать в форме при подаче.
- **Edge Add-ons:** «Продуктивность» (Productivity). Отдельной категории приватности в Edge Add-ons, по открытым данным, нет — сверить в форме Partner Center.

## Поисковые запросы (Edge, ≤ 7 запросов, ≤ 30 символов каждый, ≤ 21 слово всего)

- **ru:** обезличивание документов; персональные данные; анонимизация docx; ИИ и конфиденциальность; маскирование ПДн; обезличивание Excel; договор без реквизитов
- **en:** document anonymizer; personal data; redact docx; AI privacy; PII masking; anonymize Excel; contract redaction

## Полное описание — ru (≈ 2 400 символов; Edge: от 250 до 10 000)

```
Перед тем как договор, таблица или презентация попадёт в ИИ-чат, расширение перехватывает файл, прямо на вашем компьютере находит в нём персональные данные и реквизиты и заменяет их метками вида [ФИО_1], [ИНН_1], [СЧЕТ_1]. В чат уходит обезличенная копия того же формата, а ответ ИИ можно вернуть с настоящими значениями.

Что умеет
• Форматы: Word (.docx, .docm), Excel (.xlsx, .xlsm), PowerPoint (.pptx, .pptm), PDF с текстовым слоем, текстовые файлы (.txt, .md, .csv, .json, .log). Форматирование, таблицы, формулы, слайды и заметки сохраняются; из PDF в чат уходит текст с метками.
• Персональные данные и реквизиты закрываются всегда: ФИО, паспорт по частям, СНИЛС, телефоны, почта, адреса, водительское удостоверение, полис ОМС, VIN и госномер, ИНН, КПП, ОГРН, счета, БИК, IBAN, кадастровые номера, номера судебных дел и другое — 50 категорий с проверкой контрольных сумм, где они есть.
• Коммерческая информация — названия организаций, номера договоров, заказов и счетов, суммы — по желанию, по умолчанию выключена; свои компании можно внести в список «маскировать всегда».
• Скрытое в документе: панель сообщает о комментариях, истории правок, скрытом тексте, скрытых листах и слайдах и по вашему выбору удаляет их; метаданные файла очищаются.
• Перед отправкой видно всё найденное: можно снять лишнее, добавить своё, посмотреть текст с подсветкой.
• Восстановление: ответ ИИ — текстом или файлом (.docx, .xlsx, .pptx, .csv, .json, .md, .txt) — возвращается с настоящими значениями по ключу восстановления; ФИО склоняются по контексту. Ключ можно сохранить в файл и защитить паролем.
• Имена без меток находит встроенная нейросетевая модель, работающая в браузере.

Приватность
Расширение не делает ни одного сетевого запроса: документ, найденные значения и ключ восстановления не покидают компьютер. Доступ к сайтам выдаёте вы сами, по одному сайту; перехват выключен, пока вы его не включите.

Ограничения
Сканы и изображения не распознаются (такой файл можно загрузить как есть после подтверждения). Сведения о здоровье, вероисповедание и другие особые категории находятся только по явной метке («Диагноз:»). Автоматический поиск ошибается — перед отправкой просматривайте результат.

Модель распознавания имён обучена в том числе на открытых корпусах без явной лицензии на тексты (NEREL, Nerus) и распространяется как есть; подробности — в справке расширения и в репозитории проекта.
```

## Полное описание — en (≈ 2 600 символов)

```
Before a contract, spreadsheet or deck reaches an AI chat, the extension intercepts the file, finds personal data and company identifiers in it right on your computer and replaces them with markers such as [PERSON_1], [INN_1], [ACCOUNT_1]. The chat receives an anonymized copy in the same format, and the AI's answer can be restored with the real values.

Features
• Formats: Word (.docx, .docm), Excel (.xlsx, .xlsm), PowerPoint (.pptx, .pptm), PDF with a text layer, text files (.txt, .md, .csv, .json, .log). Formatting, tables, formulas, slides and notes are kept; for a PDF the chat receives its text with markers.
• Personal data and identifiers are always masked: names, passport details (each part separately), phone numbers, e-mails, addresses, driver's licenses, health insurance and vehicle numbers, Russian tax and company IDs (INN, KPP, OGRN), bank accounts, IBAN, SWIFT, cadastral and court case numbers and more — 50 categories, with checksum validation where one exists.
• Commercial information — company names, contract, order and invoice numbers, amounts — is optional and off by default; your own companies can be added to an "always mask" list.
• Hidden content: the panel reports comments, tracked changes, hidden text, hidden sheets and slides and removes them if you choose; file metadata is wiped.
• Before sending you see everything that was found: uncheck what is not needed, add your own, review the text with highlights.
• Restore: the AI's answer — pasted text or a file (.docx, .xlsx, .pptx, .csv, .json, .md, .txt) — gets the real values back from the recovery key; Russian names are declined by context. The key can be saved to a file and protected with a password.
• Names without labels are found by a built-in neural model that runs inside the browser.

Privacy
The extension makes no network requests: the document, the values found in it and the recovery key never leave your computer. You grant site access yourself, one site at a time; interception is off until you turn it on.

Limitations
Scans and images are not recognized (such a file can be uploaded as is after you confirm). Health data, religion and other special categories are found only by an explicit label ("Diagnosis:"). Automatic detection makes mistakes — review the result before sending. The interface and detection are Russian-first; English documents and an English interface are supported.

The name recognition model was trained, among other data, on open corpora whose texts have no explicit license (NEREL, Nerus) and is provided as is; see the extension's help page and the project repository.
```

## Заметки для проверяющих (Edge — «Notes for certification»; Chrome — при запросе ревьюера)

```
No account or server is needed. To test:
1. Open any https page with a file upload field, or a local page served over http (e.g. python3 -m http.server in a folder with an HTML page containing <input type="file">); file:// pages are not supported.
2. Click the extension icon, turn on "Upload interception" and press "Add <site>" — the browser asks for access to this one site (optional_host_permissions).
3. Attach a .docx/.xlsx/.pptx/.pdf/.csv file with names, phone numbers or tax IDs. The extension panel shows the findings; "Anonymize and upload" passes an anonymized copy to the page.
4. "Restore text" in the extension menu restores an answer with markers.
All processing is local: the extension makes no network requests (CSP connect-src 'self'). The bundled files models/*.zip contain NER model weights (ONNX data, not code) that are copied into the extension's OPFS storage on first run; vendor/ort-wasm-simd-threaded.wasm is ONNX Runtime Web (MIT), vendor/pdfjs is pdf.js (Apache-2.0). Source code: https://github.com/argmaster-dev/docx-anonymizer
```

# Магазины: комплект и чек-лист подачи (версия 0.5.1)

Подготовка к магазинам по концепции 0.5 (п. 9 «Магазины», Ц7, К15). **Целевой магазин — Chrome Web Store** (решение владельца 0.5); материалы для Edge Add-ons (требования Edge в пунктах ниже, `edge-upload.md`, логотип 300×300, шестой снимок, `--lite`) оставлены как справочные — **подача в Edge не планируется**. **Статус: комплект собран и проверен, не подан.** Подачу, аккаунты разработчика и оплату делает владелец; из репозитория ничего никуда не отправляется. Требования сверены с официальной документацией 27.10.2026 (ссылки — в конце и у каждого пункта).

## Комплект

| Что | Где | Как получить |
|---|---|---|
| Пакет для Chrome Web Store (полный, с моделью NER 1.2.1, манифест без `key`; годится и для Edge) | `release/docx-anonymizer-0.5.1-store.zip` (не в git) | `npm run pack:store` — сборка, автоматические проверки ниже; печатает размер и sha256 |
| Справочно, Edge (не планируется): лёгкий пакет без модели — только чтобы создать продукт в Edge, если полный не грузится через браузер | `release/docx-anonymizer-0.5.1-store-lite.zip` | `npm run pack:store -- --lite`; [`edge-upload.md`](edge-upload.md) |
| Тексты листинга ru/en, категория, поисковые запросы, заметки для проверяющих | [`listing.md`](listing.md) | — |
| Политика конфиденциальности ru/en | [`privacy.md`](privacy.md) | публичная ссылка — после push (раздел 5) |
| Скриншоты 1280×800, ru и en | `docs/store/images/{ru,en}/0[1-6]-*.png` | `npm run store:shots` (под блокировкой сборки, как e2e) |
| Промо-плитки 440×280 и 1400×560, значок 128×128, логотип 300×300 | `docs/store/images/` | то же |
| Справочно, Edge (не планируется): загрузка крупного пакета в Edge Partner Center | [`edge-upload.md`](edge-upload.md) | — |

Размеры 0.5.0 (02.11.2026, `npm run pack` и `npm run pack:store`): лёгкий архив релиза 6 616 449 байт (6,3 МиБ), полный 36 223 813 байт (34,5 МиБ), пакет для магазинов 36 223 459 байт (34,5 МиБ; от полного отличается только манифестом без `key`). Лимиты К14: лёгкий ≤ 12 МБ, полный ≤ 45 МБ — пройдены. Размеры 0.5.1 (05.11.2026, после смены лицензии, WP13-L): лёгкий 6 627 243 байт, полный 36 238 795 байт, пакет для магазинов 36 238 441 байт (34,6 МиБ), модель 1.2.1 внутри.

## 1. Пакет

- [x] `manifest.json` — в корне архива ([Prepare your extension](https://developer.chrome.com/docs/webstore/prepare): «place the manifest file in the root directory»); Manifest V3; версия 0.5.1 (каждая следующая загрузка — с большей версией).
- [x] **Поля `key` нет.** Он нужен только распакованной установке (закрепляет ID при обновлении из папки, README «Обновление»); магазин назначает свой ID, а загрузку с `key`/`update_url` Chrome Web Store, по опыту разработчиков, отклоняет. Следствие: установка из магазина — другое расширение с другим ID; настройки и модель распакованной установки она не видит (при переходе — экспорт настроек → импорт).
- [x] **Нет `update_url`**, обновления — только через магазин (Edge 1.2.4 «Extension updates»).
- [x] Краткое описание (`extDescription`) ≤ 132 символов в обеих локалях: ru 127, en 119 ([Prepare your extension](https://developer.chrome.com/docs/webstore/prepare)); название ≤ 75.
- [x] Название и описание — через `__MSG_…__` и `default_locale` (`ru`), локали `ru` и `en`: Partner Center находит языки листинга именно так ([Publish a Microsoft Edge extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension), «If a single locale appears…»).
- [x] Иконки 16/32/48/128 в пакете.
- [x] В пакете нет исходников, тестов, `node_modules`, sourcemaps.
- [x] **Лицензия** (с 0.5.1, WP13-L): `LICENSE` (Apache 2.0) и `NOTICE` — в корне пакета; лицензии сторонних компонентов — в `vendor/`.
- [x] **Размер.** Chrome Web Store — до 2 ГБ ([Publish](https://developer.chrome.com/docs/webstore/publish)). Edge Add-ons официального лимита не публикует; пакет ≈ 34,5 МиБ у границы, где браузерная загрузка в Partner Center, по опыту разработчиков, падает → [`edge-upload.md`](edge-upload.md).

Автоматически это проверяет `npm run pack:store` (`scripts/pack-store.mjs`, `checkStorePackage`) и тест `tests/integration/pack-store.spec.js`: манифест в корне, MV3, версия, нет `key`/`update_url`/`host_permissions`, длины описания и названия во всех локалях, иконки, нет `<script src>` с внешних адресов, нет служебного блока «Проверка конвейера (dev)» в `popup.html`, CSP без внешних источников, `LICENSE` (Apache 2.0) и `NOTICE` в корне, ровно один пакет модели — последний из `KNOWN_PACKS` с верным sha256, нет лишних файлов, размер ≤ 45 МБ.

## 2. Удалённый код и читаемость

Требования: [MV3 requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements) («the full functionality of an extension must be easily discernible from its submitted code»; нарушения — внешний `<script>`, `eval` строки с сервера, интерпретатор команд с сервера), Edge — «In Manifest V3, loading and executing remotely hosted code is not permitted» ([Publish](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension), «Declare any use of remote code»).

- [x] **Удалённого кода нет.** Сетевых запросов нет вовсе: CSP `connect-src 'self'`, ESLint запрещает сетевые API в `src/`, e2e `nfr.spec.js` слушает трафик всех целей браузера.
- [x] **WebAssembly — в пакете**: `vendor/ort-wasm-simd-threaded.wasm` (ONNX Runtime Web 1.30.0, MIT) грузится из пакета; `'wasm-unsafe-eval'` в CSP — минимум, который Chrome сам ставит страницам расширения для WASM ([CSP в манифесте](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)); `'unsafe-eval'` нет.
- [x] **Модель NER — данные, не код**: `models/docx-anonymizer-ner-rubert-tiny2-ner-ruen-1.2.1.zip` — веса ONNX, конфигурация и словарь токенизатора; при первом запуске копируются из пакета (`chrome-extension://`, не сеть) в OPFS и исполняются ONNX Runtime из пакета. Ничего не скачивается, sha256 пакета зашит в код (`KNOWN_PACKS`).
- [x] pdf.js (Apache-2.0) с CMaps и шрифтами — в `vendor/pdfjs/` пакета.
- [x] **Обфускации нет** ([Code readability](https://developer.chrome.com/docs/webstore/program-policies/code-readability), Edge 1.1.7): код расширения не минифицируется; минифицированы только сторонние библиотеки ONNX Runtime Web и pdf.js в их официальных сборках npm (минификация разрешена: «Removal of whitespace… Shortening of variable and function names»). Исходники — в открытом репозитории.
- **Ответ в форме:** «No, I am not using remote code» / «Нет, я не использую удалённый код».

## 3. Единственное назначение

[Quality guidelines](https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines) («An extension must have a single purpose that is narrow and easy to understand»), Edge 1.1.1.

- [x] Все функции служат одному: обезличить документ перед загрузкой на сайт и вернуть настоящие значения в ответ (меню, настройки, восстановление, справка — части одного сценария).
- **Поле «Single purpose»:**
  - ru: «Локально обезличивает документы (Word, Excel, PowerPoint, PDF, текстовые файлы) перед загрузкой на выбранные пользователем сайты: находит персональные данные и реквизиты, заменяет их метками и позволяет вернуть настоящие значения в ответ ИИ. Без сетевых запросов.»
  - en: «Anonymizes documents (Word, Excel, PowerPoint, PDF, text files) locally before they are uploaded to sites the user chooses: finds personal data and identifiers, replaces them with markers and lets the user put the real values back into the AI's answer. No network requests.»

## 4. Разрешения — обоснование каждого

Поле «Permission justification» в обоих магазинах ([Privacy tab](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), Edge 1.6 «only request those permissions that are necessary»). Запрашивается только то, что ниже; `host_permissions` нет.

| Разрешение | Зачем (ru) | Why (en) |
|---|---|---|
| `storage` | Хранить настройки пользователя в `chrome.storage.local`: перехват и списки сайтов, свои категории, переключатели, положение панели на сайте; по явной команде пользователя — отдельные значения из документа («Больше не предлагать» → список исключений, «Маскировать всегда» → список компаний), видны и удаляются в настройках. Документы, их текст и карта замен туда не пишутся. | Stores the user's settings in chrome.storage.local: interception and site lists, custom categories, switches, the panel position per site; on the user's explicit command — individual values from a document ("Stop suggesting" → exclusions list, "Always mask" → company list), shown and deletable in the settings. Documents, their text and the replacement map are never stored. |
| `unlimitedStorage` | Хранить пакет нейросетевой модели распознавания имён (≈ 30 МБ весов) в хранилище расширения (OPFS); без него модель может не поместиться в квоту. | Keeps the name recognition model package (≈ 30 MB of weights) in the extension's OPFS storage; without it the model may exceed the default quota. |
| `offscreen` | Обработка документа идёт в offscreen-документе расширения (`reasons: WORKERS`): Web Worker с разбором Word/Excel/PowerPoint/PDF и моделью на WebAssembly. Service worker не может держать Worker и долгую обработку. | Documents are processed in the extension's offscreen document (reason WORKERS): a Web Worker parses Word/Excel/PowerPoint/PDF and runs the WebAssembly model. A service worker cannot host a Worker or long processing. |
| `scripting` | Регистрировать скрипт перехвата загрузки файлов только на сайтах, к которым пользователь выдал доступ (`registerContentScripts`), и внедрять его во вкладку сразу после выдачи доступа, без перезагрузки страницы. | Registers the file upload interception script only on sites the user granted access to (registerContentScripts) and injects it into the tab right after access is granted, without a reload. |
| `activeTab` | Когда пользователь открывает меню расширения, узнать адрес текущей вкладки, чтобы показать, работает ли там перехват, и по его нажатию добавить этот сайт. | When the user opens the extension menu, reads the current tab's address to show whether interception works there and to add that site when the user clicks. |
| `optional_host_permissions: <all_urls>` | Доступ к сайту запрашивается во время работы, по одному сайту и только по действию пользователя («Разрешить доступ», «Добавить сайт»); при установке доступа нет ни к одному сайту. Сайты загрузки файлов заранее неизвестны (у каждого ИИ-сервиса и формы свой адрес), поэтому список не зашит. | Site access is requested at runtime, one site at a time and only on the user's action ("Allow access", "Add site"); no site access at install. Upload sites are not known in advance, so the list is not hard-coded. |

Отдельно — `tabs` не запрашивается: адрес текущей вкладки виден по `activeTab`, а значок «ON» ставится только на сайтах с выданным доступом.

## 5. Данные пользователя и политика конфиденциальности

Требования: Chrome — [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) (п. 3: раскрывать обращение с данными нужно, «even when data is processed or stored locally»; п. 14: политика нужна и при локальном хранении), [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use), [Privacy policies](https://developer.chrome.com/docs/webstore/program-policies/privacy); Edge — 1.5 «Personal information» и 1.5.2 «Maintain a privacy policy» ([Developer policies](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies)).

- [x] Политика ru/en — [`privacy.md`](privacy.md): ноль сетевых запросов; ничего не собирается и не передаётся; что хранится локально (настройки, а по команде пользователя — значения из «Исключений» и «Компаний для маскирования» и адреса сайтов в списках и положениях панели — `chrome.storage.local`; модель — OPFS; документ и карта замен — только память; ключ — файл у пользователя, по желанию с паролем) и как удалить; что получает сайт; доступ к сайтам. Политика говорит о «браузере», а не о Chrome (Edge 1.5.2: политика не должна быть про другие браузеры).
- [ ] **Публичная ссылка** — после push ветки в `main`: `https://github.com/argmaster-dev/docx-anonymizer/blob/main/docs/store/privacy.md`. Проверить, что открывается без входа; вставить в поле «Privacy policy URL» обоих магазинов.
- **Раскрытие данных (Chrome «Data usage», Edge «Data usage»).** Расширение ничего не передаёт, но по FAQ п. 3 локальная обработка тоже раскрывается. Рекомендация — отметить категории, которые встречаются в обрабатываемых документах: «Personally identifiable information» (ФИО, паспорт, адреса, телефоны), «Financial and payment information» (счета, карты в документах), «Health information» (диагноз по метке); в пояснении — «processed locally in memory only, never transmitted or stored». «Website content», «Web history», «User activity», «Location», «Authentication information», «Personal communications» — не отмечать: расширение не читает страницы и историю, а обрабатывает только файл, который пользователь сам приложил. Окончательный выбор — владельца.
- **Подтверждения (certifications)** — все три можно отметить честно: данные не продаются третьим лицам; не используются и не передаются для целей, не связанных с единственным назначением; не используются для кредитоспособности и кредитования.

## 6. Листинг

- [x] Тексты ru/en — [`listing.md`](listing.md): краткое (из манифеста) и полное описание, категория, поисковые запросы, заметки для проверяющих.
- [x] Edge: полное описание от 250 до 10 000 символов (ru ≈ 2 400, en ≈ 2 600); поисковых запросов ≤ 7, каждый ≤ 30 символов, всего ≤ 21 слово ([Publish](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension), Step 7).
- [x] Без превосходных степеней и повторов ключевых слов ([Best listing](https://developer.chrome.com/docs/webstore/best-listing)); без названий ИИ-сервисов и других браузеров в описании (Chrome: краткое описание не ссылается на похожие продукты; Edge 1.1.2: «must not reference other browsers»).
- [x] Ограничения названы в описании (Edge 1.1.2): сканы, особые категории только по метке, «проверяйте результат», модель «как есть».
- [x] Строки интерфейса, где говорилось «Chrome спросит / Chrome не выдал доступ», в 0.5 заменены на «браузер». Справка: «Нужен Chrome версии 132 и новее» / «Chrome 132 or later is required» (решение владельца: целевой браузер — Chrome); README по-прежнему говорит, что расширение работает и в Edge.
- [x] Сайт проекта / поддержка: репозиторий `https://github.com/argmaster-dev/docx-anonymizer` и его issues. `homepage_url` в манифесте — `https://sitimlab.ru/?utm_source=extension&utm_medium=store` (решение владельца; ссылка «Сделано в Sitimlab» на страницах расширения — без меток).
- [x] Служебный раздел меню «Проверка конвейера (dev)» есть только в e2e-сборке: `scripts/build.mjs` вырезает его из `popup.html` релизных сборок (`npm run build`, `pack`, `pack:store`, `--lite`), `checkStorePackage` и `pack.spec.js` это проверяют (решение владельца).

## 7. Изображения

Требования: Chrome — [Images](https://developer.chrome.com/docs/webstore/images) и [Store listing](https://developer.chrome.com/docs/webstore/cws-dashboard-listing): значок 128×128 (рисунок 96×96 и прозрачные поля 16 px), скриншоты 1280×800 или 640×400, от 1 до 5, «full bleed», малая промо-плитка 440×280 и большая 1400×560 — PNG или JPEG, на плитках «Avoid text»; Edge — [Publish](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension), Step 7: логотип 1:1, рекомендовано 300×300 (не меньше 128×128), скриншоты 640×480 или 1280×800 до 6, малая плитка 440×280, большая 1400×560, скриншоты «clear and informative», не растянуты (1.1.2).

| Файл | Размер | Для чего |
|---|---|---|
| `images/ru/01-panel-word.png`, `images/en/01-panel-word.png` | 1280×800 | панель над чатом: найденные в договоре Word данные и метки |
| `images/{ru,en}/02-preview-text.png` | 1280×800 | вкладка «Текст»: документ с подсветкой находок |
| `images/{ru,en}/03-panel-excel.png` | 1280×800 | книга Excel (выгрузка CRM): скрытые строки и комментарий, числа-идентификаторы |
| `images/{ru,en}/04-hidden-data.png` | 1280×800 | договор с комментариями, историей правок и скрытым текстом — переключатели удаления |
| `images/{ru,en}/05-restore.png` | 1280×800 | восстановление ответа ИИ: метки → настоящие значения, склонение |
| `images/{ru,en}/06-panel-powerpoint.png` | 1280×800 | презентация PowerPoint со скрытым слайдом — **только Edge** (в Chrome до 5 снимков) |
| `images/promo-440x280.png` | 440×280 | малая промо-плитка (оба магазина), без текста |
| `images/promo-1400x560.png` | 1400×560 | большая промо-плитка (необязательна) |
| `images/store-icon-128.png` | 128×128 | значок листинга Chrome: рисунок 96×96 с прозрачными полями 16 px |
| `images/logo-300x300.png` | 300×300 | логотип листинга Edge |

- [x] Только синтетические данные из `tests/fixtures` (вымышленные лица и реквизиты); сайт в кадре — нейтральная локальная страница «Ассистент» (`tests/shots/pages/chat-demo.html`, адрес `chat.example`), без логотипов и названий ИИ-сервисов.
- [x] Подпись студии на страницах расширения в кадр не попадает (скрывается при съёмке); названия студии в картинках нет.
- [x] **Значок — синий щит** (решение владельца), как в шапке панели и на промо-плитках: `assets/icon-shield.svg` (48, 128, `store-icon-128.png`, `logo-300x300.png`) и упрощённый `assets/icon-shield-small.svg` (16, 32 — щит читается и на 16 px); `npm run icons`. Знак студии `assets/sitimlab-icon.svg` в репозитории остаётся, в иконках не используется.
- [x] Каждый снимок просмотрен: нет реальных данных, обрезков, пустых панелей. Скриншоты en — английский интерфейс; документы на скриншотах Excel, PowerPoint и скрытых данных — русские (английских фикстур этих форматов нет).
- Пересъёмка: `npm run store:shots` (e2e-сборка с моделью из `release/`, затем `playwright.shots.config.js`); `SHOTS_ONLY=store|promo|readme` — часть набора.

## 8. Что остаётся владельцу

1. Аккаунт разработчика Chrome Web Store — регистрация (разовый сбор) и подтверждённый контактный e-mail.
2. Push ветки, затем проверить публичную ссылку на `privacy.md` (раздел 5).
3. `npm run pack:store` на коммите релиза; загрузить `release/docx-anonymizer-0.5.1-store.zip` в Chrome Web Store.
4. Перед загрузкой — поставить пакет как распакованное расширение в чистом профиле: модель ставится сама (настройки → «Модель NER» → «проверенный пакет»), перехват на локальной странице работает.
5. Заполнить формы Chrome Web Store по разделам 3–7: назначение, разрешения, «удалённого кода нет», раскрытие данных и подтверждения, ссылка на политику, листинг ru/en, категория (сверить названия категорий в форме), изображения (5 снимков `01`–`05`, `store-icon-128.png`, промо-плитки).
6. Решить: категории раскрытия данных (раздел 5).

## Источники (проверены 27.10.2026)

- Chrome Web Store: [Prepare your extension](https://developer.chrome.com/docs/webstore/prepare) · [Publish](https://developer.chrome.com/docs/webstore/publish) · [Store listing](https://developer.chrome.com/docs/webstore/cws-dashboard-listing) · [Images](https://developer.chrome.com/docs/webstore/images) · [Privacy tab](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) · [MV3 requirements (remote code)](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements) · [Code readability](https://developer.chrome.com/docs/webstore/program-policies/code-readability) · [Quality guidelines (single purpose)](https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines) · [Privacy policies](https://developer.chrome.com/docs/webstore/program-policies/privacy) · [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use) · [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) · [Best listing](https://developer.chrome.com/docs/webstore/best-listing) · [Manifest CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
- Edge Add-ons: [Publish a Microsoft Edge extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension) · [Developer policies](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies) · [Update REST API](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api) · [REST API reference](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/addons-api-reference)
- Не подтверждено официальной документацией (по опыту разработчиков, проверить при подаче): отказ Chrome Web Store от пакета с `key`/`update_url`; сбои браузерной загрузки крупных пакетов в Partner Center; списки категорий обоих магазинов.

# Контракты модулей

Документ описывает, **что есть** в коде и **как к этому подключаться** (версия 0.3.0: MVP WP1–WP5, пакеты 0.2 WP6–WP9 и 0.3 WP10-A…D — PDF §7, восстановление файла §1.6, встроенная модель §6.8; 0.4 — §8; 0.5 WP12-A — словари в `vendor/dict` §2, общий слой OOXML и `DocumentAdapter` §9; WP12-B — Excel, PowerPoint, текстовые форматы §9.8).
Источник истины — код с JSDoc; здесь — смысл и правила. Рамки MVP — `docs/mvp-scope.md`, цели 0.2 и 0.3 — `docs/concept-0.2.md`, `docs/concept-0.3.md`,
ТЗ — `docs/spec-full.md`, рабочие пакеты — `docs/tasks.md`.

```
popup / content / options / restore ──port "docx"──► background (router) ──runtime.sendMessage──► offscreen ──postMessage──► Web Worker
        (клиенты протокола §5.4)                    добавляет settings                          (мост)                 host.js → core/
```

Сборка: esbuild, бандлы — **IIFE** (content script и classic worker не умеют ESM), кроме `offscreen/worker.js`: с 0.2 (WP8) это
**ES-модуль** (отдельный вызов esbuild `format: 'esm'`, `new Worker('worker.js', {type: 'module'})`) — его требует `onnxruntime-web`. Точки входа — `scripts/build.mjs`.

---

## 0. Карта кода

| Путь | Что | Пакет |
|---|---|---|
| `src/core/ooxml/zip.js` | свой ZIP: чтение, детерминированная запись, байт-копия нетронутых записей (до 0.5 — `core/docx/zip.js`, там остался реэкспорт) | фундамент; WP12-A |
| `src/core/ooxml/xml.js` | линейный токенизатор XML, (un)escape, `applyRangeEdits` (до 0.5 — `core/docx/xml.js`, реэкспорт) | фундамент; WP12-A |
| `src/core/ooxml/model.js`, `flow.js`, `opc.js`, `serialize.js`, `adapter.js` | общий слой OOXML (§9): каркас пакета `parsePackage`, потоки/charMap/замена через раны по описанию разметки `FlowMarkup`, rels/docProps/чистка ссылок, сборка `serializePackage`, интерфейс `DocumentAdapter` | WP12-A |
| `src/core/adapters.js` | реестр адаптеров форматов: `DOCUMENT_ADAPTERS` (Word + лёгкие записи форматов по требованию), `adapterForKind`, `detectAdapter`, `loadAdapter`, `registerAdapter` (§9, §9.8) | WP12-A; WP12-B |
| `src/core/ooxml/hidden.js`, `src/core/docx/hidden.js`, `src/core/xlsx/hidden.js`, `src/core/pptx/hidden.js` | скрытые данные (§9.9): счётчики `doc.hidden`, удаление по выбору (`HiddenFlags`, план сериализатора `ctx.strip`/`ctx.remove`), `resolveStrips`, `collectOrphans` | WP12-D |
| `src/core/key-crypto.js` | ключ восстановления с паролем (§9.9): `encryptMapping`/`decryptMapping`, PBKDF2-SHA-256 → AES-GCM-256, `KeyCryptoError` (`KEY_PASSWORD`, `KEY_INVALID`) | WP12-D |
| `src/core/ooxml/dml.js` | DrawingML и общее Excel/PowerPoint: `DML`, `parseDrawingPart` (alt-тексты), `addElementTextStreams`, `addAttrStreams`, `linkAuthors`, `embeddedWarning` (§9.8) | WP12-B |
| `src/core/xlsx/` | Excel по требованию: `model.js` (`parseXlsx`, `SML`, части и порядок, числа-идентификаторы, колонтитулы, имена листов, формулы), `refs.js` (ссылки A1, переименование листа, `safeSheetName`), `xlsx-adapter.js` (`XLSX_ADAPTER`, сериализация `plan`, `xlsxWarnings`) (§9.8) | WP12-B |
| `src/core/pptx/pptx-adapter.js` | PowerPoint по требованию: `parsePptx`, `PPTX_ADAPTER`, части и порядок, комментарии и авторы, таблицы слайдов (§9.8) | WP12-B |
| `src/core/plain/plain-adapter.js` | текстовые форматы по требованию (.txt/.log/.md/.csv/.json): кодировки, CSV RFC 4180, JSON со смещениями, `PLAIN_ADAPTER` (§9.8) | WP12-B |
| `src/core/table-blocks.js` | ячейки таблиц форматов 0.5 → `doc.blocks` для `detect/tables.js`: шапка, заголовок над шапкой (§9.8) | WP12-B |
| `scripts/office-writer.mjs`, `scripts/gen-office-fixtures.mjs` | свой писатель OOXML (книги и презентации); фикстуры `tests/fixtures/office/` и жанры `xlsx-crm`, `xlsx-statement`, `pptx-deck`, `csv-export`, `json-export` (`npm run gen-office-fixtures`, `--check`) | WP12-B |
| `src/core/docx/model.js` | адаптер Word поверх ooxml/: `WORDML`, части и порядок FR-25 (`docxParts`, `partRank`), авторы/alt/поля/вид абзаца; `parseDocx` → `DocModel` (`kind: 'docx'`) | фундамент; WP12-A |
| `src/core/docx/replace.js`, `adapter.js` | `serializeDocx(doc, edits, opts)` = `serializePackage` с записями встроенных объектов Word; `DOCX_ADAPTER`, `DOCX_MIME` | фундамент; WP12-A |
| `src/core/pdf/sniff.js` | `isPdf` — сигнатура PDF без загрузки разбора (хост; `extract.js` реэкспортирует) | WP12-A |
| `src/core/pdf/layout.js` | разметка текста PDF: `buildLayout(pages)` и шаги `orientPage`, `normalizeItems`, `groupLines`, `findGutters`, `monoCharWidth`, `joinWords`, `stripRepeating`, `detectColumns`, `detectTables`, `linePitch`, `mergeParagraphs`, `dehyphenate`, `classifyHeading`, `detectList`; помощники `orientationOf`, `isUpright`, `mulTransform`; пороги `LINE_TOL`, `SPACE_GAP`, `SEGMENT_GAP`, `GUTTER_GAP`, `PARA_PITCH`, `INDENT`, `BAND`, `HEADER_GAP`, `MONO_FONT_RE` (§7) | WP10-A |
| `src/core/pdf/extract.js` | `extractPdf(pdfjs, bytes, opts) → Layout` (pdf.js передаётся снаружи), `isPdf`, `lettersOnPage`, `mapPdfError`, `pageSpace`, `BASE_DOC_OPTIONS`, `MIN_LETTERS` (20), `MAX_PAGES` (1000) (§7) | WP10-A |
| `src/core/text/model.js`, `serialize.js` | текстовая модель `fromText(blocks, meta)` → `DocModel` с `kind: 'text'`; `serializeText(doc, edits, {format: 'md'\|'txt'})` (§7) | WP10-A |
| `src/offscreen/pdf-loader.js` | `createPdfExtractor({vendorBase?, maxPages?})` — ленивый импорт `vendor/pdfjs/pdf.mjs`, вложенный воркер pdf.js, `env.extractPdf` хоста (§7) | WP10-A |
| `scripts/gen-pdf-fixtures.mjs` | PDF-фикстуры `tests/fixtures/pdf/` (DOCX → HTML → Chromium `page.pdf`, LibreOffice), gold и снимки разметки (`npm run gen-pdf-fixtures`) | WP10-A |
| `src/core/categories.js` | **единственный** каталог встроенных категорий (21 до 0.5, 50 с 0.5 — §8.7) + `buildCatalog`, `normalizeValue` | фундамент (данные — WP1/WP2; WP12-C) |
| `src/core/contracts/` | типы `Entity`/`EntityGroup`/`Decision`, реестр детекторов, `NerProvider` (+ `dispose`, `NER_LABEL_TO_CATEGORY`), `Session` | фундамент; `ner.js` — WP8 |
| `src/core/detect/runner.js` | `analyze()` — весь конвейер поиска, этап `ner`, порог `nerThreshold` | фундамент; WP8/WP9 |
| `src/core/detect/overlap.js` | `resolveOverlaps()` (FR-20) | фундамент |
| `src/core/apply.js`, `mapping.js`, `placeholders.js` | `planEdits()` + `applyDecisions()` (сериализатор по `doc.kind`), маппинг, плейсхолдеры, режимы | фундамент; WP10-A |
| `src/core/deanon.js` | `deanonymize()` (FR-36), опция `decline` (FR-37); `deanonymizeSpans()`, `findUnresolved()` — то же в координатах входа | фундамент; WP6; WP10-B |
| `src/core/restore-doc.js` | `restoreDocx()` — восстановление файла DOCX от ИИ с сохранением форматирования, `restoreText` (FR-36а, §1.6); `restoreDocument()` — любой формат через адаптер (§9.8) | WP10-B; WP12-B |
| `src/core/deanon-morph.js` | склонение ФИО при восстановлении: `parsePersonValue`, `detectCase`, `declineInContext` (FR-37) | WP6 |
| `src/core/settings.js`, `sites.js` | схема настроек (`SETTINGS_SCHEMA_VERSION` 4 с 0.5, §3), дефолты, миграции; allowlist/blocklist | фундамент; WP6–WP9; WP11; WP12-C |
| `src/core/search.js`, `text-view.js` | поиск всех вхождений; данные для вкладки «Текст» | фундамент |
| `src/core/hash.js` | `sha256Hex` (WebCrypto; `shared/protocol.js` реэкспортирует) | WP8 |
| `src/core/validators.js`, `detect/identifiers/` | валидаторы и детекторы идентификаторов: 18 категорий WP1; с 0.5 — части паспорта (`docs.js`) и 26 категорий `papers.js` (документы, транспорт, сеть, суды, недвижимость, коммерческие номера, здоровье и особые категории по метке, §8.7) | WP1; WP12-C |
| `src/core/detect/names/` | PERSON/COMPANY/ADDRESS, база знаний сторон (`kb.js`), морфология, транслитерация | WP2 |
| `src/core/detect/names/person-dict.js` | словарный детектор ФИО третьих лиц `findPersonsByDict` (§2) | WP7 |
| `src/core/detect/names/dict/` | `index.js` (ленивое декодирование, поиск), `codec.js` (front-coding), `load.js` (`loadDicts`, `parseDictFile`, `dictState`, §2) | WP7; WP12-A |
| `vendor/dict/` | словари ФИО — файлы пакета `ru-surnames.txt`, `ru-first.txt`, `en-first.txt`, `en-surnames.txt` и `NOTICE.md` (генерирует `npm run dicts`), §2 | WP12-A |
| `src/core/detect/custom/` | документный детектор пользовательских категорий | WP4 |
| `src/core/ner/pack.js`, `known-packs.js` | формат пакета модели: `parsePackManifest`, `verifyPackFiles`, `packZipName`; список проверенных пакетов (§6.1) | WP8; sha256 — WP9 |
| `src/core/ner/pending-provider.js` | заглушка провайдера WP8 (только для `tests/unit/ner/pack.spec.js`) | WP8 |
| `src/core/ner/wordpiece.js`, `windows.js`, `bio.js`, `onnx-provider.js` | ONNX-провайдер NER: WordPiece с офсетами, окна, BIO и границы спанов, инференс через переданный `ort` (§6.7) | WP9 |
| `src/shared/protocol.js` | протокол §5.4 + транспорт (чанки base64, клиент), `MODEL_CHANGED`; с 0.3 — `GET_MAPPING`/`MAPPING`, `MODEL_BOOTSTRAP`/`MODEL_INSTALL`/`MODEL_INSTALLED`, `ERROR_REASONS`, стадия `pdf`, коды `PDF_*` | фундамент; WP8; WP10-A…C |
| `src/shared/settings-store.js`, `port-client.js` | обёртки `chrome.storage` и порта | фундамент |
| `src/shared/permissions.js` | опциональный доступ к сайтам: паттерны, `requestOrigins`, `removeOrigins`, `hasOriginAccess` (§4а) | WP6 |
| `src/shared/model-store.js` | хранилище пакетов модели в OPFS: проверка, установка в слоты, чтение из воркера, удаление (§6.2) | WP8 |
| `src/shared/bundled-model.js` | встроенная модель: `planBootstrap`, `settingsPatchFor`, `BOOTSTRAP_CLIENT` (чистые функции, §6.8) | WP10-C |
| `src/background/bundled-model.js` | автоустановка встроенной модели: `initBundledModel` (onInstalled + миграция настроек, onStartup, ответ хоста), `bootstrapBundledModel` (§6.8) | WP10-C |
| `src/offscreen/package-fetch.js` | `readPackageFile(url)` — файл из собственного пакета расширения (`chrome-extension://` того же origin): `models/*.zip` (§6.8) и с 0.5 `vendor/dict/*.txt` (§2); единственный `fetch` в `src/` | WP10-C; WP12-A |
| `src/background/index.js`, `router.js`, `offscreen-manager.js` | роутер портов (с 0.3 — `MODEL_BOOTSTRAP`, отказ на клиентские `MODEL_INSTALL`/`MODEL_INSTALLED`), жизненный цикл offscreen; миграция настроек с 0.3 — в `background/bundled-model.js` (`onInstalled`) | фундамент; WP10-C |
| `src/background/site-access.js` | динамическая регистрация content script по выданным origin (§4а) | WP6 |
| `src/background/badge.js` | бейдж `ON` (FR-43) | WP3 |
| `src/offscreen/` | `offscreen.js` (мост, модульный воркер), `host.js` (сессии, ANALYZE/APPLY/DEANON/…, кэш NER-провайдера; с 0.3 — ветка PDF через `env.extractPdf`, `GET_MAPPING`, очередь `MODEL_INSTALL` через `env.readPackageFile`/`env.modelStore`), `worker.js` (ESM + ORT; передаёт хосту `extractPdf`, `readPackageFile`, `modelStore`) | фундамент; WP6, WP8, WP9; WP10-A…C |
| `src/content/`, `src/ui/panel/`, `src/ui/preview/`, `src/popup/` | перехват, панель, предпросмотр, popup; `content/files.js` — `fileKind`, `isSupported`, `hasSupported`, `makeResultName`, `resultType`, `mappingFileName` (PDF, §7.4); меню «Ещё» панели (WP10-D), подсказка о модели в popup/панели (WP10-C) | WP3; WP10-A, C, D |
| `src/ui/panel/done-hint.js` | `shouldShowMappingHint()` — одноразовая подсказка о ключе восстановления на экране «готово» | WP10-D |
| `src/ui/components/site-state.js` | состояние сайта для popup (`needsAccess`) | WP6 |
| `src/options/`, `src/restore/`, `src/ui/deanon/` | настройки (в т.ч. «Модель NER» с онбордингом и встроенной моделью, `pdf-mode`), свои категории, восстановление (склонение, подсветка; с 0.3 — режим «Файл от ИИ», `?docId=`) | WP4; WP6–WP8; WP10-A…C |
| `src/help/`, `src/ui/brand.js` | справка, подпись «Сделано в Sitimlab» | 0.1 |
| `src/core/errors.js`, `src/core/index.js` | `CoreError`, `ERROR_CODES` (в т.ч. `PDF_*`); публичный реэкспорт ядра | фундамент; WP10-A, B |
| `src/core/detect/index.js` | `registerBuiltinDetectors` — регистрация детекторов WP1/WP2/WP4 | фундамент |
| `src/ui/i18n/*.js`, `src/_locales/` | словари интерфейса ru/en по модулям (ключи ru/en совпадают — тесты паритета); `messages.json` — имя и описание расширения | все |
| `src/ui/components/dom.js` | `h`, `clear` — построение DOM без `innerHTML` | 0.1 |
| `schemas/` | `mapping` (с 0.5 — `oneOf`: открытая карта `$defs/mapping` или зашифрованный ключ `$defs/encrypted`), `protocol`, `model-pack` (JSON Schema draft 2020-12) | WP5; WP8; WP12-D |
| `scripts/build.mjs`, `pack.mjs` | сборка `dist/` (`--e2e` → `dist-e2e/`, `--with-model=<zip>` — полная), архивы релиза: лёгкий и `-full` (§6.8) | фундамент; WP6, WP8, WP10-C |
| `scripts/make-dicts.mjs` | генератор словарей ФИО из закреплённых коммитов (`npm run dicts`, `--check`) → `vendor/dict/` | WP7; WP12-A |
| `scripts/dicts-node.mjs` | словари в Node: `readDictFromDisk`, `loadDictsFromDisk` (тесты — `tests/setup/dicts.js`, скрипты) | WP12-A |
| `scripts/bench.mjs` | бенчмарк конвейера без модели (`npm run bench`, `-- --browser`): холодный старт и 20-страничный договор | WP12-A |
| `scripts/pack-model.mjs` | детерминированный zip пакета модели (`npm run pack:model -- --id=<id>`) | WP8 |
| `scripts/bench-ner.mjs` | бенчмарк и span-F1 провайдера в Node (`npm run bench-ner`), помощники для тестов | WP9 |
| `scripts/gen-ner-eval.mjs` | корпус оценки NER `tests/fixtures/ner/eval-{ru,en}.json` (`npm run gen-ner-eval`) | WP9 |
| `scripts/gen-fixtures.mjs`, `make-sample.mjs` | документы-фикстуры с gold, образец договора | WP5; WP7 (`third-persons`) |
| `scripts/make-icons.mjs` | иконки `icons/` из знака Sitimlab (`npm run icons`) | 0.1 |
| `tools/ner-train/` | обучение модели (Python, uv): WikiANN ru+en, дистилляция, ONNX int8, калибровка порога, `models-src/<id>/` | WP9 |

`src/core/**` — чистый JS: без `chrome.*`, DOM и сети (ESLint это проверяет). Тесты ядра — Vitest в Node 22.

---

## 1. Модель документа и сущностей

### 1.1. `DocModel` (`core/docx/model.js`)

`parseDocx(bytes) → DocModel` или `CoreError` с `code` ∈ `NOT_DOCX | ENCRYPTED | PARSE_FAILED`.

- `doc.streams: Stream[]` — **всё, по чему ищут детекторы**, в порядке обхода FR-25
  (document → headers → footers → footnotes → endnotes → comments → glossary → people → rels → docProps).
- `Stream.type`:
  - `live` / `deleted` / `field` — потоки параграфа (`w:t` / `w:delText` / `w:instrText`); есть `segments`, `segIndex`, `segOffset` (charMap);
  - `attr` — значение атрибута; `attrKind` ∈ `author | initials | author-id | alt | field-instr | rel-target`;
  - `meta` — текст элемента `docProps/core.xml|app.xml`.
- `Stream.text` — **virtualText** (§6.2): XML уже раскрыт (`&amp;` → `&`); `w:tab`/`w:ptab` → `\t`; `w:br`/`w:cr` → `\n`;
  `w:sym`, ссылки на сноски/комментарии, `w:drawing`/`w:pict`/`w:object`/`mc:AlternateContent` → `U+FFFC`;
  `w:noBreakHyphen` → `U+2011`; `w:softHyphen` — **0 символов** (удаляется, если попал внутрь заменяемого диапазона).
- Вложенные `w:p` (текстовые поля, ячейки, `sdtContent`) — отдельные параграфы со своими потоками; `paragraph.depth` — вложенность.
- `doc.language` — авто-язык FR-19 (`ru|en|both`), `doc.warnings` — например `EMBEDDED_NOT_PROCESSED` (FR-15).
- `doc.kind` (0.5, WP12-A) — вид документа, он же `DocumentAdapter.kind`: `'docx'` у Word, `'text'` у текстовой модели; по нему `applyDecisions` выбирает сериализатор (§9).
- **Текстовая модель** (0.3, PDF): `fromText(blocks, {name, size, format})` (`core/text/model.js`) строит `DocModel` с `kind: 'text'` — без ZIP и XML
  (`entries: []`, `parts: new Map()`), один `live`-поток `p<N>:live` на блок (кроме `hr`), без `segments`; ячейки таблиц — отдельные абзацы (`depth: 1`),
  `doc.tables = [{index, cols, pids}]`, колонтитулы — потоки в `word/header1.xml` / `word/footer1.xml`, `doc.blocks` — блоки с `pid` для сериализации.
  Потребители `doc.parts` вне `core/docx/` — только `kb.js` (зона реквизитов), он берёт таблицы из `doc.tables`, если они есть. Подробно — §7.

### 1.2. `Candidate` → `Entity` → `EntityGroup` (`core/contracts/entity.js`)

| Уровень | Кто создаёт | Ключевые поля |
|---|---|---|
| `Candidate` | детектор | `start`, `end` (в virtualText потока), `confidence` (уровень), `source?`, `validator?`, `keepPrefix?`, `keepSuffix?`, `canonical?` |
| `Entity` | ядро из кандидата | + `id`, `category`, `text`, `normalized`, `streamId`, `enabled` |
| `EntityGroup` | ядро (группировка) | одно значение = один плейсхолдер: `id` (`e1`…), `value`, `normalized`, `placeholder` (`[ФИО_1]`), `level`, `enabled`, `replacement?`, `excludedOccurrences?`, `occurrences[]` |

- **Уровни** (`confidence`): `validated > labeled > kb > ner > weak`. Кандидат с уровнем вне `category.allowedLevels` ядро **молча отбрасывает** (кроме `source: 'user'` и `'list'`).
- **Источники** (`source`): `rule`, `label`, `kb`, `user`, `ner`, `list` (0.4: список компаний для маскирования). Кандидаты `user` и `list` принимаются и при **выключенной** категории — это явная просьба пользователя (§8).
- **Границы**: сущность не может содержать `\n` или `U+FFFC` — такие кандидаты отбрасываются. `\t` допустим (адреса, телефоны).
- **Метки-заглушки** (доработка 0.5 по прогону КП и ревью): находку **модели** (`source: 'ner'`), целиком лежащую внутри «⟦КОД_N⟧» или «⟦КОД_N.ПОЛЕ⟧», `accept` отбрасывает:
  это пример замены в тексте, а не значение. КОД — префикс плейсхолдера каталога (ru/en, вместе с пользовательскими категориями: «ФИО», «КОМПАНИЯ», «PERSON»…) или общий
  код меток (ORG, PER, PERSON, LOC, ADDR, AMT, ACC, MISC, NAME, DATE, PHONE, EMAIL, INN, KPP); N — номер, ПОЛЕ — заглавные и «_» («⟦ORG_1.ACC⟧», «⟦AMT_1⟧», «⟦ФИО_2⟧»).
  Правила и KB не ограничиваются. Любое другое значение в таких скобках — «⟦ИВАНОВ⟧», «⟦IVANOV_1⟧», «⟦Петров_2⟧», «⟦А123ВС77⟧», «⟦XTA21099012345678⟧», значение
  из строки контекста `text-view.js` («…в лице ⟦Иванова П.С.⟧…»), вставленной в документ, — не заглушка и маскируется.
- **`keepPrefix`/`keepSuffix`** — сколько символов по краям остаётся вне плейсхолдера. COMPANY `ООО «Ромашка»` → `keepPrefix: 5, keepSuffix: 1` → `ООО «[КОМПАНИЯ_1]»`. Нормализация и `value` считаются по «ядру» без обёртки.
- **`canonical`** — для вариантов (KB: падежи, инициалы, транслитерация): нормализованное значение основной сущности. Все кандидаты с одним `(category, canonical|normalized)` получают один плейсхолдер. Ядро пропускает `canonical` через `normalizeValue`, так что `ё/е` и регистр не важны.
- **Нормализация** (`normalizeValue(cat, text)`): `lower` — PERSON/COMPANY/EMAIL/URL/ADDRESS (+`ё→е`); `alnum`/`alnumUpper` — числовые идентификаторы без разделителей.
- **Авторы правок/комментариев** (FR-11) ядро обрабатывает само: `w:author`, `w15:author` → PERSON `validated`; `w:initials` и `w15:userId` получают плейсхолдер своего автора. Детекторы для потоков `author|initials|author-id` **не вызываются**.

### 1.3. Решения и применение

- `Decision = {entityId, action: 'replace'|'skip', replacement?, excludedOccurrences?}`; `mergeDecisions(groups, decisions)` → новые группы.
- `applyDecisions(doc, groups, options) → {bytes, docxBytes, mime, mapping, stats}` (`docxBytes === bytes` — прежнее имя); `options`: `mode` (`placeholder|mask|delete`),
  `placeholderLanguage` (для `[удалено]/[redacted]`), `keepMetadata`, `stripEmbedded`, `document {name, sha256, resultName}`, `createdAt`, `toolVersion`, `language` (язык документа, пишется в маппинг), `textFormat` (`md|txt`, 0.3).
  Правки строит `planEdits(doc, groups, {mode, placeholderLanguage}) → {edits, applied}` — общая часть; сериализатор — по `doc.kind`: DOCX → `serializeDocx`
  (`mime` — MIME `.docx`), `kind: 'text'` → `serializeText` (`text/markdown` или `text/plain`, §7).
  - ручная `replacement` побеждает режим (FR-26); `mask` — все буквы/цифры → `X`; `delete` → `[удалено]`/`[redacted]`;
  - внешняя ссылка `rel-target` + URL → `https://anonymized.invalid/<плейсхолдер>`, `mailto:` + EMAIL → `mailto:[EMAIL_1]` (FR-13);
  - `keepMetadata: false` — поля docProps очищаются (элементы остаются), `custom.xml` и миниатюра удаляются вместе с записями в `[Content_Types].xml` и `.rels` (FR-12);
  - `stripEmbedded: true` — удаляются `word/embeddings/*`, `word/charts/*`, их связи и раны с `w:object`/`c:chart` (FR-15).
- Модель `DocModel` **не мутируется** — применять можно многократно (другой режим, другие решения).
- Результат детерминирован (FR-40): порядок записей как в исходнике, дата 1980-01-01, DEFLATE 6, нетронутые части — исходные сжатые байты.

### 1.4. Маппинг (`core/mapping.js`)

Формат FR-28 плюс два поля: `token` — то, что реально стоит в тексте (`[КОМПАНИЯ_1]`), и `value` — значение без обёртки (`Ромашка`).
`placeholder` — полная форма (`ООО «[КОМПАНИЯ_1]»`), `original` — `ООО «Ромашка»`. Записи отсортированы по каталогу и номеру.
`mergeMappings([...])` — склейка маппингов файлов одной отправки. **Маппинг никогда не пишется в `chrome.storage`** (FR-29).

### 1.5. `deanonymize(text, mapping, {decline = false, strict = false} = {}) → {text, unresolved[], replaced, declined[], tokens[]}`

Понимает `[ФИО_1]`, `ФИО_1`, `ФИО 1`, `ФИО-1`, любой регистр, Markdown-обёртки; `ООО «[КОМПАНИЯ_1]»` → `ООО «Ромашка»`.
`strict: true` (0.3, для файлов — FR-36а): без скобок принимается только точный текст метки из карты (`ФИО_1`, `ДАТА_РОЖД_1`; регистр и `_` как в карте),
`Счет 1`, `договор-1`, `Person 1` — нет; формы в скобках (`[счет 1]`, `[ ФИО_1 ]`, `**[ФИО_1]**`) — как без `strict`. По умолчанию (текст, FR-36) — либерально.
`tokens[]` — метки карты (`[ПАСПОРТ_1]`), найденные и восстановленные, без повторов (для предупреждений страницы восстановления).
Записи режимов `mask`/`delete` не восстанавливаются. `unresolved` — оставшиеся `[X_n]` (позиции в результирующем тексте).
`decline: true` (FR-37, редакция 0.2) — PERSON в форме `[X_n]` склоняется по контексту (`core/deanon-morph.js`: приклеенное окончание → предлог → сочинение, иначе именительный);
предлог ищется в окне до 6 слов и 64 символов (`PREP_WINDOW_CHARS`, общий для `prepositionCase` и `wordAlignedBefore`), между предлогом и меткой — только мостики `BRIDGE`:
обращения/роли и основы должностей — те же, что в `POSITION_RE_SRC`, но списком в `deanon-morph.js` (ведётся вручную) плюс роли сторон договора («индивидуальный предприниматель»/«ИП», «учредитель», «участник», «адвокат», «нотариус», «доверитель», «арендодатель», «арендатор», «заказчик», «исполнитель», «поставщик», «покупатель», «подрядчик»)
(«в лице заместителя генерального директора [ФИО_1]» → `gen`; «в лице представителя по доверенности [ФИО_1]» → `nom`);
`declined[] = {start, end, case: 'nom'|'gen'|'dat'|'acc'|'ins'|'prep', original, text}` — позиции в результирующем тексте, `original` — значение из карты.
При `decline: false` результат побайтно прежний, `declined` пуст. Карта замен не меняется: лемма и род выводятся из `value`/`variants`.

Под капотом (0.3, WP10-B) — два шага в координатах **входного** текста:
- `deanonymizeSpans(text, mapping, {decline, strict, used}) → [{start, end, newText, declined?: {case, original}}]` — распознанные метки, отсортированы, без пересечений;
  `used` — необязательный `Set`, в него добавляются токены карты найденных меток;
  `end` включает поглощённое приклеенное окончание (`[ФИО_1]у`); контекст склонения (предлог, сочинение) — по входу, как и раньше;
- `findUnresolved(text, spans) → [{text, start, end}]` — метки `[X_n]` вне спанов (координаты входа).
`deanonymize` = склейка по спанам; его `unresolved` по-прежнему считается по результату. Фикстуры `deanon.json` (30) и `deanon-decline.json` проходят без изменений.

### 1.6. `restoreDocx(bytes, mapping, {decline = false} = {})` (`core/restore-doc.js`, FR-36а)

Восстановление файла от ИИ: `parseDocx` → `deanonymizeSpans(…, {strict: true})` по **всем** потокам (`live/deleted/field/attr/meta`) → `serializeDocx(doc, edits, {keepMetadata: true, stripEmbedded: false})`.
Возвращает `{bytes, replaced, unresolved: [{text, streamId, part}], declined: [{streamId, part, start, end, case, original, text}], skipped: [{streamId, part, reason: 'container'}], changedParts, tokens}`.
- Распознавание строгое (`strict: true`, §1.5): «Счет 1», «Договор 1 от 01.01» из текста документа не заменяются; `ФИО_1` и формы в скобках — заменяются.
- `tokens` — метки карты, найденные в текстовых потоках документа (метка внешней ссылки, восстановленной целиком, не учитывается). Страница по ним строит предупреждения `mixedValueWarnings(mapping, tokens)` (`ui/deanon/index.js`):
  запись не PERSON/COMPANY, у которой в `variants` есть значения, отличные от `value`/`original` после нормализации (регистр, «ё», пробелы и знаки) —
  «метка {token}: в документе были и другие значения ({n})». Известный случай 0.2–0.4 — паспорт: `[ПАСПОРТ_1]` = серия и номер, `variants` = орган выдачи и код подразделения;
  при восстановлении все три места получали серию и номер. С 0.5 (WP12-C, К6, §8.7) части паспорта — разные категории, у новых карт предупреждения нет;
  для ключей, сохранённых в 0.4 и раньше, оно остаётся.
- Форматирование: правка идёт через раны §6.3 — значение пишется в первый ран плейсхолдера, остальные `w:t` пустеют (`xml:space="preserve"`), `rPr` не трогаются; нетронутые части ZIP (в т.ч. `word/vbaProject.bin`) — исходные сжатые байты.
- `rel-target` вида `https://anonymized.invalid/<метка>` (в т.ч. в %-кодировке), где хвост — ровно одна известная метка, заменяется целиком исходным URL (обратное FR-13); иначе — общий путь (`mailto:[EMAIL_1]` → `mailto:…`).
- Склонение (`decline: true`) — только в `live`/`deleted`; атрибуты, поля, связи и метаданные получают значение из карты как есть. Координаты `declined` — в тексте потока до восстановления.
- Спан, задевающий встроенный объект (`container`-сегмент), не применяется и попадает в `skipped` (на практике пусто: метка не содержит `U+FFFC`).
- `parseDocx` бросает `CoreError` `NOT_DOCX | ENCRYPTED | PARSE_FAILED`. Функция синхронная — страница восстановления вызывает её на главном потоке.
- `restoreText = deanonymize` — для вставленного текста и `.md/.txt`.
Ограничения: `w:initials` → полное имя автора; записи `mask`/`delete` не восстанавливаются; форма ФИО в косвенном падеже — из карты или по FR-37.

---

## 2. Детекторы (`core/contracts/detector.js`)

```js
// Потоковый: вызывается для каждого потока (кроме авторов), только если категория включена.
registerDetector('INN', (virtualText, ctx) => [{ start, end, confidence: 'validated', validator: 'inn' }]);
// ctx: { stream: {id, part, pid, type, attrKind, columnHeader?}, language: 'ru'|'en'|'both', category, catalog, settings }
// columnHeader (0.4, WP11-D) — текст ячейки первой строки того же столбца (detect/tables.js columnHeaders(doc)): DOCX по w:tbl/w:tr/w:tc с w:gridSpan, PDF по doc.blocks[].table

// Документный: один раз после потоковых; видит весь документ и уже найденные сущности.
registerDocumentDetector('kb', (doc, entities, ctx) => [{ streamId, category: 'PERSON', start, end, confidence: 'kb', source: 'kb', canonical }]);
// ctx: { language, catalog, settings, isEnabled(categoryId) }
```

Правила:
- Регистрация — **только** в своём `register(api)`: WP1 → `detect/identifiers/index.js`, WP2 → `detect/names/index.js`,
  WP4 → `detect/custom/index.js`. Общий `detect/index.js` не трогать.
- Детектор — чистая функция; исключение внутри детектора не роняет анализ (предупреждение `DETECTOR_FAILED`), но так делать нельзя.
- Лейблы категорий — в каталоге (`category.labels.ru/en`); добавлять лейблы можно в `categories.js` (данные), структуру записей не менять.
- Документный детектор обязан задать `streamId` и `category`; категории, выключенные в настройках, ядро отбросит само.
- Пользовательские категории (FR-44) динамические → только документным детектором; их определения — `ctx.catalog.list.filter(c => !c.builtin)`, исходный объект — `cat.custom`.
- В тестах детекторов: `clearDetectors()` в `beforeEach`, затем `register(api)` своего модуля (реестр глобален в пределах файла теста).

Пересечения (FR-20) решает ядро после всех детекторов: user → уровень → приоритет категории (порядок в каталоге;
`aboveBuiltin` — выше всех) → раньше начался → длиннее. Проигравший отбрасывается целиком.

`analyze(doc, settings, {nerProvider?, allocator?, userEntities?, onProgress?}) → {language, placeholderLanguage, entities, groups, warnings, stats}`.
`stats.virtualTextLength`, `stats.entities` (групп), `stats.occurrences`.

### NER (`core/contracts/ner.js`)
`NerProvider = {name, init(): Promise, detect(text, {language}): Promise<{start,end,label:'PER'|'ORG'|'LOC',score}[]>}`.
`dispose?()` (0.2, WP8) — освободить модель; хост зовёт при `MODEL_CHANGED` и смене `nerModel`. `init()` вызывается на каждый анализ и кэширует модель сам.
Провайдер создаёт фабрика хоста `env.createNerProvider(settings)` (§6.4); без модели (`nerModel: ''`), с `nerEnabled: false` или без фабрики провайдера нет и этапа `ner` нет.
Сбой провайдера → предупреждение `NER_FAILED {details: {reason}}`, анализ продолжается (NFR-13): `reason = 'MODEL_LOAD_FAILED'`, если `init()`/`detect()` бросили ошибку с `code === 'MODEL_LOAD_FAILED'` (`CoreError`), иначе `'INFERENCE_FAILED'`.
**`MODEL_LOAD_FAILED` никогда не уходит клиенту как `ERROR`** — только как `NER_FAILED.details.reason`. Панель показывает `warnNer` с причиной.

### Словарный детектор ФИО (0.2, WP7 — ступень 1 NER)
Работает внутри документного детектора `kb` (`names/kb.js`), не зависит от `nerEnabled` и модели; выключается настройкой `dictNames: false`.
- `findPersonsByDict(text, {toks?, skip?}) → PersonSpan[]` (`names/person-dict.js`): пары «Имя Фамилия»/«Фамилия Имя» (`parse.kind: 'pair'`), «Имя Отчество» (`'fm'`), латиница; `span.dict = true`, `parse.lemma = {surname?, first, patronymic?, gender}`. Спаны правил (`findPersons`) передаются в `skip` — словарь их не пересекает.
- Вхождения словаря выдаются с `confidence: 'kb'`, `source: 'kb'` (проигрывают `labeled`/`validated` других категорий по FR-20) и **не делают лицо стороной** (`party: false`).
- Записи базы лиц: `kind ∈ full | pair | initials | fm | other`. `fm` — «Имя Отчество» без фамилии: присоединяется к единственной записи с такими именем и отчеством (`full`), иначе своя запись с canonical `имя отчество`. `hits` — число присоединённых вхождений; записи (кроме `other`/`fm`) с `hits ≥ 2` ищутся по документу в двух- и трёхсловных формах, одиночная фамилия — только для сторон.
- Названия фирм (ревью WP-N1): латинская пара не берётся перед хвостом названия (`ORG_TAIL_WORDS_EN` в `lexicon.js`: `International`, `LLP`, `Inc.`, `Bank`, `Partners`…, а также `&` и `and <хвост>`), после `<Слово> of` («Bank of America Merrill Lynch») и если сама «фамилия» — хвост («Morris International»); устойчивые названия из двух «имён» («Clifford Chance», «Майкл Корс») — в `NON_PERSON_PAIRS`. Это же действует для латинских пар правил, найденных только по курируемому имени (`span.nameOnly`, без лейбла и обращения). В `kb.js` словарная пара (или `nameOnly`), совпадающая с названием компании документа без ОПФ или с его началом из ≥ 2 слов, выдаётся как `COMPANY` (`confidence: 'kb'`, canonical этой компании), а не `PERSON`.
- Пара правил «Имя Отчество» («Ольгой Петровной»: второе слово — отчество, согласованное с именем по роду и падежу) в `kb.js` разбирается как `fm`, поэтому падежные формы попадают в одну запись.
- Измерения: фикстура `PERSON-dict.json` — 47 позитивов (39 `dictOnly`), 68 негативов; К4 (2 400 абзацев) — отношение времени со словарём к времени без него 1.07–1.17.
- Словари (`names/dict/index.js`): `getDicts()`, `bigFirstNameInfo(word)`, `surnameLemmas(word)`, `surnameSuffixInfo(word)`, `isEnFirst`, `isEnSurname` — синхронные. Файлы словарей генерируются (`npm run dicts`), вручную не правятся.

**Словари в `vendor/dict` (версия 0.5, WP12-A, К14).** Словари — не код `worker.js`, а файлы пакета `vendor/dict/{ru-surnames,ru-first,en-first,en-surnames}.txt`
(359 538 байт) и `vendor/dict/NOTICE.md` (лицензии источников; сборка копирует каталог в `dist/vendor/dict/` и печатает размер).
- **Формат файла:** UTF-8; строки `# …` — комментарии (первая — заголовок с источником); `#=<ИМЯ>` (`[A-Z][A-Z0-9_]*`) начинает секцию; строки до следующей
  строки на `#` — тело секции: строка `codec.js` (front-coding, ASCII, первая буква `R`/`L`). Строка кодека начинается с `'0'…'X'`, поэтому с `#` не путается.
  Секции: `ru-surnames` — `SURNAMES`; `ru-first` — `MALE`, `FEMALE`, `UNISEX`, `AMBIGUOUS`; `en-first` — `FIRST`; `en-surnames` — `SURNAMES`. CRLF допустим.
  Размер в архиве не хуже 0.4: 142 179 байт сжатых против ≈ 142 553 байт доли словарей в сжатом `worker.js` 0.4.
- **Загрузка** (`names/dict/load.js`): `loadDicts(read) → Promise<{ok: true, ms} | {ok: false, reason: 'READ_FAILED'|'BAD_FORMAT', ms}>`, `read(name)` — имя без
  `.txt` → `Uint8Array | string`. Один раз на жизнь модуля (воркера): параллельные вызовы ждут одну загрузку, последующие получают её итог без чтения; не бросает.
  Успех — списки ставятся (`setDictSources`) и сразу декодируются (`getDicts()`, ≈ 55–70 мс в Node), так формат проверен до первого анализа. Сбой —
  пустые списки (`EMPTY_DICT_SOURCES`: остаются курируемые имена `lexicon.js`), `dictState() === 'failed'` **окончательно**: подмена словарей после первого анализа
  оставила бы устаревшие разборы слов в кэше `person-dict.js` (`SIG_MEMO`). `READ_FAILED` — файл не получен, не байты/строка или не UTF-8; `BAD_FORMAT` — нет секции,
  данные вне секции, не строка кодека. `parseDictFile(text) → Map<секция, строка кодека>`, `DICT_FILES`, `resetDictsForTests()` (только тесты).
- **`getDicts()` до загрузки** бросает `Error('Словари ФИО не загружены: до анализа вызовите loadDicts() …')`; вызывающие (`person-dict`, `vocative`, `kb`,
  `ner/filters-pl`) не менялись.
- **Браузер:** `worker.js` передаёт хосту `readDictFile: (name) => readPackageFile(new URL('../vendor/dict/<name>.txt', import.meta.url).href)`; хост
  (`createHost`) запускает `loadDicts` сразу при создании (пока клиент шлёт файл чанками), `ANALYZE` и `ADD_ENTITY` её дожидаются. Сбой — анализ идёт без
  словарного детектора, к каждому анализу — предупреждение `DICT_FAILED {details: {reason}}` (по образцу `NER_FAILED`; панель показывает `warnGeneric`), правила,
  база знаний и модель работают. Без `env.readDictFile` хост работает на словарях, загруженных раньше (тесты), а если их нет — `DICT_FAILED {reason: 'READ_FAILED'}`.
- **Node:** `scripts/dicts-node.mjs` (`loadDictsFromDisk()` — сбой бросает); vitest грузит словари до каждого файла теста (`setupFiles: tests/setup/dicts.js`),
  `scripts/eval-genres.mjs` и `gen-ner-eval.mjs` — на верхнем уровне.

---

## 3. Каталог и настройки

- `BUILTIN_CATEGORIES` — 21 запись до 0.5, 50 с 0.5 (§8.7): `id, label{ru,en}, placeholderPrefix{ru,en}, color, defaultOn, allowedLevels, labels{ru[],en[]}, validator, priority, builtin, normalize, numeric?`.
- `buildCatalog(settings) → {list, byId}` — встроенные + пользовательские. **UI берёт список категорий только отсюда** (FR-17).
- `isCategoryEnabled(cat, settings)` — политика 0.4 (§8): группы `pii`/`ids` → всегда `true`; `commercial` → `settings.commercial === true && (settings.categories[id] ?? defaultOn)`; пользовательские — `enabled`.
- `CATEGORY_GROUPS` (`{pii, ids, commercial}` → id[]), `ALWAYS_ON_IDS` (0.4) — состав групп для настроек и справки; у каждой встроенной категории поле `group`.
- Настройки: `defaultSettings()`, `migrateSettings(stored) → {settings, changed}` (миграции — `MIGRATIONS[n]` + `SETTINGS_SCHEMA_VERSION`),
  `validateSettingsPatch(patch) → badKeys[]`, `VALIDATORS[key]`, `effectiveSettings(settings, profileId)`, `applyMigrations(obj, fromVersion)` — те же миграции
  для частичного объекта (импорт файла настроек, `options/config-io.js`).
- `SETTINGS_SCHEMA_VERSION` = 3 (0.4): миграция 1 → 2 (0.2) меняет `nerThreshold` 0.6 (прежний дефолт) на 0.7, другие значения порога не трогает;
  миграция 2 → 3 (0.4, §8) включает категории `pii`/`ids` в `categories` и в `profiles[].values.categories`, ставит `orgPolicyHintPending: true` объекту с `categories`
  (существующий профиль); `commercial` у всех — дефолт `false`. `migrateSettings` дополнительно всегда включает `pii`/`ids` (К1) — даже в объекте текущей версии.
  `SETTINGS_SCHEMA_VERSION` = 4 (0.5, WP12-C): миграция 3 → 4 дописывает в `categories` и `profiles[].values.categories` только категории 0.5
  (`CATEGORIES_05` в `settings.js`; `pii`/`ids` — `true`, `commercial` — `defaultOn`), которых там нет; заданные значения и отсутствующие ключи 0.4 частичного
  профиля не трогает; частичный объект без `categories` (патч импорта) — только версия (§8.7).
- `commercial` (boolean, по умолчанию `false`, поле профиля; 0.4) — группа «Коммерческая информация» (COMPANY, CONTRACT, AMOUNT). Экспортируется.
- `maskedCompanies` (`[{name, aliases?: string[]}]`, ≤ 200 записей, `name` 1–120 символов, ≤ 20 псевдонимов; 0.4) — список компаний для маскирования; не поле профиля, экспортируется. Пишут страница настроек, панель («Маскировать всегда») и вкладка «Текст» («запомнить»).
- `orgPolicyHintPending` (boolean, по умолчанию `false`; 0.4) — показать один раз подсказку «организации теперь по желанию» в панели; ставит миграция 2 → 3, снимает content script. **Не экспортируется**.
- `nerThresholdOrg` (0–1, по умолчанию **0.85**, поле профиля; 0.4) — порог модели для метки ORG; `nerThreshold` остаётся порогом PER/LOC. `nerStoplist` (string[] ≤ 500; 0.4) — пользовательское дополнение стоп-списка модельных организаций (§8); не поле профиля, экспортируется.
- `dictNames` (boolean, по умолчанию `true`, поле профиля) — словарный детектор ФИО (WP7); тумблер в настройках, раздел «Обработка».
- `nerEnabled` (boolean, `true`) и `nerThreshold` (0–1, по умолчанию **0.7** = `recommendedThreshold` пакета, поле профиля) — этап NER; без установленного пакета не действуют.
- `nerModel` (string, по умолчанию `''`; иначе id пакета `/^[a-z0-9][a-z0-9-]{1,40}$/`) — установленный пакет модели NER (WP8). Не поле профиля, **не экспортируется** в файл настроек (`NOT_EXPORTED` в `options/config-io.js`): пакет живёт в OPFS этого браузера. Пишет только карточка «Модель NER».
- `hintMappingShown` (boolean, по умолчанию `false`; 0.3, WP10-D) — одноразовая подсказка о ключе восстановления на экране «готово» уже показана. Пишет content script (`saveSettingsPatch` из `content/flow.js`, хранилище сайта `localStorage` не используется); **не экспортируется** (`NOT_EXPORTED`). Миграция не нужна: `migrateSettings` дополняет ключ дефолтом.
- `bundledModelSha` (string, по умолчанию `''`; иначе hex64; 0.3, WP10-C) — sha256 встроенного пакета модели, который этот профиль уже обработал (поставил или
  нашёл стоящим). Пишет только background по ответу `MODEL_INSTALLED` (§6.8); удаление модели пользователем поле **не трогает** — поэтому модель сама не
  возвращается. **Не экспортируется** (`NOT_EXPORTED`), миграции нет: `migrateSettings` дополняет ключ дефолтом.
- `bundledModelError` (string, по умолчанию `''`; иначе код `/^[A-Z_]{1,40}$/`; 0.3, WP10-C) — код последней неудачной автоустановки встроенного пакета
  (`MODEL_INSTALLED failed`, `ERROR` хоста, `HOST_UNAVAILABLE`). Пишет только background (§6.8): код — при неудаче, `''` — в начале новой попытки и при
  `installed|present`; страница настроек стирает его сама перед «Повторить». **Не экспортируется** (`NOT_EXPORTED`).
- `pdfMode` (`markdown` | `text` | `off`, по умолчанию `markdown`; 0.3, WP10-A) — что уходит в чат вместо PDF; не поле профиля, **экспортируется** (§7.4).
- `NOT_EXPORTED` (`options/config-io.js`) = `schemaVersion`, `panelPosition`, `nerModel`, `hintMappingShown`, `bundledModelSha`, `bundledModelError`, `orgPolicyHintPending`.
- «Сбросить настройки» (`config-reset`) сохраняет `KEPT_ON_RESET` = `nerModel`, `bundledModelSha`, `bundledModelError` (`options/config-io.js`): это состояние
  браузера (установленная модель и её автоустановка), а не настройки; без этого полная сборка после сброса висела бы в «устанавливается…» без попытки установки.
- Хранилище — **только** через `src/shared/settings-store.js`: `loadSettings()`, `saveSettingsPatch(patch) → {settings, rejected}`, `onSettingsChanged(cb)`.
- Сайты: `matchOrigin`, `isOriginAllowed`, `isInterceptActive(settings, origin)` (FR-07, FR-35).

---

## 4. Протокол (`src/shared/protocol.js`)

- Порт: `chrome.runtime.connect({name: 'docx'})` → `connectClient()` из `src/shared/port-client.js` возвращает клиента.
- Все сообщения `{type, requestId, ...}`; типы — `MSG.*` (§5.4) + расширение `ACK` (ответ на `DISCARD`, `CANCEL`, `BATCH_BEGIN/END`, `CATALOG_CHANGED`, `MODEL_CHANGED`, `MODEL_BOOTSTRAP`, `OPEN_OPTIONS`, `OPEN_KEY_SAVE`).
  `BATCH_ADD`, `BATCH_APPLY`, `BATCH_DONE` (ТЗ §5.4, рабочее пространство) объявлены в `MSG`, но не реализованы: в схеме их нет, хост отвечает `ERROR INTERNAL`.
- `MODEL_CHANGED {modelId?}` (0.2, WP8): клиент (страница настроек) → bg → offscreen → worker; хост сбрасывает кэш NER-провайдера (`dispose()`), ответ `ACK`. Router не добавляет `settings`; если offscreen-документа нет — отвечает `ACK` сам, не поднимая его.
- Встроенная модель NER (0.3, WP10-C, §6.8): `MODEL_BOOTSTRAP {}` — клиент (кнопка «Восстановить встроенную модель») → bg, ответ `ACK` сразу, установка
  идёт в фоне (`bootstrapBundledModel({force: true})`); `MODEL_INSTALL {url, id, sha256, version, extensionVersion}` — bg → offscreen с `clientId: 'bootstrap'`
  (не порт клиента: router такие ответы игнорирует, их слушает `background/bundled-model.js`); `MODEL_INSTALLED {status: 'installed'|'present'|'failed', id, sha256,
  version?, bytes?, ms?, code?}` — ответ хоста, в `TERMINAL`. `url` — только `chrome-extension://` (схема), `sha256` — hex64.
- Файлы — чанками base64 по `CHUNK_CHARS` = 4 МиБ символов (кратно 4): `FILE_BEGIN {name, size, chunks, sha256?, origin?}` → `FILE_CHUNK {index, data}`… → `ANALYZE {settingsOverride?, batchId?}`.
  Ответ — `PROGRESS {stage, percent}`… и `ENTITIES`. Результат — `RESULT_BEGIN {name, mime, size, chunks, docId}` → `RESULT_CHUNK`… → `RESULT_END {docId, mapping, stats}`.
  Форматы 0.5 (§9.8): `ENTITIES.kind` — `docx` | `pdf` | `xlsx` | `pptx` | `plain`; результат — тот же формат (`имя.anon.xlsx`, `.anon.csv`…), `mime` — формата
  (книга с макросами — `application/vnd.ms-excel.sheet.macroEnabled.12`, CSV — `text/csv`, JSON — `application/json`); коды `NOT_SUPPORTED` (не распознан, не ZIP при
  расширении Excel/PowerPoint) и `FORMAT_LOAD_FAILED` (не загрузился модуль формата; панель предлагает «Повторить»).
  PDF (0.3, §7): стадия `pdf` вместо `unzip`; `ENTITIES.kind` — `docx` | `pdf`; `RESULT_BEGIN.name` — `имя.anon.md` / `.anon.txt` (по `settings.pdfMode` сессии), `mime` —
  `text/markdown` / `text/plain`; коды `PDF_INVALID | PDF_ENCRYPTED | PDF_EMPTY | PDF_NO_TEXT`, предупреждение `PDF_PAGES_NO_TEXT {count, details: {pages}}`.
- Клиент:
  ```js
  const client = connectClient();
  const ent = await client.analyzeFile({ name, bytes /* или base64 из readAsDataURL */, origin, onProgress });
  // ent: {docId, name, kind /* 'docx'|'pdf'|'xlsx'|'pptx'|'plain' */, language, placeholderLanguage, entities[], warnings[], stats, restoredDecisions}
  const res = await client.apply({ docId: ent.docId, mode, decisions, options: {keepMetadata, stripEmbedded} });
  // res: {name: 'x.anon.docx', mime, bytes: Uint8Array, mapping, stats}
  await client.request(MSG.GET_TEXT, { docId, part, from, count });          // → TEXT {paragraphs[{pid,text,spans[]}], total}
  await client.request(MSG.ADD_ENTITY, { docId, category, text, replaceAll }); // → ENTITIES (ПОЛНЫЙ список, не дельта; решения сохраняются)
  await client.request(MSG.DEANON, { mappingRef: docId /* или объект маппинга */, text, decline /* необяз., FR-37 */ }); // → DEANON_RESULT {text, unresolved, replaced, declined}
  await client.request(MSG.LIST_SESSIONS);  // → SESSIONS {sessions[] без значений}
  await client.request(MSG.GET_MAPPING, { docId }); // → MAPPING {docId, mapping} (0.3, WP10-B)
  await client.request(MSG.DISCARD, { docId }); // → ACK
  ```
  Ошибки — `ProtocolError {code, message}`; разрыв порта → `HOST_UNAVAILABLE` для всех ожидающих запросов.
- `DEANON` (FR-36/37): `mappingRef` — `docId` сессии (берётся её последний маппинг; нет маппинга → ошибка «сначала примените замены») или объект маппинга.
  Хост склоняет ФИО **только при `decline === true`** (иначе результат прежний, `declined: []`). С 0.3 страница восстановления `DEANON` не шлёт:
  карту сессии она получает через `GET_MAPPING`, карту из `.mapping.json` разбирает сама и в обоих случаях вызывает ядро (`restoreText`/`restoreDocx`) с `decline` из флажка (по умолчанию вкл.).
- `OPEN_OPTIONS {section}` (0.4, WP11-A) — клиент (ссылка «Открыть настройки» в подсказке панели о политике маскирования) → bg: background открывает
  вкладку `options/options.html#<section>` (`chrome.tabs.create`) и отвечает `ACK`; в offscreen не уходит. `section` ∈ `OPTIONS_SECTIONS`
  (`categories`, `companies`, `ner`; `src/shared/protocol.js`, enum в схеме), иначе `ERROR INTERNAL`. Нужно потому, что контент-скрипт не может открыть
  страницу расширения сам (`web_accessible_resources` пуст).
- `OPEN_KEY_SAVE {docIds, name}` (0.5, WP12-D) — клиент (меню «Ещё» → «Сохранить с паролем…») → bg: background проверяет `keySavePath` (id сессий `d<N>`,
  1–20, имя `*.mapping.json` без путей) и открывает `restore/restore.html?save=1&docId=…&name=…`, отвечает `ACK`; пароль вводится на этой странице (§9.9).
- `GET_MAPPING {docId}` → `MAPPING {docId, mapping}` (0.3, WP10-B, FR-36а): карта последнего применения сессии (`session.lastMapping`) для восстановления на странице;
  до `APPLY` — `ERROR INTERNAL` «Маппинг не найден: сначала примените замены» с `reason: 'NO_MAPPING'`, неизвестный `docId` — `ERROR INTERNAL` с `reason: 'NO_SESSION'`
  (так же `DEANON` и все запросы с `docId`; `ERROR.reason` — необязательное поле, `ERROR_REASONS` в `shared/protocol.js`, переносится в `ProtocolError.reason`). Страница различает
  случаи по `reason`, а не по тексту: `session_missing` / `session_gone`. Настроек не требует. Страница «Восстановить» берёт карту так
  и для текста, и для файла, замену делает ядром у себя (`restoreText`/`restoreDocx`); `?docId=` в адресе страницы предвыбирает сессию (неизвестный — самая свежая).
- Сущность в `ENTITIES`: `{id, category, value, normalized, placeholder, replacement?, level, source, validated, enabled, occurrences[{id, part, pid, streamId, stream, start, end, text, context, variantOf?}]}`.
- Повторная загрузка того же файла (SHA-256) в одной сессии браузера → `restoredDecisions: true` и прежние решения (§3.6).
- Сквозная нумерация по нескольким файлам: `BATCH_BEGIN {batchId}` → `analyzeFile({..., batchId})` для каждого → `BATCH_END`.

---

## 4а. Доступ к сайтам (версия 0.2, К9)

В манифесте нет `host_permissions` и `content_scripts`: `permissions` = `storage, unlimitedStorage, offscreen, scripting, activeTab` (`unlimitedStorage` — для пакета модели в OPFS, §6), `optional_host_permissions: ["<all_urls>"]`.
Доступ к сайту выдаёт пользователь; **источник истины — `chrome.permissions`**, настройки (allowlist/blocklist) лишь решают, работать ли на сайте с доступом.

`src/shared/permissions.js` (чистые функции + обёртки с параметром `api = chrome` для тестов):
- `toMatchPattern('https://host')` → `'https://host/*'` (`*.` и порт сохраняются; `'<all_urls>'` как есть; мусор → `null`); `originFromPattern(match)` — обратно;
- `desiredPatterns(settings)` → `['<all_urls>']` в режиме `all`, иначе паттерны allowlist без дублей;
- `requestOrigins(patterns)` → `Promise<boolean>`, **вызывает `permissions.request` синхронно** — звать первым оператором обработчика клика, до любого `await` (нужен жест пользователя); не отклоняется;
- `removeOrigins(patterns)` → `Promise<boolean>` (ошибки, например снятие обязательного разрешения в e2e-сборке, глотаются);
- `hasOriginAccess(origin)` — `permissions.contains` для паттерна сайта (`activeTab` не учитывается).

`src/background/site-access.js`:
- `planRegistration(granted, registered)` → `{op: 'none'|'register'|'update'|'unregister', matches}` — чистая; `<all_urls>` поглощает остальные, не-http(s) паттерны отбрасываются;
- `createSiteAccess(api)` → `{sync(), inject(patterns), init()}`. Скрипт: `{id: 'intercept', js: ['content.js'], matches, allFrames: true, runAt: 'document_start', persistAcrossSessions: true}`.
  `sync()` сериализован (очередь промисов). `inject()` — `executeScript` во все кадры открытых вкладок, ошибки вкладок глотаются.
  `init()` — слушатели `runtime.onInstalled/onStartup` и `permissions.onRemoved` → `sync`, `permissions.onAdded` → `sync` + `inject(added.origins)`; вызывается синхронно из `background/index.js`.
- `content.js` может прийти дважды (регистрация + `executeScript`) — защита флагом `globalThis.__docxAnonymizerBooted`.

UI: popup — `siteState(settings, url, {granted})` даёт `needsAccess` (настройки разрешают, доступа нет; кнопка `site-grant`), `site-add` запрашивает доступ и сохраняет allowlist независимо от ответа. Настройки: добавление в allowlist → `requestOrigins`, удаление → `removeOrigins` (кроме режима `all`); `allowlist → all` сохраняется только при выданном `<all_urls>`, `all → allowlist` снимает `<all_urls>` и запрашивает сайты списка.
Бейдж (`background/badge.js`) не трогается: без доступа `tab.url` не виден, бейдж пуст.

Сборка `node scripts/build.mjs --e2e` → `dist-e2e/` с `host_permissions: ["<all_urls>"]` (нативный диалог Playwright не нажимает, опциональные разрешения заранее не выдать). e2e-фикстура грузит `dist-e2e/` и ждёт регистрации `intercept`. Релиз и `npm run pack` — без флага.

---

## 5. Подводные камни (прочитать всем)

1. **Offscreen-документ не имеет `chrome.storage`.** Background сам добавляет поле `settings` к `FILE_BEGIN/ANALYZE/APPLY/ADD_ENTITY/BATCH_BEGIN`. Клиентам настройки слать не нужно (только `settingsOverride`).
2. **`runtime.sendMessage` слышат все страницы расширения** (popup, options, restore). Не вешайте там `chrome.runtime.onMessage` с `sendResponse` — используйте порт. Сообщения с полем `target` — служебные (bg ⇄ offscreen).
3. Префикс пространства имён WordprocessingML предполагается `w:` (так пишут Word, LibreOffice, Google Docs).
4. Плейсхолдеры назначаются в `analyze` (порядок обхода); тексты `mask`/`delete` — в `applyDecisions`.
5. Для `\n`/`U+FFFC` внутри сущности — кандидат отбрасывается без предупреждения: проверяйте детекторы на текстах с переносами строк.
6. Логи — без значений сущностей и текста документа (NFR-14): только id, категории, длины, тайминги.
7. Детектор EMAIL — настоящий (WP1); `tests/integration/host.spec.js` и e2e рассчитывают на те же 4 адреса образца.
8. Блок «Проверка конвейера (dev)» в popup (`#dev-file`) остался для ручной отладки; e2e от него не зависят — `pipeline.spec.js` и `ner.spec.js` гоняют конвейер через клиент протокола (`tests/e2e/helpers/client.js`).
9. Образец — `scripts/make-sample.mjs` (`buildSampleDocx() → {bytes, gold}`); `gold` — все чувствительные значения для проверок утечек.
10. Snap-LibreOffice не видит скрытые каталоги и `/tmp`: интеграционный тест пишет в `test-output/` в репозитории; `SKIP_LIBREOFFICE=1` — пропустить.
11. Сборка: новые точки входа добавляются в `entries` в `scripts/build.mjs`; HTML подключает бандлы обычным `<script src>`. Исключение — `offscreen/worker.js`: отдельный ESM-вызов esbuild (§6.5); в него не добавлять код, который рассчитывает на IIFE-обёртку.
12. Воркер ядра — модульный: в нём нет `importScripts`, а `import.meta.url` есть. `chrome.runtime.getURL` в воркере нет — пути к ресурсам расширения строятся от `import.meta.url`/`self.location`.
13. Сеть в e2e (NFR-01, К6): `context.on('request')` Playwright не видит offscreen-документ и его воркер. `tests/e2e/helpers/network.js` (`captureAllRequests`,
    `externalRequests`, `offscreenRequests`) подключается к браузерной CDP-цели (фикстура запускает Chromium с `--remote-debugging-port=0`, порт — из
    `<профиль>/DevToolsActivePort`) и через `Target.setAutoAttach` пишет запросы всех целей: страниц, service worker, offscreen, worker. Работает в новом headless.
14. CI (`.github/workflows/ci.yml`, К12 0.2, К13 0.3): push и pull request в `main`, кроме правок только `**.md`, `docs/**`, `assets/**` (`paths-ignore`);
    задание `test` — `npm ci`, `lint`, `npm test` (`SKIP_LIBREOFFICE=1`, xmllint из `libxml2-utils`), `build`, `pack` (только лёгкий архив), `release/*.zip` — артефакт
    `extension-zip`; задание `e2e` (`needs: test`) — `npx playwright install --with-deps chromium`, `npm run e2e` (headless, без xvfb), `test-output/` — артефакт при сбое.
    В CI пропускаются (условие — в скобках): реальная модель (`NER_MODEL_DIR` — `tests/integration/ner-provider.spec.js`, `NER_PACK` — `tests/e2e/ner.spec.js`; модели в git нет);
    «полный архив» `pack.spec.js` и настоящий zip в `manifest.spec.js` (файл `release/docx-anonymizer-ner-rubert-tiny2-ner-ruen-1.0.0.zip`); e2e `bundled-model.spec.js`
    (`BUNDLED` — `dist-e2e/models/index.json`; в полной сборке, наоборот, пропускаются тесты лёгкой: `model-pack`, `ner`, онбординг в `options`/`intercept`);
    регенерация PDF-фикстур в `pdf-fixtures.spec.js` (Chromium Playwright в задании `test` не установлен; `SKIP_PDF_REGEN=1`); сверка с `pdftotext` в
    `pdf-pipeline.spec.js` (нет утилиты); LibreOffice (`SKIP_LIBREOFFICE=1`). Только по запросу: `E2E_SHOTS`, `E2E_HEADED`, `E2E_WP3_DETACHED`, `FULL_DETECTORS`.
    Главный сценарий `tests/e2e/chat.spec.js`: 13 тестов, 12 идут всегда, detached input — только с `E2E_WP3_DETACHED=1`; флаг `E2E_WP3` времён WP3/WP5 снят.
15. С 0.3 `fetch` в `src/` есть ровно в одном файле — `src/offscreen/package-fetch.js` (чтение из своего пакета: zip встроенной модели, с 0.5 — словари
    `vendor/dict/*.txt`; override ESLint, сторож — `tests/unit/bundled-model.spec.js`); новый `fetch` в другом файле — ошибка lint и теста. pdf.js не бандлится: он лежит в `vendor/pdfjs/` и грузится лениво (§7.1);
    импорт `pdfjs-dist` в код расширения раздует `worker.js` сверх бюджета (§6.5). Текстовая модель (`kind: 'text'`) имеет пустые `doc.parts` и `doc.entries` — код вне `core/docx/`,
    которому нужны части DOCX, должен проверять `doc.kind` (§1.1).
16. С 0.5 (WP12-A) словари ФИО грузятся отдельно от кода (§2): в Node до первого `analyze`/`getDicts` нужен `await loadDictsFromDisk()` (`scripts/dicts-node.mjs`);
    vitest делает это сам (`tests/setup/dicts.js`). Тест, которому нужно «словари не загружены» или «сбой загрузки» вместе с анализом, берёт свежий граф модулей
    (`vi.resetModules()` + динамический импорт) и стоит последним в файле: кэши детекторов (`SIG_MEMO`) живут в экземпляре модуля, а после `resetModules`
    динамические импорты дают новые классы (`ModelStoreError` и т.п.) — тестам ниже нужны прежние.
17. С 0.5 `worker.js` собирается с разделением кода (`splitting`, `chunkNames: 'offscreen/chunks/[name]-[hash]'`): динамический `import()` в коде воркера — отдельный
    модуль, который воркер грузит из пакета по требованию (разбор PDF — `offscreen/pdf-loader.js`). Общий для них код esbuild кладёт в `offscreen/chunks/chunk-*.js`,
    его `worker.js` импортирует статически — он входит в бюджет кода. `offscreen/host.js` импортирует ядро из модулей, а не из `core/index.js`: реэкспорт
    `core/pdf/extract.js` в баррель затянул бы разбор PDF в `worker.js`. Код, нужный только одному формату, — кандидат в такой модуль (§9, WP12-B).

---

## 6. Пакет модели NER (версия 0.2, WP8)

Модель не входит в архив расширения: пользователь скачивает zip-пакет (GitHub Releases), импортирует на странице настроек, расширение проверяет
хеши и кладёт файлы в OPFS. Сетевых запросов из расширения нет (NFR-01, К6). С версии 0.3 есть и полный архив расширения с моделью внутри — она
ставится в OPFS сама при первом запуске (§6.8); лёгкий архив — как описано здесь.

### 6.1. Формат пакета

Плоский zip `docx-anonymizer-ner-<id>-<version>.zip` (`packZipName(manifest)`): `pack.json` + файлы (`model.onnx`, `vocab.txt`, `config.json`, `LICENSE`, `NOTICE`).
Схема `pack.json` — `schemas/model-pack.schema.json` (draft 2020-12, `additionalProperties: false`); код проверки — `core/ner/pack.js` (зеркалит схему и добавляет связи между полями).

```jsonc
{
  "kind": "docx-anonymizer-model-pack", "schemaVersion": 1,
  "id": "rubert-tiny2-ner-ruen",          // /^[a-z0-9][a-z0-9-]{1,40}$/
  "version": "1.0.0",                      // semver
  "name": { "ru": "…", "en": "…" }, "languages": ["ru", "en"],
  "task": "token-classification",
  "labels": ["O", "B-PER", "I-PER", "B-ORG", "I-ORG", "B-LOC", "I-LOC"],   // labels[0] === 'O', далее O|B-X|I-X
  "tokenizer": { "type": "wordpiece", "vocab": "vocab.txt", "lowercase": false, "stripAccents": false,
                 "maxLen": 128 /* 64..512 */, "stride": 16 /* < maxLen/2 */, "cls": "[CLS]", "sep": "[SEP]", "pad": "[PAD]", "unk": "[UNK]" },
  "model": { "file": "model.onnx", "inputs": { "ids": "input_ids", "mask": "attention_mask", "types": "token_type_ids" /* необяз. */ },
             "output": "logits", "indexType": "int64" /* | int32 */ },
  "files": [{ "path": "model.onnx", "sha256": "<hex64>", "size": 31852495 }, …],  // ВСЕ записи zip, кроме pack.json
  "license": "MIT", "source": { "baseModel": "…", "data": ["…"] },  // source: строки/числа/логические/массивы строк
  "minExtensionVersion": "0.2.0",
  "recommendedThreshold": 0.7               // необязательно
}
```

Правила: имя файла — `/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/` (без `/`, `..`, скрытых файлов; `LICENSE`/`NOTICE` — заглавными), без повторов,
не зарезервированное (`RESERVED_PACK_PATHS`, без учёта регистра: `pack.json`, `installed.json`, `.installing` — служебные файлы слота в хранилище, §6.2;
`__proto__`, `constructor`, `prototype` — имена свойств прототипа; проверяет код, схема только описывает);
`model.file` и `tokenizer.vocab` ∈ `files`; каждая запись zip, кроме `pack.json`, есть в `files`, и каждый файл из `files` есть в zip; размер и sha256 совпадают.
Записи zip с одинаковым именем и записи с зарезервированными именами отвергаются при распаковке (§6.2). Размер zip-файла и сумма распакованных размеров
записей по центральному каталогу — не больше 512 МБ (`MAX_PACK_BYTES`), иначе `TOO_LARGE`.
`minExtensionVersion` больше версии расширения → пакет отклоняется (`INCOMPATIBLE`).
Исходник пакета — `models-src/<id>/pack.src.json` (тот же объект **без** `files`) + файлы; `npm run pack:model -- --id=<id>` (`scripts/pack-model.mjs`, `buildModelPack({srcDir, outDir, now})`)
считает `files`, проверяет `parsePackManifest`, пишет детерминированный zip (`FIXED_TIME`, `pack.json` первой записью, остальные по имени) в `release/` и печатает sha256.

API ядра (`core/ner/pack.js`, без побочных эффектов; обе функции **не бросают** ни на каком входе — любой сбой возвращается как `{ok: false, error}`):
- `parsePackManifest(jsonOrObjOrBytes, {extensionVersion?}) → {ok: true, manifest} | {ok: false, error}` — `error`: путь к первому неверному полю (`'tokenizer.stride'`, `'files[2].path'`, лишний ключ — его имя), `'json'`, `'minExtensionVersion'` или `'manifest'` (непредвиденная ошибка разбора);
- `verifyPackFiles(manifest, entries, {digest?}) → {ok: true} | {ok: false, error: 'EXTRA_FILE'|'MISSING_FILE'|'SIZE_MISMATCH'|'HASH_MISMATCH'|'VERIFY_FAILED', path}` —
  `entries`: `Map<string, Uint8Array>` или объект; у объекта читаются только собственные ключи (`Object.hasOwn`), значение не `Uint8Array` → `MISSING_FILE`;
  `VERIFY_FAILED` — непредвиденный сбой (например, хеширования), `path` — файл, на котором он случился. Недоверенный zip передавайте как `Map` (в обычном объекте запись `__proto__` теряется);
- `RESERVED_PACK_PATHS`, `isReservedPackPath(name)` — зарезервированные имена;
- `core/ner/known-packs.js`: `KNOWN_PACKS = [{id, version, sha256}]` (sha256 **всего zip**; пополняет WP9 при публикации), `findKnownPack(sha256)`. Пакет из списка — «проверен», иначе установка только после подтверждения.

### 6.2. Хранилище (`src/shared/model-store.js`)

OPFS (`navigator.storage.getDirectory()`), работает в окне и в dedicated worker. Раскладка: у пакета два слота — `models/<id>/` и `models/<id>.1/`,
в каждом `{pack.json, <files>, installed.json}` (id без точки, поэтому слоты разных пакетов не пересекаются). Во время установки в слоте лежит `.installing`
(время начала) — такой слот не считается установленным; брошенный (> 10 мин) удаляется в `listInstalled()`. **Активный слот** — завершённый (есть `installed.json`,
нет `.installing`) с наибольшим `installedAt`; из него читают `readFile`/`getManifest`/`listInstalled`. Переустановка пишет в неактивный слот, переключение —
снятие `.installing` (одна операция; `installedAt` новой версии строго больше прежней), прежний слот удаляется только после этого. Сбой записи на любом шаге
оставляет прежнюю версию рабочей; не удалившийся устаревший слот дочищает `listInstalled()`. Переименовать каталог в OPFS нельзя, поэтому слоты, а не rename.

| Функция | Что делает |
|---|---|
| `isAvailable()` | есть ли OPFS в контексте |
| `listInstalled()` | `[{id, version, name, languages, bytes, installedAt, verified, packSha256, manifest}]` |
| `inspectPack(bytes, {extensionVersion?})` | zip ≤ `MAX_PACK_BYTES`; unzip (fflate) в `Map`, в `filter`: сумма распакованных размеров ≤ `MAX_PACK_BYTES` (`TOO_LARGE`), повтор имени → `BAD_MANIFEST {reason: 'DUPLICATE_ENTRY'}`, зарезервированное имя (кроме `pack.json`) → `BAD_MANIFEST {reason: 'EXTRA_FILE'}`; затем `parsePackManifest` + `verifyPackFiles`, без записи → `{manifest, packSha256, verified, bytes}` |
| `install(bytes, {verified?, extensionVersion?})` | повторная проверка; очищает неактивный слот и пишет в него `.installing` → `pack.json` → файлы (`createWritable`) → `installed.json` → снимает `.installing`; затем удаляет прежний слот. `verified` вычисляется по `KNOWN_PACKS`, параметр его не поднимает |
| `remove(id)` | удаляет оба слота; отсутствующий — не ошибка |
| `getManifest(id)` | манифест или `null` |
| `readFile(id, path)` | `Uint8Array` из активного слота; путь проверяется (`PACK_PATH_RE`, без `/` и `..`); активного нет → `NOT_INSTALLED` |
| `openModelFiles(id)` | `{modelId, read(path)}` — синхронно, без обращения к хранилищу до первого `read` (для фабрики провайдера) |

Ошибки — `ModelStoreError {code, details?}`; `MODEL_STORE_ERROR_CODES`: `UNAVAILABLE | BAD_ZIP | TOO_LARGE | BAD_MANIFEST | INCOMPATIBLE | HASH_MISMATCH | QUOTA | IO | NOT_INSTALLED`
(`SIZE_MISMATCH`/`HASH_MISMATCH` файла → `HASH_MISMATCH`; лишний/отсутствующий/повторяющийся файл → `BAD_MANIFEST` с `details: {path, reason}`; `VERIFY_FAILED` → `IO`;
больше `MAX_PACK_BYTES` → `TOO_LARGE`; `QuotaExceededError` → `QUOTA`). Тексты — `ner_err_<CODE>` в `ui/i18n/options.js`.

### 6.3. Страница настроек

Карточка `#ner` («Модель NER», после «Обработки»): тумблер `ner-enabled` (`nerEnabled`), число `ner-threshold` (`nerThreshold`, 0–1, шаг 0.05), статус `ner-status`,
`ner-import` + скрытый `ner-import-file` (`.zip`), `ner-remove`, сообщения `ner-msg` (role=status), ссылка `ner-releases-link` (обычный `<a target=_blank>`), подсказка о приватности.
Импорт: `f.size > MAX_PACK_BYTES` → `TOO_LARGE` без чтения файла → `inspectPack` → не проверен → `confirmDialog` → `install` → прочие пакеты удаляются (одна модель) → `save({nerModel: id})` → `MODEL_CHANGED`.
Удаление: подтверждение → `remove` всех установленных → `save({nerModel: ''})` → `MODEL_CHANGED`. Сбой установки, оставивший `nerModel` без файлов, сбрасывает `nerModel`.

Состояния карточки (0.3, WP10-C; `ner-status[data-state]` = `loading | installed | installing | failed | none`), `BUNDLED` — define `__BUNDLED_MODEL__` (§6.8):

| Условие | Карточка |
|---|---|
| активная модель (`listInstalled` содержит `nerModel`) | «Установлена модель … · проверенный пакет», `ner-remove`; онбординга нет |
| `BUNDLED`, `!nerModel`, `bundledModelError` не пуст — или ожидание («устанавливается…», «устанавливается заново…») дольше `BUNDLED_WAIT_MS` = 60 с с открытия страницы / нажатия кнопки (код `TIMEOUT`) | `ner_bundled_failed` «Не удалось установить встроенную модель ({code})», `data-state="failed"`, `ner-import` включён, кнопка `ner-retry` «Повторить» → стирает `bundledModelError`, `MODEL_BOOTSTRAP` (force); `ner-restore` скрыта; флаг «восстанавливается» сбрасывается |
| `BUNDLED`, `!nerModel`, `bundledModelSha !== BUNDLED.sha256`, ошибки нет | `ner_bundled_installing` «Встроенная модель устанавливается…», `data-state="installing"`, `ner-import` отключён |
| `BUNDLED`, `!nerModel`, `bundledModelSha === BUNDLED.sha256` (модель удалили) | `ner_not_installed` + кнопка `ner-restore` «Восстановить встроенную модель» → `MODEL_BOOTSTRAP`, статус `ner_bundled_restoring` до смены настроек |
| `!BUNDLED`, нет активной | блок `ner-onboarding`: `<ol class="steps">` — `ner_step_1` + `ner-releases-link`, `ner_step_2` + `ner-import`, `ner_step_3` |

Ссылка `ner-releases-link` и кнопка `ner-import` — одни и те же элементы (testid не дублируются): в онбординге они переезжают в шаги. Карточка строится
динамически, поэтому после первой отрисовки страница прокручивается к `location.hash` (`options.html#ner` из popup). Popup: строка `ner-hint` между первой
карточкой и «Недавними» — скрыта при `nerModel`; при `BUNDLED && bundledModelSha !== sha && !bundledModelError` — `nerInstalling` без ссылки (`data-state="installing"`),
иначе `nerHint` со ссылкой (`data-state="failed"` при `bundledModelError`, иначе `none`;
`chrome.tabs.create({url: getURL('options/options.html#ner')})` — `openOptionsPage()` якорь не принимает). Панель: только лёгкая сборка — `!BUNDLED && !nerModel`
(`content/flow.js` читает тот же define `__BUNDLED_MODEL__`: `common.define` в `scripts/build.mjs` применяется ко всем entry, включая content script; → `new Panel({nerHint})`) — `.note[data-testid="ner-hint"]` с крестиком `ner-hint-close`; закрытие запоминается до перезагрузки страницы.

### 6.4. Хост и воркер

`createHost({post, toolVersion, nerProvider?, createNerProvider?, extractPdf?, readPackageFile?, modelStore?})` (последние три — 0.3: §7.1, §6.8). `createNerProvider(settings)` — **синхронная** фабрика, модель не читает (загрузка — в `init()`).
Хост держит кэш `{modelId, provider}`: один провайдер на `nerModel`; смена `nerModel` или `MODEL_CHANGED` → `dispose?.()` и сброс. `env.nerProvider` (тесты) имеет приоритет.
`providerFor(settings)` используется в `ANALYZE` и `ADD_ENTITY`; при `!nerEnabled || !nerModel || !createNerProvider` → провайдера нет.
`worker.js` (ESM): `import * as ort from 'onnxruntime-web/wasm'`; `ort.env.wasm.numThreads = 1`, `proxy = false`, `wasmPaths = {wasm: new URL('../vendor/ort-wasm-simd-threaded.wasm', import.meta.url).href}`;
фабрика — `createOnnxNerProvider({files: openModelFiles(s.nerModel), modelId: s.nerModel, ort})` (`core/ner/onnx-provider.js`, WP9, §6.7). Любой сбой загрузки
(нет файла, битый `pack.json`, словарь без спецтокенов, ORT не принял модель, нет нужных входов/выхода) → `CoreError('MODEL_LOAD_FAILED')` → `NER_FAILED {reason: 'MODEL_LOAD_FAILED'}`;
так e2e `model-pack.spec.js` с фейковой моделью получает ту же причину. `core/ner/pending-provider.js` (заглушка WP8) воркером больше не используется — остаётся для `tests/unit/ner/pack.spec.js`.

### 6.5. Сборка и упаковка

- `scripts/build.mjs`: второй вызов esbuild для `offscreen/worker.js` (`format: 'esm'`, `platform: 'browser'`, `metafile`) — в лог пишется размер worker.js и доля ORT.
  В бандл попадает **`ort.wasm.bundle.min.mjs`** (glue встроен, без внешнего `.mjs`); в `dist/vendor/` — `ort-wasm-simd-threaded.wasm` (14 239 897 байт) и `onnxruntime-web.LICENSE`
  (в npm-пакете ORT файла лицензии нет — текст MIT лежит в `assets/licenses/`).
- Размеры `offscreen/worker.js`: до WP8 (IIFE) 225 443 байт; после WP8 329 403 байт, из них ORT ≈ 102 400 (+ словари WP7: 719 209 байт на момент сдачи WP8, без ORT ≈ 616 400).
  После WP9 (провайдер, токенизатор, BIO): 745 462 байт, из них ORT 102 795, без ORT 642 667 (≤ 700 КБ, К15).
  Финальное состояние 0.2.0 (`npm run build`, 15.10.2026): `worker.js` 757 433 байт, из них ORT 102 856, без ORT 654 577; `content.js` 110 262 байт (< 150 КБ, без словарей).
  `tests/integration/pack.spec.js` проверял «worker.js без ORT ≤ 700 КБ» (К15), считая ORT по секции бандла `// node_modules/onnxruntime-web/…`.
  **С 0.3 (ревью WP10-A) бюджет разделён:** словари ФИО (секции `// src/core/detect/names/dict/…`, генерируемые данные WP7) считаются отдельно от кода —
  **код без ORT и словарей ≤ 400 КБ, словари ≤ 400 КБ**: общий запас «без ORT ≤ 700 КБ» был исчерпан (на 19.10.2026 — 531 байт), а растёт код.
  Состояние 19.10.2026 (`node scripts/build.mjs`, с PDF и доработкой WP10-A по ревью): `worker.js` 819 125 байт = ORT 102 856 + словари 365 494 + код 350 775
  (запас кода 58 825 байт ≈ 57,4 КиБ, словарей 44 106 байт ≈ 43,1 КиБ; «КБ» в бюджетах = 1024 байт). Бэклог — словари в `vendor/dict/*.txt` с ленивой загрузкой через `package-fetch.js` (`docs/tasks.md`).
- **С 0.5 (WP12-A, К14):** словари — файлы `vendor/dict/*.txt` (§2), в `worker.js` их нет (0 байт); разбор PDF ядра (`core/pdf/extract.js` + `layout.js`) —
  модуль по требованию `offscreen/chunks/extract-*.js` (38 399 байт). Бюджет — **код `worker.js` без ORT ≤ 400 КиБ** (409 600 байт), считая статически
  импортируемый общий модуль `offscreen/chunks/chunk-*.js`; лимит 416 КиБ WP11-E снят. Состояние 26.10.2026 (`npm run pack`): `worker.js` 502 401 байт + общий модуль
  1 768 байт, из них ORT 102 856, **код без ORT 401 313 байт (391,9 КиБ, запас 8 287 байт ≈ 8,1 КиБ)**; `vendor/dict` — 359 538 байт; лёгкий архив 6 486 404 байт
  (та же сборка кода 0.4.1 — 6 479 326: + `vendor/dict/NOTICE.md`, модуль PDF и код слоя OOXML), полный — 36 029 405 байт. Сборка печатает размеры `worker.js`, модулей по требованию и `vendor/dict`.
- Что проверяет `tests/integration/pack.spec.js` в лёгком архиве (до 0.5; с 0.5 — абзац выше и `pack.spec.js`): код `worker.js` без ORT и словарей ≤ 400 КБ, словари ≤ 400 КБ (и > 100 КБ), ORT встроен (> 50 КБ),
  нет внешних `ort-wasm*.mjs`; `content.js` < 150 КБ и без словарей; `vendor/pdfjs/` ≤ 6 МБ, ≥ 150 `.bcmap`, ≥ 10 шрифтов, `LICENSE` (Apache); pdf.js не бандлится в
  `worker.js`; архив ≤ 12 МБ (К8). Полный архив — при наличии zip пакета (§6.8).
- Архив релиза (`npm run pack`, 0.2.0): 4 244 595 байт (4,0 МБ), 27 файлов; wasm 14 239 897 байт (13,6 МБ) сжимается в архиве до 3 824 625 байт. Модели в архиве нет.
  Версия 0.3.0 (19.10.2026): лёгкий архив ≈ 6,1 МБ (215 файлов: + pdf.js с CMaps и шрифтами), полный ≈ 34 МБ (217 файлов: + `models/index.json` и zip пакета);
  точные байты и sha256 печатает `npm run pack` (§6.8).

### 6.6. Спайки S1–S3 (Chromium из Playwright 1.63, headless new, `dist-e2e`)

| Спайк | Результат |
|---|---|
| **S1** OPFS в dedicated worker offscreen-документа | **Работает.** Страница настроек записала `models/_probe/x.bin` через `navigator.storage.getDirectory()` + `createWritable()`; модульный воркер offscreen прочитал тот же файл (130 байт) — общий origin `chrome-extension://<id>`. В воркере `self.isSecureContext === true`, `self.location` = `chrome-extension://<id>/offscreen/worker.js`. Fallback на IndexedDB не нужен. |
| **S2** квота | Запись 40 МБ одним файлом через `createWritable` прошла (даже без `unlimitedStorage`: `estimate().quota` ≈ 10,8 ГБ — квота считается от свободного места диска, `persisted() === false`). `unlimitedStorage` добавлен в манифест, чтобы квота не зависела от места на диске и вытеснения. `QuotaExceededError` → `ModelStoreError('QUOTA')` (код в `ioError`). |
| **S3** модульный worker под CSP + ORT | `new Worker('worker.js', {type: 'module'})` из классического offscreen-скрипта работает под CSP `extension_pages` (`script-src 'self' 'wasm-unsafe-eval'`); все существующие e2e зелёные. `onnxruntime-web/wasm` → `ort.wasm.bundle.min.mjs`; `InferenceSession.create` на 1-оп модели (`mul_1.onnx`, Mul, opset 7) — 146 мс холодно, `run` дал верный результат `[1..6]`. `ort.env.wasm.numThreads` = 1 до и после создания сессии; `SharedArrayBuffer` в воркере есть, но нити не создаются; ни одного запроса, кроме `chrome-extension:` (нет `blob:`-воркеров, нет http(s)). wasm грузится через `fetch` ORT с `chrome-extension://…/vendor/…` — разрешено `connect-src 'self'`. |

### 6.7. ONNX-провайдер NER (версия 0.2, WP9)

`createOnnxNerProvider({files, ort, modelId, batchSize = 8, skipLowercaseWindows = true, maxLen?, executionProviders = ['wasm'], onProgress?})` → `NerProvider` (+ `stats`).
Модуль `ort` передаётся снаружи (`{InferenceSession, Tensor}`): в воркере — `onnxruntime-web/wasm`, в Node-тестах — `onnxruntime-web` (сборка `ort.node.min.mjs`, тот же WASM).
Ядро не импортирует ORT и не делает сетевых запросов: модель и словарь читаются только через `files.read` (NFR-01).

**`init()`** — один общий промис (сбой не кэшируется: следующий анализ попробует снова): `pack.json` → `parsePackManifest` → `vocab.txt` → `createWordPiece`
(спецтокены из манифеста обязательны) → метки: `config.json` `id2label` (число меток должно совпасть с `manifest.labels`), иначе `manifest.labels` →
`ort.InferenceSession.create(bytes, {executionProviders: ['wasm'], graphOptimizationLevel: 'all'})` → проверка `session.inputNames` ⊇ `manifest.model.inputs`
и `outputNames` ∋ `model.output`. Любая ошибка → `CoreError('MODEL_LOAD_FAILED')` (сессия при этом освобождается). `dispose()` → `session.release()`.

**`detect(text)`** (конвейер):
1. `wordpiece.pretokenize` — BERT basic tokenizer как в `BertTokenizerFast`: пробелы Unicode (`\p{White_Space}`) разделяют; пунктуация (ASCII-не-буквы и `\p{P}`) и
   иероглифы CJK — отдельные слова; управляющие (`\p{C}`, кроме `\t\n\r`; NUL; U+FFFD) выбрасываются и слово не рвут (`и​нулевой` — одно слово); NFC/NFD
   не применяются при `stripAccents: false`. Офсеты — индексы исходной JS-строки (UTF-16). `tokenizeWord` — жадный longest-match с `##`, неразобранный
   остаток или слово длиннее `maxWordChars` (100) → один `[UNK]`; кэш слов (50 000). Эталон — `tests/fixtures/ner/wordpiece-cases.json` (40 случаев, 100 %).
2. `makeWindows(wordIds, {maxLen, stride, cls, sep})` — окна из целых слов `[CLS] … [SEP]` длиной ≤ `maxLen`; следующее окно начинается за `stride` слов
   до конца предыдущего (перекрытие ровно `stride` слов, если в окне их больше); слово длиннее `maxLen − 2` субтокенов усекается (метка — по первому).
3. **Пре-фильтр** `skipLowercaseWindows` (по умолчанию вкл.): окно без единого слова с заглавной буквой (`\p{Lu}`) в модель не подаётся — все слова O.
4. Батчи по `batchSize` окон, дополнение `[PAD]` до самого длинного в батче, `attention_mask`, `token_type_ids` = 0; тип индексов — `model.indexType` (int64/int32).
5. softmax по меткам **первого субтокена** слова. Слово в перекрытии берёт предсказание окна, чей центр (по словам) ближе.
6. `bio.decodeWord`: тип слова — argmax маргинальных вероятностей `P(X) = P(B-X) + P(I-X)` (метки вне PER/ORG/LOC, например MISC, считаются O); тег B/I — что больше;
   `prob` = `P(X)`. Так «Пятунину» с `I-PER 0.41, B-PER 0.20, O 0.39` — PER, а не O.
7. `bridgePunct`: знак между двумя словами одного типа становится частью сущности — дефис/апостроф без пробелов («Римский-Корсаков», «О'Коннор»), точка после
   однобуквенного инициала («И.С. Пятунину»).
8. `mergeBio` (B открывает, I продолжает спан того же типа, I без B начинает, O и смена типа закрывают; `score` — средняя `prob` слов) →
   `joinAdjacent` (соседние спаны одного типа через одни пробелы — один спан: модель ставит B на каждое слово ФИО; с версии 0.5
   PER склеиваются и вплотную, без промежутка, — «Комаров Р.» + «А.», — и через одни инициалы с точкой — «А.» + «Иванов» в «А.А.Иванов»). Доработка 0.5 по прогону КП:
   PER из двух и более полных ФИО с инициалами одного вида подряд (через пробел, табуляцию или вплотную) делится на людей: «Котова А.Б.Лебедев В.Г.»,
   «Котова А.Б.\tЛебедев В.Г.», «А.Б. Котова В.Г. Лебедев» (и когда модель сама дала один спан); голая фамилия последней не отделяется — «John A. Smith»,
   «Комаров Р. А. Петрович» — один человек. Табуляция сама по себе спан не делит (ревью: «Мороз\tИван Петрович» в ячейках строки — один человек).
9. `filterSpans` → `alignSpans` → `filterSpans`: подрезка пунктуации по краям (парные кавычки внутри и точка инициала/«Ltd.» остаются, объемлющие скобки снимаются);
   границы по соглашениям каталога (FR-18): ORG — с кавычками и ОПФ перед названием (`PREFIX_FORMS`, `FULL_FORMS_RE_SRC`) и латинской ОПФ после
   (`SUFFIX_FORMS_RE_SRC`), спан из одной ОПФ дотягивается до названия в кавычках (голая ОПФ выбрасывается); PER — без обращения (Mr., г-н). Выбрасываются спаны
   короче 2 символов, без букв, без заглавной буквы, PER/ORG из одних шаблонных слов договора (`isStopWord`, `ROLE_WORDS` WP2 + должности/названия реквизитов)
   и короткие сокращения с точкой, за которыми не начинается предложение («Стр. 1»).
   Структурный фильтр (`STRUCT_WORDS`, `structuralCut`): ORG/LOC, начинающийся со слова колонтитула/заголовка (стр, лист, раздел, статья, приложение, page, section… с падежами) и номера (`№`, арабский, римский), выбрасывается вместе с заголовком после номера («Стр. 1», «Лист 2», «Раздел 3. Порядок расчётов»), как и одно такое слово с номером сразу за спаном и нарицательное `COMMON_NOUNS` с номером («Ромашка 2»); ORG с ОПФ или кавычками после номера отрезается от заголовка («Таблица 1. Реквизиты ООО «Ромашка»» → «ООО «Ромашка»»), PER не трогается.

Порог: runner отбрасывает `score < settings.nerThreshold`. Дефолт **0.7** = `recommendedThreshold` пакета (было 0.6; миграция настроек 1 → 2 меняет только
прежний дефолт 0.6). `score` — средняя маргинальная вероятность типа, поэтому он выше, чем вероятность отдельной метки при калибровке. Замеры по порогу — ниже, под таблицей результатов.

**Корпус оценки** — `scripts/gen-ner-eval.mjs` (сид 20261015, вымышленные данные: ФИО из словарей WP7 со склонением `names/morph.js`, придуманные компании,
общеупотребительные топонимы) → `tests/fixtures/ner/eval-ru.json` (240 предложений договорного стиля: PER 169, ORG 94, LOC 88 спанов; 8 шаблонов без сущностей)
и `eval-en.json` (120: PER 80, ORG 42, LOC 58). Соглашение о gold: PER — ФИО как написано (с точкой последнего инициала), ORG — с ОПФ и кавычками, LOC — топоним
без родового слова («Ленина» в «ул. Ленина»). Метрика — span-F1 с точным совпадением границ и метки (`scoreSpans` в `scripts/bench-ner.mjs`).

**Результаты** (`rubert-tiny2-ner-ruen` 1.0.0, int8, `model.onnx` 31 852 495 байт (30,4 МБ), sha256 `0ab310c0…cd01` — финальная модель T1 (дистилляция XLM-R + 10 % синтетики);
опубликованный zip `docx-anonymizer-ner-rubert-tiny2-ner-ruen-1.0.0.zip`, 29 517 760 байт, sha256 `ca023f16799f08b1b1d6134fae242461bda6ab79dfe74e34eda1ec6c9a48318f` (= `KNOWN_PACKS`);
`maxLen` 128, `stride` 16, порог 0.7; `npm run bench-ner` и `tests/integration/ner-provider.spec.js`, 15.10.2026). При переэкспорте модели числа, zip и `KNOWN_PACKS` обновляются вместе:

| Корпус | PER P / R / F1 | ORG P / R / F1 | LOC P / R / F1 | Гейт |
|---|---|---|---|---|
| eval-ru (240) | 0.982 / 0.982 / **0.982** | 0.955 / 0.894 / **0.923** | 0.933 / 0.943 / 0.938 | PER ≥ 0.80 ✓, ORG ≥ 0.65 ✓ (К8) |
| eval-en (120) | 0.986 / 0.850 / **0.913** | 0.778 / 1.000 / 0.875 | 0.957 / 0.776 / 0.857 | PER ≥ 0.75 ✓ |

Тест WikiANN (`tools/ner-train/evaluate.py`, `verify_onnx.py`; токен-уровень seqeval, F1, int8-модель): ru — PER **0.916**, ORG **0.762**, LOC 0.861 (гейты К7 PER ≥ 0.85, ORG ≥ 0.75 ✓;
исходная PyTorch fp32 — PER 0.915, ORG 0.760); en — PER 0.809, ORG 0.652, LOC 0.772. Согласие argmax int8 ↔ PyTorch fp32 — 99,7 % (50 предложений; 99,65 % на 2 000), гейт ≥ 99 % ✓.
Числа на `eval-{ru,en}` оптимистичны: в обучение добавлена шаблонная синтетика того же договорного стиля (`synth.py`, свои словари и шаблоны), поэтому решающие для К7 — числа WikiANN.

**Результаты 1.1.0** (версия 0.4, WP11-C, 20.10.2026; `docs/concept-0.4.md` К8). Та же архитектура, токенизатор и постобработка; переобучение на WikiANN ru/en
+ factRuEval-2016 (×2) + синтетика деловых жанров 35 % (треть — предложения без сущностей), см. `tools/ner-train/README.md` «1.1.0». `model.onnx` int8
31 852 495 байт (30,4 МБ), `maxLen` 128, `stride` 16, `recommendedThreshold` 0.7; опубликованный zip `docx-anonymizer-ner-rubert-tiny2-ner-ruen-1.1.0.zip`,
29 541 797 байт, sha256 `5616d089ed34cb2e299bb1f8af0adb5863e29fa8e8784b37197694f30deea0b8` (`KNOWN_PACKS`; запись 1.0.0 остаётся — импортированный 1.0.0 «проверен»).

| Корпус (порог 0.7, span-F1) | PER P / R / F1 | ORG P / R / F1 | LOC P / R / F1 | Гейт |
|---|---|---|---|---|
| eval-ru (240) | 0.982 / 0.982 / **0.982** | 0.923 / 0.894 / **0.908** | 0.931 / 0.920 / 0.926 | PER ≥ 0.80 ✓, ORG ≥ 0.65 ✓ |
| eval-ru абзацами по 5 | 0.958 / 0.953 / 0.955 | 0.912 / 0.883 / 0.897 | 0.931 / 0.920 / 0.926 | PER ≥ 0.80 ✓, ORG ≥ 0.65 ✓ |
| eval-en (120) | 0.946 / 0.875 / **0.909** | 0.764 / 1.000 / 0.866 | 0.978 / 0.759 / 0.854 | PER ≥ 0.75 ✓ |

К 1.0.0 на договорной синтетике: ORG ru 0.923 → 0.908 (ложных 4 → 7 при той же полноте), LOC 0.938 → 0.926, PER без изменений; en PER 0.913 → 0.909 — в пределах гейтов
`ner-provider.spec.js`. WikiANN test (int8): ru — PER **0.913**, ORG **0.757**, LOC 0.863 (гейты `evaluate.py --strict`: `ru_per_f1` ≥ 0.91 ✓, `ru_org_f1` ≥ 0.75 ✓ —
без регрессии к 1.0.0); en — PER 0.806, ORG 0.654, LOC 0.775. factRuEval-2016 `test_factru` (fp32): PER 0.861, ORG 0.704 (1.0.0 — 0.736 / 0.412). Отложенная синтетика
жанров `synth_genre_test` (2 000 предложений): точность ORG 0.991 (1.0.0 — 0.466), ложных ORG на 566 предложениях без сущностей — **5** (1.0.0 — 510; оставшиеся — en).
Согласие argmax int8 ↔ PyTorch — 99,7 % (50 предложений), 99,6 % (2 000).
Бенчмарк 1.1.0 (`npm run bench-ner -- --dir=<исходники пакета>`, Node 22, одна нить, тот же AMD Ryzen 9 7945HX, при параллельной нагрузке второго агента): холодная `init()`
**0,25–0,31 с** (К8 ≤ 0,5 с ✓), строка «батч 1 / 8» — 1,9 / 3,2 мс на окно, ≈ 11 500 токенов/с (1.0.0 на той же машине в тот же час — те же 1,9 / 3,2 мс: скорость от весов
не зависит; с `splitSentences` по умолчанию бенчмарк режет поток на предложения, и «окно» — одно предложение, ≈ 12 слов, а не полные 128 токенов, как в
замере 11,5 мс/окно в таблице ниже), eval-ru 0,42–0,43 с, «20 страниц» (9 016 слов,
813 окон) — NER **1,72–1,74 с** (К8 ≤ 3 с ✓). Chromium (e2e `ner.spec.js`, лёгкая сборка + импорт 1.1.0): холодный `analyzeFile` образца 0,61 с, тёплый 0,11 с,
«20 страниц» целиком — 2,36 с. Полный архив с 1.1.0 (`npm run pack`, код 0.4 на 20.10.2026): 36 017 278 байт (≤ 45 МБ, К12), лёгкий — 6 474 276 байт (≤ 12 МБ).

**Результаты 1.2.0** (версия 0.5, WP12-E, 27.10.2026; `docs/concept-0.5.md` п. 8, К10–К12). Та же архитектура, токенизатор и формат; данные — WikiANN ru/en,
factRuEval-2016 (×2), **NEREL** (×0.5) и **Nerus** (20 000 предложений) — у двух последних нет явной лицензии на тексты (решение владельца; предупреждение в `NOTICE`
пакета, README и справке), синтетика 42 % с шестью новыми жанрами (инициалы без пробела, иностранные имена, имена без контекста, строки таблиц, омонимы, документы 0.5);
см. `tools/ner-train/README.md` «Источники 1.2.0» и «1.2.0». `model.onnx` — 31 852 495 байт (30,4 МБ): все MatMul int8, как в 1.1.0 (первая сборка с fp32 в
классификаторе и FFN последнего слоя снята по ревью, решение владельца 27.10.2026); согласие argmax с PyTorch — гейт на 2 000 предложениях: 99,62 % (50 предложений —
98,96 %, справочно); `recommendedThreshold` 0.7; опубликованный zip `docx-anonymizer-ner-rubert-tiny2-ner-ruen-1.2.0.zip`, 29 606 008 байт, sha256
`a7e022266ae7c37d00988d546c702c299c8aa9a82af0fd9bdcc63404e3ce19e4` (`KNOWN_PACKS`; 1.0.0 и 1.1.0 остаются). WikiANN test (int8): ru — PER **0.912**, ORG **0.754**, LOC 0.863
(гейты 0.91 / 0.75 ✓; ORG ниже 1.1.0 на 0,002–0,004 — 0.757 int8, 0.756 fp32 — в пределах разброса сидов); en — PER 0.811, ORG 0.663, LOC 0.775; factRuEval
`test_factru` (fp32): PER 0.894, ORG 0.727 (1.1.0 — 0.861 / 0.704); отложенный набор имён К10 (`tests/fixtures/ner/heldout-names.json` + бэклог 0.4, 86 вхождений): полнота PER 0.930
против 0.814 у 1.1.0 (+11,6 п. п.; на int8 обоих пакетов — 0.930 против 0.802; набор оптимистичен: имена новые, рамки фраз — как в шаблонах синтетики).
eval-ru (порог 0.7): PER 0.994, ORG 0.978, LOC 0.950; eval-en: PER 0.905, ORG 0.903, LOC 0.879. `npm run bench-ner` (Node, одна нить):
холодная `init()` 0,27 с, «20 страниц» 1,89 с (1.1.0 на той же машине в тот же час — 1,85 с), гейты ≤ 0,5 с и ≤ 3 с ✓; Chromium (e2e `ner.spec.js`)
холодный `analyzeFile` образца 0,72 с, тёплый 0,17 с. Полный архив с 1.2.0 (`npm run pack`, код 0.5 на 27.10.2026, `adc5629`) — 36 224 244 байт (≤ 45 МБ), лёгкий — 6 616 874 байт.
Метрики на документах — синтетика и корпус жанров одного автора; реальных документов в замерах нет. Ложные ORG на отрицательных предложениях жанров (гейт ≤ 5)
с 1.2.0 считаются декодированием расширения (3; по argmax, как в 1.1.0, — 7) — определение сменено после провала по argmax, решение владельца 27.10.2026.
`joinAdjacent` 0.5 склеивает PER вплотную и через инициалы (шаг 8 выше) — «Комаров Р.А.» одна сущность и с 1.1.0.

Без постобработки шагов 6–9 (argmax метки, строгий BIO, только подрезка пунктуации по краям, порог 0.7) — замер WP9 на предыдущем экспорте той же архитектуры:
ru PER 0.711 / ORG 0.145 / LOC 0.877, en PER 0.671 / ORG 0.460 / LOC 0.796 — модель ставит B на каждое слово ФИО, делит массу между B и I, не включает ОПФ и кавычки в ORG.
Оставшиеся ошибки финальной модели (`npm run bench-ner -- --errors=10`): ORG без ОПФ или без ОПФ перед кавычками не находится («Севзапкабель», «Эталон-Логистик»»),
граница ORG захватывает соседние слова («силами ООО «Север-М»», «АНО "Вектор-Технологии" Коростелкина»), «Ростов-на-Дону» → «Ростов»;
в en — инициал перед фамилией («C. Bozeman»), голая фамилия после обращения («Mr. Stanfill», «Dr. Childers» → ORG), названия штатов и стран без контекста («California», «Bavaria»).

Порог: на `eval-ru` span-F1 почти не зависит от порога в диапазоне 0.4–0.8 (PER 0.982 везде, ORG 0.904 при 0.4, 0.929 при 0.6, 0.923 при 0.7, 0.917 при 0.75–0.8);
на `eval-en` выше порог — точнее ORG (0.840 при 0.4 → 0.923 при 0.8) ценой полноты PER/LOC. Калибровка на validation WikiANN (`calibrate.py`) даёт максимум micro-F1 при 0.70
(кривая плоская: 0.65–0.75 различаются < 0.001), поэтому дефолт 0.7 = `recommendedThreshold` пакета.

**Бенчмарк** (AMD Ryzen 9 7945HX, одна нить WASM SIMD; в Node — `npm run bench-ner`, в Chromium — e2e `ner.spec.js` и спайк S6). Финальная модель, 15.10.2026;
Chromium — e2e `ner.spec.js` с опубликованным zip (`NER_PACK`, headless). Строки с пометкой «WP9» измерены на предыдущем экспорте той же архитектуры и размера (скорость от весов не зависит):

| Замер | Node 22 (onnxruntime-web) | Chromium (расширение) |
|---|---|---|
| Холодная `init()` (чтение файлов + словарь 83 828 токенов + сессия) | **0,28–0,32 с** | холодный `analyzeFile` образца (чтение из OPFS + словарь + сессия + анализ) — 0,57 с (WP9: `create` 271 мс + чтение 103 мс) |
| Окно 128 токенов, батч 1 / батч 8 | **11,5 / 10,8 мс** на окно (≈ 12 мс) | WP9: 13,2 / 14,2 мс на окно |
| Окно 256 токенов, батч 1 / батч 8 (WP9) | — | 32,2 / 37,0 мс на окно |
| Токены/с (длинный поток, окна по 128) | **≈ 10 000** (10 900 / 11 700 при батче 1 / 8) | — |
| eval-ru, 240 предложений (по потоку на предложение) | 0,42 с, ≈ 12 000 токенов/с | — |
| «20 страниц», 9 016 слов, 286 абзацев | NER **1,4 с** (1 338 мс; пре-фильтр пропустил 0 окон: в каждом абзаце есть заглавные) | `analyzeFile` целиком (правила + NER) — 2,15 с |
| Тёплый `analyzeFile` образца | — | 0,10 с |
| «300 страниц» ≈ 150 000 слов, 4 764 абзаца (WP9) | NER 23,2 с (282 282 токена) | — |

Батч 8 не быстрее батча 1 в одной нити (≈ одинаковое время на окно), но и не медленнее; в документах батч собирается только внутри потока (абзаца), поэтому
короткие абзацы идут по одному окну. 20 страниц укладываются в 15 с с большим запасом — митигации (`maxLen` 128 уже в пакете, батч 8, пре-фильтр) включены по
умолчанию, до/после не потребовались. Холодная загрузка ≤ 5 с (К7, NFR-06) — с запасом более 10×.

**Спайки:**

| Спайк | Результат |
|---|---|
| **S4** окружение обучения (`tools/ner-train`) | **Работает** (запись по `tools/ner-train/README.md`; отдельного отчёта спайка в WP9 не было): Python 3.12 через `uv`, PyTorch с CUDA 12.8 (`pytorch-cu128`) на RTX 5070 Laptop (Blackwell, `sm_120`); WikiANN `unimelb-nlp/wikiann` (`ru`, `en`) загружается напрямую (parquet, `datasets` 5.x), зеркало не понадобилось. Без GPU конвейер работает на CPU, медленнее. |
| **S5** `onnxruntime-web` под vitest/Node | **Работает без `onnxruntime-node`.** `import 'onnxruntime-web'` в Node разрешается в `dist/ort.node.min.mjs` (WASM-бэкенд, wasm из пакета); `InferenceSession.create(Uint8Array)` на `model.onnx` (int8, 31,9 МБ) — 0,3–0,4 с, `inputNames` = `input_ids, attention_mask, token_type_ids`, выход `logits` float32 `[B, L, 7]`. ESM-импорт подпути `onnxruntime-web/wasm` (тот же, что в воркере) в Node тоже работает; CJS-вход (`require.resolve` → `ort.wasm.min.js`) при `import()` кладёт API в `default`. Тесты и бенчмарк берут основной ESM-вход (`loadOrt()` в `scripts/bench-ner.mjs`), `onnxruntime-node` не нужен. |
| **S6** int8-модель в ORT WASM (браузер и Node) | **Исполняется** в обоих: квантованные MatMul/Gather (в т.ч. построчно квантованная таблица эмбеддингов `Gather → Cast → Mul → Add`) поддерживает WASM EP; одна нить (`numThreads = 1`), без proxy. Числа — в таблице бенчмарка. Браузерный замер — отдельная страница в копии `dist-e2e` (ESM-бандл `ort.wasm.bundle.min.mjs`, модель с `chrome-extension://`), Chromium из Playwright 1.63, headless. |

**Поток из нескольких предложений, `splitSentences`, границы PER, дубликаты** (доработка после ревью WP9, 15.10.2026). В документе модель получает поток
абзаца, а обучена на отдельных предложениях: в склейке она тянет PER через точку («… Антонина. Груз …») и чаще ошибается в типе. Опция провайдера
`splitSentences` (**по умолчанию `true`**) режет поток на предложения до `makeWindows` (`windows.js` `sentenceRanges`: граница — `.`/`!`/`?`/`…` перед словом
с заглавной, в т.ч. после открывающей кавычки, и перенос строки/U+FFFC; не после однобуквенного инициала и сокращений «г.», «ул.», «Inc.»; обрывок короче
4 слов с буквами идёт со следующим предложением — иначе «Добрый день!» без контекста становится ORG); окна строятся по каждому предложению отдельно.
Дополнительно: `mergeBio` закрывает спан на переносе строки и U+FFFC между словами; `alignSpans` срезает у PER ведущие обращения, должности и роли
(`POSITION_RE_SRC`, `ROLE_WORDS`, «Уважаемый», «г-жа», «гражданка», «менеджер» …; спан из одних таких слов выбрасывается); `dedupeSpans` после последнего
`filterSpans` убирает дубликаты и вложенные спаны того же типа (остаётся объемлющий с большим score), а спан другого типа внутри кавычек названия ORG
(PER «Орион» в «ПАО "Орион-Логистик"») поглощается ORG; прочие пересечения — в пользу большего score. `dispose()` во время `detect`/`init` →
`CoreError('MODEL_LOAD_FAILED')` (сессия, созданная после dispose, освобождается), а не `TypeError`.

Склейка eval-ru по k подряд идущих предложений через пробел (gold сдвигается), порог 0.7, span-F1 PER / ORG / LOC:

| k | до доработки (ревью) | `splitSentences: false` | `splitSentences: true` (по умолчанию) |
|---|---|---|---|
| 1 | 0.982 / 0.923 / 0.938 | 0.982 / 0.923 / 0.938 | 0.982 / 0.923 / 0.938 |
| 3 | 0.893 / 0.891 / 0.894 | 0.893 / 0.891 / 0.894 | **0.959 / 0.917 / 0.938** |
| 5 | 0.877 / 0.930 / 0.903 | 0.886 / 0.930 / 0.903 | **0.959 / 0.923 / 0.938** |
| 10 | 0.856 / 0.885 / 0.880 | 0.859 / 0.891 / 0.880 | **0.964 / 0.917 / 0.938** |

eval-en при k = 5: PER 0.902 → 0.899, ORG 0.792 → 0.845, LOC 0.846 → 0.849 (без нарезки → с нарезкой). Гейт `tests/integration/ner-provider.spec.js` —
eval-ru абзацами по 5 предложений: PER ≥ 0.80, ORG ≥ 0.65 ✓. Собственный корпус ревьюера (30 предложений ru/en): PER 0.930 → **0.977**, ORG 0.933, LOC 1.000
(без изменений); трудный (15): PER 0.800, ORG 0.533, LOC 0.667 (без изменений). Цена нарезки: «20 страниц» — 813 окон вместо 286, NER в Node 1,35–1,42 → 1,72 с;
`analyzeFile` в Chromium (e2e `ner.spec.js`) 2,1 с — гейт 15 с с запасом.

### 6.8. Встроенная модель (версия 0.3, WP10-C, Ц7, К15–К17)

Из одного кода собираются два архива: **лёгкий** (как в 0.2, без `models/`) и **полный** — с опубликованным zip пакета модели внутри. В полной сборке модель
ставится в OPFS сама при первом запуске, без скачивания и импорта; сетевых запросов по-прежнему ноль (NFR-01): zip читается из собственного пакета расширения.

**Сборка.** `node scripts/build.mjs --with-model=<zip>` → `readBundledModel(zip)`: sha256 байтов zip обязан быть в `KNOWN_PACKS` (иначе сборка падает с текстом
«… не в KNOWN_PACKS …», `dist` не трогается), `id`/`version` — из `pack.json` внутри zip (`parsePackManifest`) и совпадают с записью `KNOWN_PACKS`. Без флага — `null`.
Описание запекается define `__BUNDLED_MODEL__` (во все бандлы; читают `background/bundled-model.js`, `options/options.js`, `popup/popup.js`, `content/flow.js` — подсказка в панели; объявлен глобалом
в `eslint.config.js`, как `__VERSION__`). После статики zip копируется в `dist/models/<file>` байт в байт, рядом — `models/index.json`:

```json
[{ "file": "docx-anonymizer-ner-rubert-tiny2-ner-ruen-1.0.0.zip", "id": "rubert-tiny2-ner-ruen", "version": "1.0.0",
   "sha256": "ca023f16…48318f", "size": 29517760 }]
```

Ключи — в этом порядке. `scripts/pack.mjs`: `packRelease({outDir, modelZip}) → {lite, full|null}`; каждый вариант собирается в свою временную стадию (define
запечён в бандлы — лёгкий архив из полной стадии «думал» бы, что модель есть). `lite` — побайтно прежний архив; `full` — `docx-anonymizer-<v>-full.zip`, записи
`models/*.zip` — `level: 0` (zip уже сжат). CLI: `--model=<zip>` (главнее всего) или из `release/docx-anonymizer-ner-*.zip` — zip, чей sha256 есть в `KNOWN_PACKS`, с наибольшей версией
(semver, `compareVersions`; версия 0.4, WP11-C3 — рядом лежат 1.0.0 и 1.1.0); zip с неизвестным sha пропускается с предупреждением в stderr; ни одного подходящего —
только лёгкий с сообщением. В CI пакета нет — собирается только лёгкий; `tests/integration/pack.spec.js` «полный архив» (с гейтом размера ≤ 45 МБ, К12 0.4) и
`manifest.spec.js` (настоящий zip) — с гейтом по наличию в `release/` zip последнего пакета `KNOWN_PACKS` (`latestKnownPack()`/`latestModelZipPath()` из `scripts/pack.mjs`,
имя — `packZipName`); тест выбора — `pack.spec.js` «findModelZip» (фейковые zip и подменённый поиск sha). Прочие ключи CLI: `--out=<каталог>`; поиск zip — `findModelZip`.

**План** (`src/shared/bundled-model.js`, чистые функции):

| `planBootstrap({bundled, settings})` | Условие | Действие |
|---|---|---|
| `none` | `bundled === null` (лёгкая сборка) | ничего, offscreen не поднимается |
| `skip` | `settings.bundledModelSha === bundled.sha256` | ничего: этот пакет профиль уже обработал (модель стоит или пользователь её удалил) |
| `foreign` | `nerModel` не пуст и `≠ bundled.id` | ничего: выбран свой пакет |
| `install` | иначе (свежий профиль; новый sha при обновлении; `nerModel === id` без sha — ручной импорт того же zip) | `MODEL_INSTALL` |

`settingsPatchFor(result, bundled, cur)`: `installed|present` → `cur.nerModel && cur.nerModel !== bundled.id ? {bundledModelSha, bundledModelError: ''} : {nerModel: bundled.id, bundledModelSha, bundledModelError: ''}`;
`failed` → `{bundledModelError: errorCode(code)}` (код не по `/^[A-Z_]{1,40}$/` → `INTERNAL`; sha не отмечается — следующий запуск попробует снова); прочее → `null`.
`force` (`MODEL_BOOTSTRAP`, кнопки «Восстановить встроенную модель» и «Повторить») трактует `skip` как `install`.

**Поток сообщений.**

1. `background/bundled-model.js` `initBundledModel()` (слушатели верхнего уровня): `onInstalled` → `migrateStoredSettings()` (перенесено из `index.js`, чтобы
   миграция не перетёрла патч модели) → при `reason ∈ {install, update}` `bootstrapBundledModel()`; `onStartup` → `bootstrapBundledModel()`; `runtime.onMessage` —
   ответы `{target: 'background', clientId: 'bootstrap', msg}` (router их игнорирует: порта с таким id нет). `chrome_update`/`shared_module_update` — без плана.
2. `bootstrapBundledModel({force})`: повторные вызовы до отправки получают тот же промис; `force` во время прогона без `force` не теряется — после него
   запускается ещё один прогон с `force` (один на всех ждущих). `install` → непустой `bundledModelError` стирается → `ensureOffscreen()` →
   `runtime.sendMessage({target: 'offscreen', clientId: 'bootstrap', msg: {type: MODEL_INSTALL, requestId, url: getURL('models/<file>'), id, sha256, version, extensionVersion}})`
   (одна повторная попытка, как router; не вышло — `bundledModelError: 'HOST_UNAVAILABLE'`). Ответа промисом **не ждёт**: установка идёт секунды, service worker может уснуть и проснётся на сообщении `MODEL_INSTALLED`.
3. Хост (`offscreen/host.js`, `env.readPackageFile`, `env.modelStore`), установки строго по очереди: `listInstalled()` содержит `{id, packSha256 === sha256}` →
   `MODEL_INSTALLED {status: 'present'}` без чтения файла; иначе `readPackageFile(url)` → `inspectPack` → требуется `verified === true` (`UNVERIFIED`), тот же
   `packSha256` и `manifest.id` (`MISMATCH`) → `install(bytes, {verified: true, extensionVersion})` **без удаления чужих пакетов** → сброс кэша NER-провайдера (как
   `MODEL_CHANGED`) → `{status: 'installed', bytes, ms}`. `ModelStoreError` → `{status: 'failed', code}`; прочее — `ERROR`.
4. Background: `MODEL_INSTALLED` с тем же sha → `saveSettingsPatch(settingsPatchFor(...))` → страницы перерисовываются по `onSettingsChanged`;
   `failed`/`ERROR` → `console.warn('[bundled-model] <code>')` (только код) и `bundledModelError: <code>`; `installed` → `console.info('[bundled-model] installed in <ms> ms')`.
5. Router: клиентский `MODEL_BOOTSTRAP` → `bootstrapBundledModel({force: true})` и `ACK` сразу; клиентские `MODEL_INSTALL`/`MODEL_INSTALLED` → `ERROR INTERNAL`,
   в offscreen не уходят (установку из пакета запрашивает только background).

**`offscreen/package-fetch.js`** — `readPackageFile(url) → Uint8Array`, **единственный `fetch` в `src/`**: адрес обязан быть `chrome-extension://` с тем же хостом,
что `self.location` воркера, путь — строго `/models/<имя>.zip` (`^/models/[A-Za-z0-9][A-Za-z0-9._-]*\.zip$`); в исходной строке запрещены `..`, `%2e`, `%2f`,
`%5c`, `\`; непустые `username`/`password`, порт, query, fragment, схемы `blob:`/`data:`/http(s) — отказ. Иначе `ModelStoreError('IO')` до вызова `fetch`; `!ok` → `IO` «Файл пакета расширения не найден». Override ESLint — блок
`{files: ['src/offscreen/package-fetch.js']}` с `no-restricted-globals` без `fetch` (XHR, WebSocket, EventSource по-прежнему запрещены); сторож — `tests/unit/bundled-model.spec.js`
(`\bfetch\(` в `src/**/*.js` ровно в этом файле, override ровно на него). CSP `connect-src 'self'` дублирует ограничение в браузере.

**Гонка с ручным импортом.** Пока встроенная модель ставится (`bundledModelSha` не равен sha), карточка «Модель NER» показывает «устанавливается…» и импорт
отключён. Если пользователь всё же выбрал другой пакет раньше, чем пришёл ответ, `settingsPatchFor` пишет только `bundledModelSha` — выбор пользователя не
перетирается; встроенный пакет остаётся в OPFS вторым (кнопка «Удалить модель» удаляет все). Импорт того же zip даёт `present`.

**Замеры** (e2e `tests/e2e/bundled-model.spec.js`, Chromium из Playwright 1.63, headless; полная e2e-сборка): `nerModel` выставлен через ≈ 1,2 с после старта
теста (норма К15 ≤ 30 с), `MODEL_INSTALLED.ms` 804 мс (zip 28,2 МБ → 5 файлов пакета, 31,4 МБ в OPFS), восстановление кнопкой — 1,1 с по `ms`, ≈ 2,4 с до смены
настроек; повторный `MODEL_BOOTSTRAP` при том же sha файлы не переписывает (`installedAt` прежний); http(s)-запросов ноль, снимок CDP-захвата сразу после
появления `nerModel` содержит `chrome-extension://<id>/models/<file>`. Архивы (`npm run pack`, версия 0.3.0, с pdf.js WP10-A): `docx-anonymizer-0.3.0.zip` ≈ 6,1 МБ,
`docx-anonymizer-0.3.0-full.zip` ≈ 34 МБ; точные байты и sha256 печатает `npm run pack` (здесь не фиксируются — меняются с каждым изменением кода).

**Запись сети с самого старта (К17).** Сценарий автоустановки идёт с опцией фикстуры `earlyCapture` (`tests/e2e/fixtures.js`): Chromium запускается без
расширения (`--enable-unsafe-extension-debugging`, без `--disable-extensions`), `captureAllRequests` подключается к CDP браузера, и только затем расширение
загружается командой CDP `Extensions.loadUnpacked` по каналу Playwright. Поэтому `onInstalled`, загрузка `offscreen.html/js`, `worker.js` и чтение zip
модели проходят уже под записью — снимок сразу после появления `nerModel` обязан содержать и `offscreen/*`, и `models/<file>` (окна без записи нет; в
0.3.0 до финальной приёмки запись подключалась после `--load-extension`, и в 2 из 5 прогонов чтение zip успевало пройти до неё). Остальные сценарии
по-прежнему запускаются с `--load-extension`. http(s) исключён и без записи: CSP `connect-src 'self'`, `readPackageFile` принимает только
`chrome-extension://<свой id>/models/*.zip`, в `src/` нет других сетевых API (ESLint). Сценарий с испорченным zip (копия сборки, `test.use({extensionDir})`) проверяет экран «не удалось / повторить».

**Обновление пакета поверх прежнего (версия 0.4, WP11-C3, К9).** Пакеты одного id с разными sha (1.0.0 → 1.1.0): профиль с `bundledModelSha` = sha 1.0.0 и
`nerModel` = id после обновления расширения получает план `install` (sha другой), хост не находит `{id, packSha256 = sha 1.1.0}` и ставит zip; `install` пишет в
неактивный слот и удаляет прежний — в OPFS один слот 1.1.0. Удалённая после этого пользователем модель не возвращается (`skip`: sha 1.1.0 уже обработан). Тесты:
`tests/unit/background/bundled-model.spec.js` (план и патч настроек), `tests/integration/host.spec.js` «MODEL_INSTALL поверх установленной прежней версии»
(настоящий `model-store` на поддельном OPFS: слоты `<id>` → `<id>.1`), e2e `bundled-model.spec.js` «обновление поверх прежней версии» (гейт `NER_PACK_PREV` — путь к
zip 1.0.0; импорт 1.0.0 через настройки → `bundledModelSha` = sha 1.0.0 → повторная команда CDP `Extensions.loadUnpacked` того же каталога, как «Обновить» на
`chrome://extensions` → 1.1.0, один слот, http(s) ноль; `chrome.runtime.reload()` под Playwright оставляет расширение выгруженным). Замер 20.10.2026: 1,46 с от
обновления до `bundledModelSha` = sha 1.1.0.

---

## 7. PDF с текстовым слоем (версия 0.3, WP10-A, `docs/concept-0.3.md`)

```
content (files.js: fileKind/isSupported по pdfMode) ──► host.onAnalyze: isPdf(bytes) || имя .pdf ──► env.extractPdf (offscreen/pdf-loader.js)
   └─ pdf.js (vendor/pdfjs/pdf.mjs, лениво) + вложенный Worker vendor/pdfjs/pdf.worker.mjs ──► core/pdf/extract.js ──► core/pdf/layout.js (Layout)
        ──► core/text/model.js fromText (DocModel kind:'text') ──► analyze() как для DOCX ──► APPLY: planEdits + serializeText ──► имя.anon.md
```

### 7.1. Извлечение (`core/pdf/extract.js`, `offscreen/pdf-loader.js`)

- `extractPdf(pdfjs, bytes, {password?, maxPages = 1000, onProgress?, docOptions?, fonts?}) → Promise<Layout>`. Модуль pdf.js **передаётся снаружи**: ядро не
  импортирует pdf.js, не знает `chrome.*` и не делает сетевых запросов. `getDocument({...BASE_DOC_OPTIONS, ...docOptions, data: bytes.slice(), password?, verbosity: ERRORS})`,
  `BASE_DOC_OPTIONS = {disableFontFace, useSystemFonts: false, useWasm: false, stopAtErrors: false, isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
  enableXfa: false, disableRange, disableStream, disableAutoFetch, fontExtraProperties: true}`; копия байтов — pdf.js передаёт буфер в свой воркер.
- По страницам: `getTextContent({includeMarkedContent: false})` → `PageItems {page, width, height, items[{str, transform (координаты видимой страницы, y вверх), width,
  height, fontName, hasEOL}], fonts}`. Координаты — через матрицу `page.getViewport({scale: 1}).transform` (`pageSpace(page)`: учитывает `/Rotate` и начало
  view; размеры — видимой страницы), затем `orientPage` (§7.2) поворачивает страницу к преобладающей ориентации текста — альбомный лист «по-принтерному»
  (`/Rotate` + матрица `cm`) и текст сверху вниз не теряются. «Страница без текста» (< `MIN_LETTERS`) считается по буквам элементов, которые разметка возьмёт
  (`isUpright`), — страница из одних диагональных водяных знаков даёт `PDF_NO_TEXT`/`PDF_PAGES_NO_TEXT`, а не пустой результат. Жирность и моноширинность — по
  шрифту (`…-Bold`, `Black`, `Semibold`…; `isMonospace` или имя `Mono`/`Courier`/`Consolas`): имя приходит в `page.commonObjs` только после
  `getOperatorList()` и с `fontExtraProperties: true`; вызывается только для страниц с текстом, сбой не ошибка. После страницы — `page.cleanup()`, в конце — `loadingTask.destroy()`.
- Коды (`CoreError`, текст без содержимого документа): `PasswordException` → `PDF_ENCRYPTED {details: {reason: NEED_PASSWORD|INCORRECT_PASSWORD}}` (не путать с `ERROR.reason`, §4); `InvalidPDFException`,
  `FormatError`, `UnknownErrorException`, `MissingPDFException` → `PDF_INVALID`; прочее → `INTERNAL`; `numPages === 0` → `PDF_EMPTY`; `> maxPages` →
  `TOO_LARGE {pages, limitPages}`; на каждой странице < 20 букв (`\p{L}`, `MIN_LETTERS`) → `PDF_NO_TEXT {details: {pages: <число страниц>}}`; только часть таких страниц — в `layout.warnings`
  `PDF_PAGES_NO_TEXT {count, details: {pages: [номера]}}`. Распознаются по `err.name` (исключения пересекают границу воркера pdf.js).
- `isPdf(bytes)` — `%PDF-` в первых 1024 байтах. Хост: сигнатура или имя `.pdf` → ветка PDF; `.pdf` без сигнатуры → `PDF_INVALID`; файл с сигнатурой и именем
  `.docx` — тоже PDF. Без `env.extractPdf` → `INTERNAL 'PDF недоступен'`.
- `createPdfExtractor({vendorBase?, maxPages?})` (воркер ядра): `await import(vendorBase + 'pdf.mjs')` при первом PDF (сбой не кэшируется),
  `GlobalWorkerOptions.workerSrc = vendorBase + 'pdf.worker.mjs'`, свой воркер pdf.js — `new pdfjs.PDFWorker({port: new Worker(workerSrc, {type: 'module'})})`
  один на жизнь offscreen; `docOptions = {worker, useWorkerFetch: true, cMapUrl, cMapPacked: true, standardFontDataUrl}` — пути от `import.meta.url`
  (`chrome.runtime.getURL` в воркере нет). Порт задаётся явно: без него `PDFWorker` читает `window.location` (в воркере его нет) и уходит в «fake worker»,
  который импортирует `pdf.worker.mjs` в наш воркер и вешает обработчик на его `self`.
- Сборка: pdf.js **не бандлится** (бюджет кода `worker.js`, К15, §6.5) — `scripts/build.mjs` копирует `node_modules/pdfjs-dist/legacy/build/pdf.min.mjs` →
  `vendor/pdfjs/pdf.mjs`, `pdf.worker.min.mjs` → `vendor/pdfjs/pdf.worker.mjs`, `cmaps/` (168 `.bcmap` + `LICENSE`), `standard_fonts/` (14 шрифтов + 2 лицензии), `LICENSE` (Apache 2.0);
  `package.json` pdf.js не копируется. **Legacy-сборка**, а не современная: современная `build/pdf*.mjs` 6.4 использует `Map.prototype.getOrInsertComputed` и
  `Math.sumPrecise` (есть только в самых новых Chrome), legacy заполняет их и `Response.prototype.bytes` (core-js). Тот же legacy-модуль — в Node-тестах
  (`tests/integration/support/pdf.js`: `cMapUrl`/`standardFontDataUrl` — пути ФС, в Node 22 нет `Promise.try`). `minimum_chrome_version` — 132.

### 7.2. Разметка (`core/pdf/layout.js`)

`buildLayout(pages: PageItems[]) → Layout {blocks, pages, warnings}`; `Block = {kind: 'p'|'h1'|'h2'|'li'|'cell'|'hr'|'header'|'footer', text, page, table?: {index, row, col, cols}}`.
Шаги экспортируются и тестируются отдельно (`tests/unit/pdf/layout.spec.js`); пороги — в долях кегля строки `size`:

| Шаг | Правило |
|---|---|
| `orientPage` | ориентация элемента (`orientationOf`: 0/90/180/270 или наклон); если по числу букв преобладает не 0 — все элементы поворачиваются вместе со страницей (при 90/270 ширина и высота меняются местами), иначе страница как есть |
| `normalizeItems` | пробельные элементы pdf.js не выдаются, а помечают соседей (`spAfter`/`spBefore`); NBSP → пробел; управляющие символы удаляются; не `isUpright` (наклон, вверх ногами, зеркало — водяные знаки) отбрасывается; y — сверху страницы; флаги `bold`, `mono` — по шрифту |
| `groupLines` | базовые линии ближе `0.35·size` — одна строка; надстрочный знак мельче `0.8·size` (сноска) в пределах `−0.65…+0.35·size` — часть строки |
| `findGutters` + `joinWords` | зазор > `0.15·size` или явный пробел pdf.js — пробел; зазор > `2·size` или `hasEOL` непустого элемента — новый сегмент; зазор > `0.4·size` — сегмент, если в непрерывном участке строк, не пересекающих этот x текстом, ещё ≥ 2 строки начинают элемент у того же x (±0.3·size): так ячейки таблиц LibreOffice (поле ≈ 0.47·size) отделяются, а растянутые пробелы выровненного текста (до ≈ 0.85·size) — нет; в моноширинной строке (`monoCharWidth`: шрифт с моноширинным именем у большинства прогонов или ≥ 4 прогонов с одной шириной символа ≥ 0.55·size) порог просвета — не меньше 1.5 ширины символа: пробел (0.6·size) не режет «БИК 044525901»; двойная отрисовка (имитация жирного) — один раз |
| `stripRepeating` | строки верхних/нижних 8 % страницы: номера страниц (`3`, `- 3 -`, `Страница 2 из 4`, `Page 2 of 4`, `2 из 4`) удаляются; крайние строки полосы (участок подряд от края страницы, номера страниц не в счёт), текст которых (цифры → `#`) повторяется в той же полосе на ≥ 3 страницах или ≥ 50 % (не меньше двух) и не похож на текст договора — не заголовок (кегль ≤ 1.15 основного, не жирный), не пункт с нумерацией, без реквизита с номером (`ИНН 7701…`, `ОГРН`, `БИК`, `р/с`…) и не продолжение абзаца (сверху: предыдущая страница кончается незавершённым предложением и следующая строка идёт шагом ≤ `PARA_PITCH`; снизу: строка выше идёт таким шагом без конца предложения), — колонтитул; одиночная крайняя строка кеглем ≤ 0.85 основного — тоже (`header`/`footer`, по одному на текст); крайняя строка полосы обычного кегля без жирного, отделённая от соседней строки шагом > `HEADER_GAP` (1.5) обычного, — тоже, и на одностраничном документе (колонтитул LibreOffice 12 pt: шаг 1.54) |
| `detectColumns` | участок строк, все сегменты которых лежат в половинах, ≥ 3 строки в каждой, ≥ 50 % строк каждой колонки заполняют ≥ 75 % её ширины (проза, а не ячейки); участок обрывается, где обе половины строки начинаются не там, где колонки, и на строке левой половины ниже последней строки правой колонки, набранной иначе (кегль ±15 % или жирная после промежутка) — заголовок на всю ширину после колонок; строка, пересекающая середину, в участок не входит; читается слева направо |
| `detectTables` | ≥ 3 строки из ≥ 2 сегментов с общими x-началами (±0.5·size) — или общими правыми краями для сегментов вне колонок по началу (числа и суммы вправо; колонка по началу внутри такой — та же колонка), одиночные строки внутри — продолжение ячейки (у начала колонки, не шире её, обычным шагом); ячейки колонки сливаются, если предыдущая строка дошла до правого края ячейки (начало следующей колонки − 2 поля, поле — отступ текста таблицы от края текста страницы; у последней колонки — ширина предыдущей, но не меньше её самой длинной строки) или кончилась дефисом; не сливаются строки с общим правым краем и разным началом и суммы/количества (`AMOUNT_RE`); строки таблицы — по y начала ячеек, пустые ячейки дополняются; **0.4 (WP11-D):** две многосегментные строки — таблица, если у них одинаковое число сегментов (≥ 2) с попарно общими x-началами (±0.5·size), вторая — новая строка; одиночные строки сразу под последней строкой — перенос её ячейки, если начинаются у края колонки (±0.2·size), строка выше дошла до правого края колонки и колонка не последняя |
| `linePitch` | обычный шаг строк — наименьший частый шаг (кластер 1 pt, ≥ 2 и ≥ 10 % шагов), без частых — наименьший |
| `mergeParagraphs` | новый абзац: шаг > `1.3` обычного, смена кегля > 15 %, жирный ↔ не жирный, отступ первой строки > `1.5·size`, строка по центру, маркер списка, «….» + нумерация «1.3. », первое слово следующей строки поместилось бы в предыдущую; другая страница/колонка — продолжение, если предыдущая строка дошла до края и не кончилась `.!?:` (`;` — конец, только если дальше не строчная буква или нумерация) (абзац склеивается, `hr` — после него); узкий блок (`narrowBlocks`: ≥ 2 строки вне колонок с общим x0, отступом > 1.5·size и обычным шагом, самая длинная заметно короче края страницы — надпись LibreOffice) — край строки считается по max x1 блока, строки разных блоков не склеиваются; **0.4 (WP11-D):** `technicalBreak` — строка кончается на «-» или «.» внутри почты, URL, `www.` или домена с дефисом, следующая начинается латинской строчной (после «-» — и цифрой): продолжение абзаца даже в строке по центру, после «.» склейка без пробела |
| `dehyphenate` | `U+00AD` и `U+2010` в конце — удалить всегда; «цифры-» + «цифры» → без дефиса, если по любую сторону группа ≥ 4 цифр (ИНН с мягким переносом), группы 2–3 цифр (телефон) — дефис остаётся; «слово-» + строчная → без дефиса (левая часть ≥ 3 букв или 2 буквы с заглавной, кроме «По-видимому», «Во-первых»; справа не частица `то/либо/нибудь/таки/ка/де/с/за/под/над/т`); заглавная справа, почта/URL (`@ / . : _`) — дефис остаётся без пробела; иначе — пробел |
| `classifyHeading` | ≤ 30 слов: кегль ≥ 1.5× медианного — `h1`, ≥ 1.2× — `h2`; ≥ 90 % жирного и ≤ 12 слов (не на `,;`) — `h2` |
| `detectList` | маркер `• ‒ – — ○ ▪ ■ ✓ - · ◦ ● ►` + пробел → `li` без маркера; нумерация («1.», «1.1.») — обычный абзац: kb.js ищет начало условий по `^\s*1\.` |

Порядок блоков: верхние колонтитулы, основной текст по страницам (`hr` между страницами), нижние колонтитулы.

### 7.3. Текстовая модель и сериализация (`core/text/{model,serialize}.js`)

- `fromText(blocks, {name, size, format = 'pdf'})` — см. §1.1. Порядок потоков FR-25: основной текст → `word/header1.xml` → `word/footer1.xml`; язык — `detectLanguage(streams)`
  (только основной текст). Сущности в колонтитулах находятся и попадают в карту, но текст колонтитулов в результат не идёт.
- `serializeText(doc, edits, {format: 'md'|'txt'}) → {bytes (UTF-8 без BOM), text, changedParts, removedParts: []}`. Правки проверяются, как в `serializeDocx`
  (неизвестный поток, диапазон вне потока, пересечения → `CoreError('INTERNAL')`). Markdown: `h1 → "# "`, `h2 → "## "`, `li → "- "`, ячейки таблицы →
  `| a | b |` + `| --- | --- |` после первой строки, `hr → ---`, блоки через пустую строку. Экранирование минимальное и обратимое: `|` в ячейке → `\|`, в начале абзаца
  `#`, `>`, `- `, `* `, `+ `, `N. `/`N) ` → с `\`; `*`, `_`, `[`, `]` не трогаются — плейсхолдеры `[ФИО_1]` как есть (их понимает `deanonymize`).
  Текст: блоки через пустую строку, ячейки строки — через `\t`.

### 7.4. Перехват, панель, настройки

- `pdfMode` (`markdown` | `text` | `off`, по умолчанию `markdown`; не поле профиля, экспортируется): `content/files.js` — `fileKind(file) → 'docx'|'pdf'|null`,
  `isSupported(file, settings)` (PDF — если `pdfMode !== 'off'`), `hasSupported`; `createInterceptor(flow, {isSupported})` (по умолчанию — только DOCX);
  `flow.js` обрабатывает все поддерживаемые файлы (`procIdx`), имя результата — по исходному файлу (`makeResultName(name, suffix, {ext})` из `content/files.js`, расширение — из
  `res.name`; `RESULT_BEGIN.name` хост строит своей `makeResultName` в `offscreen/host.js`), тип — `resultType(original, res.mime)` (для PDF — `text/markdown`/`text/plain`, для DOCX — MIME исходника); `mappingFileName('a.anon.md') → 'a.mapping.json'`.
- Панель: для `ENTITIES.kind === 'pdf'` — заметка `pdfNote {ext}` (`data-testid="pdf-note"`; `ext` — `.md`/`.txt` по `pdfMode`, передаёт `flow.js`),
  `PDF_PAGES_NO_TEXT` → `warnPdfPages {pages}` (одна страница — `warnPdfPage`, единственное число: `pdfPagesKey` в `ui/panel/panel.js`); отказы — прежний экран ошибки с «Загрузить как есть» (`btn-asis`); кнопка `btn-anonymize` доступна и когда все файлы
  помечены «как есть» (уходят оригиналы), подпись тогда — `btnUpload` («Загрузить»). `TOO_LARGE` с `details.pages` (лимит страниц PDF) → `err.TOO_LARGE_PAGES
  {pages, limit}`, без — `err.TOO_LARGE {limit}` (МБ). Тексты — `err.PDF_*`, `stage.pdf` (`ui/i18n/common.js`). Настройки: select `pdf-mode` и подсказка `pdf-mode-hint` в «Обработке».

### 7.5. Фикстуры и тесты

`npm run gen-pdf-fixtures` (`scripts/gen-pdf-fixtures.mjs`): `buildFixtures()` + `buildSampleDocx()` → HTML (обход `document.xml` токенизатором ядра: абзацы, жирный,
таблицы и вложенные таблицы, `w:numPr` → пункты, надписи — отдельными абзацами, без удалённого текста, полей, сносок) → Chromium `page.pdf` (A4, поля 20/15 мм,
колонтитул и «Страница N из M» шаблонами). `two-companies` — абзацы 1–3 в две колонки, `english-contract` — абзацы 2–3 пунктами списка, `perf-50p` — 48 страниц,
≈ 18 600 слов, `scan` — страница-картинка, `mixed` — `ip-contract` + страница-картинка, `empty` — `/Count 0`, LibreOffice (если есть): `ip-contract.lo`,
`two-companies.lo`, `structures.lo` (надпись, мягкий перенос в ИНН, исправления), `sample-contract.lo` (колонтитулы обычного кегля на одной странице, сноски),
`encrypted` (пароль). По ревью WP10-A — «дикие» PDF из HTML (реквизиты `WILD_GOLD`): `wild-mono` (Liberation Mono 12 pt), `wild-landscape` (альбомная, DejaVu Sans
10 pt, таблица с числами вправо), `wild-2col` (две колонки, колонтитул 11 pt обычным кеглем, заголовок на всю ширину после колонок); `rotated` — `ip-contract`
с `/Rotate 270` и содержимым, повёрнутым матрицей `cm` (`rotatePdf`: инкрементальное обновление PDF Chromium). К каждому текстовому PDF — `.gold.json` и снимок `.txt` (Markdown после разметки); снимки переписываются только
с `--update-snapshots` (или пишутся, если снимка ещё нет; `--only=<имена>`, `--out=<каталог>`, путь к LibreOffice — `SOFFICE`), `--snapshots-only` — пересчёт из записанных PDF после правки разметки. Байты PDF недетерминированы → `pdf-fixtures.spec.js` сравнивает
извлечение со снимком (всегда) и регенерацию в памяти со снимком (если есть Chromium, `SKIP_PDF_REGEN=1` — пропустить).

### 7.6. Спайки S1–S4 (15–19.10.2026, Chromium 153 из Playwright 1.63, headless; Node 22.22)

| Спайк | Результат |
|---|---|
| **S1** pdf.js в модульном воркере под CSP (`dist-e2e`) | **Работает.** Вложенный `Worker(vendor/pdfjs/pdf.worker.mjs, {type: 'module'})`, переданный в `PDFWorker({port})`, поднимается из воркера ядра; CSP `script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'` не мешает; ни CSP-ошибок, ни `document is not defined`, ни `blob:`/http(s): CDP-захват видит только `vendor/pdfjs/pdf.mjs` и `pdf.worker.mjs` (CMaps и стандартные шрифты фикстурам не понадобились — шрифты встроены; при необходимости они грузятся `fetch` по `chrome-extension://`). Холодный `analyzeFile` 1-страничного PDF вместе с импортом pdf.js и первым `getTextContent` — 0,19–0,24 с, тёплый — 0,015 с (≤ 1 с, К6). Жирность: `page.commonObjs.get(fontName).name` (`AAAAAA+LiberationSerif-Bold`) доступен после `getOperatorList()` и только с `fontExtraProperties: true`. `Response.prototype.bytes`, `Math.sumPrecise`, `Map.prototype.getOrInsertComputed` в Chromium 153 есть; современная сборка pdf.js без них не работает (последние два — Chrome новее 132), поэтому вендорится legacy-сборка (+ ≈ 120 КБ). |
| **S2** размер | `vendor/pdfjs/` — 188 файлов, 3 821 048 байт (3,6 МБ ≤ 6 МБ, К8): `pdf.mjs` 523 774, `pdf.worker.mjs` 1 321 307, 168 `.bcmap`, 14 шрифтов, лицензии; подмножество CMaps не нужно. Лёгкий архив `npm run pack` — 6 425 902 байт (6,1 МБ ≤ 12 МБ; было 4,0 МБ). `worker.js` без ORT — 706 952 байт (≤ 716 800 = 700 КБ; код PDF и текстовой модели в нём ≈ 34 КБ). |
| **S3** LibreOffice vs Chromium, `pdftotext -layout` | Chromium пишет строку длинными элементами с пробелами внутри и отдельным `" "`-элементом на зазор > 0.6·size; LibreOffice — элемент на слово и `" "`-элемент шириной растянутого пробела (до 0.85·size в выровненном тексте), колонтитулы — в начале потока страницы (порядок — только по геометрии), между ячейками таблицы поле ≈ 0.47·size. Отсюда пороги `SPACE_GAP 0.15`, `GUTTER_GAP 0.4` с проверкой просвета, `SEGMENT_GAP 2`. Снимки разметки `ip-contract` и `two-companies` из Chromium и LibreOffice **совпадают** (в Chromium `two-companies` свёрстан в две колонки, в LibreOffice — в одну). Jaccard слов основного текста с `pdftotext -layout` — 1.000 на всех 10 текстовых фикстурах (гейт ≥ 0.97). |
| **S4** pdf.js в Node/vitest | `pdfjs-dist/legacy/build/pdf.mjs` (современная сборка в Node 22 падает на `Promise.try`); `cMapUrl`/`standardFontDataUrl` — пути ФС, canvas не нужен. `/Count 0` → `numPages === 0` (→ `PDF_EMPTY`); мусор и пустой буфер → `InvalidPDFException`; PDF LibreOffice с паролем → `PasswordException` `code 1` без пароля, `code 2` с неверным. |

Измерения (Node 22, AMD Ryzen 9 7945HX): `perf-50p` (48 стр., ≈ 18 600 слов) — извлечение + разметка ≈ 0,32 с, анализ без NER ≈ 0,11 с (гейт К6 8 с); в Chromium
`analyzeFile` того же PDF — 0,36 с. К3 — паритет DOCX/PDF 100 % по всем категориям на 9 фикстурах (`pdf-pipeline.spec.js` печатает таблицу), К2 — 0 утечек gold
детекторами без подсказок на 10 фикстурах.

После ревью WP10-A (19.10.2026): 16 текстовых фикстур; К2 — 0 утечек целиком **и частично** (фамилия любого gold-ФИО целым словом; номера ≥ 9 цифр после
удаления дефисов, знаков переноса и пробелов между цифрами — `partialLeaks` в `pdf-pipeline.spec.js`); К3 — паритет с DOCX ≥ 95 % на каждой фикстуре с DOCX-исходником
(`structures.lo` 8/8, `sample-contract.lo` 28/29 — LibreOffice рисует удалённый текст исправления рядом с адресом почты), на «диких» — 17/17 gold. Порядок абзацев
(К4) для `structures.lo` и `sample-contract.lo` не меряется: исправления и сноски LibreOffice в теле страницы не сопоставляются с живым текстом DOCX.

---

## 8. Политика маскирования и список компаний (версия 0.4, `docs/concept-0.4.md`)

Решения владельца (19.10.2026): персональные данные и идентификаторы компаний маскируются **всегда**, названия организаций — **по желанию**;
бренд «Sitimlab» не маскируется никогда; водяного знака в файлах нет.

### 8.1. Группы категорий (волна 0, `core/categories.js`, `core/settings.js`)

| Группа | Категории | Переключатель |
|---|---|---|
| `pii` | PERSON, PASSPORT, SNILS, SSN, PHONE, EMAIL, BIRTHDATE, ADDRESS, CARD | нет — всегда включены |
| `ids` | INN, KPP, OGRN, ACCOUNT, IBAN, BIK, SWIFT, TAXID, URL | нет — всегда включены |
| `commercial` | COMPANY, CONTRACT, AMOUNT | `settings.commercial` (по умолчанию `false`) + прежние `settings.categories[id]` внутри |

- `isCategoryEnabled` — см. §3. `settings.categories[id] = false` для `pii`/`ids` игнорируется и исправляется `migrateSettings`.
- «ИП Фамилия И.О.» — имя человека (решение 1): всегда PERSON с `keepPrefix` на форму «ИП » (WP11-A; до него — COMPANY, как в 0.3).
- Ядро (`detect/runner.js`, `accept`): кандидаты `source: 'user'` и `'list'` **не** проверяются на включённость категории и `allowedLevels`.
  Остальные источники — как раньше. Детекторы документа вызываются всегда; `kb.js` при выключенной COMPANY не порождает компании и не занимает их спаны.
- Этап NER: порог по метке — `ORG` → `nerThresholdOrg`, `PER`/`LOC` → `nerThreshold`; спаны ORG проходят `filterOrgSpans(spans, {text, blockKind, ...ctx})`
  из `core/ner/filters.js` (контекст документа — `createOrgFilterContext(doc, settings)`, один раз на анализ); при выключенной COMPANY фильтр не вызывается,
  ORG отбрасывается `accept`.
- `paragraph.kind` (0.4): DOCX — `'heading'` (`w:pStyle` = `Heading\d*`, `Title`, `Subtitle`, «1»…«9» — русский Word даёт styleId цифрой), `'li'` (`w:numPr`), иначе `'p'`;
  текстовая модель — вид блока разметки PDF (`h1|h2|li|cell|p|header|footer`). Раннер передаёт его фильтру как `blockKind`.

### 8.2. Список компаний (`detect/names/company-list.js`, WP11-A)

- Запись `{name, aliases}` → ядро названия без ОПФ и внешних кавычек (`companyCore` в `company.js`); псевдонимы — ещё одно название записи.
- Поиск во всех потоках, документный детектор `company-list` (после `kb`), независимо от `commercial`:
  - точное слово без учёта регистра первой буквы; название с заглавной не ищется в строчном написании («ромашка» — цветок);
  - русская морфология: кириллическое слово ≥ 5 букв — основа + падежное окончание из списка (до 3 букв), у слова на согласную основа — всё слово;
    в многословном названии склоняется и короткое слово («Лунного света»); одиночное короткое название и латиница — только точно;
  - границы слова как `glued()` в `person-dict.js`; составное через дефис («Ромашка-Трейд») — не «Ромашка»;
  - кросс-скрипт через `crossScriptMatch` при `skeletonWeight ≥ 3` (последовательности 1–3 слов с заглавной);
  - ОПФ перед названием, латинская ОПФ после, кавычки — в `keepPrefix`/`keepSuffix`; спанов через `\n` нет.
  - Название маскируется везде, в т.ч. в начале предложения, после «:» и в ячейке; риск общих слов («Старт») — предупреждение `company-short` в настройках.
- Выход: `category: 'COMPANY'`, `source: 'list'`, `confidence: 'labeled'`, `canonical` = ядро названия записи (одна метка с находкой правил в коммерческом режиме:
  совпавшее с записью название правил `kb.js` выдаёт с `source: 'list'`). `exclusions` применяются после; ⊘ у строки из списка кладёт нормализованный canonical.
- Бренд владельца (`NEVER_MASK_ORGS` в `lexicon.js`: Sitimlab, Ситимлаб в любом падеже) не маскируется никогда: ни правилами, ни KB, ни списком, ни моделью (стоп-список).
- Пополнение: `pv-mask-always` в строке COMPANY, флажок `pv-sel-remember` на вкладке «Текст»; страница настроек `#companies` (импорт/экспорт
  `{kind: 'docx-anonymizer-companies', version: 1, companies}`, слияние при импорте).

### 8.3. Фильтры модельных организаций (`core/ner/{filters,stoplist}.js`, WP11-B)

Только в коммерческом режиме (раннер вызывает `filterOrgSpans` для ORG после порога `nerThresholdOrg`). Контекст документа —
`createOrgFilterContext(doc, settings)` → `{stoplist, properStems, cellTexts}`: стоп-список (`stoplist.js` ∪ `settings.nerStoplist`, ключ
`stopKey` — без регистра, «ё» = «е», кириллица и латиница одного начертания совпадают: 1С = 1C; бренд владельца — `NEVER_MASK_ORGS`), основы
слов, написанных в обычном тексте (не капс, не заголовок) с заглавной не в начале предложения, тексты ячеек таблиц DOCX (у DOCX `kind` ячейки — `p`).
Порядок проверки (первое сработавшее решает):
1. ОПФ в спане или вплотную к нему — сохранить.
2. Стоп-список: спан целиком, каждым словом («Word и Excel»), слово целиком вокруг спана («Диск» из «Яндекс.Диск»); падежное окончание до 2 букв —
   только для кириллицы — отбросить.
3. Кавычки или «Студия/Агентство/Бюро/Компания/Группа компаний/Холдинг + Название» — сохранить.
4. (2б) Часть спана из стоп-списка, остальные слова — не имена собственные документа («Настройка CRM») — отбросить.
5. (1) Спан — вся строка ≤ 3 слов (номер раздела допускается: «05 Цены») в `h1|h2|li|cell|heading`, ячейке DOCX, капсом или с «:» в конце —
   отбросить, если не все слова спана — имена собственные в тексте документа.
6. (3) Капс-строка или заголовок, спан ≤ 8 слов, ни одно слово не имя собственное в тексте («ВХОДИТ», «АКТ СВЕРКИ ВЗАИМНЫХ РАСЧЁТОВ») — отбросить.
7. (4) Фраза: тире с пробелами; слово со строчной буквы (кроме частиц «и», «of», «de»…) при спане — весь абзац, строка ≤ 5 слов без точки,
   заголовок, пункт или ячейка; в предложении — спан со строчного слова в начале или служебного в конце — отбросить
   («Уральский завод точных приборов» в предложении сохраняется).
8. (5) Обрывок кода: ≤ 4 заглавных букв с цифрой внутри или вплотную («ПС» из «17/ПС-2026») или сразу после «серия/серии/сер.» («серии ФС № …», доработка 0.5) — отбросить.
9. (6) Адрес («45 King Street», «ул.») или должность в конце спана без продолжения названия с заглавной («Senior Data Analyst») — отбросить.
10. Иначе — сохранить.

Корпус жанров (`genres.spec.js`, стаб-провайдер ORG на каждый отрицательный пример) — 0 прошло фильтр, организации с ОПФ и без ОПФ со строчными
словами сохранены; с моделью 1.0.0 ложных ORG на КП — 0.

Стоп-список с версии 0.5 (WP12-E) дополнен `STOP_DOCS_05`: СТС, ПТС, ЭПТС, ОМС и «Полис ОМС», ДМС, ОСАГО, КАСКО, СНИЛС, MAC, ЕГРН, ЕГРП, КУСП, ВНЖ, РВП, МКБ/МКБ-10,
ГРЗ, VIN, ЗАГС, УИД, «Электронная почта», кодексы (ГПК, АПК, УПК, КоАП, КАС, «ГК РФ»…) и модели автомобилей целым названием («Лада Веста», «Toyota Camry»; марка одна — не в списке:
«Лада» — и имя, «Toyota» — и компания). Список действует и на PER/LOC модели (§8.3а, шаг 1). Доработка 0.5 по прогону КП: одним словом — только аббревиатуры, которые
сами по себе не бывают названием стороны; «Полис», «Почта» одним словом убраны (с них начинаются названия — «Почта России», «Почта Банк»; стоп-список отбрасывал бы
и спан «Почта», и, по правилу 2б, составной спан с нарицательными), «ФС» — правило обрывка кода (шаг 8). Добавлены «Tax ID», VAT, IBAN, SWIFT, BIC и модели ИИ
(`PRODUCT_NAMES`: DeepSeek, Qwen, Gemini, Copilot, Perplexity, Grok, Midjourney, Шедеврум, ГигаЧат, «Яндекс GPT», GPT-4/4o/5, «Яндекс Алиса»,
«Яндекс Станция»…; ChatGPT, Claude, GigaChat, YandexGPT были). «Алиса» одна — женское имя, в список не входит (§8.3а, шаг 5а).

Пересечения (`detect/overlap.js`, 0.4): (1) находка модели, целиком лежащая внутри более длинной находки правил/KB/пользователя, отбрасывается до
ранжирования — адрес без метки (`weak`) не теряет индекс и дом из-за обрывка «Новосибирск» от модели; (2) `mergePersons` (WP11-D): PERSON правил и PERSON
модели, пересекающиеся так, что модель выходит за правило, — одно лицо: спан — объединение, уровень, источник и `canonical` — правила, профессия в начале —
в `keepPrefix` («Сотрудник Кирилл» + «Кирилл Ахмедов» → «Кирилл Ахмедов»); модель, перекрывающая двух людей из правил, не объединяется.

### 8.3а. Фильтр PER/LOC модели (`core/ner/filters-pl.js`, WP11-D)

Оба режима. Раннер вызывает `filterPersonLocSpans(spans, {...ctx, text, blockKind})` после порога; контекст `createOrgFilterContext` строится всегда:
`{stoplist, properStems, cellTexts, pairedWords, toolWords}` (`pairedWords` — слова рядом с другим словом с заглавной через пробел или табуляцию; `toolWords` — словоформы
с суффиксом программы-инструмента, хоть раз написанные в обычном тексте со строчной). Порядок:
1. Стоп-список (спан целиком, каждым словом, слово вокруг) — отбросить.
2. По краям отрезаются `SERVICE_WORDS` (вежливость, учётные данные, заголовки таблиц, тарифы, языки, должности), у PER ещё строчные слова и слова с цифрами;
   ничего не осталось, остаток со строчной или римская цифра — отбросить.
3. Одно слово со строчной — отбросить.
4. LOC остаётся ADDRESS, только если в спане или окне ±40 символов есть признак адреса (индекс, «ул./пер./пр-т/наб.», «д./кв./оф.» с номером,
   «дом/офис/улица/проспект», street/road/suite, британский индекс, ZIP, номер дома после запятой), адресная метка («адрес*», «проживающ*», «зарегистрирован*»,
   «место жительства/регистрации», «доставк*», «курьер», «address», «lives at», «located at», «resides») или номер дома сразу после места; «г.» сама по себе —
   не признак; номер дома и квартира входят в спан.
5. PER со строчным словом внутри (кроме частиц) или цифрой — отбросить; PER без слова-имени (словари, `morph.js`, инициал с точкой; капс — без суффикса фамилии,
   в капсе из нескольких слов нужно имя, отчество или инициал) — отбросить, если это остаток после отрезания, капс или одно слово в `h1|h2|li|cell|heading`/ячейке;
   одно такое слово — отбросить и в тексте, если у него суффикс программы-инструмента (-айзер, -изатор, -ератор, -атор, -итор, -ктор, -ометр в любом падеже),
   та же словоформа в документе написана и со строчной (`isToolWordInDoc`: «Анонимайзер» в начале фраз и «анонимайзер документов») и слово не стоит рядом
   с другим словом с заглавной (`pairedWords`) — доработка 0.5 по прогону КП. По ревью сужено: общее правило «есть строчный двойник или однокоренное» открывало
   одиночные фамилии («Мороз» + «ударил мороз», «Кузнец», «Лебедь» + «лебёдка», «Коваль» + «кованый»).
5а. (доработка 0.5) PER одним словом в контексте продукта (`ner/product-context.js`, `productContext`) — отбросить. Только имя голосового помощника («Алиса»,
   «Маруся», «Салют», Siri, Alexa — все падежи) и только (1) сразу после «Яндекс», «голосовой помощник/ассистент», «умная колонка», «чат-бот», «нейросеть»,
   «ИИ-помощник» или (2) в перечислении между двумя продуктами `PRODUCT_NAMES` либо после продукта перед «и другие/др./прочие» + «модели/сервисы/нейросети/
   продукты/помощники/чат-боты/платформы/ИИ» («в GigaChat, Алису, DeepSeek и другие модели»). Сразу за именем глагол в личной форме или прошедшего времени
   («Яндекс Алиса подтвердила», «чат-бот Маруся передала») — человек, маскируется. Фамилии и другие имена в перечислении продуктов («Excel, Петров и другие
   сотрудники», «Slack, Мороз, Zoom») правило не трогает (ревью). «В Яндексе Алиса отвечает…», «Алиса от Яндекса приедет» — остаются ФИО. Тот же контекст не даёт
   LOC стать PER (шаг 8), обращению (`names/vocative.js`), паре «Яндекс Алиса» правил (`names/person.js`, `assistantPair`) и одиночному варианту лица в `kb.js`
   («Алису» при «Алиса Котова» в документе).
6. Омоним нарицательного одним словом в начале предложения перед предлогом или в перечислении — отбросить, если его нет в `pairedWords` (человек с этим именем в документе).
7. PER, оборванный перед словарной фамилией, продолжается.
8. (3-я итерация WP11-D) До порога ORG модели, за которым сразу идёт номер дома (не в кавычках, не капсом), становится LOC (`orgStreetsAsLoc` в раннере).
   LOC в адресном контексте продлевается номером дома и частями адреса после запятой (`addressTailEnd`). LOC вне адресного контекста из одного слова-фамилии
   по суффиксу (не имя, не после «г./пос./с./дер./ст.») становится PER — иначе фамилия, принятая моделью за топоним, уходила открытой.

Фильтр ORG (§8.3), дополнение WP11-D: ORG, который кончается родовым словом (завод, комбинат, компания, группа, фабрика, агентство, бюро, холдинг, институт,
университет, банк, фонд), продолжается строчными словами в родительном падеже до знака препинания, глагола, предлога или союза, не дальше 5 слов (`extendGenericTail`).

### 8.3б. Детекторы, доработанные по корпусу (WP11-D)

- «ИНН/КПП» допускает до двух слов перед номерами и пробелы вокруг «/» («ИНН/КПП покупателя: X/Y»). Доработка 0.5 по прогону КП: «/» в любой метке каталога —
  с пробелами или без с каждой стороны («ИНН/ КПП», «ИНН /КПП», «р / с»); иначе «ИНН/ КПП 7701234567/770101001» оставлял ИНН открытым (метка «КПП» делала его
  чужим). ИНН с подписью и неверной контрольной суммой — `labeled` (маскируется, fail-closed); без подписи — нет. По ревью: составная подпись реквизитов
  (`compoundRequisites`, `numeric.js`) — 2–3 метки ИНН/КПП/ОГРН(ИП) в любом порядке через «/», «\» или «,» и столько же значений через те же разделители
  («КПП/ ИНН Y/X», «ИНН, КПП X, Y», «ИНН\КПП X\Y», «ИНН / КПП / ОГРН X/Y/Z»): значение получает категорию своей метки по позиции, если подходит по виду
  (ИНН 10/12, КПП 9, ОГРН 13/15 знаков); `validated` при верной контрольной сумме, иначе `labeled`. Метки КПП и ОГРН делают значение «чужим» только при своём
  виде (`foreignHit`): «КПП» перед 10-значным ИНН его больше не прячет.
- ИНН и ОГРН без своего лейбла не берутся только сразу после ключевого слова кода товара и только при длине кода (ТН ВЭД/HS — 10; штрихкод/EAN/GTIN — 8/13/14;
  артикул/SKU/«код товара» — любая) или под заголовком столбца, где нет других слов; ОКПД2/ОКВЭД не подавляют. При сомнении ИНН маскируется.
- ADDRESS: значение после адресной метки до конца строки или предложения (`labeled`); «Город, Улица 12-5» — `weak`.
- Обращения (`names/vocative.js`, шаг 4в `kb.js`, при `dictNames`): имя в именительном падеже в начале строки, после метки реплики или приветствия, за ним «,» или
  «!»; омоним — только с меткой реплики, приветствием или словом обращения и не в перечислении. PERSON `kb`, `canonical` — единственная запись с этим именем.
- База лиц: «Уважаемый/-ая/-ые» и профессии (`isRoleNoun`) — не части ФИО; одиночная фамилия и «Фамилия И.» — варианты любого человека с именем и фамилией
  (кириллица и латиница, без диакритики); PER модели — записи базы, их варианты ищутся правилами.
- PERSON после профессии (`isRoleNoun`, с заглавной или со строчной, в т.ч. в метке реплики «Роль Имя:»): одно имя или фамилия из словаря (фамилия — и по суффиксу) —
  PERSON `kb`, профессия вне спана.
- ADDRESS продлевается через «, N» и «, кв./корп./корпус/стр./строение/офис/пом./подъезд/этаж N», кроме даты, года, суммы и штук (`NOT_HOUSE_SRC`); метки
  «расположенн*», «находящ*» — адресные; «Город, Улица, N» — `weak`; английский компонент «N Name,» с городом и британским индексом — адрес.
- Отложенный набор `tests/fixtures/heldout/` (`scripts/gen-heldout-fixtures.mjs`, `tests/integration/heldout.spec.js`) — регрессия рядом с корпусом жанров.

### 8.4. Корпус жанров (`scripts/gen-genre-fixtures.mjs`, `tests/fixtures/genres/`, WP11-B)

8 жанров (`proposal`, `letter`, `invoice`, `reconciliation`, `manual`, `deck`, `resume`, `chat`; `letter`/`resume` + en) × ≥ 3 документа, DOCX + PDF, gold
`{entities, negatives}`; детерминированный PRNG. Настоящие документы владельца — `tests/fixtures/private/` (gitignored), гейт `PRIVATE_FIXTURES=1`.
Отчёт `npm run eval-genres` — точность/полнота/ложные по жанру × категории × режиму (`normal`/`commercial`), с моделью при `NER_MODEL_DIR`.

### 8.5. Исправления по финальной проверке (WP11-E)

- **Раннер:** потоковые детекторы получают и `ctx.stream.rowHeader` — текст ближайшей непустой ячейки слева в той же строке таблицы (`detect/tables.js`
  `tableHeaders(doc) → {column, row}`; DOCX и текстовая модель PDF). `columnHeader` собирается из всех строк таблицы до первой строки с цифрой (заголовок PDF на две строки).
- **ORG (§8.3):** первой проверкой `filterOrgSpans` ORG со словом бренда владельца (`isNeverMaskOrg`, и в слове целиком вокруг спана) отбрасывается — раньше ОПФ,
  кавычек и родового слова; `orgStreetsAsLoc` не трогает ORG с брендом. Стоп-список отбрасывает и спан, начинающийся многословным термином («Confidential
  Information …») или учёной степенью (MSc, BSc, MBA, PhD, MA, BA, MPhil, LLM, LLB); добавлены KYC, AML.
- **PER/LOC (§8.3а):** LOC модели вне адресного контекста из одного слова — фамилия по суффиксу или имя из словаря (не омоним, не после «г./пос./с./дер./ст.») — PER.
- **Лейблы (§8.3б):** значение в начале ячейки считается помеченным текстом `rowHeader` по правилам лейблов в потоке («Дата рождения | 17.11.1993»).
- **ADDRESS:** ячейка под короткой адресной меткой строки (≤ 50 символов) — `labeled`; индекс «NNNNNN, » прямо перед адресом входит в адрес; цепочка «город + улица + дом»
  по типам («г. Воронеж, ул. Липовая, д. 15») — `weak` и без индекса; значение после метки, совпавшее с цепочкой, поднимает её до `labeled`; `addressTailEnd`
  включает «, д. N» и «, дом N»; европейский адрес «Улица N, NNNN[-NNN] Город[, Страна]» — `weak`.
- **TAXID:** UK VAT «GB NNN NNNN NN[ NNN]» с меткой «VAT number / No. / reg. / registration number» — `labeled`; без метки — только «GB» + 9 цифр группами 3-4-2.
- **Коды товаров:** «ВЭД» в одиночку в заголовке столбца — код ТН ВЭД (подавляет числа из 10 цифр без своего лейбла).
- **PERSON:** подпись реплики одним именем («[время] Имя:», в т.ч. в цитате «> »), если имя не омоним; обращение после конца предложения («…. Тамара, а кто…») и в конце
  фразы («Спасибо, Ринат!», «потом Святослав.») — только не омонимы и не после «г./ул./им.»; «Фамилия И.» с одним инициалом — PERSON `kb`; имя одним словом у человека
  с полным именем в документе — его вариант (≥ 3 букв, не нарицательное, не омоним, не после «г./ул.»).
- **Бюджет:** лимит кода `worker.js` (без ORT и словарей) поднят с 400 до 416 КиБ (`pack.spec.js`, отклонение К12 записано в `docs/tasks.md`).

### 8.6. Таблицы, анкеты и иностранные реквизиты (WP11-E, вторая часть)

- **Метки таблицы:** у значения в начале ячейки лейблом служат и `rowHeader`, и `columnHeader` (до 40 символов) — телефон без «+7» под «Телефон» — PHONE.
- **PERSON в анкете:** под меткой строки «Фамилия», «Имя», «Отчество», «Surname», «First / Last / Given / Family name» вся ячейка — одно слово с заглавной; под «ФИО»,
  «Ф.И.О.», «Full name» — до трёх слов; PERSON `labeled` (`kb.js`).
- **TAXID:** метки «USt-IdNr.», «USt-ID», «UID», «Steuernummer», «TVA», «NIF», «NIPC», «P.IVA», «Partita IVA» (формат страны — `taxid`); кандидаты ищутся с перекрытием.
- **ADDRESS:** «наб. реки / р. / канала / кан. / ручья» — часть типа улицы; российский адрес латиницей «ul./pr./per./nab./sh./pl./ulitsa/prospekt + Name + N» с хвостом
  «office/apt./kv./bld./flat/room N», «NNNNNN City», «Russia» — `weak`.
- **Признаки адреса для LOC модели:** окно ±40 расширяется до границы слова; индекс после тире или «=» — не признак; «, N» — только если перед запятой не цифра;
  «дом / офис / квартира / строение / корпус» — только с номером.
- **Фильтр PER/LOC, дополнительные отказы:** одиночная роль стороны («Займодавца»), шаблонное слово для PER, PER в перечислении мест, прилагательное перед прилагательным со
  строчной, омоним перед «, котор…», PER одним словом в столбце «Город / City / Регион / Страна»; LOC → PER не применяется в этих же случаях и для улиц на «-ская/-ской».
- **Подписи и обращения:** подпись Telegram «Имя, [дата время]» / «Имя Ф., [дата время]» — PERSON; имя из подписи или обращения ищется и в косвенных падежах
  («через Арсения»), только не омонимы.
- **Не делается:** склейка ячеек широкой PDF-таблицы (8+ колонок, переносы, заголовок вне таблицы) — ограничение README, бэклог.

### 8.7. Новые категории и паспорт по частям (версия 0.5, WP12-C, `docs/concept-0.5.md` п. 5, К5, К6, К9)

Каталог — 50 встроенных категорий (было 21): 29 новых, у каждой `label`, `placeholderPrefix` ru/en и цвет, группы — по политике 0.4 (§8.1).
Строки каталога 0.5 — короткой записью `N(id, group, label, prefix, color, allowedLevels, normalize, validator, defaultOn)`; метки для детекторов —
регулярными основами `EXTRA_RX` в `detect/identifiers/labels.js` (падежи: «водительского удостоверения», «миграционной карты»); они участвуют в
`labelHits` наравне с литеральными метками каталога. Порядок каталога = приоритет FR-20: части паспорта и документы — сразу после PASSPORT, NICKNAME —
перед URL («t.me/ник» — ник, а не ссылка), IP и MAC — после URL (`http://10.0.0.5/admin` — ссылка целиком), EGRN_RECORD — перед CADASTRAL,
HEALTH и SPECIAL — перед PERSON (ревью WP12-C), коммерческие номера — между CONTRACT и AMOUNT.

| Группа | Категория (префикс ru / en) | Уровни | Без метки | Проверка |
|---|---|---|---|---|
| `pii` | PASSPORT_DEPT (ПАСП_КОД / PASSPORT_CODE), PASSPORT_ISSUER (ПАСП_ВЫДАН / PASSPORT_ISSUER), PASSPORT_DATE (ПАСП_ДАТА / PASSPORT_DATE) | `labeled` | нет | — |
| `pii` | INTL_PASSPORT (ЗАГРАН), DRIVER_LICENSE (ВУ), MILITARY_ID (ВОЕН_БИЛЕТ), RESIDENCE_PERMIT (ВНЖ: ВНЖ, РВП, разрешение на работу, патент), MIGRATION_CARD (МИГР_КАРТА), VEHICLE_DOC (СТС_ПТС: СТС, ПТС, ЭПТС из 15 цифр) | `labeled` | нет | формат серии и номера; загранпаспорт — `passport` |
| `pii` | OMS (ПОЛИС_ОМС / OMS_POLICY) | `labeled` | нет (16 цифр с алгоритмом Луна — это и карта) | контрольная цифра Mod10 ISO/HL7 27931 (= Луна), неверная — отказ и с меткой |
| `pii` | CIVIL_CERT (ЗАГС) | `validated`, `labeled` | серия «I-МЮ № 123456» (римская часть — `roman`; так же выглядит паспорт СССР); запись акта — по метке | `roman` |
| `pii` | VIN | `validated`, `labeled` | 17 знаков без I/O/Q с буквами и цифрами: проверочная цифра верна **или** буква в WMI и 4 цифры в конце | `vin` (дополнительный признак) |
| `pii` | PLATE (ГОСНОМЕР / PLATE) | `validated`, `labeled` | «А123ВС77[7] [RUS]» только кириллицей АВЕКМНОРСТУХ, не «000», не регион «00», не внутри кода («В123ОР77-X»); латинские двойники, прицеп, мотоцикл, такси — по метке | — |
| `pii` | IP, MAC | `validated`, `labeled` | IPv4 (октеты без ведущих нулей, хотя бы один из 2+ цифр, не после «версия / п. / ст. / ГОСТ / ОКПД»), IPv6; MAC через «:», через «-» и Cisco — с hex-буквой | `ipv4`, `ipv6` |
| `pii` | NICKNAME (НИК / HANDLE) | `validated`, `labeled` | ссылка на профиль `t.me/`, `vk.com/`, `instagram.com/`…; `@ник` — по метке («Telegram:», «ТГ», «ник») или при названии мессенджера в строке (60 символов до, 40 после); не e-mail (перед «@» нет имени), не домен | — |
| `pii` | HEALTH (ЗДОРОВЬЕ), SPECIAL (ОСОБЫЕ_ПДН / SPECIAL_PD) | `labeled` | **нет** — только метка («Диагноз:», «Код МКБ-10», «Вероисповедание:», «Судимость:»…) с разделителем «:», «—» или табуляцией, либо ячейка под меткой строки/столбца; диагноз — ещё и сразу код МКБ-10; SPECIAL — только метка поля (начало строки, после «,», «;», «:»); значение — до конца фразы, строки или следующей такой метки | — |
| `ids` | EGRN_RECORD (ЕГРН), CADASTRAL (КАДАСТР) | `validated`, `labeled` | «77:01:0001001:1234» и «…-77/011/2026-1»; кадастровый квартал и старый номер записи — по метке | формат |
| `ids` | ENFORCEMENT (ИСП_ПРОИЗВ) | `validated`, `labeled` | «12345/26/77001-ИП» (и «-СД»); исполнительный лист — по метке | формат |
| `ids` | COURT_CASE (ДЕЛО / CASE) | `validated`, `labeled` | арбитраж «А40-12345/2026» и УИД «77RS0001-02-2026-001234-56»; «2-1545/2026», «02-…», «33-…», «2а-…», КУСП, уголовное дело — по метке | формат |
| `ids` | POA (ДОВЕРЕННОСТЬ), NOTARY_REG (НОТ_РЕЕСТР) | `labeled` | нет | — |
| `commercial` | TENDER (ЗАКУПКА), ORDER_NO (ЗАКАЗ), INVOICE_NO (НОМ_СЧЕТА), CLIENT_NO (КЛИЕНТ), IP_REG (РИД) | `labeled` | нет; `defaultOn: true` — ищутся при включённой группе | номер из 20 цифр — не INVOICE_NO (это ACCOUNT) |

**Два способа поиска** (`papers.js`):
- «формат → метка» (`detector(id, fmts)`): значение по регулярке, затем `labelHits` (окно 40 символов, у документов — 64; метка строки и заголовок
  столбца таблицы — как в §8.5, §8.6); без метки — только `bare`-форматы (уровень `validated`) и только если перед значением нет «чужой» строгой метки
  (`foreignHit`); `hard: true` (ЗАГС, кадастр, ЕГРН, производство, дело, MAC, ссылка на профиль) — чужая метка не мешает («серия VII-МЮ № 334455»);
- «метка → значение» (`tokens(id)`, `freeText(id)`): метка в тексте, до трёх слов перед «№» («Счёт на оплату № 245», «доверенность от 01.02.2026 № 15»),
  затем один код с цифрой (не дата); нужен «№ / # / No / :», если в самой метке нет слова-номера («номер заказа», «код клиента», «ИКЗ»); особые форматы
  с пробелами — `fmt` («77 АА 1234567», «RU 2765432 C1»); ячейка, которая сама начинается с метки, — заголовок, не значение («Диагноз | Код МКБ-10»).

**Какой документ** (`docContext`): номера документов похожи («серия 77 12 № 345678»), поэтому метка документа засчитывается, только если ближайшее к
номеру название документа (в окне 60 символов строки, затем в метке ячейки; при равном конце — более длинное: «паспорт транспортного средства»,
«заграничный паспорт») — этот документ. Так работает и PASSPORT: «серия» после «водительское удостоверение» — не паспорт. `docSeriesTail`: число после
серии документа («патент на работу 77 № 1900012346») — не ИНН, даже если сходится контрольная сумма (`detectInn` без своей метки).

**«Чужие» метки** (`labelState().foreign`, `foreignHit`): метки документов, VIN, госномера, кадастра, судов и нотариата делают число «чужим» для
прежних детекторов (полис ОМС с Луном — не карта, СТС «9901123456» — не ИНН). Метки PASSPORT_ISSUER, PASSPORT_DATE, NICKNAME, IP, MAC, HEALTH, SPECIAL и
коммерческих номеров — нет (`NOT_FOREIGN`): «с расчётного счёта 4070…» и «TG: +7 …» не теряют счёт и телефон. Телефон не начинается сразу после
«буква/» («…-н/78-2026-3-1001» — реестровый номер нотариуса).

**Доработки по ревью WP12-C** (принцип второго ревью: лишнее маскирование дешевле утечки; исключение по контексту — только когда стоп-слово стоит
непосредственно перед значением):
- HEALTH/SPECIAL: значение обрезается по началу метки любой категории (`labelStarts`; «Аллергия:», «Анамнез:», «сопутствующий:» — тоже метки здоровья),
  по строке, табуляции, черте подписи «______», полю бланка не о здоровье («Врач:», «Лечащий врач:», «Подпись:», «Дата:», «Пациент:», «Гражданство:»…)
  и по первой находке другой категории внутри (`innerStarts`: детекторы реестра, кроме HEALTH/SPECIAL, уровни `validated`/`labeled`,
  только для потоков с меткой здоровья) — длинный `labeled`-кандидат больше не проигрывает ИНН или телефону целиком; на случай находки документного детектора
  внутри (ФИО правил) рядом с целым выдаются запасные части — через запятую и слова: без конфликта целое сильнее и они отпадают (FR-20). HEALTH и SPECIAL
  стоят в каталоге перед PERSON. Медицинские подполя («основное заболевание:», «Стадия:»), «;» и точки («II ст. Риск 4. ХСН IIА») значение не
  обрывают. «Диагноз основной», «Диагноз сопутствующий» — метки; пояснение в скобках после метки («Вероисповедание (при желании):») пропускается.
  «МКБ-10», «Код МКБ» — только код МКБ в начале значения; SPECIAL — метка с заглавной или после «, ; : …»; не поле — метка в кавычках («В графе
  «Национальность:» …») и метка перед обычной фразой («Инвалидность — это не приговор», «Национальности: все равны…»).
- NICKNAME: ссылка на профиль — целиком с путём, `?` и `#`, хвостовая пунктуация — `trimUrl` (`contact.js`); публикации, видео, поиск
  (`watch`, `wall…`, `video…`, `p`, `reel`…) и YouTube без «@» — не ник, их берёт URL.
- Дефис номеров `DASH` = `-`, U+2010–U+2013 и мягкий перенос: дела, УИД, исполнительные производства, ЕГРН, ЗАГС, код подразделения, токен кода.
- IP без метки не берётся, только если непосредственно перед числом (допустимы «:», «№», тире) стоит слово версии, пункта («п.», «пункт»), раздела,
  главы, статьи, таблицы, рисунка, приложения, ГОСТ/ОКПД/ОКВЭД/КБК, браузера или маски подсети, либо заголовок столбца — коды и версии («Код ОКПД2»);
  «по адресу 192.168.10.25», «Сервер Windows 192.168.1.20», «Табл. доступа: 95.31.18.119» — IP. Ведущие нули — только по метке. VIN без метки — проверочная
  цифра или WMI из списка, не сразу после «арт.», «S/N», «серийный номер», «зав.», «партия»; по метке — кириллические двойники, строчные, пробелы и дефисы
  между группами. Госномер по метке — и строчными. Арбитражное дело без метки — год из четырёх цифр и без продолжения «-ПД»; по метке номер дела —
  формат дела (`COURT_NO`, номер после дефиса — от двух цифр) или не меньше четырёх цифр подряд (КУСП, уголовное дело): «в деле № 5–7 листов» — не номер.
- Третье ревью (сравнение покрытия с 0.4 и 2d862d6 по символам): «чужие» метки (`foreignHit(hits, own, value)`) — метки документов 0.5
  делают значение чужим для ИНН, СНИЛС, ОГРН, телефона, карты, только если оно похоже на номер этого документа (`DOC_SHAPE` в `labels.js`); метки
  госномера, VIN, кадастра, дела, доверенности, ЗАГС и прочих категорий 0.5 — никогда: «полис ОМС +7 (495) 123-45-67», «Кадастровый номер 7707083893»,
  «Доверенность 112-233-445 95» — телефон, ИНН, СНИЛС, как в 0.4. Значение здоровья/особой категории режут метки других категорий, а своя — только с
  «:» или тире после неё (новое поле; «…, аллергия на пенициллин», «…, инвалидность III группы» — продолжение); `аллерги(я|и|ю|ей)` — целым словом,
  метки «Диагноз при поступлении», «Основное/Хронические заболевания», «Группа крови». Позиция метки (`catsAt`) — только целым словом («гр» в «группа»
  не «г.р.»). VIN по метке «кузов №», «номер кузова», «шасси (рама) №», расширен список WMI. Орган и дата выдачи — общие для паспорта и загранпаспорта
  («загранпаспорт 75 1234567 выдан МВД 0001»); «кем выдан г. Москва, ул. …» — адрес, орган не выделяется. Номер неверного формата после метки паспорта —
  паспорт («паспорт 4506 12345», как в 0.4). Постоянная проверка — `tests/integration/coverage-grid.spec.js` + `scripts/coverage-grid.mjs`: корпус ревью
  (`tests/fixtures/coverage/corpus.json`, 2 227 элементов, обычный и коммерческий режим) и сетка «метка × значение × разделитель» (3 525 строк) против
  снимка покрытия 0.4 и 2d862d6 (`prev-*.json`); отрезок «раньше закрыто → открыто» допустим только из `whitelist.json` (ложные срабатывания прежних
  версий с причиной), лишняя запись белого списка — тоже ошибка.
- Запасной путь документов (`fb` в `detector()`): номер сразу после метки документа, не прошедший его формат, — этот документ уровня `labeled`
  («загранпаспорт 71 12345678»); у ОМС — только номер не из 16 цифр (16 цифр с неверной контрольной — не полис, К5). Без него метка документа делала
  номер «чужим» для ИНН/ОГРН, и он оставался открытым (регрессия к 0.4).
- Строка таблицы по положению заголовком не считается (второе ревью: «Паспорт | 4506 123456 | Дата рождения | …» в первой строке — данные);
  ячейка, которая сама начинается с метки («Госномер» рядом с «Диагноз»), — название столбца, а не значение.
- PASSPORT_DATE по метке «Дата выдачи» в тексте — только если ближе всех назван паспорт; в ячейке под меткой строки — если не назван другой документ.
  День в кавычках («“12” марта 2006») — дата, а не орган выдачи; дата перед органом — вместе с «г.» («выдан 12.03.2006 г. ОВД …»).
- Скорость: окна меток не ищут начало строки по всему потоку, позиции меток — двоичным поиском, занятые отрезки — `intervals()`, разрешение пересечений
  (`detect/overlap.js`) — двоичный поиск по оставленным вместо перебора (поведение то же); абзац 151 тыс. знаков — как в 0.4 (`perf-labels.spec.js`).

**Паспорт по частям** (К6, `docs.js` `passportParts`): одна функция на поток (кэш последнего потока) находит серию и номер (метка PASSPORT и
`docContext` — паспорт или ничего), орган выдачи после «выдан / кем выдан» за номером и по метке «Кем выдан» / «Орган, выдавший документ» (до даты,
«код подразделения», «дата выдачи» или запятой), дату выдачи (в строке органа — после него или перед ним: «выдан 03.04.2015 ГУ МВД…»; по строгой
метке «Дата выдачи», если ближе не назван другой документ), код подразделения «NNN-NNN» по метке. Четыре категории — четыре группы, четыре метки
(`[ПАСПОРТ_1]`, `[ПАСП_ВЫДАН_1]`, `[ПАСП_ДАТА_1]`, `[ПАСП_КОД_1]`) и четыре записи карты без `variants`; `core/mapping.js` и `core/deanon.js` не менялись:
каждое место восстанавливается своим значением, `mixedValueWarnings` у новых карт пуст (`tests/unit/passport-parts.spec.js`). До 0.5 части были
вхождениями PASSPORT через `canonical`; загранпаспорт был PASSPORT под меткой «загранпаспорт», теперь — INTL_PASSPORT.

**Настройки** (§3): схема 4, миграция 3 → 4 дописывает в категории настроек и профилей только категории 0.5 (`CATEGORIES_05`), ключи 0.4 частичного профиля не трогает; экспорт/импорт конфигурации переносит новые ключи `categories`,
файл схемы 3 при импорте дополняется миграцией. Страница настроек, панель и предпросмотр строят списки из каталога (`buildCatalog`, `CATEGORY_GROUPS`) —
изменены только подсказки групп и справка (`ui/i18n/{options,help}.js`).

**Фикстуры и корпус:** `tests/fixtures/categories/<ID>.json` для каждой новой категории (10–11 позитивов, 10 негативов: даты, коды товаров, пункты,
телефоны, похожие форматы); точное совпадение — `tests/unit/identifiers/categories.spec.js`, порог К5 и уровни — `tests/unit/detectors-0.5.spec.js`
(фикстуры — в `fixtures/categories/`, как у прежних категорий, а не в `fixtures/detectors/` из текста К5); пересечения — 8 случаев `overlap.json`
(`identifiers: true`). Корпус жанров 0.5 (`scripts/gen-genre-fixtures-05.mjs`, вызывается из `gen-genre-fixtures.mjs`): `form`, `court`, `realty`,
`vehicle`, `medical` × 3 документа, DOCX + PDF; отрицательные примеры для правил помечены `rules: true` — их не размечают стабы модели в
`genres.spec.js`; гейты К6/К7 пакета 1.1.0 — на жанрах 0.4, жанры 0.5 с моделью печатаются (их гейты — у модели 1.2.0, WP12-E). Номера счетов и
заказов в документах 0.4 стали gold коммерческих категорий (DOCX не изменились).

---

## 9. Общий слой OOXML и адаптеры форматов (версия 0.5, WP12-A, `docs/concept-0.5.md` п. 1)

```
bytes, name ──► host: isPdf / .pdf ? ──да──► env.extractPdf → fromText (kind 'text', §7)
                         └─нет──► detectAdapter(bytes, name) ?? Word ──► adapter.parse(bytes) ──► DocModel {kind, entries, parts, streams, …}
DocModel ──► analyze() ──► planEdits() ──► adapterForKind(doc.kind).serialize(doc, edits, {keepMetadata, stripEmbedded}) ──► bytes того же формата
```

Ядро (детекторы, `analyze`, `planEdits`, маппинг) формата не знает: оно работает с потоками `DocModel` (§1.1). Формат знает адаптер. Word — первый адаптер
поверх общего слоя `src/core/ooxml/`; Excel и PowerPoint (WP12-B) подключаются своим описанием частей и разметки, без копирования ZIP, токенизатора, charMap и
замены через раны. Поведение DOCX не изменилось: `tests/integration/docx-regression.spec.js` сверяет sha256 результата со снимком, снятым до переноса (§9.6).

### 9.1. `DocumentAdapter` (`ooxml/adapter.js`, реестр — `core/adapters.js`)

| Поле | Что | Word (`docx/adapter.js`) |
|---|---|---|
| `kind` | вид документа = `doc.kind` = поле `kind` сессии и `ENTITIES` | `'docx'` |
| `extensions` | расширения имени в нижнем регистре | `['.docx', '.docm']` |
| `mime` | MIME результата (`applyDecisions` → `mime`) | `DOCX_MIME` |
| `detect(bytes, name?) → boolean` | сигнатура и содержимое (ZIP с главной частью) или имя | `zipHasEntry(bytes, 'word/document.xml') \|\| hasExtension(name, …)` |
| `parse(bytes) → DocModel` | модель; ошибки — `CoreError` | `parseDocx` (`NOT_DOCX`/`ENCRYPTED`/`PARSE_FAILED`) |
| `serialize(doc, edits, opts?) → {bytes, changedParts, removedParts}` | результат того же формата; правки — `TextEdit[]` из `planEdits` (решения пользователя уже учтены); модель не мутируется | `serializeDocx` |
| `parts(names) → string[]` | части пакета с текстом в порядке обхода FR-25 | `docxParts` (`partRank` + естественный порядок) |

Реестр: `DOCUMENT_ADAPTERS` (порядок = приоритет распознавания), `adapterForKind(kind)` (модель без `kind` — Word; неизвестный — `null`, `applyDecisions` → `INTERNAL`),
`detectAdapter(bytes, name)` — первый адаптер, чей `detect` истинен, иначе `null`. Хост (`onAnalyze`): PDF — как в 0.3; иначе `detectAdapter(...) || Word`
(нераспознанный файл получает прежнюю ошибку Word `NOT_DOCX`). **С WP12-B** — см. §9.8: форматы по требованию, `detectAdapter` в два прохода (сначала
содержимое, потом имя), нераспознанный файл с именем — `NOT_SUPPORTED`. Помощники: `isZip(bytes)`, `zipHasEntry(bytes, name)` (только центральный каталог; не ZIP,
битый, зашифрованный — `false`), `hasExtension(name, exts)`. PDF — не адаптер: извлечение асинхронное и требует pdf.js из окружения (§7).

### 9.2. Каркас пакета (`ooxml/model.js`)

`parsePackage(bytes, desc) → DocModel`: `readZip` → нет `desc.mainPart` → `CoreError(desc.notFound.code, desc.notFound.message)` → для каждой части из
`desc.parts(names)` (в этом порядке) `desc.parsePart(name, readXmlEntry(entry), ctx)` → потоки каждой части по позиции → общий порядок `order` (FR-25) →
`warnings: desc.warnings?.(entries) ?? []` → `language: detectLanguage(streams, desc.languageStream ?? live-потоки главной части)`. `ctx = {pidCounter, attrCounter,
paragraphs}` — сквозные счётчики `p<N>`/`a<N>` на весь документ. Типы `Segment`, `Stream`, `Paragraph`, `Part` (+ `markup` у текстовой части), `DocModel` (+ `kind`) —
здесь; `docx/model.js` реэкспортирует их как прежде. Ещё: `readXmlEntry(entry)` (UTF-8, BOM снимается, сбой — `PARSE_FAILED`), `sortParts(names, rank)`,
`addAttrStream(part, ctx, {raw, valueStart, valueEnd}, attrKind, xpath, type = 'attr')`, `detectLanguage(streams, pick?)`.

`PackageDescription = {kind, mainPart, notFound: {code, message}, parts(names), parsePart(name, xml, ctx), warnings?(entries), languageStream?(stream)}`.

### 9.3. Потоки по описанию разметки (`ooxml/flow.js`)

`parseFlowPart(name, xml, ctx, markup, hooks?) → Part` — параграфы (с вложенностью `depth`), потоки `live`/`deleted`/`field` с сегментами и charMap
(`buildCharMap(segments, length)`), раны со встроенными объектами (`embeddedRuns`). `hooks.onElement(token, parent, para, part)` вызывается для каждого
открывающего и самозакрывающегося тега до разметки потоков — так адаптер добавляет атрибутные потоки (авторы, alt) и вид абзаца. `planRunEdits(xml, stream, edits,
markup, push)` — замена через раны (§6.3 п.2–4): новый текст — в первый затронутый элемент текста, остальной затронутый текст удаляется, спецэлементы в диапазоне
удаляются, контейнер — `INTERNAL`, диапазон из одних спецэлементов → `markup.specialReplacement(escaped)`. `planValueEdits(stream, edits, push)` — значение атрибута
или метаданных целиком. `OBJ` = U+FFFC.

`FlowMarkup` — описание разметки (значения Word — `WORDML` в `docx/model.js`; SpreadsheetML и DrawingML — образцы в `tests/unit/ooxml/markups.js`):

| Поле | Word | SpreadsheetML (образец) | DrawingML (образец) |
|---|---|---|---|
| `paragraph` / `paragraphs` | `w:p` / {`w:p`} | `si` / {`si`, `is`} | `a:p` / {`a:p`} |
| `run` | `w:r` | `r` | `a:r` |
| `text` (элемент → тип потока) | `w:t` live, `w:delText` deleted, `w:instrText`/`w:delInstrText` field | `t` live | `a:t` live |
| `textParents` | {`w:r`} | {`r`, `si`, `is`} (не `rPh` — фонетика) | {`a:r`, `a:fld`} |
| `specials` / `openSpecials` | `w:tab`, `w:ptab` → `\t`; `w:br`, `w:cr` → `\n`; `w:sym`, ссылки на сноски/комментарии → U+FFFC; `w:noBreakHyphen` → U+2011 / нет | — | `a:br` → `\n`, `a:tab` → `\t` / **да** (`<a:br><a:rPr/></a:br>`) |
| `soft` | {`w:softHyphen`} (0 символов) | — | — |
| `containers` | {`w:drawing`, `w:pict`, `w:object`, `mc:AlternateContent`} | — | по формату |
| `specialParents` | {`w:r`} | {`r`} | {`a:p`, `a:r`} (`a:br` — между ранами) |
| `deleted` | {`w:del`, `w:moveFrom`} | — | — |
| `embeddedOpen` / `embeddedSelf` | {`w:object`, `c:chart`} / {`c:chart`} | — | по формату |
| `preserveSpace` | да | да | **нет** (у `a:t` нет `xml:space`) |
| `specialReplacement` | `<w:t xml:space="preserve">…</w:t>` | `<t xml:space="preserve">…</t>` | `<a:r><a:t>…</a:t></a:r>` |

### 9.4. Пакет OPC и сборка (`ooxml/opc.js`, `ooxml/serialize.js`)

`opc.js`: `parseRelsPart` (внешние ссылки `TargetMode="External"` → `attr`/`rel-target`, FR-13), `parseMetaPart` (docProps core/app → `meta`, FR-12),
`META_PART_RE`, `META_REMOVED_RE` (`docProps/custom.xml`, `docProps/thumbnail.*`), `cleanupReferences(doc, removed, newXml)` (Override в `[Content_Types].xml`, связи
во всех `*.rels`), `relsBaseDir`, `resolveTarget`, `removeElements`. `serialize.js`: `serializePackage(doc, edits, {keepMetadata, stripEmbedded}, {embeddedParts})`
— правки по потокам (проверки `INTERNAL`: неизвестный поток, диапазон, пересечения), через раны по `part.markup` или значением, очистка метаданных, удаление
частей `embeddedParts` и ранов `embeddedRuns`, ZIP в исходном порядке с байт-копией нетронутых записей (FR-40). `TextEdit`, `SerializeOptions` — здесь.

### 9.5. Word (`src/core/docx/`)

Остались только знания о Word: `WORDML`; `TEXT_PART_RE`, `PEOPLE_PART_RE`, `RELS_PART_RE` (только `word/_rels`), `EMBEDDED_PART_RE` (`word/embeddings|charts`);
`partRank`, `docxParts`; хук текстовой части — авторы/инициалы (`w:author`, `w:initials`, связь по элементу), alt-тексты (`wp:docPr`, `pic:cNvPr`, `v:shape`),
`w:fldSimple/@w:instr`, вид абзаца по `w:pPr` (К10 0.4); `people.xml` (FR-11); предупреждение `EMBEDDED_NOT_PROCESSED`. `docx/zip.js`, `docx/xml.js` — реэкспорт
`ooxml/` для прежних импортов (тесты, скрипты); `docx/replace.js` реэкспортирует `relsBaseDir`, `resolveTarget`.

### 9.6. Регрессия и тесты

- `tests/integration/docx-regression.spec.js` + снимок `tests/fixtures/docx-regression.json` (снят на коммите fc9a46b до переноса): все `tests/fixtures/**/*.docx` (41)
  и образец `make-sample.mjs` — sha256 результата `normal` (настройки по умолчанию, метки), `commercial`, `strip` (маска, `keepMetadata: false`, `stripEmbedded: true`)
  и `restore` (`restoreDocx` результата `commercial`). Переснять — только при намеренном изменении DOCX: `UPDATE_DOCX_REGRESSION=1 npx vitest run tests/integration/docx-regression.spec.js`.
- `tests/unit/ooxml/flow.spec.js` — токенизатор и потоки на SpreadsheetML/DrawingML/выдуманной разметке, charMap, замена через раны; `package.spec.js` — каркас и сборка
  выдуманного формата «demo»; `adapter.spec.js` — интерфейс Word, реестр, `applyDecisions` по `doc.kind`.

### 9.7. Что нужно WP12-B (предложения по итогам WP12-A)

- **Бюджет.** Запас кода `worker.js` ≈ 8,1 КиБ — адаптеры Excel и PowerPoint в него не поместятся. Предложение: адаптер формата — модуль по требованию, как разбор PDF
  (§5 п. 17): в реестре лёгкая запись `{kind, extensions, mime, detect, load: () => import('./xlsx/adapter.js')}`; хост после распознавания делает
  `await load()` (он и так асинхронный), а синхронный `applyDecisions` берёт уже загруженный адаптер (реестр запоминает результат `load`). Тогда `worker.js`
  растёт только на `detect` и запись реестра, а код формата живёт в `offscreen/chunks/` со своим бюджетом. В Node-тестах `load` — тот же динамический импорт. Запасной вариант — `minifyWhitespace` для `worker.js` (замер на коде 0.4: код без ORT 431 580 → 335 754 байт), но тогда
  `pack.spec.js` должен считать ORT по metafile, а не по комментариям секций.
- **Распознавание:** Excel — ZIP с `xl/workbook.xml`, `.xlsx`/`.xlsm`; PowerPoint — `ppt/presentation.xml`, `.pptx`/`.pptm`. `readZip` отвечает `NOT_DOCX` на не-ZIP —
  адаптеру нужен свой код ошибки (протокол §5.4, тексты панели) или общий `NOT_SUPPORTED`.
- **Excel:** `sharedStrings.xml` — `parseFlowPart` с разметкой `si`/`r`/`t` (`textParents` без `rPh`); inline-строки `<c t="inlineStr"><is>` — те же правила в частях
  листов; числа `<v>` (ИНН, счёт числом) и имена листов (`<sheet name>`), колонтитулы `<oddHeader>` (текст с кодами `&P`) — не раны: свои потоки через `addAttrStream`
  или новый тип; замена числа строкой меняет ячейку (`t="s"`/`inlineStr`) — правка вне `planRunEdits`, своя функция сериализации части. Порядок частей — `parts(names)`.
- **PowerPoint:** `slides/slideN.xml`, `notesSlides/`, комментарии; разметка DrawingML — образец `DML` (`openSpecials: true`, `specialParents: {a:p, a:r}`,
  `preserveSpace: false`, `specialReplacement` с раном). Таблицы и группы — тот же `a:p` внутри `a:tc`/`p:grpSp`, отдельной логики не нужно.
- **Вне ядра, но затронуто:** `content/files.js` (`fileKind`, `isSupported`, `makeResultName`, `resultType`), `host.makeResultName`, `restore-doc.js` (восстановление
  файла через адаптер: `parse` + `serialize` вместо `parseDocx`/`serializeDocx`), `ENTITIES.kind` и схема протокола (`docx|pdf` → + `xlsx|pptx`).
- **Скрытые данные (WP12-D):** счётчики комментариев, правок, скрытого текста — хуками `onElement` при разборе (`ooxml/hidden.js`), без второго прохода.

### 9.8. Excel, PowerPoint и текстовые форматы (версия 0.5, WP12-B, `docs/concept-0.5.md` п. 2–4, К1–К4, К13, К14)

```
bytes, name ──► detectAdapter: проход 1 — только содержимое (ZIP с word/document.xml | xl/workbook.xml | ppt/presentation.xml), проход 2 — имя
            ──► Word: сразу │ xlsx/pptx/plain: await loadAdapter(entry) — import('./xlsx/xlsx-adapter.js') → offscreen/chunks/xlsx-adapter-*.js
            ──► adapter.parse(bytes, name) → DocModel {kind, blocks (таблицы), viewParts, …} ──► analyze ──► adapter.analysisWarnings(doc, groups)
            ──► applyDecisions → adapterForKind(doc.kind).serialize (уже загружен) → {bytes, mime}
```

**Модули по требованию и реестр** (`core/adapters.js`). Word — в коде воркера; Excel, PowerPoint и текстовые форматы — лёгкие записи `LazyAdapterEntry
{kind, extensions, mime, detect, load: () => import(...)}`: в `worker.js` попадают только они и `detect` (через `zipHasEntry`/`hasExtension`), код формата —
`offscreen/chunks/{xlsx,pptx,plain}-adapter-*.js` и общий `chunk-*.js` (`ooxml/dml.js`, `table-blocks.js`); сборка печатает каждый модуль по требованию
(`scripts/build.mjs`), `pack.spec.js` проверяет, что их нет в коде воркера, и бюджет модулей форматов (≤ 120 КиБ вместе). `loadAdapter(entryOrKind)` —
полный адаптер (Word — сразу; формат — после загрузки, результат кэшируется, сбой — нет: следующий файл пробует снова). Модуль формата при загрузке сам
вызывает `registerAdapter(adapter)` — так `adapterForKind` находит его и при прямом импорте (тесты, скрипты). Синхронный `applyDecisions` берёт уже
загруженный адаптер; не загружен — `INTERNAL`. В IIFE-бандле страницы восстановления esbuild встраивает те же модули (динамический `import()` без
разделения кода) — страница работает без сети и без чанков.

**Хост** (`offscreen/host.js`): `entry = detectAdapter(bytes, name) || (name ? null : Word)`; нет — `CoreError('NOT_SUPPORTED')`; модуль формата —
`env.loadAdapter || loadAdapter`, сбой → `CoreError('FORMAT_LOAD_FAILED')` (панель: текст `err.FORMAT_LOAD_FAILED`, кнопка «Повторить»); `adapter.parse(bytes, name)`;
после `analyze` (и `ADD_ENTITY`) — `adapter.analysisWarnings?.(doc, groups)` в `warnings`. Имя результата — тот же формат (`makeResultName`: `реестр.xlsx` →
`реестр.anon.xlsx`, без известного расширения — `.docx`, книга/презентация без расширения — `.xlsx`/`.pptx`). DOCX: битый `.docx` — по-прежнему `NOT_DOCX`.

**Интерфейс** (дополнения к §9.1): `parse(bytes, name?)` (имя нужно текстовым форматам); `serialize(...)` может вернуть `mime` (книга с макросами, CSV, JSON) —
`applyDecisions` берёт `out.mime || adapter.mime`; необязательный `analysisWarnings(doc, groups) → {code, count}[]`. Общий сериализатор: необязательный
`PackageSerializeDescription.plan(doc, byStream, pushRaw)` — правки, которые строит адаптер (удаляет свои потоки из `byStream`, кладёт правки диапазонов XML).

| Вид | Части (порядок обхода FR-25) | Потоки |
|---|---|---|
| `xlsx` | `sharedStrings` → листы → примечания → цепочки комментариев → `persons` → надписи `drawings` → диаграммы → `workbook` → кэш сводных → `*.rels` → `docProps` | общие и inline-строки (`SML`: `si`/`is`, ран `r`, текст `t`, без `rPh`); `attr`: `cell-number` (число-идентификатор `<v>` из 6–15 цифр, со своим абзацем и `pid`), `cell-cache` (кэш строковой формулы `t="str"`, кэш диаграммы `<c:v>` в `c:strCache`, `<s v>` сводной), `formula-literal` (строковый литерал формулы длиннее двух символов — только поиск), `header-footer` (куски колонтитула между кодами `&L &C &R &P &N &D &T &F &A &"шрифт" &12 &K…`), `sheet-name`, `alt` (ссылка `display`/`tooltip`, alt надписи), `author` (примечание; не `tc={…}`), `author`/`author-id` (`persons`: `displayName`, `userId`), `fileSharing/@userName` |
| `pptx` | слайды → заметки → комментарии (обычные и `modernComment_*`) → `commentAuthors`/`authors` → SmartArt (`diagrams/data*`, `drawing*`) → диаграммы → макеты и образцы → `*.rels` → `docProps` | DrawingML `DML` (`a:p`/`a:r`/`a:t`, поле `a:fld`, разрыв `a:br` между ранами, без `xml:space`); обычный комментарий — `<p:text>` в `<p:cm>` (свой `FlowMarkup`); `alt` — `cNvPr/@descr`, `@title`, у рисунка и `@name`; авторы — `author`, `initials`, `author-id` (связь по элементу, FR-11) |
| `plain` (`.txt` `.log` `.md` `.csv` `.json`) | одна «часть» `word/document.xml` (как текстовая модель PDF) | строка файла (txt/log/md), ячейка CSV, строковое значение JSON; число JSON под ключом-идентификатором — `attr`/`json-number` |

**Excel — правки** (`xlsx-adapter.js` `plan`): число-идентификатор → `<c … t="inlineStr"><is><t>метка</t></is></c>` (у ячейки с формулой — `t="str"` и кэш `<v>`),
прочие атрибуты (`s` — стиль) не меняются; имя листа → `safeSheetName` (без `[ ] : * ? / \`, ≤ 31 символа, не пустое, без повтора — « (2)»), ссылки на лист
во всех формулах (`<f>`, `definedName`, `<c:f>` диаграмм, `formula`/`formula1`/`formula2`/`xm:f`), ссылке `hyperlink/@location` и `worksheetSource/@sheet`
переименовываются согласованно (`refs.js renameSheets`: имя всегда в апострофах, литералы и другие книги `[1]Лист!` — нет); литерал формулы не меняется;
колонтитул — «&» нового текста удваивается; после правки ячеек или имени листа — `calcPr fullCalcOnLoad="1"` (Excel и LibreOffice с пересчётом при
открытии получают значения формул от новых ячеек). Встроенные объекты (`xl/embeddings`, `xl/media`) — предупреждение `EMBEDDED_NOT_PROCESSED`
без разобранных книг Excel (см. «Доработка по ревью» ниже: книги обезличиваются, книги диаграмм удаляются при `stripEmbedded`). Предупреждения `analysisWarnings`: `XLSX_CELL_REFERENCED {count}` —
число с сущностью в ячейке, на которую ссылаются формулы или диаграммы (граф ссылок `refs.js`: A1-ссылки вне литералов, столбцы и строки целиком,
общая формула — прямоугольником на весь диапазон, имена книги — если имя встречается в формулах; грубо), `XLSX_FORMULA_LITERAL {count}`, `XLSX_SHEET_RENAMED {count}`.

**Таблицы для заголовков** (`table-blocks.js`, `detect/tables.js` без правок): лист Excel, таблица слайда, CSV → `doc.blocks[] {pid, kind: 'cell', text, table: {index, row, col}}`.
Шапка — первая строка (из первых 10) с ≥ 3 ячейками без цифр (CSV — первая строка с ≥ 2): её ячейки получают служебные `pid` `h<N>` без потока
(иначе «Телефон» справа от «ФИО» получил бы «метку слева» и стал ФИО по правилу анкеты), строки над шапкой (заголовок листа «Реестр … 2026») — своя
таблица `title<N>` (без «:» — `tables.js` делит ключ по нему). Объединённая ячейка шапки повторяется над каждым столбцом диапазона; общая строка Excel
в данных — по первому вхождению. JSON: пара «ключ | значение» — строка своей таблицы, ключ (латинский — переведённый `keyLabel`: `inn` → «ИНН»,
`phone` → «Телефон»…) — метка строки.

**Текстовые форматы**: кодировка — BOM UTF-8/UTF-16, иначе строгий UTF-8, иначе Windows-1251 (таблица записи — из декодера платформы); результат —
та же кодировка и BOM. CSV — разделитель `;`/`,`/табуляция по первым 20 записям (одинаковое число в ≥ 80 % записей), кавычки RFC 4180; изменённая ячейка
в кавычках, если была в кавычках или в ней разделитель, кавычка, перевод строки. JSON — свой разбор со смещениями (`scanJson`), меняются только строки
(`JSON.stringify` значения) и числа-идентификаторы под ключом из `keyLabel` (`JSON_NUMBER_AS_STRING {count}`); битый JSON — по строкам, `JSON_INVALID`.
`.txt/.log/.md` — правки по смещениям строк, остальное символ в символ.

**Восстановление** (`restore-doc.js`): `restoreDocument(bytes, mapping, {adapter, name?, decline?})` — те же строгие правила, что `restoreDocx` (§1.6;
`restoreDocx` = общая часть + `serializeDocx`, байты DOCX не изменились — снимок регрессии); литералы формул пропускаются; лист, переименованный при
анонимизации, получает значение метки (ссылки — тоже). Страница восстановления: `aiFileKind` → `docx | xlsx | pptx | csv | json | text`; xlsx/pptx/csv/json —
`restoreDocument` с адаптером (`loadAdapter`), `.md/.txt/.log` — как текст (`restoreText`, как в 0.3).

**Перехват и интерфейс**: `content/files.js` — `fileKind` → `docx | pdf | xlsx | pptx | text | null` (по расширению; Excel/PowerPoint — и по MIME без
расширения), изображения и сканы не перехватываются (OCR — 0.6; текст `err.PDF_NO_TEXT` — «распознавание сканов — в следующей версии»);
`makeResultName`/`mappingFileName`/`resultType` — тот же формат, MIME исходника или от хоста; панель — тексты предупреждений `WARN_KEYS` (`DICT_FAILED`,
`XLSX_*`, `JSON_*`), прочие коды — `warnGeneric`. Вкладка «Текст»: без `part` — `doc.viewParts` (Excel: общие строки и листы; PowerPoint: слайды и заметки).

**Фикстуры и тесты**: `tests/fixtures/office/` (6 книг, 4 презентации, 3 CSV, 1 JSON + gold), жанры корпуса (`eval-genres.mjs`: `CORPUS_FORMATS`, `loadDoc`
через адаптер); `tests/integration/{xlsx,pptx,host-formats}.spec.js`, `tests/unit/{text-formats,restore-ooxml,xlsx-refs}.spec.js`, e2e `formats.spec.js`
и `nfr.spec.js` (модули форматов — только `chrome-extension://`, один раз). LibreOffice (локально, `SKIP_LIBREOFFICE`): книги и презентации открываются
без восстановления; книги — с пересчётом формул при открытии (`OOXMLRecalcMode = 0` в профиле теста) без `#REF!`.

**Доработка по ревью WP12-B** (файлы openpyxl, pandas, python-pptx, LibreOffice; принцип — лишнее маскирование дешевле утечки):
- **Части — по связям пакета** (`ooxml/dml.js readRelations`: все `*.rels`, тип — последнее звено URI): Excel — `worksheet`, `sharedStrings`, `comments`
  (openpyxl пишет `xl/comments/comment1.xml`), `threadedComment`, `person`, `vmlDrawing` (текст в `<v:textbox>`), `drawing`, `chart`, `table`,
  `pivotCacheDefinition|Records`, `externalLink`, `connections`, `usernames`; PowerPoint — `slide`, `notesSlide`, `comments` (вид — по корню:
  `p188:cmLst` или `p:cmLst`), `commentAuthors`, `authors`, `diagramData|Drawing`, `chart`, макеты и образцы. Главная часть — по связи `officeDocument`
  корня (корень проверяется: `workbook`/`presentation`). Путь — запасной вариант (`xlsxRole`, `pptxRole`).
- **Числа ячеек** (`xlsx/numfmt.js`): запись целого — и «7.728168971E9», «74951234567.0»; поток числа — показанный текст: формат из цифр и литералов
  («000000000000» → 027409876579, «000-000-000 00», «+0 (000) 000-00-00»), без формата — ведущие нули по заголовку столбца (ИНН 9/11 → 10/12, СНИЛС → 11,
  БИК и КПП → 9, паспорт → 10). Шапка листа и таблицы слайда — от двух столбцов (`minHeader: 2`).
- **Константы** (`name-literal`): строковые литералы в `definedName` и в списках проверки данных (`formula1/2`) заменяются (предупреждение
  `XLSX_FORMULA_LITERAL` считает и их); подсказки проверки (`prompt`, `promptTitle`, `error`, `errorTitle`), значения фильтров (`filter/@val`) — `alt`.
- **Умные таблицы**: `tableColumn/@name` (`table-column`) связан с потоком ячейки шапки — правка одного становится правкой другого (`XlsxInfo.tableColumns`).
- **Сводные**: `<n v>` из 6–15 цифр (`pivot-number`) → `<s v="метка">`, у набора `sharedItems` снимаются признаки типов и `minValue`/`maxValue`,
  у определения — `refreshOnLoad="1"`; `refreshedBy` — автор.
- **Внешние книги**: кэш (`sheetName/@val`, строки и числа ячеек `<cell>`) — потоки; путь `externalLinkPath` (`file:///C:/Users/…`) заменяется всегда
  на `external-link-N.xlsx` (`XLSX_EXTERNAL_LINKS`). **Подключения**: имя, описание, команда — `alt`; строка подключения (`conn-string`) — найденное
  метками, `UID=`/`PWD=`/`User ID=`/`Password=` → `***` всегда (`XLSX_CONNECTIONS`). `usernames.xml userInfo/@name` — автор,
  `customWorkbookView/@name` — `alt`. PowerPoint: `a:hlinkClick|hlinkHover/@tooltip`, `p:cSld/@name`, `p14:section/@name`, `p:custShow/@name` — `alt`.
- **Встроенные книги** (`core/embedded.js`): `*/embeddings/*.xls[xm]` (данные диаграмм, OLE-книги) разбираются адаптером Excel и входят в модель
  документа (id с префиксом `e<N>/`, абзацы — с частью `<запись>#<часть>`): один анализ — одна карта меток; `serializePackage` отдаёт правки книги её
  сериализатору и подменяет запись (`doc.embedded = [{entry, doc, serialize}]`). Excel и PowerPoint делают это в своём `parse` (синхронно —
  адаптер PowerPoint импортирует адаптер Excel, общий модуль по требованию), Word — хост (`attachEmbeddedBooks` после разбора, модуль Excel грузится
  по требованию). `restoreDocument` восстанавливает и книги внутри. «Удалять встроенные объекты» для Excel и PowerPoint: книга данных диаграммы
  удаляется вместе с `<c:externalData>` (`chartExternalData`) и связями; OLE-объекты слайдов и листов — нет (предупреждение).
- **Имя файла** (`core/file-name.js`): имя без расширения — поток `file-name` (часть `#file-name`, «_» и «.» — пробелы); `applyDecisions` возвращает
  `fileName` с метками вместо найденного, хост строит из него `RESULT_BEGIN.name` и `mapping.documents[].resultName`; `content/flow.js` берёт имя
  хоста, если сессия — этого же файла. Восстановление имени не делается.
- **JSON**: любое целое из 6–20 цифр — поток (ключ — только метка; `keyLabel` по словам: `clientInn`, `snils_number`); ключи — потоки (`jsonKey`, язык
  документа по ним не считается), найденное в ключе — меткой; совпадение с другим ключом объекта — суффикс « (2)». **UTF-16 без BOM** — по доле нулевых
  байтов, записывается так же.
- **Хук плана** `plan(doc, byStream, pushRaw, {options, remove})`: `remove(name)` — удалить запись пакета со ссылками.

**Повторное ревью WP12-B** (после слияния WP12-C):
- **Сводная**: поля кэша — заголовки чисел (`cacheField/@name`: ведущие нули, «Телефон» над номером; таблица заголовков `piv<N>`), числа записей —
  по номеру поля в `<r>`; число, заменённое на листе, заменяется в кэше той же меткой, даже если в кэше его не нашли (`planXlsx`); части сводных
  таблиц (`pivotTable`): имя, подписи, `pivotField/@name`, `dataField/@name`, `item/@n` — `alt`.
- **Внешние цели связей** (`ooxml/opc.js`): у связи с `TargetMode="External"` и типом не `hyperlink` — `rel-external`, общий сериализатор всегда
  ставит `external-<N><расширение>` (аудио, видео, рисунки по ссылке, шаблон Word, путь внешней книги Excel); связь без типа — как гиперссылка.
- **Диаграммы Word** (`word/charts`) — `core/embedded.js attachEmbeddedBooks` (тот же вызов, что для книг; разметка — `parseChartPart` модуля Excel).
- **Макросы**: `vbaProject.bin` в пакете — предупреждение `MACROS_NOT_PROCESSED` (Word, Excel, PowerPoint).
- **JSON**: строка, которая сама JSON, разбирается рекурсивно и собирается обратно строкой; пометки восстановления — `documents[].restore =
  {numbers: [метки], keys: [[новый ключ, исходный]]}` в карте (схема карты разрешает поля документа); `restoreDocument` возвращает числа
  числами и ключи с суффиксом — исходными. Язык меток — по значениям и ключам на кириллице.
- **Имя файла**: точки остаются («Иванов И.И. договор»), «_» — пробел, слово-тип документа в начале («Резюме», «Договор», «Заявка»…) — со строчной;
  тот же файл под другим именем — новый анализ (решения прежней сессии переносятся по ключу), `content/flow.js` — нейтральное
  `document.anon.<расширение>` вместо исходного имени при любом сбое (fail-closed) и уникальные имена в одной отправке (`uniqueResultName`).

**Не сделано / ограничения**: ФИО в %-кодированной гиперссылке («Договор%20Горбунова») — бэклог; упоминания `@Имя` в цепочке комментариев Excel (`<mention startIndex length>`) не пересчитываются; `chartEx` и OLE-объекты
(кроме книг Excel) не разбираются и не удаляются (предупреждение `EMBEDDED_NOT_PROCESSED`); `docProps/custom.xml` при «Сохранять метаданные» не меняется
(как в DOCX); скрытые листы, строки и слайды обрабатываются как обычные (счётчики и удаление — WP12-D).

### 9.9. Скрытые данные и ключ с паролем (версия 0.5, WP12-D, `docs/concept-0.5.md` п. 6–7, Ц4, Ц5, К7, К8, К13)

```
parse ──► adapter.parse: doc.hidden = {comments, revisions, hiddenText | hiddenSheets, hiddenRows, hiddenCols | hiddenSlides} ──► ENTITIES.hidden
панель: «В документе: 3 комментария, история правок, скрытый текст» + переключатели (по умолчанию выключены, settings.remove*) ──► APPLY.options.hidden
applyDecisions({hidden}) ──► adapter.serialize(doc, edits, {keepMetadata, stripEmbedded, hidden}) ──► план формата: ctx.strip(part, {from, to, text?}), ctx.remove(name)
                         ──► serializePackage: удаления важнее правок сущностей внутри (resolveStrips) ──► cleanupReferences ([Content_Types].xml, *.rels)
```

**Счётчики** (`doc.hidden`, `HiddenCounts` в `ooxml/hidden.js`; в ENTITIES — поле `hidden`, схема протокола): Word — `comments` (элементы `w:comment`
в `word/comments.xml`), `revisions` (элементы `w:ins`, `w:del`, `w:moveFrom`, `w:moveTo`, `w:*Change`, `w:cellIns|cellDel|cellMerge` во всех текстовых частях),
`hiddenText` (раны с содержимым, у которых текст скрыт: `w:vanish` в свойствах рана, `w:specVanish`, стиль символа или абзаца со скрытым текстом с учётом
`w:basedOn` и стиля абзаца по умолчанию; `w:vanish w:val="0"` — видимый; свойства внутри `*Change` не считаются); Excel — `hiddenSheets`
(`state="hidden|veryHidden"`), `hiddenRows`, `hiddenCols` (сумма ширин диапазонов `<col hidden>`), `comments` (max(примечаний, корневых комментариев цепочек):
Excel пишет к цепочке примечание-заглушку); PowerPoint — `hiddenSlides` (`<p:sld show="0">`), `comments` (`p:cm` и `p188:cm`). Word считает при разборе
только части, где быстрая проверка нашла признаки скрытого (регулярное выражение на XML части, styles.xml читается, только если в нём есть `w:vanish`):
20-страничный договор без скрытого — +0,03 мс к разбору 4,2 мс.

**Выбор** (`HiddenFlags`): `comments`, `revisions`, `hiddenText` (Word), `hiddenSheets` (Excel: листы, строки и столбцы — один переключатель), `hiddenSlides`;
настройки `removeComments`, `acceptRevisions`, `removeHiddenText`, `removeHiddenSheets`, `removeHiddenSlides` (по умолчанию `false`, `HIDDEN_SETTINGS`,
`hiddenFlagsFrom`; новые ключи с дефолтом — схема настроек остаётся 4, `migrateSettings` дополняет). Панель шлёт свой выбор в `APPLY.options.hidden`;
хост без него берёт выбор из настроек. Ни один флаг не включён — план формата ничего не делает, байты результата прежние (снимок `docx-regression`
— только добавлены записи двух новых DOCX-фикстур `tests/fixtures/hidden/`, прежние 59 не менялись).

**Общий сериализатор** (`ooxml/serialize.js`): план адаптера получает `PlanContext {options, remove, strip, hidden}`; `remove(name)` удаляет и файл связей
части (`relsPartOf`); правки с `strip: true` (и удаление ранов встроенных объектов при «Удалять встроенные объекты») сводятся `resolveStrips`: вложенное
удаление — внешнее, частично пересекающиеся удаления без замены — объединение, правка или вставка внутри удаления — отбрасывается; часть, которая удалена,
не собирается и не попадает в `changedParts`. `collectOrphans(relations, removed, names)` — части, на которые ссылались только удалённые (заметки
скрытого слайда, рисунки и примечания скрытого листа, их картинки и диаграммы), транзитивно; часть с входящей связью от корня или живой части остаётся.

| Формат | Переключатель | Что делается |
|---|---|---|
| Word | «Удалить комментарии» | `word/comments.xml`, `commentsExtended.xml`, `commentsIds.xml`, `commentsExtensible.xml` (со связями и типами); `w:commentRangeStart/End`, `w:commentReference` (ран только из ссылки — целиком); `word/people.xml` — если правок нет или они принимаются |
| Word | «Принять исправления» | `w:ins`/`w:moveTo` — разворачиваются (удаляются только теги); `w:del`/`w:moveFrom` — с содержимым; `w:*Change`, метки `w:ins`/`w:del` в свойствах, `w:cellIns|cellDel|cellMerge`, метки диапазонов перемещения — удаляются; удалённый знак абзаца — абзац склеивается со следующим того же уровня (от `</w:p>` до конца `w:pPr` следующего; остаются свойства первого; не склеивается через разрыв раздела); удалённая строка таблицы (`w:trPr/w:del`) — строка, все строки — таблица; `settings.xml` (`w:trackRevisions`) не меняется |
| Word | «Удалить скрытый текст» | раны со скрытым текстом; абзац со скрытым знаком и без видимого текста — целиком, кроме последнего блока ячейки, колонтитула, сноски, надписи, тела |
| Excel | «Удалить комментарии» | примечания и цепочки листов, `persons`, VML примечаний (только примечания — часть и `<legacyDrawing>` листа; есть другие фигуры — фигуры с `ObjectType="Note"`) |
| Excel | «Удалить скрытые листы, строки и столбцы» | `<sheet>` скрытых листов, их части и всё, на что ссылались только они; локальные имена этих листов — удаляются, `localSheetId` остальных и `activeTab`/`firstSheet` — со сдвигом; ссылки на удалённые листы в формулах ячеек, именах книги, диаграммах, ссылках «#Лист!A1» → `#REF!` (то же переименование листов `refs.js renameSheets` с заглушкой `REMOVED_SHEET`, как делает Excel), источник сводной на удалённом листе — как был; ячейки скрытых строк и столбцов — удаляются (строки и столбцы на месте: адреса и формулы не сдвигаются; у владельца общей/массивной формулы остаётся формула без значения; левая верхняя ячейка объединения, которое заходит на видимые строки и столбцы, остаётся — её текст виден); **кэш формул** (ревью WP12-D: `<v>` читают ИИ и парсеры): формула со ссылкой на удалённый лист (прямо или через имя книги) — ячейка-ошибка `t="e"` с `<v>#REF!</v>`; формула со ссылкой на очищенные ячейки или на ячейку со снятым кэшем (транзитивно: `=Данные!B4`, где B4 = `SUM` по скрытой строке) — без `<v>` (пересчёт при открытии); общая формула — по владельцу и его диапазону для всей группы; имена книги раскрываются до неподвижной точки (`Имя2` → `Источник` → удалённый лист — `#REF!`; цикл — как динамическое имя); формулы и ряды с `INDIRECT`, `OFFSET` или вычисляемым диапазоном (`…):B5`, `:INDEX(`), в том числе через имя, при любом удалении или очистке теряют кэш (fail-closed, транзитивно); **ряды диаграмм** (`c:numRef`/`c:strRef`/`c:multiLvlStrRef` в `xl/charts/*.xml`) с такой ссылкой — пустой кэш точек (`<c:numCache><c:ptCount val="0"/></c:numCache>`), формула ряда — `#REF!` по общим правилам; **сводная таблица** с источником (`worksheetSource sheet|name`) на удалённом листе или очищенных ячейках — удаляются определение кэша, записи, сводные таблицы на нём и `<pivotCache>` книги (пустой `<pivotCaches>` — целиком), выведенные ячейки остаются значениями; общие строки без ссылок — пустые `<si><t></t></si>` (индексы прочих на месте); `calcChain.xml` — удаляется, `fullCalcOnLoad="1"` |
| PowerPoint | «Удалить скрытые слайды» | часть слайда и всё, на что ссылался только он (заметки, комментарии, картинки); `<p:sldId>`, слайд в произвольных показах (`p:custShow/p:sldLst/p:sld`) и разделах (`p14:sldId`); гиперссылки других частей на него (`a:hlinkClick|hlinkHover`) |
| PowerPoint | «Удалить комментарии» | части комментариев обоих видов, `commentAuthors.xml`, `authors.xml`; в слайде — `<p:ext>` с `p188:commentRel` |

Найденное в скрытом маскируется при любом выборе (общие потоки: удалённый текст `deleted`, комментарии, авторы, скрытые листы и слайды — как в 0.4).
Проверка — `tests/integration/hidden.spec.js` (счётчики; каждый переключатель — элементы удалены, пакет цел, XML корректен, LibreOffice конвертирует;
выключенные — те же байты; ни одного секрета из скрытого в результате ни при каком выборе и в режиме маски; протокол ENTITIES/APPLY), фикстуры
`scripts/gen-hidden-fixtures.mjs` (`--check`; `--real` — настоящие файлы LibreOffice из плоских ODF в `tests/fixtures/hidden/real/`), e2e `hidden.spec.js`.

**Ограничения**: склейка абзацев по удалённому знаку берёт свойства первого абзаца (Word — последнего); удалённая ячейка (`w:cellDel`) и объединение
(`w:cellMerge`) — снимаются только метки; правки в `styles.xml` и `numbering.xml` не принимаются (там нет текста документа); ссылки других книг на
удалённый лист и именованные диапазоны внешних книг не пересчитываются; у Excel «скрытые строки» по `sheetFormatPr zeroHeight` и сгруппированные
свёрнутые столбцы без `hidden` не считаются; у владельца общей формулы (`<f t="shared" ref>`) в скрытой строке остаётся текст формулы (и строковые литералы в нём): зависимые видимые ячейки ссылаются на неё — без перестройки группы её не удалить (кэш значения снимается); во встроенных книгах (данные диаграмм, `*/embeddings/*.xlsx`) скрытое не удаляется (найденное в них
обезличивается, как в 0.5).

**Ключ с паролем** (`core/key-crypto.js`; схема — `schemas/mapping.schema.json#/$defs/encrypted`, корень схемы — `oneOf` открытой карты и зашифрованного ключа,
протокол ссылается на `#/$defs/mapping`):

```json
{ "encVersion": 1, "enc": "AES-GCM-256",
  "kdf": { "name": "PBKDF2", "hash": "SHA-256", "iterations": 600000, "salt": "<16 байт, base64>" },
  "iv": "<12 байт, base64>", "ct": "<AES-GCM(JSON карты) + тег 16 байт, base64>" }
```

`encryptMapping(mapping|json, password, {iterations?})` — WebCrypto (`globalThis.crypto.subtle`: страница расширения, Node ≥ 20), пароль — NFC, соль и
IV — `getRandomValues`, итераций 600 000 (меньше `KDF_MIN_ITERATIONS` = 600 000 не принимается); заголовок — AAD AES-GCM: JSON-массив
`[encVersion, enc, kdf.name, kdf.hash, kdf.iterations, kdf.salt]` (подмена любого поля ломает тег); в файле нет ни значений, ни меток, ни имён документов. `decryptMapping(obj, password)` — неверный пароль и изменённые `ct`/`iv`/соль/итерации неразличимы (тег GCM) → `KeyCryptoError
('KEY_PASSWORD')` без частичного результата; не тот формат (версия, алгоритм, хэш, итерации вне [600 000; 2 000 000], длины соли/IV, не base64) →
`'KEY_INVALID'`; WebCrypto нет (страница без защищённого контекста) → `'KEY_CRYPTO_UNAVAILABLE'`. Коды — не протокола §5.4 (ключ не ходит через хост).
Интерфейс (ревью WP12-D): **пароль вводится только на странице расширения** — на сайте чата слушатели клавиатуры страницы на `window`/`document` в фазе
перехвата получают `keydown.key` и `input/beforeinput/textInput.data` и из закрытого Shadow DOM панели, закрыть это изнутри страницы нельзя. Меню «Ещё»
панели: «Сохранить ключ восстановления» (без пароля — как раньше) и «Сохранить с паролем…» → `MSG.OPEN_KEY_SAVE {docIds, name}` → background
(`router.js`, проверка `keySavePath`: только `d<N>` и имя `*.mapping.json` без путей) открывает `restore/restore.html?save=1&docId=…&name=…`; страница
берёт карты сессий через `GET_MAPPING` (несколько файлов отправки — `mergeMappings`), показывает пароль и повтор (не короче `MIN_PASSWORD_LENGTH` = 8),
индикатор длины, предупреждение «забытый пароль = потерянный ключ», шифрует и скачивает файл с тем же именем `.mapping.json`; поля очищаются после
сохранения и при уходе со страницы (`pagehide`). Работает и на http-сайтах (страница расширения — защищённый контекст). В `content.js` нет ни
`key-crypto`, ни полей пароля (`pack.spec.js`). Страница восстановления — `readMappingFiles(texts, password?)` (`ui/deanon/index.js`):
зашифрованный ключ → поле пароля и «Открыть»; неверный — «Неверный пароль или файл ключа повреждён» (карты нет, вывода нет); пароль после попытки
стирается из поля, в хранилище не пишется; расшифрованная карта — только в памяти страницы. Других мест импорта ключа нет (настройки импортируют
конфигурацию, не ключ). Проверка — `tests/unit/key-crypto.spec.js`, e2e `hidden.spec.js` (https и http: шпион страницы чата — слушатели на `window`/`document` — не видит ни
одного символа пароля при сохранении с паролем; при работе с панелью ввод он видит — поэтому полей пароля в панели нет; сохранение → восстановление)
и `restore.spec.js`.

**Бюджеты**: код `worker.js` без ORT ≤ 512 КиБ; `content.js` 163 773 байт — лимит сторожа `pack.spec.js` 150 → 163 КиБ (блок скрытых данных в панели;
словарей, шифрования и полей пароля в нём нет).

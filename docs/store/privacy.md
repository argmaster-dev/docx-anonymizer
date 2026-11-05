# Политика конфиденциальности DOCX Anonymizer

*English version below.*

Редакция от 5 ноября 2026 года, версия расширения 0.5.1.

DOCX Anonymizer — браузерное расширение, которое обезличивает документы перед загрузкой на сайт: находит в файле персональные данные и реквизиты и заменяет их метками. Вся обработка происходит на вашем компьютере.

## Коротко

- Расширение **не делает ни одного сетевого запроса**: у него нет сервера, аналитики, телеметрии, рекламы и отчётов об ошибках.
- Разработчик **ничего не собирает, не получает, не хранит и не передаёт** третьим лицам — ни документы, ни найденные в них значения, ни сведения о том, какие сайты вы посещаете.
- Данные документа обрабатываются только в памяти браузера на вашем компьютере.

## Какие данные обрабатываются и зачем

| Данные | Где и как долго | Зачем |
|---|---|---|
| Файл, который вы прикладываете на сайте, и его текст | Память браузера (изолированная страница расширения и её Web Worker), пока открыт браузер | Найти и заменить персональные данные и реквизиты |
| Найденные значения и карта замен («ключ восстановления»: метка → настоящее значение) | Только память браузера; список недавних обработок исчезает при закрытии браузера | Показать находки в панели и вернуть настоящие значения в ответ ИИ |
| Файл ключа восстановления `.mapping.json` | На вашем диске — только если вы сами нажали «Сохранить ключ восстановления»; по желанию шифруется вашим паролем (PBKDF2-SHA-256, AES-GCM-256) | Восстановить ответ ИИ позже. Пароль нигде не сохраняется |
| Настройки: включён ли перехват, режим и списки разрешённых и заблокированных сайтов, свои категории и словари, порог и стоп-слова модели, выбор переключателей (в том числе удаления скрытых данных), служебные отметки (показана ли подсказка) | `chrome.storage.local` этого профиля браузера, пока вы их не измените, не сбросите настройки или не удалите расширение | Работа расширения так, как вы его настроили |
| **Отдельные значения из документов — только по вашей команде:** значение, для которого вы нажали «Больше не предлагать» (список «Исключения»); название организации, для которого вы нажали «Маскировать всегда» или отметили «запомнить» в «Анонимизировать как → Организация» (список «Компании для маскирования») | `chrome.storage.local`, в открытом виде, пока вы не удалите запись; видны и удаляются на странице настроек — разделы «Исключения» и «Компании для маскирования» (кнопка «×» у записи) | Не предлагать это значение / маскировать эту организацию в следующих документах |
| Адреса сайтов (origin, например `https://example.com`): сайт, на котором вы нажали «Отключить на этом сайте» (список заблокированных); сайт, на котором вы передвинули панель, — вместе с её положением на экране | `chrome.storage.local`; заблокированные сайты видны и удаляются в настройках, раздел «Перехват»; положения панели в интерфейсе не показываются и удаляются кнопкой «Сбросить все настройки» | Не перехватывать на этом сайте; открывать панель там, где вы её оставили |
| Пакет модели распознавания имён (веса нейросети, без ваших данных) | Хранилище браузера этого расширения (OPFS), пока вы не удалите модель или расширение | Находить имена без меток |
| Адрес текущей вкладки | Читается, только когда вы открываете меню расширения или включаете перехват на сайте; сохраняется только как запись в списке сайтов или положение панели (строки выше), и только после вашего действия | Показать, работает ли перехват на этом сайте, и добавить сайт по вашей команде |

Документы, их текст и карта замен **никогда** не записываются в хранилище браузера и не попадают в журналы. Найденные значения тоже не записываются — кроме отдельных значений, которые вы сами внесли в «Исключения» или «Компании для маскирования» (строка выше). Перед экспортом настроек в файл («Данные» → «Экспорт настроек») помните, что эти списки входят в него.

## Что получает сайт

Сайт, на который вы загружаете файл, получает **обезличенную копию** — ту, которую вы подтвердили в панели расширения. Если вы выбрали «Отправить оригинал» или «Загрузить как есть», сайт получит исходный файл. Что дальше делает с файлом этот сайт, определяет его собственная политика конфиденциальности; расширение на это не влияет.

## Доступ к сайтам

После установки расширение не имеет доступа ни к одному сайту. Доступ запрашивается у браузера по одному сайту — когда вы нажимаете «Разрешить доступ» или добавляете сайт в настройках. Отозвать его можно в настройках браузера на странице расширений. На сайтах без доступа расширение ничего не делает.

## Ссылки

В меню и на страницах расширения есть ссылки на справку, на страницу релизов проекта, на сайт разработчика и на его Telegram-канал (@sitimlab, с 0.5.1). Они открываются только по вашему щелчку, как обычные ссылки в новой вкладке; само расширение при этом ничего не отправляет.

## Как удалить данные

- **Недавние обработки и карты замен** — закройте браузер: они хранятся только в памяти.
- **Исключения и компании для маскирования** — на странице настроек, разделы «Исключения» и «Компании для маскирования», кнопка «×» у записи.
- **Все настройки**, включая списки сайтов, исключения, компании и положения панели, — на странице настроек, раздел «Данные» → «Сбросить все настройки» (модель при этом остаётся).
- **Модель распознавания имён** — на странице настроек, карточка «Модель NER» → «Удалить модель».
- **Всё сразу** — удалите расширение: браузер стирает его настройки и хранилище.
- **Сохранённые вами файлы** (обезличенные копии, `.mapping.json`) лежат на вашем диске — удаляйте их как обычные файлы.

## Дети

Расширение не предназначено специально для детей и не собирает сведений ни о ком.

## Изменения политики

Новая редакция публикуется в этом файле репозитория проекта вместе с версией расширения, в которой изменилось обращение с данными. Если расширение когда-нибудь начнёт передавать какие-либо данные, это будет только с вашего явного согласия и будет описано здесь заранее.

## Контакты

Вопросы о приватности — через issues репозитория: https://github.com/argmaster-dev/docx-anonymizer/issues

---

# DOCX Anonymizer privacy policy

Revision of 5 November 2026, extension version 0.5.1.

DOCX Anonymizer is a browser extension that anonymizes documents before you upload them to a website: it finds personal data and identifiers in a file and replaces them with markers. All processing happens on your computer.

## In short

- The extension **makes no network requests**: it has no server, analytics, telemetry, ads or crash reporting.
- The developer **collects, receives, stores and shares nothing** — neither documents nor the values found in them nor which websites you visit.
- Document data is processed only in the browser's memory on your computer.

## What data is processed and why

| Data | Where and for how long | Why |
|---|---|---|
| The file you attach on a website and its text | Browser memory (the extension's isolated page and its Web Worker) while the browser is open | To find and replace personal data and identifiers |
| Values found and the replacement map (the "recovery key": marker → real value) | Browser memory only; the list of recent runs disappears when the browser is closed | To show findings in the panel and put the real values back into the AI's answer |
| The recovery key file `.mapping.json` | Your disk — only if you press "Save the recovery key"; optionally encrypted with your password (PBKDF2-SHA-256, AES-GCM-256) | To restore an AI answer later. The password is never stored |
| Settings: interception on/off, site mode and the allowed and blocked site lists, custom categories and dictionaries, model threshold and stop words, switch choices (including hidden-content removal), service flags (whether a hint was shown) | `chrome.storage.local` of this browser profile, until you change them, reset the settings or remove the extension | To work the way you configured it |
| **Individual values from documents — only on your command:** a value for which you pressed "Stop suggesting" (the "Exclusions" list); a company name for which you pressed "Always mask" or ticked "remember" in "Anonymize as → Company" (the "Companies to mask" list) | `chrome.storage.local`, in plain text, until you delete the entry; shown and deleted on the settings page — "Exclusions" and "Companies to mask" sections ("×" next to an entry) | To stop suggesting that value / to mask that company in later documents |
| Site addresses (origin, e.g. `https://example.com`): a site where you pressed "Turn off on this site" (the blocked list); a site where you moved the panel, together with its position on screen | `chrome.storage.local`; blocked sites are shown and deleted in the settings, "Interception" section; panel positions are not shown in the interface and are deleted with "Reset all settings" | Not to intercept on that site; to open the panel where you left it |
| The name recognition model package (neural network weights, none of your data) | The extension's browser storage (OPFS), until you remove the model or the extension | To find names without labels |
| The current tab's address | Read only when you open the extension menu or turn interception on for a site; stored only as a site list entry or a panel position (rows above), and only after your action | To show whether interception works on this site and to add the site at your request |

Documents, their text and the replacement map are **never** written to browser storage or to logs. Values found are not written either — except individual values you added yourself to "Exclusions" or "Companies to mask" (row above). Keep in mind that these lists are included when you export the settings to a file ("Data" → "Export settings").

## What the website receives

The website you upload a file to receives the **anonymized copy** you confirmed in the extension's panel. If you choose "Send original" or "Upload as is", the website receives the original file. What that website does with the file is governed by its own privacy policy; the extension has no influence over it.

## Site access

After installation the extension has access to no website. Access is requested from the browser one site at a time — when you press "Allow access" or add a site in the settings. You can revoke it in the browser's extension settings. On sites without access the extension does nothing.

## Links

The menu and the extension's pages link to the help page, the project's releases page, the developer's website and the developer's Telegram channel (@sitimlab, since 0.5.1). They open only when you click them, as ordinary links in a new tab; the extension itself sends nothing.

## How to delete data

- **Recent runs and replacement maps** — close the browser: they live only in memory.
- **Exclusions and companies to mask** — settings page, "Exclusions" and "Companies to mask" sections, "×" next to an entry.
- **All settings**, including site lists, exclusions, companies and panel positions — settings page, "Data" → "Reset all settings" (the model stays).
- **The name recognition model** — settings page, "NER model" card → "Remove model".
- **Everything at once** — remove the extension: the browser erases its settings and storage.
- **Files you saved** (anonymized copies, `.mapping.json`) are on your disk — delete them like any other file.

## Children

The extension is not directed at children and collects no information about anyone.

## Changes

A new revision is published in this file of the project repository together with the extension version that changes how data is handled. If the extension ever starts transmitting any data, it will do so only with your explicit consent, described here in advance.

## Contact

Privacy questions — via the repository's issues: https://github.com/argmaster-dev/docx-anonymizer/issues

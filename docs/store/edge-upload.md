# Загрузка крупного пакета в Edge Partner Center

> **Справочно: подача в Edge Add-ons не планируется** (решение владельца 0.5 — целевой магазин Chrome Web Store). Заметка сохранена на случай, если решение изменится.

Заметка к подаче в Edge Add-ons (концепция 0.5 п. 9, риск «Edge Add-ons»). Сверено с документацией Microsoft 27.10.2026. Ничего отсюда не выполнялось: аккаунта и ключей у проекта нет, подача — решение владельца.

## Проблема

Пакет для магазинов `release/docx-anonymizer-0.5.0-store.zip` — ≈ 34,5 МиБ (36,2 МБ; 28,2 МиБ из них — встроенный пакет модели NER). Официального лимита размера пакета Edge Add-ons Microsoft не публикует ([Publish a Microsoft Edge extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension) — требований к размеру нет), но, по опыту разработчиков, загрузка пакетов такого размера через браузерную форму Partner Center иногда обрывается или зависает на проверке. В Chrome Web Store лимит — 2 ГБ ([Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish)), там проблемы нет.

## Порядок действий

1. **Сначала — обычная загрузка в браузере.** Partner Center → Edge → «Create new extension» → перетащить `docx-anonymizer-0.5.0-store.zip`. Если пакет принят — дальше по [`checklist.md`](checklist.md).
2. **Если загрузка падает:** попробовать по советам Microsoft для ошибок формы — очистить кэш и cookies, режим InPrivate, другой браузер (раздел «Resolve any Partner Center errors» той же страницы).
3. **Если не помогло — REST API.** Важно: **первую** версию продукта REST API создать не может — «There aren't REST API endpoints for: Creating a new product» ([Use the REST API to update an extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api)). Поэтому:
   1. Создать продукт в Partner Center с **лёгким** пакетом без модели: `npm run pack:store -- --lite` → `release/docx-anonymizer-0.5.0-store-lite.zip` (≈ 6,3 МиБ, манифест тоже без `key`). Заполнить листинг, но **не публиковать**: в этой версии модели нет.
   2. Загрузить полный пакет `docx-anonymizer-0.5.0-store.zip` в черновик через REST API (v1.1, ключ API) — запросы ниже.
   3. Проверить статус загрузки, затем отправить черновик на сертификацию из Partner Center (или запросом API).

## REST API v1.1 — запросы

Ключ создаётся в Partner Center → Microsoft Edge → **Publish API** → «Create API credentials» (Client ID и API key; у ключа есть срок действия). `productID` — GUID продукта со страницы «Extension overview». Корень API — `https://api.addons.microsoftedge.microsoft.com`.

```sh
# 1. Загрузить пакет в черновик существующего продукта → 202 Accepted, в заголовке Location — operationID
curl -H "Authorization: ApiKey $ApiKey" -H "X-ClientID: $ClientID" -H "Content-Type: application/zip" \
  -X POST -T release/docx-anonymizer-0.5.0-store.zip -v \
  "https://api.addons.microsoftedge.microsoft.com/v1/products/$productID/submissions/draft/package"

# 2. Статус загрузки (повторять, пока status не перестанет быть InProgress)
curl -H "Authorization: ApiKey $ApiKey" -H "X-ClientID: $ClientID" -X GET -v \
  "https://api.addons.microsoftedge.microsoft.com/v1/products/$productID/submissions/draft/package/operations/$operationID"

# 3. Отправить черновик на сертификацию (тело — заметки для проверяющих) → 202, Location — operationID публикации
curl -H "Authorization: ApiKey $ApiKey" -H "X-ClientID: $ClientID" -X POST \
  -d '{ "notes": "No account or server is needed; see the certification notes in the listing." }' -v \
  "https://api.addons.microsoftedge.microsoft.com/v1/products/$productID/submissions"

# 4. Статус публикации
curl -H "Authorization: ApiKey $ApiKey" -H "X-ClientID: $ClientID" -X GET -v \
  "https://api.addons.microsoftedge.microsoft.com/v1/products/$productID/submissions/operations/$operationID"
```

Коды ошибок загрузки (в том числе 408 — тайм-аут загрузки пакета, 429 — ограничение частоты) — [REST API Reference](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/addons-api-reference). Ключ API и Client ID — секреты: не коммитить, не вставлять в issues и CI без секретного хранилища.

## Если и REST API не принимает пакет

Запасной вариант без изменения кода — публиковать в Edge **лёгкий** пакет (≈ 6,3 МиБ), а модель предлагать импортировать вручную из GitHub Releases, как в лёгком архиве (карточка «Модель NER» показывает три шага). Это хуже по Ц7 («установка в один клик»), поэтому — только если полный пакет не проходит; решение владельца. Обращение в поддержку — [Extensions New Support Request](https://support.microsoft.com/supportrequestform/e7a381be-9c9a-fafb-ed76-262bc93fd9e4).

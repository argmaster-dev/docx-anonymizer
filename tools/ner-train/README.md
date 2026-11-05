# Обучение NER-модели `rubert-tiny2-ner-ruen`

Здесь обучается, экспортируется в ONNX, квантуется и готовится к упаковке модель распознавания имён
(PER / ORG / LOC) для локального ONNX-провайдера расширения DOCX Anonymizer (WP9, ступень 3 NER).

* База: [`cointegrated/rubert-tiny2`](https://huggingface.co/cointegrated/rubert-tiny2) (MIT; BERT, 3 слоя, hidden 312,
  словарь WordPiece 83 828, `do_lower_case=false`, `strip_accents=null` → регистр и диакритика не меняются).
* Данные: список источников с весами — `config.yaml` `data.sources[]` (с 1.1.0; лицензии — разделы «Источники 1.1.0» и
  «Источники 1.2.0»; с 1.2.0 добавлены NEREL и Nerus — **без явной лицензии на тексты**, см. ниже).
  WikiANN, [`unimelb-nlp/wikiann`](https://huggingface.co/datasets/unimelb-nlp/wikiann), конфигурации `ru` и `en`
  (разбиение Rahimi et al.: train/validation/test = 20k/10k/10k на язык; теги BIO уже в нужном порядке) — основа и
  гейты; с 1.1.0 к нему добавлены factRuEval-2016 и синтетика деловых жанров, с 1.2.0 — NEREL и подвыборка Nerus. Датасет
  загружается под этим именем напрямую (parquet, `datasets` 5.x), зеркало не понадобилось. Collection3/CoNLL не используются.
* Метки (ровно в этом порядке): `O, B-PER, I-PER, B-ORG, I-ORG, B-LOC, I-LOC`.
* Код — на английском, все параметры — в `config.yaml`; любой ключ переопределяется флагом `--set ключ=значение`
  (например, `--set run_id=exp1 --set train.epochs=10`). Сиды фиксированы (`seed: 42`).
* Артефакты — в `runs/<run_id>/` (в git не попадают, см. `.gitignore`), итоговый пакет-источник — в
  `models-src/<id>/` в корне репозитория (тоже вне git).

## Источники 1.1.0

Спайк лицензий 19.10.2026 (WP11-C1). Критерий включения: явная лицензия у первоисточника данных (и разметки, и текста),
разрешающая обучать модель и распространять веса под MIT с упоминанием источника в `NOTICE` пакета; без явной
совместимой лицензии источник отклоняется (как Collection3/NEREL/CoNLL в 0.2). CC BY-SA у текста допускается — так же,
как для WikiANN в 1.0.0: в пакет не попадает ни одного предложения или аннотации, только веса.

| Источник | Лицензия | Ссылка | Решение | Почему |
|---|---|---|---|---|
| WikiANN ru/en | разметка — Pan et al. 2017 / Rahimi et al. 2019; текст — Википедия, CC BY-SA 3.0 (в карточке HF — `unknown`) | [HF `unimelb-nlp/wikiann`](https://huggingface.co/datasets/unimelb-nlp/wikiann) | **включён** (как в 1.0.0) | основа гейтов К8; принят в 0.2 |
| factRuEval-2016 | **MIT** (файл [`LICENSE`](https://github.com/dialogue-evaluation/factRuEval-2016/blob/master/LICENSE) репозитория, «Copyright (c) 2015 dialogue-evaluation»); тексты — из OpenCorpora (`book_N` — номера текстов OpenCorpora), корпус OpenCorpora — [CC BY-SA 3.0](http://opencorpora.org/?page=downloads) | [github.com/dialogue-evaluation/factRuEval-2016](https://github.com/dialogue-evaluation/factRuEval-2016), коммит `dfe9623` | **включён** | явная пермиссивная лицензия на разметку, текст CC BY-SA; новости и аналитика вне Википедии (≈ 4 900 предложений, PER 2 100 / ORG 2 800 / LOC 2 700 упоминаний) |
| Nerus (natasha) | MIT в репозитории — на код (`Copyright (c) 2016`, без отдельной лицензии на данные); текст — [Lenta.ru dataset](https://github.com/yutkin/Lenta.Ru-News-Dataset) без лицензии (статьи Lenta.ru, права издателя); разметка «серебряная» — модель Slovnet BERT NER, обученная на NE5/Collection5 (без лицензии) и factRu | [github.com/natasha/nerus](https://github.com/natasha/nerus) | **отклонён** | у текста нет лицензии на распространение и производные, разметка унаследована от корпуса без лицензии; MIT репозитория не может лицензировать чужие статьи |
| RuREBus (dialogue-evaluation) | **нет** (ни `LICENSE`, ни условий в README; GitHub API: `license: null`) | [github.com/dialogue-evaluation/RuREBus](https://github.com/dialogue-evaluation/RuREBus) | **отклонён** | нет лицензии; к тому же классы сущностей бизнес-предметные (ECO, CMP, INST, ACT, BIN, MET, SOC, QUA) — нет PER и ORG |
| NEREL / RuNNE-2022 | нет (`license: null`, в README не указана) | [nerel-ds/NEREL](https://github.com/nerel-ds/NEREL), [dialogue-evaluation/RuNNE](https://github.com/dialogue-evaluation/RuNNE) | **отклонён** | как в 0.2 — лицензии нет |
| RuSentNE-2023 | MIT на репозиторий | [dialogue-evaluation/RuSentNE-evaluation](https://github.com/dialogue-evaluation/RuSentNE-evaluation) | **отклонён** | производный от NEREL (без лицензии); размечена одна целевая сущность на предложение — разметка не исчерпывающая, остальные имена стали бы O |
| MultiCoNER v2 | CC BY 4.0 | [HF `MultiCoNER/multiconer_v2`](https://huggingface.co/datasets/MultiCoNER/multiconer_v2) | **отклонён** | русского нет (bn, zh, de, en, es, fa, fr, hi, it, pt, sv, uk); v1 с русским на HF недоступен |
| WikiNEuRal, MultiNERD (Babelscape) | CC BY-NC-SA 4.0 | [HF `Babelscape/wikineural`](https://huggingface.co/datasets/Babelscape/wikineural) | **отклонён** | некоммерческая лицензия; Википедия |
| Universal NER (`ru_pud`) | CC BY-SA 4.0 | [HF `universalner/universal_ner`](https://huggingface.co/datasets/universalner/universal_ner) | **не включён в 1.1.0** | лицензия совместима, но это 1 000 предложений PUD (Википедия и новости, перевод с английского), только test; возможен как доп. оценка в C2 |
| Collection5 (NE5), Gareev, BSNLP | нет явной лицензии | [natasha/corus](https://github.com/natasha/corus) | **отклонён** | лицензии нет |
| Учитель `FacebookAI/xlm-roberta-base` | MIT | [HF](https://huggingface.co/FacebookAI/xlm-roberta-base) | используется только для мягких меток | не распространяется |
| Синтетика `synth.py` | собственная (MIT, вымышленные данные) | `tools/ner-train/synth.py` | **включена** | договоры (1.0.0) и 8 деловых жанров (1.1.0) |

Итог: внешний корпус вне Википедии один — factRuEval-2016. Запасной путь «учитель + синтетика ≥ 50 %»
(`--set data.mode=teacher_synth`) реализован и не требует внешних корпусов.

Конвертация factRuEval-2016 (`sources.py`): слой объектов (`*.objects`) → `Person` = PER, `Org` = ORG,
`Location`/`LocOrg` = LOC, `Project`/`Facility` = O. Спан упоминания — от первого до последнего токена его
именных спанов (`name`, `surname`, `patronymic`, `nickname`; `org_name` (+`loc_name`/`geo_adj` внутри названия); `loc_name`);
описатели (`org_descr` «компания», `loc_descr` «город», `job`) в спан не входят, упоминание ORG без `org_name`
(«правительство», «дипмиссия») пропускается. По соглашению расширения ORG дотягивается до объемлющих кавычек и ОПФ
перед ними. Вложенные упоминания: побеждает внешнее («МИД Грузии» — ORG, «Грузии» внутри не размечается).
20 % документов (детерминированно по хешу имени файла) отложено как `test_factru` (справочная метрика).

## Источники 1.2.0

Решение владельца 26.10.2026 (концепция 0.5, п. 8): к источникам 1.1.0 добавляются **NEREL** и **Nerus**, хотя у их текстов
нет явной лицензии. Это осознанный отход от критерия «Источников 1.1.0» (там оба отклонены): в пакет по-прежнему не попадает
ни одного предложения или аннотации, только веса; `NOTICE` пакета (раздел «IMPORTANT: training corpora without an explicit
license»), этот README и строка в README расширения / справке прямо говорят, что часть обучающих корпусов без явной лицензии
и **модель используется на свой страх и риск**. Natasha (Slovnet) — только для сравнения (раздел ниже), не для обучения;
LLM не используются ни для генерации, ни для разметки.

| Источник | Лицензия | Ссылка, версия | Решение | Как используется |
|---|---|---|---|---|
| WikiANN ru/en | как в 1.1.0 | HF `unimelb-nlp/wikiann` | **включён** | train ×1, гейты WikiANN test |
| factRuEval-2016 | MIT (разметка), CC BY-SA 3.0 (тексты OpenCorpora) | коммит `dfe9623` | **включён** | train ×2, `test_factru` (20 % документов) |
| NEREL v1.1 | **нет явной лицензии** (`license: null`, в README не указана; тексты — Русские Викиновости) | [nerel-ds/NEREL](https://github.com/nerel-ds/NEREL), коммит `8f07d3e`, sha256 архива `ffd4691e…7cc` | **включён решением владельца** | train ×0.5 (5 452 из 10 903 предложений после проверки пересечений), `validation_nerel` (dev, 1 402), `test_nerel` (1 491) — справочно |
| Nerus (Lenta.ru) | **нет явной лицензии на тексты** (MIT репозитория — на код; статьи Lenta.ru; разметка серебряная — Slovnet BERT NER) | [natasha/nerus](https://github.com/natasha/nerus), `nerus_lenta.conllu.gz` (1 961 465 886 байт, sha256 `fefd13f9…1d94`) | **включён решением владельца** | детерминированная выборка документов (`doc_share` 0.006 по хешу `seed:doc id` → 4 417 документов, 48 570 предложений), из неё 20 000 предложений в train |
| Учитель `FacebookAI/xlm-roberta-large` / `-base` | MIT | HF | только мягкие метки | не распространяется |
| Синтетика `synth.py` | собственная (MIT, вымышленные данные) | `tools/ner-train/synth.py` | **включена** | жанры 1.1.0 + шесть жанров 1.2.0 (ниже) |
| Natasha (Slovnet NER) | MIT | `natasha` 1.6.0 | **не используется в обучении** | только `compare_natasha.py` |

Конвертация (`sources.py`):

* **NEREL** (brat, вложенные сущности): PERSON → PER, ORGANIZATION → ORG, CITY / COUNTRY / STATE_OR_PROVINCE / LOCATION /
  DISTRICT → LOC, остальные 22 типа → O. Токенизация — как в `synth.py` (`\w+(?:[-']\w+)*|[^\w\s]`), предложения — по
  `.!?…` перед заглавной/цифрой/кавычкой и по переносу строки (не после инициала и сокращений «г.», «ул.», «им.»…; граница
  никогда не рвёт сущность). Вложенность: побеждает внешнее упоминание из сведённых типов. Соглашения расширения:
  у ORG отрезаются ведущие строчные слова-описатели («отдела расследования «Лаборатории Касперского»» → «« Лаборатории
  Касперского »»), ORG дотягивается до объемлющих кавычек и ОПФ; описательные организации без имени собственного
  («Правоохранительные органы Киргизии» в начале предложения, «полицией», «талибов») не размечаются — вложенное LOC/PER
  остаётся; LOC из одного прилагательного («Российский») — O; упоминания, не совпавшие с границами токенов (90), и
  разрывные (127) пропускаются. Итог по train: PER 9 563, ORG 4 656, LOC 5 863 (отброшено описательных ORG 907, строчных
  2 095, прилагательных LOC 624).
* **Nerus** (CoNLL-U, `Tag=B-PER` в MISC): типы PER/ORG/LOC как есть, ORG дотягивается до кавычек и ОПФ (у Nerus ORG без
  кавычек). Выборка кэшируется в `.cache/nerus/pool-<doc_share>-<seed>.jsonl.gz` (один проход по дампу ≈ 75 с).
* **Проверка пересечений** (`prepare.py`, источники с `dedupe: true`): ключ предложения — нижний регистр, ё → е, только
  буквы и цифры (не зависит от токенизации), не короче 12 знаков; с ключами сравниваются WikiANN test ru/en, `test_factru`,
  `test_nerel` и тексты фикстур оценки (`data.overlap_fixtures`: корпус жанров — DOCX/XLSX/PPTX, снимки PDF, CSV/JSON;
  набор `heldout`; `tests/fixtures/ner/backlog-0.4.json`, `heldout-names.json`) по строкам и предложениям. Совпавшие
  предложения и документы с ≥ 2 совпадениями выбрасываются из train; отчёт — `data_info.json` → `test_overlap`.
  Результат (финальная смесь): NEREL — 8 совпавших предложений (2 — WikiANN ru test: «Криштиану Роналду», «Владимир Путин»;
  6 — собственный test NEREL: короткие заголовки-имена и «Это невозможно .»), документов с ≥ 2 совпадениями нет;
  `test_factru` — 0 (документы Викиновостей OpenCorpora в factRuEval с NEREL не пересеклись); корпус жанров и отложенные
  наборы — 0. Nerus — 0 совпадений со всеми наборами.

## Окружение

* Python 3.12 через [`uv`](https://docs.astral.sh/uv/) (системный `python3` не нужен).
* PyTorch с CUDA 12.8 (индекс `pytorch-cu128` в `pyproject.toml`) — нужен для Blackwell (RTX 50xx, `sm_120`).
  Без GPU всё работает на CPU, обучение заметно дольше.
* Кэш Hugging Face — в `tools/ner-train/.cache/hf` (задаётся в `common.py`).

```bash
cd tools/ner-train
uv sync
uv run python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_arch_list())"
```

## Последовательность команд

```bash
cd tools/ner-train
uv sync                                   # Python 3.12 + torch cu128 и остальные зависимости
uv run python prepare.py                  # data.sources[] + синтетика жанров -> runs/rubert-tiny2-ner-ruen/data/
uv run python teacher.py                  # учитель XLM-R base, ~26 мин на RTX 5070 Laptop (8 ГБ), смесь 1.2.0
uv run python train.py                    # ученик rubert-tiny2 с дистилляцией, 15 эпох, ~20 мин
uv run python evaluate.py --strict        # F1 по классам, ORG precision на synth_genre_test, гейты (код 1 при провале)
uv run python export_onnx.py              # ONNX fp32, opset 17
uv run python quantize.py                 # int8, гейт <= 40 МБ
uv run python verify_onnx.py              # согласие argmax int8 <-> PyTorch >= 99 % на 2 000 предложениях (код 1 при провале)
uv run python calibrate.py                # порог nerThreshold
uv run python bench_ort.py                # мс/окно в ORT CPU, 1 нить
uv run python make_tokenizer_fixture.py   # tests/fixtures/ner/wordpiece-cases.json
uv run python make_pack_src.py            # models-src/rubert-tiny2-ner-ruen/ (другая версия там -> нужен --force)
```

Команды выше — для текущего кода (пакет 1.2.0, раздел «1.2.0» ниже; NEREL и Nerus скачиваются в `.cache/` при первом
`prepare.py`, дамп Nerus — 1.96 ГБ). Пакет 1.1.0 воспроизводится кодом коммита `b5ec40c`, 1.0.0 — `7e9dd06`
(`git checkout <коммит> -- tools/ner-train`): там другие `synth.py` и `config.yaml`.

Варианты: без синтетики — `--set data.synth.enabled=false` ко всем командам (WikiANN-гейты берутся, но на
договорных текстах ORG почти не находится — см. ниже); без дистилляции — пропустить `teacher.py` и добавить
`--set distill.enabled=false` (F1(ORG) ru ≈ 0.73, гейт К7 не берётся).
Эксперимент в отдельном каталоге: добавить ко всем командам `--set run_id=<имя>`.

После обучения можно освободить место: `runs/<id>/checkpoints/`, `runs/<id>/teacher/checkpoints/` не нужны
(на диске остаётся ≈ 1.6 ГБ, из них 1.1 ГБ — учитель).

Затем в корне репозитория: `npm run pack:model -- --id=rubert-tiny2-ner-ruen` (zip в `release/`, хеши файлов
добавляет JS-упаковщик).

## Что делает каждый скрипт

| Скрипт | Что делает | Результат |
|---|---|---|
| `prepare.py` | Собирает train из `data.sources[]` (веса — повторы train-части, 0 — источник выключен) и синтетики (`data.synth.share`, предел `max_ratio`), отложенные `test_factru`, `test_nerel`, `validation_nerel` и `test_synth_genre`; проверка пересечений `dedupe`-источников с тестами и фикстурами (`test_overlap`, с 1.2.0); токенизирует базовым `BertTokenizerFast` (`max_length` 128), метка — на первый субтокен слова, остальным `-100`; отпечаток train (`train_fingerprint`) | `runs/<id>/data/`, `data_info.json` |
| `sources.py` | Загрузчики корпусов: `wikiann` (HF), `factru` и `nerel` (архив закреплённого коммита GitHub, проверка sha256, конвертация меток), `nerus` (дамп CoNLL-U, детерминированная выборка документов, кэш) | — |
| `teacher.py` | (Дистилляция) обучает учителя (`distill.teacher`, по умолчанию `FacebookAI/xlm-roberta-base`) на тех же данных и сохраняет его логиты по словам train; для XLM-R large на 8 ГБ — `teacher_freeze_embeddings`, `teacher_grad_accum`, `teacher_gradient_checkpointing` | `runs/<id>/teacher/` |
| `train.py` | `AutoModelForTokenClassification` + `Trainer`, оценка каждую эпоху, лучшая по `eval_f1` (seqeval, ru+en validation); при `distill.enabled` — CE + KL к учителю | `runs/<id>/model/`, `train.json` |
| `evaluate.py` | seqeval по классам на WikiANN ru/en test/validation, `test_factru`, `test_synth_genre` (по жанрам; ложные ORG на отрицательных предложениях), гейты `ru_per_f1`, `ru_org_f1`, `synth_genre_org_precision`, `synth_genre_false_org` (≤, ложные ORG так, как декодирует расширение: ORG ≥ 0.85), `heldout_names_recall_gain` (полнота PER на отложенных именах против 1.1.0, с 1.2.0); `--strict` — код выхода 1 при провале | раздел `metrics` в `eval.json` |
| `export_onnx.py` | ONNX opset 17, динамические оси `batch`/`sequence`, входы `input_ids`, `attention_mask`, `token_type_ids` (int64), выход `logits`; `onnx.checker` и сверка с PyTorch | `runs/<id>/onnx/model.fp32.onnx` |
| `quantize.py` | `quant_pre_process` + `quantize_dynamic` (MatMul, int8, per-channel; `quantize.keep_fp32` — узлы MatMul, оставленные fp32; в опубликованном 1.2.0 пусто, как в 1.1.0) + построчная uint8-квантизация таблицы эмбеддингов (см. ниже); гейт ≤ 40 МБ | `runs/<id>/onnx/model.int8.onnx` |
| `verify_onnx.py` | Согласие argmax int8 ↔ PyTorch fp32 и средняя \|Δlogit\|: гейт ≥ 99 % — на 2 000 предложениях test (1 000 ru + 1 000 en, с 1.2.0; 50 предложений — справочно), батч [8,128] на `CPUExecutionProvider`, F1 int8 на полном test; с 1.2.0 — тот же int8 на проверках декодирования расширения: ложные спаны на отрицательных `synth_genre_test` (argmax и расширение) и полнота PER на отложенных именах К10 против int8 1.1.0 (`verify.baseline_onnx`); код 1 при провале гейта | раздел `verify` |
| `calibrate.py` | Порог `nerThreshold` по int8-модели на ru+en validation: сетка 0.30…0.95 шаг 0.05, максимум span micro-F1 | `runs/<id>/calibration.json` |
| `bench_ort.py` | мс на окно [1,128] и [8,128] в onnxruntime CPU, одна нить (ориентир для WASM) | раздел `bench_ort` |
| `make_tokenizer_fixture.py` | 40 случаев для JS-токенизатора: слова с офсетами (UTF-16) и id субтокенов | `tests/fixtures/ner/wordpiece-cases.json` |
| `make_pack_src.py` | Собирает `model.onnx`, `vocab.txt`, `config.json`, `LICENSE`, `NOTICE`, `pack.src.json`; источники и лицензии — из `data.sources[]` (только вошедшие в train по `data_info.json`), `version` — из конфига; `--out <dir>` — другой каталог, `--force` — перезаписать пакет другой версии | `models-src/<id>/` |
| `compare_natasha.py` | Только оценка: наша модель (ONNX int8 пакета, справочно PyTorch fp32) против Natasha (Slovnet NER) на русских наборах и корпусе жанров, размер, холодный старт и скорость в одну нить; Natasha — в группе зависимостей `compare`, в обучение и пакет не попадает (раздел «Сравнение с Natasha») | `runs/compare-natasha/compare.json` |
| `synth.py` | Шаблонные предложения с вымышленными сущностями: договоры (1.0.0), 8 деловых жанров (1.1.0) и 6 жанров 1.2.0 (инициалы, иностранные имена, имена без контекста, таблицы, омонимы, документы 0.5); словари разбиты на train/test для `synth_genre_test` | — |
| `ablation.py` | Несколько прогонов на одних и тех же отложенных наборах одного каталога данных (validation WikiANN, NEREL dev, test WikiANN/factRuEval, `synth_genre_test`) — абляция 1.2.0 | `runs/ablation.json` |
| `pipeline_values.mjs` (Node) | Значения PERSON / COMPANY, найденные всем конвейером расширения (правила + словари + модель, `analyze()` в коммерческом режиме) на корпусе жанров — второй замер `compare_natasha.py --pipeline-json` | JSON |

Все числа собираются в `runs/<id>/eval.json` (каждый скрипт пишет свой раздел).

## Решения и находки

**Почему дистилляция.** С гиперпараметрами из задания (lr 5e-5, batch 32, 5 эпох, warmup 10 %) F1(ORG) на ru test
= 0.708 при гейте 0.75. Перебор не помог — потолок маленькой модели (3 слоя) на ORG ≈ 0.73–0.74
(выбор — по `eval_f1` на validation, test только для сводки):

| Вариант | val F1 | ru PER | ru ORG | ru LOC | en PER |
|---|---|---|---|---|---|
| lr 5e-5, 5 эп. (задание) | 0.7571 | 0.903 | 0.708 | 0.835 | 0.768 |
| lr 5e-5, 10 эп. | 0.7608 | 0.899 | 0.717 | 0.843 | 0.769 |
| lr 1e-4, 5 эп. | 0.7626 | 0.904 | 0.726 | 0.851 | 0.775 |
| lr 1e-4, 10 эп. | 0.7619 | 0.898 | 0.733 | 0.847 | 0.772 |
| lr 1e-4, 10 эп., label smoothing 0.1 | 0.7627 | 0.896 | 0.729 | 0.843 | 0.778 |
| lr 1e-4, 10 эп., batch 16 | 0.7655 | 0.897 | 0.736 | 0.853 | 0.777 |
| lr 2e-4, 10 эп. | 0.7623 | 0.898 | 0.738 | 0.850 | 0.773 |
| lr 2e-4, 10 эп., ru×2 в train | 0.7611 | 0.893 | 0.731 | 0.845 | 0.771 |
| lr 3e-4, 15 эп. | 0.7548 | 0.889 | 0.727 | 0.838 | 0.764 |
| **KD**, lr 1e-4, 10 эп., α 0.5 | 0.7855 | 0.915 | 0.756 | 0.864 | 0.801 |
| **KD**, lr 2e-4, 10 эп., α 0.5 | 0.7933 | 0.915 | 0.761 | 0.866 | 0.813 |
| **KD**, lr 2e-4, 15 эп., α 0.5 | 0.7942 | 0.916 | 0.765 | 0.870 | 0.808 |
| **KD, lr 2e-4, 10 эп., α 0.3 — лучший без синтетики** | 0.7964 | 0.915 | 0.758 | 0.863 | 0.809 |

Помогла только дистилляция знаний: учитель `FacebookAI/xlm-roberta-base` (MIT), обученный на тех же
WikiANN ru+en (3 эпохи, lr 3e-5; ru test: PER 0.942, ORG 0.805), даёт мягкие метки на словах train;
ученик учится на `α·CE(gold) + (1−α)·T²·KL(учитель‖ученик)`, T = 2. Учитель не распространяется, в пакет
попадают только веса ученика.

**Почему синтетика.** WikiANN — это заголовки статей Википедии: там нет организаций с ОПФ и кавычками
(«ООО “Меридиан-М”», «Общество с ограниченной ответственностью «…»») и ФИО в косвенных падежах и с
инициалами. Модель только на WikiANN (KD, без синтетики) на договорном корпусе `tests/fixtures/ner/eval-ru.json`
(приближённая оценка этим кодом, точное совпадение спанов, порог 0.7) давала PER 0.742, ORG 0.228; JS-провайдер на
том же экспорте — ORG 0.595 (гейт К8 ≥ 0.65 не взят). `synth.py` добавляет 4 000 шаблонных предложений (10 % от
train WikiANN; 75 % ru, 25 % en): короткие и полные ОПФ, три вида кавычек, названия без ОПФ, ФИО в 4 падежах,
инициалы до и после фамилии, фамилии на -ский и несклоняемые, «ИП» вне спана, адреса, негативы
(«Заказчик», должности). Словари и шаблоны собственные, не из генератора корпуса оценки; но стиль тот же,
поэтому числа на `eval-ru.json` оптимистичны — решающими для К7 остаются числа WikiANN. Сравнение (KD, α 0.3, lr 2e-4):

| Вариант | val F1 WikiANN | ru PER | ru ORG | en PER | eval-ru PER / ORG (Python, точное совпадение) |
|---|---|---|---|---|---|
| без синтетики, 10 эп. | 0.7963 | 0.917 | 0.764 | 0.809 | 0.742 / 0.228 |
| синтетика 10 %, 10 эп. | 0.7947 | 0.914 | 0.755 | 0.814 | 0.929 / 0.837 |
| **синтетика 10 %, 15 эп. — выбран** (по val F1) | 0.7978 | 0.916 | 0.762 | 0.810 | 0.941 / 0.758 |

**Квантизация.** Стандартный `quantize_dynamic` с `Gather` квантует таблицу эмбеддингов одним масштабом на всю
таблицу (uint8, per-tensor) — файл 27.9 МБ, но согласие argmax падает до 98.1 % на 50 предложениях
(98.5 % на 2000). Поэтому: MatMul — `quantize_dynamic` int8 per-channel; эмбеддинги слов — построчная
асимметричная uint8-квантизация (масштаб и минимум на каждую строку словаря), собранная из стандартных
операторов `Gather → Cast → Mul → Add` (+0.67 МБ на масштабы). Позиционные эмбеддинги (2048×312) и
token_type оставлены fp32. В графе только операторы домена `ai.onnx` (opset 17): `MatMulInteger`,
`DynamicQuantizeLinear`, `Gather`, `LayerNormalization`, `Softmax`, `Erf` и т. п. — без com.microsoft.
Обрезка словаря не понадобилась.

**Экспорт.** `torch.onnx.export(..., dynamo=False)` с `attn_implementation="eager"`; оболочка модели
обязательно в `eval()` — иначе экспортёр после трассировки возвращает режим обучения (dropout) и сверка
с PyTorch ломается. `quant_pre_process` запускается без symbolic shape inference (на этом графе она падает
с «Incomplete symbolic shape inference»), ONNX shape inference достаточно.

**Калибровка.** Декодирование как в расширении: метка первого субтокена каждого слова, мягкое слияние BIO
(I-X после O или другого типа начинает новый спан). Score спана по умолчанию — как в JS-провайдере:
средняя по словам маргинальная вероятность типа P(B-X)+P(I-X) на первом субтокене (`calibrate.score: marginal`);
вариант `argmax` — средняя вероятность предсказанной метки. Метрика — точное совпадение спанов, micro-F1 по
PER+ORG+LOC на ru+en validation. Обе шкалы дают порог 0.70; кривая плоская (0.65–0.75 различаются < 0.001 F1).

**Токенизатор (для JS).** `BertNormalizer(clean_text=true, handle_chinese_chars=true, strip_accents=null,
lowercase=false)` + `BertPreTokenizer`, WordPiece `##`, `max_input_chars_per_word=100` (слово длиннее —
целиком `[UNK]`). Управляющие и форматирующие символы (например, U+200B) удаляются, NBSP — пробел,
иероглифы CJK — отдельные слова, эмодзи и «—», «“», «‘» — `[UNK]`. Офсеты в фикстуре — в единицах UTF-16
(индексы строк JS), а не в кодовых точках Python. `vocabSample` — все токены, встречающиеся в случаях, и
спецтокены: жадный longest-match по такому подмножеству даёт тот же результат, что и по полному словарю.

**Воспроизводимость.** Сиды фиксированы (`seed: 42`, `data_seed`), но обучение на GPU (fp16, cuDNN) не
бит-в-бит детерминировано: повторные прогоны одного рецепта расходятся на ±0.005 F1 (например, ru ORG 0.758 / 0.764).

## Результаты 1.0.0

Прогон `runs/rubert-tiny2-ner-ruen/` (2026-10-15, RTX 5070 Laptop, torch 2.11.0+cu128, transformers 4.57.6,
onnxruntime 1.31.0; рецепт из `config.yaml`: KD + синтетика 10 %, lr 2e-4, 15 эпох). Полные числа —
в `runs/rubert-tiny2-ner-ruen/eval.json`.

| | PER | ORG | LOC | micro |
|---|---|---|---|---|
| ru test, PyTorch fp32 | **0.9146** (гейт ≥ 0.85) | **0.7601** (гейт ≥ 0.75) | 0.8617 | 0.8441 |
| en test, PyTorch fp32 | 0.8106 (≥ 0.80, справочно) | 0.6511 | 0.7707 | 0.7439 |
| ru test, ONNX int8 | 0.9159 | 0.7616 | 0.8612 | 0.8448 |
| en test, ONNX int8 | 0.8091 | 0.6521 | 0.7719 | 0.7442 |

* Время обучения: ученик 306 с (15 эпох), учитель 374 с (3 эпохи); весь конвейер ≈ 15 мин.
* Размер: `model.fp32.onnx` 111.1 МБ → `model.int8.onnx` 30.4 МБ (гейт ≤ 40 МБ).
* Согласие argmax int8 ↔ PyTorch fp32: 99.70 % на 50 предложениях (670 токенов, гейт ≥ 99 %),
  99.65 % на 2000 предложениях; средняя |Δlogit| 0.026. ONNX fp32 ↔ PyTorch: 100 %, |Δ| 6e-7.
* Калиброванный порог: **0.70** (marginal; span micro-F1 0.8089 на ru+en validation, при 0.60 — 0.8074).
* onnxruntime CPU (нативный), 1 нить: [1,128] 2.8 мс, [8,128] 24.9 мс (3.1 мс/окно); создание сессии ≈ 0.1 с.
* JS-провайдер (`node scripts/bench-ner.mjs`, onnxruntime-web WASM, порог 0.7): холодная инициализация 293 мс,
  ≈ 12.5 мс/окно; `eval-ru.json`: PER 0.982, ORG 0.923, LOC 0.938 (micro 0.956).

## 1.1.0

Пакет `rubert-tiny2-ner-ruen` 1.1.0 (версия расширения 0.4, WP11-C): та же архитектура и формат (провайдер не меняется),
переобучение на смеси корпусов с синтетикой деловых жанров. Цель — убрать ложные «организации» на заголовках капсом,
нумерованных заголовках, аббревиатурах и названиях продуктов (концепция 0.4, К6–К8) без регрессии WikiANN.

### Данные (`config.yaml` → `data`)

* `data.sources[]` — источник: `id`, `kind` (`wikiann` | `factru`), `weight` (сколько раз повторить train-часть; дробная часть —
  случайная подвыборка), `license`, `url`, `citation` (идут в `NOTICE` и `pack.src.json`). Метки вне PER/ORG/LOC → O.
* `data.mode`: `sources` — все источники; `teacher_synth` — запасной путь концепции (если внешние корпуса отклонены):
  остаются только `wikiann`, доля синтетики поднимается до `synth.teacher_synth_min_share` (0.5), мягкие метки учителя
  XLM-R — на всём train, включая синтетику.
* `data.synth`: `share` — доля синтетики в итоговом train (0.35; проверяется `share ≤ max_ratio`, по умолчанию 0.5 — вместо
  `assert ≤ 20 %` 1.0.0), `genre_share` 0.8 — жанровые шаблоны среди синтетики (остальное — договоры 1.0.0),
  `negative_share` 0.45 — предложения без сущностей среди жанровых (проверка: среди всей синтетики ≥ `min_negative_share` 0.3),
  `seed` 7; `test_seed` 20261019 и `test_size` 2000 — отложенный набор `synth_genre_test`.
* Жанры `synth.py`: ru — коммерческое предложение (`proposal`), деловое письмо (`letter`), счёт/УПД (`invoice`),
  регламент/инструкция (`manual`), резюме (`resume`), переписка/чат (`chat`), акт сверки (`reconciliation`, с C2),
  презентация (`deck`, с C2); en — `letter_en`, `resume_en`.
* Добавлено в C2 (по ошибкам пробной модели на корпусе жанров): организации без ОПФ со строчными словами внутри — один
  спан ORG (`ru_org_desc`: «Сибирская строительная группа», «Камский завод железобетонных изделий», «Бюро переводов
  Старый Мост» — по шаблону, сами названия корпуса не используются); должности en — O («Head of Partnerships»,
  «Account Manager», отдельной строкой и после имени); предметы — O («Ноутбук», «Сервер», «Монитор», отдельной строкой,
  в позициях счёта); продукты внутри реплик чата и одним словом («в Notion всё есть», «Telegram»); заголовки en в Title
  Case («Our Approach», «Why Us»); en-имена капсом (с инициалом); больше прилагательных фамилий (22 %, в т. ч. на -ой).
* Исключение корпуса оценки (`synth.exclude_gold`, по умолчанию `tests/fixtures/genres/**/*.gold.json`): слова имён из
  PERSON/COMPANY gold (кроме общих: ОПФ, «агентство», «завод», «банк», «плюс» …) — блок-лист; элемент словаря
  синтетики, содержащий такое слово или его словоформу (общий префикс без двух последних букв, ≥ 5), не используется.
  `data_info.json` → `synth.gold_exclusion`: число файлов, хеш gold, удалённые элементы словарей и точные совпадения
  gold-значений со спанами синтетики train, `synth_genre_test` и реальных корпусов.
  O: заголовки капсом («ВХОДИТ В ПАКЕТ», «ПОЧЕМУ ТАК»), нумерованные («05 Цены», «3 . Оплата»), обрывки строк
  («Новый документ или»), аббревиатуры (ЭДО, ВЭД, УПД, ТЗ, ФИО, КП, НДС, MVP, API, CRM, ERP, KPI, …), продукты (Word, Excel,
  PowerPoint, Telegram, Zoom, 1С, Bitrix24, …), должности. ORG: ОПФ + кавычки (в т. ч. капсом «ООО «РОМАШКА»»),
  «Студия/Агентство/Бюро/Компания + Название», банки, учебные заведения. PER: подписи, контакты, «Уважаемый Иван Петрович»,
  шапка резюме (в т. ч. капсом), имена в чате.
* `synth_genre_test` (`test_synth_genre` в `data/`): все словари сущностей и заголовков/обрывков/реплик разбиты
  детерминированно (индекс % 5 == 2 → test), test-часть не встречается в train-синтетике; предложения, совпавшие с
  train, отбрасываются. Аббревиатуры и продукты общие намеренно (закрытый класс, который расширение должно оставлять O).
  Синтетика того же генератора — числа на нём оптимистичны; решающие для К6/К7 — корпус жанров WP11-B (`npm run eval-genres`).

### Гейты (`config.yaml` → `gates`, `evaluate.py --strict`)

`ru_per_f1 ≥ 0.91`, `ru_org_f1 ≥ 0.75` (WikiANN ru test, seqeval, PyTorch fp32; было 0.78 — снижено координатором в C2
до «без регрессии к 1.0.0», так как 0.78 rubert-tiny2 не берёт, см. пробу ниже), `synth_genre_org_precision ≥ 0.85`
(точность ORG на `synth_genre_test`); справочно — `en_per_f1 ≥ 0.80`, ложные ORG на отрицательных предложениях жанров
(`metrics.synth_genre.false_org_on_negatives`), F1 на `test_factru`. `--strict` завершает процесс с кодом 1, если не взят
хотя бы один не-справочный гейт.

### Команды

```bash
cd tools/ner-train
R="--set run_id=rubert-tiny2-ner-ruen"     # финальный прогон C2; пробный — --set run_id=x-genre-probe
uv run python prepare.py $R                # ~30 с; factRuEval качается в .cache/factru/ (коммит dfe9623, sha256 в конфиге)
uv run python teacher.py $R                # XLM-R base, 3 эпохи, ~10 мин
uv run python train.py $R                  # 15 эпох, ~7.5 мин
uv run python evaluate.py $R --strict
uv run python export_onnx.py $R && uv run python quantize.py $R && uv run python verify_onnx.py $R
uv run python calibrate.py $R && uv run python bench_ort.py $R
uv run python make_tokenizer_fixture.py $R # только при смене словаря/токенизатора (не меняется в 1.1.0)
uv run python make_pack_src.py $R --force  # models-src/<id>/ (там 1.0.0 -> нужен --force); проба: --out runs/<id>/pack-src
```

Учитель XLM-R large на 8 ГБ (≈ 6.7 ГБ, ≈ 25 мин на 3 эпохи):

```bash
XL="--set distill.teacher=FacebookAI/xlm-roberta-large --set distill.teacher_lr=2.0e-5 --set distill.teacher_batch=16 \
    --set distill.teacher_grad_accum=2 --set distill.teacher_freeze_embeddings=true \
    --set distill.teacher_gradient_checkpointing=true --set distill.teacher_eval_batch=64"
uv run python teacher.py $R $XL && uv run python train.py $R $XL
```

Чекпоинтинг — нереентрантный (`use_reentrant: False`): с замороженными эмбеддингами реентрантный вариант молча обнуляет
градиенты всех слоёв энкодера (учится только классификатор; признак — предупреждение `check_backward_validity` и 20 it/s
вместо 5). Учителя другого прогона можно переиспользовать двумя способами: (1) скопировать `runs/<a>/teacher` в `runs/<b>/`, только если
train тот же — `train.py` сверяет `train_fingerprint` из `data_info.json` и `teacher/teacher.json`; (2) при другой смеси —
`--set distill.teacher_from=runs/<a>/teacher/model` (и `distill.teacher` той же архитектуры — для токенизатора): `teacher.py`
не обучает, а только пересчитывает логиты на новом train (≈ 10 мин для large на 89 тыс. предложений вместо 30 мин обучения), так дешевле перебирать веса
смешивания в C2. Веса источников из командной строки — по индексу: `--set data.sources.0.weight=2`.

### Пробный прогон `x-genre-probe` (19–20.10.2026, WP11-C1)

Смесь: WikiANN ru 20 000 + en 20 000 + factRuEval-2016 3 869 × 2 = 47 738 реальных предложений и 25 705 синтетических
(35 %: proposal 4 139, letter 2 727, invoice 2 810, manual 2 737, resume 2 713, chat 2 682, letter_en 1 359, resume_en 1 326,
договоры 3 929 + 1 283 en; без сущностей — 36.4 %); train 73 443. `synth_genre_test` — 2 000 (568 без сущностей),
`test_factru` — 1 038 предложений (20 % документов). Рецепт как у 1.0.0: KD α 0.3, T 2, lr 2e-4, 15 эпох, batch 32.
Полные числа — `runs/x-genre-probe/eval.json`; базовая модель 1.0.0 на тех же отложенных наборах — `runs/x-baseline-100/eval.json`.

| Модель | ru PER | ru ORG | ru LOC | en PER | en ORG | en LOC | factRu PER / ORG | synth_genre ORG P | ложных ORG на 568 отриц. |
|---|---|---|---|---|---|---|---|---|---|
| 1.0.0 (опубликованная) | 0.915 | 0.760 | 0.862 | 0.811 | 0.651 | 0.771 | 0.736 / 0.412 | 0.419 | 522 |
| учитель XLM-R base (`x-genre-probe`) | 0.941 | 0.803 | 0.889 | 0.887 | 0.750 | 0.837 | — | — | — |
| **ученик `x-genre-probe`**, fp32 | **0.914** | **0.761** | 0.868 | 0.814 | 0.658 | 0.769 | 0.864 / 0.690 | **0.945** | **27** |
| ученик `x-genre-probe`, int8 | 0.913 | 0.760 | 0.867 | 0.815 | 0.657 | 0.768 | — | — | — |
| учитель XLM-R large (`x-genre-probe-xl`) | 0.952 | 0.837 | 0.905 | 0.894 | 0.777 | 0.856 | — | — | — |
| ученик `x-genre-probe-xl` (те же данные, учитель large), fp32 | 0.916 | 0.756 | 0.865 | 0.805 | 0.650 | 0.766 | 0.862 / 0.697 | 0.955 | 25 |
| ученик `x-genre-ru2` (WikiANN ru ×2, en ×0.5, учитель large через `teacher_from`), fp32 | 0.912 | 0.751 | 0.862 | 0.777 | 0.617 | 0.729 | 0.845 / 0.701 | 0.957 | 20 из 563 |

Гейты `x-genre-probe`: `ru_per_f1` 0.9143 ≥ 0.91 — PASS; `ru_org_f1` 0.7613 ≥ 0.78 — **FAIL**; `synth_genre_org_precision`
0.9449 ≥ 0.85 — PASS; `en_per_f1` 0.8143 ≥ 0.80 — PASS (справочно); `evaluate.py --strict` → код 1.

По жанрам `synth_genre_test` (ученик): PER P/R — proposal 0.915/0.949, letter 0.992/1.000, invoice 0.970/0.970,
manual 0.924/0.955, resume 0.949/0.949, chat 0.975/0.975, letter_en 1.000/1.000, resume_en 1.000/0.821; ORG P —
0.983 / 0.983 / 0.972 / 0.973 / 0.975 / 0.791 / 0.860 / 0.844. Оставшиеся ложные ORG: продукты в репликах чата
(«Notion» 11, «Telegram» 4), английские заголовки («Our Approach», «WHY US», «SKILLS»), «БЕЗОПАСНОСТЬ»; PER капсом в
резюме en («PETER CLARK») и прилагательные фамилии («Заречная», «Покровская») уходят в ORG/LOC.

Прочее: время — учитель 609 с, ученик 449 с (≈ 19 мин с подготовкой и оценкой); `model.fp32.onnx` 111.1 МБ → `model.int8.onnx`
30.4 МБ; согласие argmax int8 ↔ PyTorch 99.70 % (50 предложений), 99.58 % (2 000); порог калибровки 0.70 (micro-F1 0.809);
ORT CPU 1 нить (int8, перемерено на простаивающей машине вместе с 1.0.0): [1,128] 2.7 мс, [8,128] 2.71 мс/окно
(1.0.0: 3.65 / 2.68 мс) — скорость та же, архитектура не менялась. Время второго прогона `x-genre-probe-xl`:
учитель large 1 785 с (6.7 ГБ видеопамяти), ученик 402 с; `x-genre-ru2`: логиты учителя 9.6 мин, ученик 508 с.

**Вывод пробы.** Синтетика жанров + factRuEval сняли ложные организации на деловых жанрах (ORG precision на
`synth_genre_test` 0.42 → 0.95, ложных ORG на отрицательных предложениях 522 → 27; factRu ORG F1 0.41 → 0.69) без
регрессии WikiANN (ru PER 0.914, ORG 0.761 против 0.915 / 0.760 у 1.0.0). Гейт `ru_org_f1 ≥ 0.78` не взят ни одним
вариантом: ни учитель large (ORG учителя 0.803 → 0.837, у ученика 0.761 → 0.756), ни смесь с упором на ru (0.751). Вместе с
перебором 1.0.0 (0.708–0.765, плато val F1 к 12-й эпохе) это потолок ёмкости rubert-tiny2 (3 слоя, hidden 312) на WikiANN ORG.

### Что менять в C2

* Рецепт — как `x-genre-probe` (он в `config.yaml` по умолчанию): WikiANN ru ×1, en ×1, factRuEval ×2, синтетика 35 %
  (жанры 80 %, отрицательных 45 % среди жанровых), KD от XLM-R base, α 0.3, T 2, lr 2e-4, 15 эпох. Учитель large даёт
  +0.01 к точности ORG и PER на жанрах, но не к WikiANN ORG и стоит +20 мин. Выбирать между ними по корпусу жанров WP11-B
  (`npm run eval-genres` с `NER_MODEL_DIR`), а не по синтетике.
* Синтетика: продукты внутри реплик чата и коротких строк (Notion, Telegram — 15 ложных ORG из 27), заголовки en в
  Title Case («Our Approach»), en-имена капсом в шапке резюме, женские прилагательные фамилии (-ая/-ской) в подписях.
* Ru×2 / en×0.5 не повышают ru ORG (0.751) и роняют en PER (0.777) — веса WikiANN не трогать.
* `ru_org_f1 ≥ 0.78` этой архитектурой не берётся (потолок 0.75–0.765 при любом учителе, смеси и числе эпох). Варианты
  для владельца: гейт «без регрессии к 1.0.0» (≥ 0.75, как в 0.2) с решающей метрикой ORG на корпусе жанров (К7), либо
  другая архитектура ученика — отдельное решение концепции («Что не делаем в 0.4»), с ростом размера пакета.

### Финальный прогон `rubert-tiny2-ner-ruen-1.1.0` (20.10.2026, WP11-C2)

Рецепт — `config.yaml` как есть (WikiANN ru ×1, en ×1, factRuEval ×2, синтетика 35 %, учитель XLM-R base, KD α 0.3, T 2,
lr 2e-4, 15 эпох) + доработки синтетики C2 и исключение gold корпуса жанров. Команды:

```bash
cd tools/ner-train
R="--set run_id=rubert-tiny2-ner-ruen-1.1.0"
uv run python prepare.py $R && uv run python teacher.py $R && uv run python train.py $R
uv run python evaluate.py $R --strict
uv run python export_onnx.py $R && uv run python quantize.py $R && uv run python verify_onnx.py $R
uv run python calibrate.py $R && uv run python bench_ort.py $R
uv run python make_pack_src.py $R --out runs/rubert-tiny2-ner-ruen-1.1.0/pack-src   # models-src/ собирает координатор
```

Данные: train 73 443 (реальных 47 738, синтетики 25 705 = 35 %, без сущностей 35.6 %; proposal 3 614, letter 2 400,
invoice 2 446, manual 2 391, resume 2 358, chat 2 399, reconciliation 1 201, deck 1 224, letter_en 1 284, resume_en 1 209,
договоры 3 829 + 1 350 en). Исключение gold: 26 файлов (хеш `a4faeb57464a63cf`), 83 слова блок-листа, из словарей
убрано 62 элемента; точных совпадений gold PERSON (42) / COMPANY (27) со спанами синтетики train, `synth_genre_test` и
реальных корпусов — **0 / 0** (в пробе C1 было: синтетика train — PERSON 5, COMPANY 3, например «Northwind Systems»,
«Белый Парус», «Лебедева М.П.»; числа пробной модели на корпусе жанров поэтому были чуть оптимистичны).
`synth_genre_test` C2 — 2 000 предложений (566 без сущностей), с жанрами reconciliation и deck и организациями без ОПФ.

| Модель (на наборах C2) | ru PER | ru ORG | ru LOC | en PER | en ORG | en LOC | factRu PER / ORG | synth_genre ORG P / F1 | ложных ORG на 566 отриц. |
|---|---|---|---|---|---|---|---|---|---|
| 1.0.0 | 0.915 | 0.760 | 0.862 | 0.811 | 0.651 | 0.771 | 0.736 / 0.412 | 0.466 / 0.586 | 510 |
| `x-genre-probe` (C1) | 0.914 | 0.761 | 0.868 | 0.814 | 0.658 | 0.769 | 0.864 / 0.690 | 0.855 / 0.884 | 66 |
| учитель XLM-R base (C2) | 0.939 | 0.804 | 0.883 | 0.887 | 0.750 | 0.833 | — | — | — |
| **1.1.0**, PyTorch fp32 | **0.913** | **0.756** | 0.863 | 0.806 | 0.655 | 0.774 | 0.861 / 0.704 | **0.991 / 0.992** | **5** |
| **1.1.0**, ONNX int8 | 0.913 | 0.757 | 0.863 | 0.806 | 0.654 | 0.775 | — | — | — |

Гейты (`evaluate.py --strict`, код 0): `ru_per_f1` 0.9134 ≥ 0.91 PASS; `ru_org_f1` 0.7563 ≥ 0.75 PASS;
`synth_genre_org_precision` 0.9909 ≥ 0.85 PASS; `en_per_f1` 0.8061 ≥ 0.80 PASS (справочно). Оставшиеся ложные ORG на
отрицательных — только en (letter_en 3, resume_en 2). По жанрам PER P/R: ru 0.92–1.00 / 0.96–1.00, en 0.89–0.90 / 0.85.

Прочее: время — подготовка 23 с, учитель 591 с (с логитами 661 с), ученик 437 с (≈ 19 мин всего на RTX 5070 Laptop);
`model.fp32.onnx` 111.1 МБ → `model.int8.onnx` 30.4 МБ (31 852 495 байт, sha256 `941e9f1b…03ec`); согласие argmax
int8 ↔ PyTorch 99.70 % (50 предложений), 99.60 % (2 000); калиброванный порог **0.75** (micro-F1 0.8068; при 0.70 — 0.8063,
кривая плоская: `recommendedThreshold` пакета 0.75, рабочий порог расширения `nerThreshold` 0.7 менять не нужно);
ORT CPU 1 нить int8: [1,128] 2.75 мс, [8,128] 2.70 мс/окно, сессия 88 мс. Пакет-источник —
`runs/rubert-tiny2-ner-ruen-1.1.0/pack-src/` (`version` 1.1.0, `minExtensionVersion` 0.2.0); `models-src/` не тронут.

## 1.2.0

Пакет `rubert-tiny2-ner-ruen` 1.2.0 (версия расширения 0.5, WP12-E, концепция 0.5 п. 8, К10–К12): та же архитектура, токенизатор,
формат пакета и провайдер. Цель — больше людей (иностранные имена, одиночные имена и фамилии без контекста, подписи с одним
инициалом, инициалы без пробела, имена в таблицах и на слайдах) без шума на деловых документах и без регрессии WikiANN
(итог: PER не хуже, ORG ниже 1.1.0 на 0.002–0.004 — в пределах разброса сидов, но не «без регрессии»; гейт ≥ 0.75 пройден).
LLM (Qwen и др.) не используются ни для генерации, ни для разметки; Natasha — только для сравнения.

### Данные

* Источники — раздел «Источники 1.2.0»: WikiANN ru ×1, en ×1, factRuEval ×2 (как в 1.1.0), **NEREL ×0.5** (5 452 из 10 903
  предложений train после проверки пересечений), **Nerus** — 20 000 случайных предложений детерминированной выборки
  документов. Вес подобран по абляции на validation: NEREL ×1 стоит −0.01…−0.015 WikiANN ru ORG на validation (0.741–0.745 против
  0.757 без корпусов, три сида), ×0.5 — 0.755; Nerus 40 000 хуже 20 000 по WikiANN ORG и точности ORG на жанрах. Итог train —
  126 190 предложений: реальных 73 190, синтетики 53 000 (42 %, без сущностей 36 %).
* Синтетика `synth.py`: доля 0.42 итогового train (было 0.35: шесть новых жанров и два корпуса не должны вытеснять жанры 1.1.0;
  при 0.35 ложных ORG на отрицательных предложениях `synth_genre_test` было 9–12, при 0.42 — 0), жанровых 80 %, отрицательных
  45 % среди жанровых. Новые жанры (`GENRES` 1.2.0, веса 2/2/2/2/1/2):
  * `initials` — ФИО с инициалами без пробела и с пробелом в подписях, актах сверки, строках таблиц, письмах: «Комаров Р.А.»,
    «Р.А. Комаров», «Р.А.Комаров», «Р. Комаров», «Комаров Р.», капсом; в падежах («Доверенность выдана Комарову Р.А.»);
  * `foreign` — иностранные имена кириллицей (казахские, татарские и башкирские, грузинские, армянские, польские, немецкие,
    китайские, японские, вьетнамские; склонение по типу фамилии: -ов/-ин и -ский склоняются, -дзе/-швили/-ян у женщин и
    китайские — нет) и латиницей (≈ 50 имён и фамилий разного происхождения; «First Last», «LAST First», «F. Last», «Last F.»);
  * `bare` — одиночные имена и фамилии без контекста («ключи оставил {имя}», «Подпишет {фамилия}», «Это к {фамилии в дат.}»),
    подписи с одним инициалом («Р. Гарипов»), обращения в конце фразы («Счёт выставлен, {имя}.»), «Дорогой/Дорогая» — O;
  * `table` — строки выгрузок CRM, ведомостей и реестров («3 | Фамилия Имя Отчество | телефон | почта», разделители `|`, `;`,
    `,` и без разделителя), ячейки с одним ФИО, строки слайдов и заметок докладчика; заголовки столбцов и статусы — O;
  * `homonym` — омонимы по контексту: «Надежда/Любовь/Злата/Роза/Лилия…» как имя («Звонила Надежда из бухгалтерии») и как
    слово («Есть надежда…», «Плата за аренду…» — O); улицы-прилагательные («на Садовой, 12», «на Тверскую 5») — LOC, не PER;
  * `docs05` — сущности версии 0.5, которые модель 1.1.0 называла организациями, — O: СТС, ПТС, ЭПТС, полис ОМС/ОСАГО, MAC,
    исполнительный лист серии ФС, ЕГРН, КУСП, ВНЖ, МКБ-10 с кодом, диагнозы (≈ 75), марки и модели автомобилей (≈ 110, кириллица
    и латиница), государственные учреждения без топонима («ГБУЗ «Городская поликлиника № 3»», «Мещанский районный суд», «МФЦ»);
    рядом — люди в ролях этих документов (собственник ТС, пациент, должник, истец, судья).
  Плюс ≈ 60 русских и ≈ 50 английских заголовков (одно-два слова) — модели с новостными корпусами чаще принимают заглавное
  слово за LOC/ORG. Словари новых жанров разбиты на train/test так же, как в 1.1.0 (`synth_genre_test`).
* Исключение корпуса оценки (`synth.exclude_gold`, список шаблонов): корпус жанров (теперь и жанры 0.5, и офисные — XLSX, PPTX,
  CSV, JSON), набор `heldout`, случаи К11 `tests/fixtures/ner/backlog-0.4.json` и отложенный набор К10
  `tests/fixtures/ner/heldout-names.json` (65 файлов, хеш `29f9aceaf9ce7f4b`, 321 слово блок-листа, из словарей убрано
  125 элементов). Точных совпадений gold PERSON / COMPANY со спанами синтетики train и `synth_genre_test` — 0 / 0; в реальных
  корпусах встречаются только частые одиночные имена других людей (Артём, Вера, Елена, Ксения, Максим, Наталья, Остап, Платон)
  и фамилия Бирюков — это не наши предложения, а совпадение имён в новостях.
* Отложенный набор имён (К10, `evaluate.heldout_names`): 66 фраз (70 имён) `heldout-names.json`, написанных вручную (не генератором), —
  иностранные имена кириллицей и латиницей, одиночные имена и фамилии, обращения, инициалы без пробела, строки таблиц, — и
  18 случаев К11; 86 вхождений PERSON. Вхождение найдено, если каждое его слово — PER с маргинальной вероятностью ≥ 0.7
  (как декодирует расширение). Гейт `heldout_names_recall_gain` — полнота против опубликованной 1.1.0 ≥ +0.10.

### Абляция (`ablation.py`, одни и те же наборы каталога `x12-full2`; PER / ORG / LOC F1, PyTorch fp32, учитель XLM-R base)

| Прогон | Данные (синтетика) | val ru PER / ORG / LOC | val en | NEREL dev | **test ru** | test_factru | `synth_genre_test` (ложных ORG, argmax) |
|---|---|---|---|---|---|---|---|
| 1.1.0 (опубликованная) | WikiANN + factRu, синтетика 1.1.0 | 0.914 / 0.752 / 0.871 | 0.813 / 0.647 / 0.771 | 0.857 / 0.501 / 0.840 | 0.913 / **0.756** / 0.863 | 0.861 / 0.704 / 0.879 | 0.927 / 0.918 / 0.716 (63) |
| `x12-base2` | без NEREL и Nerus, синтетика 1.2.0 | 0.918 / 0.757 / 0.873 | 0.816 / 0.644 / 0.778 | 0.875 / 0.493 / 0.833 | **0.909** / 0.754 / 0.864 | 0.880 / 0.715 / 0.865 | 0.986 / 0.989 / 0.960 (6) |
| `x12-nerel` | + NEREL ×1 (промежуточная синтетика) | 0.913 / 0.745 / 0.871 | 0.816 / 0.644 / 0.778 | 0.914 / 0.682 / 0.880 | 0.914 / 0.748 / 0.860 | **0.908 / 0.757** / 0.893 | 0.991 / 0.977 / 0.873 (8) |
| `x12-nerus40` | + NEREL ×1 + Nerus 40 000 (промежуточная) | 0.915 / 0.748 / 0.865 | 0.811 / 0.651 / 0.781 | 0.904 / 0.666 / 0.897 | 0.912 / 0.742 / 0.858 | 0.910 / 0.724 / 0.900 | 0.990 / 0.946 / 0.913 (8) |
| `x12-full2` | + NEREL ×1 + Nerus 20 000 | 0.916 / 0.743 / 0.872 | 0.816 / 0.653 / 0.781 | 0.907 / 0.671 / 0.904 | 0.917 / 0.749 / 0.860 | 0.900 / 0.741 / 0.892 | 0.988 / 0.940 / 0.921 (0) |
| `x12-ru2` | как `full2`, WikiANN ru ×2 | 0.909 / 0.746 / 0.868 | 0.810 / 0.645 / 0.782 | 0.907 / 0.668 / 0.891 | 0.911 / 0.741 / 0.858 | 0.899 / 0.743 / 0.892 | 0.986 / 0.990 / 0.940 (5) |
| `x12-final-base` (сиды 42 / 43 / 44) | как `full2`, итоговая синтетика | 0.913 / 0.741 / 0.870 · 0.912 / 0.740 · 0.915 / 0.738 | 0.808 / 0.641 / 0.783 | 0.897 / 0.672 / 0.892 | 0.911 / 0.744 · 0.916 / 0.741 · 0.915 / 0.742 | 0.899 / 0.734 / 0.894 | 0.988 / 0.953 / 0.980 (5 · 6 · 3) |
| `x12-xl` | как `final-base`, **учитель XLM-R large** | 0.914 / 0.741 / 0.869 | 0.809 / 0.643 / 0.778 | 0.912 / 0.665 / 0.900 | 0.912 / 0.741 / 0.860 | 0.902 / 0.747 / 0.894 | 0.990 / 0.990 / 0.928 (5) |
| `x12-ignorg` | как `final-base`, ORG NEREL/Nerus без жёстких меток | 0.912 / 0.739 / 0.868 | 0.813 / 0.645 / 0.781 | 0.906 / 0.427 / 0.883 | 0.908 / 0.741 / 0.857 | 0.893 / 0.593 / 0.869 | 0.982 / 0.976 / 0.957 (4) |
| **1.2.0** (`x12-nerel05`, сид 42) | NEREL **×0.5** + Nerus 20 000, итоговая синтетика | 0.912 / **0.755** / 0.872 | 0.811 / 0.649 / 0.777 | 0.900 / 0.634 / 0.887 | 0.913 / **0.754** / 0.863 | 0.894 / 0.727 / 0.895 | 0.986 / 0.967 / 0.970 (7; расширением — 3) |
| `x12-n05-s43` | то же, сид 43 | 0.913 / 0.748 / 0.867 | 0.814 / 0.640 / 0.780 | 0.893 / 0.652 / 0.888 | 0.916 / 0.744 / 0.863 | 0.909 / 0.732 / 0.893 | 0.988 / 0.987 / 0.941 (4) |

Все строки — на наборах финального каталога `runs/rubert-tiny2-ner-ruen-1.2.0/data` (`ablation.py`, `runs/ablation-1.2.0.json`);
`synth_genre_test` — новый, с жанрами 1.2.0 (494 предложения без сущностей), поэтому у 1.1.0 там 63 ложных ORG. «Промежуточная
синтетика» — `synth.py` до расширения словарей моделей автомобилей, диагнозов и заголовков (прогоны шли параллельно доработке).

Выводы абляции:

* **Что дал NEREL.** Полнота и точность на новостном тексте: factRuEval PER +0.03…+0.05, ORG +0.02…+0.04 (0.715 → 0.727–0.757),
  NEREL dev ORG 0.49 → 0.63–0.68. Цена — WikiANN ru ORG: на validation −0.01…−0.015 при ×1 (соглашения разметки: «ВВС США» в
  WikiANN — одна ORG, в NEREL — ORG и LOC; «Миротворческая операция ООН» — ORG в WikiANN, событие в NEREL). Вес ×0.5 снимает
  большую часть цены (validation ORG 0.755 и 0.748 на двух сидах) и сохраняет половину выигрыша на factRuEval.
* **Что дал Nerus.** Отдельно от NEREL почти ничего на наших метриках: 20 000 предложений не меняют WikiANN ORG относительно
  одного NEREL, 40 000 — ухудшают (validation ORG 0.748, точность ORG на `synth_genre_test` 0.946 против 0.977). Оставлен
  в объёме 20 000 (решение владельца — включить; меньший объём не проверялся). **Польза Nerus абляцией не доказана**:
  `x12-nerel` → `x12-full2` (+ Nerus 20 000 к NEREL ×1) — WikiANN test ORG 0.748 → 0.749, factRuEval ORG 0.757 → 0.741 (хуже),
  ложных ORG на `synth_genre_test` 8 → 0 (но синтетика промежуточная у обоих, и разброс сидов того же порядка); прогона
  «NEREL ×0.5 без Nerus» нет. Разметка Nerus — не ручная, а **автоматический выход Slovnet BERT NER (проект Natasha)**:
  Natasha, которую мы ниже сравниваем с нашей моделью, косвенно участвовала в обучающих данных 1.2.0 (20 000 предложений
  с её разметкой: 16 % train, 27 % реальных предложений). Сравнение с Natasha поэтому не вполне независимо.
* **Учитель XLM-R large** (3 эпохи, 3 652 с, ru test PER 0.943 / ORG 0.821 против 0.936 / 0.794 у base) ученику не помог:
  validation ru ORG 0.741 против 0.741 у base на тех же данных, WikiANN test 0.741 против 0.744, factRuEval и жанры — в пределах
  разброса сидов. Как в 1.1.0, ёмкость rubert-tiny2 — ограничение, а не учитель; оставлен **base** (в 2.5 раза дешевле).
* **Без жёстких меток ORG у NEREL/Nerus** (`ignore_types: [ORG]`, механизм оставлен в `prepare.py`, по умолчанию выключен):
  WikiANN ORG не вырос (0.741), factRuEval ORG упал до 0.593 — проседание WikiANN ORG даёт не разметка ORG корпусов, а их
  доля в смеси; ORG корпусов полезны.
* **WikiANN ru ×2** — хуже (0.741), как и в 1.1.0.
* Разброс сидов ученика при тех же данных и учителе — ±0.004 на WikiANN ORG; гейт 0.75 у смеси с корпусами лежит на границе
  разброса. Финальная модель выбрана по validation (ORG ru 0.755 — наибольший среди смесей с корпусами), test показан как есть.
* Синтетика 1.2.0 без корпусов (`x12-base2`) роняет WikiANN ru PER до 0.909 (< 0.91): корпуса нужны и для этого гейта.
* **`x12-n05-soup`** — «суп моделей»: поэлементное среднее весов двух учеников с одним рецептом 1.2.0 (сиды 42 и 43,
  `rubert-tiny2-ner-ruen-1.2.0` и `x12-n05-s43`; разовый скрипт, в репозитории не оставлен, проверено: среднее весов совпадает
  с `runs/x12-n05-soup/model` до бита). Хуже обоих учеников по всем гейтам: WikiANN ru PER 0.906 / ORG 0.733 (validation ORG
  0.739), en PER 0.788, ложных ORG по argmax 6, К10 +0.081 — **отклонён**; в таблицу абляции не входит (те же данные, не смесь).

### Финальный прогон

Рецепт — `config.yaml` как есть (WikiANN ru ×1, en ×1, factRuEval ×2, NEREL ×0.5, Nerus 20 000, синтетика 42 %, учитель
XLM-R base 3 эпохи, KD α 0.3, T 2, lr 2e-4, 15 эпох, batch 32, сид 42). Каталог прогона `x12-nerel05` переименован в
`runs/rubert-tiny2-ner-ruen-1.2.0` (`x12-nerel05` — ссылка); `prepare.py` с текущим `config.yaml` даёт тот же
`train_fingerprint` `7e41b6db6f5b16fc…` (проверено).

```bash
cd tools/ner-train
R="--set run_id=rubert-tiny2-ner-ruen-1.2.0"
uv run python prepare.py $R && uv run python teacher.py $R && uv run python train.py $R   # ≈ 20 + 26 + 20 мин
uv run python evaluate.py $R --strict
uv run python export_onnx.py $R && uv run python quantize.py $R && uv run python verify_onnx.py $R
uv run python calibrate.py $R && uv run python bench_ort.py $R
uv run python make_tokenizer_fixture.py $R    # фикстура не изменилась (словарь тот же)
uv run python make_pack_src.py $R --force     # models-src/rubert-tiny2-ner-ruen/ (там была 1.1.0; копия — ../ner-models-backup)
cd ../.. && npm run pack:model -- --id=rubert-tiny2-ner-ruen
uv run python ablation.py --data-run rubert-tiny2-ner-ruen-1.2.0 --runs <прогоны>        # таблица выше (из tools/ner-train)
```

Перепаковка по ревью WP12-E (27.10.2026, **без переобучения**: тот же чекпойнт и тот же `model.fp32.onnx`; решение владельца —
весь int8, как в 1.1.0, гейт согласия — на 2 000 предложениях). Версия пакета осталась 1.2.0 (релиза ещё не было); первая
сборка с fp32 в последнем слое сохранена в `../ner-models-backup/rubert-tiny2-ner-ruen-1.2.0-fp32last` (вне git).

```bash
cd tools/ner-train
R="--set run_id=rubert-tiny2-ner-ruen-1.2.0"
uv run python quantize.py $R          # quantize.keep_fp32: [] — все MatMul int8
uv run python verify_onnx.py $R       # гейт: согласие argmax на 2 000 предложениях >= 99 % (код 1 при провале) + int8 на К10 и отрицательных
uv run python calibrate.py $R && uv run python bench_ort.py $R
uv run python make_pack_src.py $R --force
cd ../.. && npm run pack:model -- --id=rubert-tiny2-ner-ruen   # sha256 -> src/core/ner/known-packs.js
npm run bench-ner                                              # и с --dir=<прежний пакет> для сравнения в тот же час
```

| | PER | ORG | LOC | micro |
|---|---|---|---|---|
| WikiANN ru test, PyTorch fp32 | **0.9130** (гейт ≥ 0.91) | **0.7540** (гейт ≥ 0.75) | 0.8633 | 0.8432 |
| WikiANN ru test, ONNX int8 (весь int8; с fp32 в последнем слое — 0.9116 / 0.7545 / 0.8627) | 0.9120 | 0.7539 | 0.8626 | 0.8426 |
| WikiANN en test, fp32 | 0.8094 (≥ 0.80, справочно) | 0.6626 | 0.7750 | 0.7484 |
| `test_factru` (справочно) | 0.8943 | 0.7271 | 0.8947 | 0.8339 |
| NEREL test / dev (справочно) | 0.8902 / 0.9004 | 0.6363 / 0.6338 | 0.9087 / 0.8870 | 0.8351 / 0.8335 |
| `synth_genre_test` (2 000) | 0.9857 | 0.9666 (P 0.9563) | 0.9703 | 0.9775 |

Гейты `evaluate.py --strict` (код 0): `ru_per_f1` 0.9130 ≥ 0.91 PASS; `ru_org_f1` 0.7540 ≥ 0.75 PASS; `synth_genre_org_precision`
0.9563 ≥ 0.85 PASS; `synth_genre_false_org` **3** ≤ 5 PASS — ложные ORG на 494 предложениях без сущностей так, как их декодирует
расширение (маргинальная вероятность типа, ORG ≥ `nerThresholdOrg` 0.85, PER/LOC ≥ 0.7). **Определение гейта сменено:** в 1.1.0
гейт считался по argmax; по argmax у 1.2.0 на новом наборе — **7 > 5 (провал)**, декодированием расширения — 3, у 1.1.0 тем же
способом на её наборе (566 отрицательных) — 3 (по argmax 5). Счёт декодированием расширения принят как гейт с 1.2.0 уже
**после** провала по argmax — решение владельца 27.10.2026; argmax остаётся справочной строкой (`synth_genre_false_org_argmax`).
Для полноты: на прежнем наборе 1.1.0 у 1.2.0 — 6 по argmax и 3 декодированием; на новом наборе у 1.1.0 — 63 и 41 (int8,
`eval.json` → `review_full_int8`). `heldout_names_recall_gain` **+0.116** ≥ 0.10 PASS (полнота PER на 86 отложенных
именах 0.930 против 0.814 у 1.1.0: без контекста 14/15 против 8/15, обращения 4/6, латиница 11/14, иностранные кириллицей 18/18,
инициалы 9/9, таблицы 8/8, К11 16/16); `en_per_f1` 0.8094 ≥ 0.80 PASS (справочно). Пропущены: «Mei Ling Tan», «Ines Moreira»,
«Thabo Nkosi», «Елисей», «Милана», «Есения» (имена без контекста и обращения в конце — предел маленькой модели).

Квантизация — **весь int8, как в 1.1.0** (`quantize.keep_fp32: []`, ревью WP12-E, решение владельца 27.10.2026). Первая
сборка 1.2.0 оставляла классификатор и FFN последнего слоя в fp32: со всеми MatMul в int8 согласие argmax на 50 предложениях
было 98.96 % (7 расхождений из 670 токенов — один токен = 0.15 п. п.) при гейте ≥ 99 %. Гейт перенесён на **2 000 предложений**
(1 000 ru + 1 000 en test, 26 076 токенов, `verify.gate_sentences`; 50 — справочно). Что дал fp32-слой и что стоит его снятие:

| | fp32 в последнем слое (первая сборка) | **весь int8 (опубликованная)** |
|---|---|---|
| Согласие argmax с PyTorch: 2 000 предложений (гейт ≥ 99 %) / 50 (справочно) | 99.62 % / 99.10 % | **99.617 %** (25 976 из 26 076) / 98.96 % |
| Средняя \|Δlogit\| (2 000) | 0.027 | 0.031 |
| WikiANN ru test int8, argmax PER / ORG / LOC | 0.9116 / 0.7545 / 0.8627 | 0.9120 / 0.7539 / 0.8626 |
| WikiANN ru test, порог 0.7 (`compare_natasha.py`) | 0.922 / 0.762 / 0.869 | 0.922 / 0.762 / 0.869 |
| factRuEval, порог 0.7 | 0.891 / 0.734 / 0.904 | 0.891 / 0.735 / 0.904 |
| Ложных ORG на 494 отрицательных: argmax / расширение | 7 / 3 | 7 / 3 |
| Ложных спанов, 514 (набор 1.1.0) / 457 (набор 1.2.0), порог 0.7 | 2 / 3 | 2 / 3 |
| К10 на int8: 1.2.0 / 1.1.0 (int8 опубликованного пакета) | 0.930 / 0.802 | 0.930 / 0.802 (+12.8 п. п.) |
| Корпус жанров, люди, документная F1 моделью (+мостики) / конвейером | 0.934·0.936·0.937 / 0.895·0.919·0.907 | то же (значения конвейера совпадают побайтно) |
| `model.onnx` | 32 971 666 байт (31.4 МБ) | **31 852 495 байт (30.4 МБ)**, sha256 `ed0d7b6f…6ac0` |
| `npm run bench-ner` (один час, вместе с 1.1.0: 0.27 с / 1.85 с) — холодная `init()` / «20 страниц» | 0.35 с / 2.29 с | **0.27 с / 1.89 с** |

То есть fp32-слой менял метрики лишь в третьем знаке и в обе стороны (заметно — только согласие на 50 предложениях), а стоил
+1.1 МБ и ≈ +20 % времени NER.
F1 int8 — в таблице выше.

Прочее: время — подготовка ≈ 40 с, учитель 1 578 с (на этой смеси), ученик 1 228 с (≈ 47 мин всего на RTX 5070 Laptop; часть
времени ученик делил GPU и CPU с другими прогонами); калиброванный порог **0.70** (micro-F1 0.8056; 0.6 — 0.8034;
`recommendedThreshold` пакета 0.7; после перепаковки — тот же 0.70, micro-F1 0.8056); ORT CPU 1 нить: сессия 75 мс, [1,128]
2.79 мс, [8,128] 2.88 мс/окно (1.1.0: 2.75 / 2.70; с fp32-слоем было 3.2 / 3.18).
Пакет: `release/docx-anonymizer-ner-rubert-tiny2-ner-ruen-1.2.0.zip`, **29 606 008 байт, sha256
`a7e022266ae7c37d00988d546c702c299c8aa9a82af0fd9bdcc63404e3ce19e4`** (сборка детерминирована — повтор даёт тот же sha; первая
сборка с fp32-слоем — 30 655 937 байт, `def55521…`, не публиковалась).
`npm run bench-ner` (Node, одна нить WASM, в один час с 1.1.0 и первой сборкой): холодная `init()` 0.27 с (1.1.0 — 0.27, fp32-слой —
0.35), батч 1 / 8 — 2.13 / 3.50 мс на окно (2.12 / 3.46; 2.64 / 4.14), «20 страниц» 1.89 с (1.85; 2.29); eval-ru PER 0.994, ORG 0.978,
LOC 0.950 (1.1.0 — 0.982 / 0.908 / 0.926), eval-en PER 0.905, ORG 0.903, LOC 0.879. Chromium (e2e `ner.spec.js`): холодный
`analyzeFile` образца 0.72 с, тёплый 0.17 с, «20 страниц» целиком 2.33 с.

С моделью в расширении (`NER_MODEL_DIR=models-src/rubert-tiny2-ner-ruen`): корпус жанров — 19 жанров (0.4, 0.5 и офисные),
люди и организации P = R = 1.000 в каждом жанре и режиме, утечек 0, отрицательных примеров, ставших сущностью, 0 (у 1.1.0 —
«Плата» как PER в `realty`, «Городская поликлиника № 3» и «Полис» как ORG в `medical`, «Почта» в `pptx-deck`); `heldout` —
утечек 0, покрытие людей 146/146; К11 — 18/18 случаев (1.1.0 — 17/18, без модели — 6/18); `model-coverage.spec.js` — модель
не открывает ни одного символа, закрытого правилами, на корпусе и сетке ревью WP12-C и на всех 60 DOCX-фикстурах и образце (обычный и коммерческий режим).
После перепаковки в весь int8 всё это перепроверено (`genres`, `heldout`, `model-coverage` с `NER_MODEL_DIR`, e2e `bundled-model`
с обновлением 1.1.0 → 1.2.0 и `ner.spec.js`) — те же результаты.

**Чего эти числа не доказывают.**
* Все метрики «на документах» — синтетика и корпус жанров **одного автора** (тот же человек и тот же генератор пишут и обучающую
  синтетику, и корпус оценки); **реальных документов владельца в замерах нет** (`PRIVATE_FIXTURES` не прогонялся). Решающая
  проверка — на настоящих документах.
* **К10 оптимистичен**: 66 фраз `heldout-names.json` написаны вручную и имена в них не встречаются в синтетике, но рамки фраз
  («ключи оставил …», «Подпишет …», строки таблиц через `|`, подписи с инициалом) — те же, что в шаблонах `synth.py` жанров
  `bare`, `table`, `initials`. Это проверка обобщения на новые имена в знакомых конструкциях, а не на незнакомый текст.
* WikiANN ru ORG у 1.2.0 **ниже 1.1.0 на 0.002–0.004** (fp32 0.754 против 0.756, int8 argmax 0.754 против 0.757, порог 0.7 —
  0.762 против 0.766): гейт ≥ 0.75 пройден, но формулировка «без регрессии к 1.1.0» неверна — это небольшая регрессия в пределах
  разброса сидов (±0.004).
* Разметка Nerus — автоматический выход Slovnet (Natasha), см. «Абляция»; сравнение с Natasha ниже поэтому не вполне независимо.

## 1.2.1 (05.11.2026): та же модель под Apache 2.0

Переобучения нет (решение владельца, WP13-L): `model.onnx`, `config.json` и `vocab.txt` — байт в байт как в 1.2.0, все замеры раздела 1.2.0 относятся
и к 1.2.1. Сменилась лицензия дообученных весов и `config.json` — Apache 2.0 (Copyright 2026 argmaster-dev, Sitimlab), как у кода расширения с 0.5.1;
база `cointegrated/rubert-tiny2` и `vocab.txt` — по-прежнему MIT, уведомление автора в `LICENSE` пакета сохранено. В `models-src/rubert-tiny2-ner-ruen/`
изменены `LICENSE`, `NOTICE` (версия, строка о лицензии весов, фраза о тех же весах) и `pack.src.json` (`version` 1.2.1, `license` `"Apache-2.0 AND MIT"`);
`make_pack_src.py` пишет ту же форму для следующих пакетов. Пакеты 1.0.0–1.2.0 выпущены под MIT и под ней остаются. Строки «под MIT» в таблицах
источников выше описывают критерии и состояние 1.1.0 и 1.2.0.

## Сравнение с Natasha (Slovnet)

Версия 0.5, концепция п. 8, критерий К12. Только оценка: Natasha не используется ни в обучении, ни в пакете, ни в
расширении. Зависимость — в необязательной группе `compare` (`pyproject.toml` → `[dependency-groups]`), основной
конвейер (`uv sync`, команды выше) её не ставит. Замер 26.10.2026, AMD Ryzen 9 7945HX, Python 3.12.

```bash
cd tools/ner-train
# 1.2.0 (27.10.2026): второй замер — весь конвейер расширения (правила + словари + модель) на тех же документах
node ../../tools/ner-train/pipeline_values.mjs --model=../../models-src/rubert-tiny2-ner-ruen --out=runs/compare-natasha/pipeline-1.2.0.json   # из корня репозитория — пути без ../../
node pipeline_values.mjs --model=<1.1.0> --out=runs/compare-natasha/pipeline-1.1.0.json; node pipeline_values.mjs --out=runs/compare-natasha/pipeline-rules.json
uv run --group compare python compare_natasha.py --pipeline-json pipeline-1.2.0=runs/compare-natasha/pipeline-1.2.0.json \
    --pipeline-json pipeline-1.1.0=runs/compare-natasha/pipeline-1.1.0.json --pipeline-json rules-only=runs/compare-natasha/pipeline-rules.json
# 1.1.0 на тех же наборах: --onnx ../../ner-models-backup/.../model.onnx --expect-version 1.1.0 --skip-torch --out runs/compare-natasha-1.1.0
# прежний набор synth_genre_test 1.1.0 (514 отрицательных): --run-id rubert-tiny2-ner-ruen-1.1.0 --skip-torch --out runs/compare-natasha-set110
# -> runs/compare-natasha*/compare.json (вне git) + сводка Markdown в stdout
```

### 1.2.0 против 1.1.0 и Natasha (27.10.2026)

Методика — как ниже (раздел 1.1.0), изменения: `join_adjacent` повторяет `joinAdjacent` расширения 0.5 (PER вплотную и через
инициалы с точкой); корпус жанров — 85 документов: DOCX 36, снимки PDF 39 и **офисные** (XLSX, PPTX, CSV, JSON — 10; текст:
ячейки, абзацы слайдов и заметок, файл как есть); добавлен **второй замер** — весь конвейер расширения: `analyze()` в
коммерческом режиме (`pipeline_values.mjs`), значения PERSON / COMPANY, оцениваются той же документной метрикой. Наборы
предложений — из каталога `rubert-tiny2-ner-ruen-1.2.0` (WikiANN и factRuEval те же, что у 1.1.0; `synth_genre_test` — новый).
Обе модели — опубликованный int8 из пакета (1.2.0 — весь int8, перепаковка по ревью 27.10.2026; замер повторён, отличия от
первой сборки с fp32-слоем — в третьем знаке, ниже уже новые числа); порог 0.7. **Natasha не вполне независима**: 20 000
предложений Nerus в обучении 1.2.0 размечены автоматически Slovnet BERT NER — той же NER-моделью проекта Natasha.

| Набор (F1 PER / ORG / LOC, точное совпадение) | 1.1.0 | **1.2.0** | Natasha |
|---|---|---|---|
| `test_ru` (WikiANN, 10 000) | 0.922 / 0.766 / 0.869 | 0.922 / 0.762 / 0.869 | 0.191 / 0.348 / 0.626 |
| `test_ru` без «Фамилия , Имя» (7 291) | 0.781 / 0.774 / 0.869 | 0.783 / 0.764 / 0.870 | 0.598 / 0.360 / 0.652 |
| `test_factru` (1 038, справочно — возможная утечка у Natasha) | 0.859 / 0.722 / 0.886 | **0.891 / 0.735 / 0.904** | 0.907 / 0.507 / 0.904 |
| `test_synth_genre` ru 1.2.0 (1 793; жанры 1.2.0 — тот же генератор, оптимистично для 1.2.0) | 0.926 / 0.935 / 0.710 | 0.988 / 0.970 / 0.995 | 0.821 / 0.358 / 0.727 |

Ложные спаны на предложениях без сущностей (порог 0.7 / расширение: ORG 0.85):

| Набор | 1.1.0 | 1.2.0 | Natasha |
|---|---|---|---|
| 514 русских из `synth_genre_test` 1.1.0 (прежний набор) | PER 2, ORG 0 (2 предложения) | **PER 0, ORG 2** (2 предложения); с ORG 0.85 — ORG 1 | 214 спанов в 159 предложениях |
| 457 русских из `synth_genre_test` 1.2.0 | PER 8, ORG 46, LOC 18 (67 предложений) | **PER 1, ORG 2** (3 предложения) | 167 спанов в 136 предложениях |

Корпус жанров, документная F1 по значениям (P / R / F1):

| Текст | Вариант | PERSON | COMPANY |
|---|---|---|---|
| DOCX (36) | модель 1.1.0, декодирование расширения (+мостики: `bridgePunct`, `joinAdjacent`) | 0.851 / 0.960 / 0.902 | 0.472 / 0.977 / 0.637 |
| | **модель 1.2.0, +мостики** | **0.892 / 0.980 / 0.934** | 0.589 / 0.977 / 0.735 |
| | модель 1.2.0, «сырое» BIO без мостиков | 0.579 / 0.762 / 0.658 | 0.566 / 0.977 / 0.717 |
| | Natasha по строкам / + те же мостики | 0.791 / 0.901 / 0.843 · 0.906 / 0.960 / 0.933 | 0.264 / 0.977 / 0.415 · 0.289 / 0.977 / 0.446 |
| | весь конвейер: только правила и словари | 0.862 / 0.931 / 0.895 | 1.000 / 0.932 / 0.965 |
| | весь конвейер + 1.1.0 | 0.855 / 0.931 / 0.891 | 0.936 / 1.000 / 0.967 |
| | **весь конвейер + 1.2.0** | **0.862 / 0.931 / 0.895** | **1.000 / 1.000 / 1.000** |
| PDF (39) | модель 1.1.0, +мостики | 0.863 / 0.962 / 0.910 | 0.374 / 0.958 / 0.538 |
| | **модель 1.2.0, +мостики** | **0.896 / 0.981 / 0.936** | 0.505 / 0.979 / 0.667 |
| | Natasha по строкам / + мостики | 0.805 / 0.867 / 0.835 · 0.906 / 0.914 / 0.910 | 0.273 / 0.979 / 0.427 · 0.294 / 0.979 / 0.452 |
| | весь конвейер + 1.1.0 / **+ 1.2.0** | 0.906 / 0.924 / 0.915 · **0.915 / 0.924 / 0.919** | 0.941 / 1.000 / 0.970 · **1.000 / 1.000 / 1.000** |
| Офисные (10) | модель 1.1.0 / **1.2.0**, +мостики | 0.974 / 0.974 / 0.974 · 0.925 / 0.949 / 0.937 | 0.692 / 1.000 / 0.818 · 0.750 / 1.000 / 0.857 |
| | Natasha по строкам / + мостики | 0.721 / 0.795 / 0.756 · 1.000 / 0.949 / 0.974 | 0.562 / 1.000 / 0.720 |
| | весь конвейер + 1.1.0 / **+ 1.2.0** | 0.830 / 1.000 / 0.907 · 0.830 / 1.000 / 0.907 | 1.000 / 1.000 / 1.000 · 1.000 / 1.000 / 1.000 |

* **Цель «люди моделью ≥ 0.85, Natasha 0.84»**: модель так, как её декодирует расширение (`bio.js`: мостики через точку
  инициала и дефис, склейка соседних PER), — **0.934 DOCX / 0.936 PDF / 0.937 офисные** против 0.843 / 0.835 / 0.756 у
  Natasha (с теми же мостиками Natasha — 0.933 / 0.910 / 0.974). «Сырое» слияние BIO без шагов `bio.js` — 0.658 / 0.669: модель
  по-прежнему ставит B на второй инициал, склейку делает `joinAdjacent` (версия 0.5) — поэтому основным числом считаем
  декодирование расширения. 1.1.0 с новым `joinAdjacent` — 0.902 / 0.910 (в замере 26.10 было 0.63–0.65 со старым).
* **Весь конвейер против Natasha**: люди 0.895 / 0.919 / 0.907 против 0.843 / 0.835 / 0.756; организации 1.000 против
  0.42–0.72. Метрика по значениям строгая: точность конвейера по людям 0.83–0.92 — это не ложные люди (перекрытие P = 1.000),
  а артефакты сравнения значений: текст сущности конвейера включает «ИП»/«индивидуальный предприниматель» (в результате они
  не маскируются — `keepPrefix`), а люди из `docProps` (автор документа) и PPTX/XLSX-ячеек вне извлечённого здесь текста не
  входят в gold этой метрики; по людям модель
  в конвейере на этом корпусе почти ничего не добавляет к правилам и словарям (они настраивались на нём) — её вклад виден
  на отложенных наборах (К10/К11, раздел 1.2.0).
* **Организации моделью без фильтров** (точность 0.59 DOCX / 0.51 PDF, у 1.1.0 — 0.47 / 0.37) ниже 0.80: ложные — заголовки,
  названия разделов и учреждений, которые в расширении снимают порог ORG 0.85 и фильтры `filters.js`/стоп-список; в конвейере
  точность организаций — 1.000 (1.1.0 — 0.936 / 0.941).
* Размер и скорость (CPU, одна нить, 1 000 предложений `test_ru`): файлы модели 32.9 МБ (`model.onnx` 31.9 + словарь 1.1) против
  29.0 МБ у Natasha; холодный старт 63 мс против 254 мс; по одному — 380 мс против 432 мс; батч 8 / одним документом — 493 мс
  против 247 мс (с fp32-слоем было 34.1 МБ, 77 мс, 421 и 571 мс).

### 1.1.0 (26.10.2026): что сравнивается

| | Наша модель | Natasha |
|---|---|---|
| Модель | `rubert-tiny2-ner-ruen` **1.1.0**: `models-src/rubert-tiny2-ner-ruen/model.onnx` (int8, версия сверяется по `pack.src.json`, sha256 `941e9f1b…03ec` = `runs/…-1.1.0/onnx/model.int8.onnx`); справочно — PyTorch fp32 `runs/rubert-tiny2-ner-ruen-1.1.0/model` | `natasha` 1.6.0: `Segmenter` + `NewsEmbedding` + `NewsNERTagger`, `Doc.segment` + `Doc.tag_ner`, без донастройки (`slovnet` 0.6.0, `navec` 0.10.0, `razdel` 0.5.0) |
| Декодирование | как в расширении (`src/core/ner/bio.js` `decodeWord` + `mergeBio`): softmax на первом субтокене слова, тип — максимум маргиналей {O, PER, ORG, LOC}, B/I по доле P(B-X); мягкое слияние BIO; score спана — средняя маргинальная вероятность типа; **порог 0.7** для всех типов (`nerThreshold`, основное число). Справочно: без порога и умолчания расширения PER/LOC 0.7 + ORG 0.85 (`nerThresholdOrg`) | спаны CRF как есть (score нет) |
| Лицензия кода | MIT (наш код, `cointegrated/rubert-tiny2` — MIT) | MIT (natasha, slovnet, navec, razdel) |
| На чём обучены веса | WikiANN ru/en, factRuEval-2016 (80 % документов), синтетика `synth.py`, дистилляция XLM-R base (раздел «Источники 1.1.0») | по описаниям проектов: NER-голова — на Nerus (новости Lenta.ru с автоматической разметкой моделью Slovnet BERT NER, обученной на Collection5 (NE5) и factRuEval); эмбеддинги Navec `news_v1` — на новостном корпусе (≈ 1 млрд токенов) |
| Размер на диске | `model.onnx` 31 852 495 + `vocab.txt` 1 080 667 = **32.9 МБ** (рантайм в расширении — onnxruntime-web WASM ≈ 14.2 МБ, уже в пакете) | `navec_news_v1_1B_250K_300d_100q.tar` 26 634 240 + `slovnet_ner_news_v1.tar` 2 385 920 = **29.0 МБ** (+ numpy и чистый Python; в браузере без порта не работает) |

Пост-обработка расширения (`filterSpans`, `alignSpans` с ОПФ и кавычками, фильтры PER/LOC `filters.js`, словарные
детекторы) в основных числах **не** воспроизводится: сравниваются модель + декодирование + порог. На корпусе жанров
отдельной строкой «+мостики» добавлены модель-независимые шаги границ: `bridgePunct` (только наша модель — работает по
словам), `joinAdjacent` и отсев спанов короче 2 символов / без букв (для обеих моделей).

### Методика

* **Наборы** — из `runs/rubert-tiny2-ner-ruen-1.1.0/data/`, только русские: `test_ru` (WikiANN ru test, 10 000),
  `test_factru` (отложенные 20 % документов factRuEval, 1 038, **справочно**), `test_synth_genre` с `lang == ru`
  (1 806 предложений из 2 000, из них 514 без сущностей из 566; английские жанры `letter_en`/`resume_en` исключены —
  Natasha только русская; наши числа на всех 2 000 — в `compare.json`). Метрика — seqeval (режим по умолчанию, как
  `evaluate.py`), точное совпадение спанов, PER/ORG/LOC. Дополнительно — «F1 по перекрытию»: предсказанный спан верен,
  если пересекается с ещё не сопоставленным gold-спаном того же типа (жадно, один к одному) — показывает, какая часть
  разрыва — соглашения о границах, а не пропуски.
* **Сведение спанов Natasha к словам.** Токены набора склеиваются одним пробелом, Natasha получает эту строку; слово
  получает тип спана, если пересекается с его символьным диапазоном, первое такое слово — B. Не легли ровно на границы
  слов: `test_ru` — 268 из 12 098 спанов (2.2 %; начало внутри слова 221, конец 239, одно слово в двух спанах — 1),
  `test_factru` — 1 из 1 486, `synth_genre` ru — 1 из 2 104. Почти все случаи `test_ru` — кавычки, приклеенные к токену
  WikiANN («Арсенала» с кавычками — один токен, Natasha кавычки не включает); сведение по пересечению даёт тот же токен,
  который размечен в gold, так что ошибка сведения — не больше этих 2 % спанов и скорее в пользу Natasha.
* **Наша модель на предложениях** получает те же слова (входы `input_ids` набора, как `calibrate.py`); обрезка по
  128 субтокенам — 1 предложение из 10 000 (`test_ru`).
* **Корпус жанров** (`tests/fixtures/genres/**`, русские документы: 21 DOCX и 24 PDF; `letter-en`, `resume-en` исключены).
  В gold есть только значения, поэтому метрика документная: по каждому документу множество нормализованных значений
  gold PERSON / COMPANY против нормализованных значений предсказанных спанов PER / ORG (нижний регистр, ё→е, без кавычек,
  ОПФ и родового слова «Бюро/Студия/Агентство…» у организаций, инициалы без пробелов); P/R/F1 — сумма по документам.
  Gold-значения, которых нет в тексте дословно (5 PERSON — полные ФИО автора из `docProps/core.xml`), не
  учитываются. «Перекрытие R» — доля gold-значений, хотя бы одно вхождение которых пересекается спаном нужного типа;
  «Перекрытие P» — доля спанов, пересекающих вхождение gold. «Ложные из negatives» — сколько значений из `negatives`
  gold (CRM, ЭДО, Excel, НДС… — без поля `mode`) модель назвала сущностью. Текст DOCX — `word/document.xml`, колонтитулы
  и сноски, абзацы через `\n`; PDF — снимок `<имя>.pdf.txt` (текст, извлечённый ядром расширения). Обе модели получают
  текст **по строкам** (абзацам), как расширение; наша — окна по предложениям (упрощённый `sentenceRanges`, без перекрытия
  окон, пропуск окон без заглавных), батч 8. Natasha целым текстом (штатно `Doc(text)`) — справочная строка.
* **Скорость** — в отдельных процессах, одна нить (`OMP/MKL/OPENBLAS_NUM_THREADS=1`, ORT `intra_op_num_threads=1`),
  первые 1 000 предложений `test_ru` (в среднем 7.0 слов, 12.3 субтокена со спецтокенами), медиана 3 прогонов, с
  токенизацией и декодированием. Холодный старт — загрузка модели (сессия ORT + словарь / `NewsEmbedding` +
  `NewsNERTagger` + `Segmenter`) и первый вызов. onnxruntime CPU — ориентир, не WASM (в браузере медленнее).

### Результаты на предложениях (точное совпадение спанов, F1)

| Набор | Модель | PER | ORG | LOC | micro | micro по перекрытию |
|---|---|---|---|---|---|---|
| `test_ru` (WikiANN, 10 000) | **наша int8, порог 0.7** | **0.922** | **0.766** | **0.869** | **0.852** | 0.889 |
| | наша int8, PER/LOC 0.7 + ORG 0.85 | 0.922 | 0.758 | 0.869 | 0.851 | 0.883 |
| | наша int8, без порога | 0.913 | 0.757 | 0.863 | 0.843 | 0.889 |
| | наша PyTorch fp32, 0.7 | 0.922 | 0.768 | 0.868 | 0.852 | 0.889 |
| | Natasha | 0.191 | 0.348 | 0.626 | 0.404 | 0.701 |
| `test_ru` без «Фамилия , Имя» (7 291) | наша int8, 0.7 | **0.781** | **0.774** | **0.869** | **0.820** | 0.864 |
| | Natasha | 0.598 | 0.360 | 0.652 | 0.548 | 0.662 |
| `test_factru` (1 038, справочно) | наша int8, 0.7 | 0.859 | **0.722** | 0.886 | **0.817** | 0.879 |
| | наша PyTorch fp32, 0.7 | 0.866 | 0.723 | 0.886 | 0.819 | 0.881 |
| | Natasha | **0.907** | 0.507 | **0.904** | 0.765 | **0.912** |
| `test_synth_genre` ru (1 806) | наша int8, 0.7 | **0.994** | **0.996** | **1.000** | **0.995** | 0.996 |
| | Natasha | 0.774 | 0.453 | 0.806 | 0.587 | 0.832 |

По перекрытию по типам: `test_factru` — наша PER 0.893 / ORG 0.839 / LOC 0.912, Natasha 0.944 / 0.868 / 0.929;
`test_ru` — наша 0.938 / 0.840 / 0.892, Natasha 0.790 / 0.535 / 0.727.

**Ложные срабатывания на предложениях без сущностей** (`test_synth_genre` ru, 514 предложений):

| Модель | ложных PER | ложных ORG | ложных LOC | предложений с ложным спаном |
|---|---|---|---|---|
| наша int8, порог 0.7 (и с ORG 0.85) | 2 | 0 | 0 | 2 (0.4 %) |
| Natasha | 14 | 187 | 13 | 159 (30.9 %) |

(Наша на всех 566 отрицательных, с английскими: PER 2, ORG 4 при 0.7; ORG 3 при 0.85.) Precision ORG Natasha на этом
наборе — 0.408: аббревиатуры и названия программ (ЭДО, УПД, CRM, Excel) она считает организациями.

### Корпус жанров (документный уровень, значения)

| Текст | Модель | PERSON P / R / F1 | перекрытие R | COMPANY P / R / F1 | перекрытие P | ложных из negatives |
|---|---|---|---|---|---|---|
| DOCX (21 док., PERSON 56, COMPANY 41) | наша int8, 0.7 | 0.513 / 0.696 / 0.591 | **1.000** | **0.800 / 0.976 / 0.879** | 0.880 | 7 |
| | наша int8, 0.7 + мостики | 0.554 / 0.732 / 0.631 | **1.000** | 0.800 / 0.976 / 0.879 | 0.880 | 7 |
| | наша int8, ORG 0.85 | — | — | **0.816 / 0.976 / 0.889** | 0.901 | 7 |
| | Natasha, по строкам | 0.785 / 0.911 / 0.843 | 0.964 | 0.374 / 0.976 / 0.540 | 0.477 | 55 |
| | Natasha, по строкам + мостики | **0.871 / 0.964 / 0.915** | 0.964 | 0.377 / 0.976 / 0.544 | 0.480 | 55 |
| | Natasha, целым текстом | 0.677 / 0.750 / 0.712 | 0.893 | 0.375 / 0.951 / 0.538 | 0.504 | 43 |
| PDF-снимок (24 док., PERSON 60, COMPANY 45) | наша int8, 0.7 | 0.538 / 0.717 / 0.614 | **1.000** | 0.606 / 0.956 / 0.741 | 0.748 | 14 |
| | наша int8, 0.7 + мостики | 0.577 / 0.750 / 0.652 | **1.000** | 0.606 / 0.956 / 0.741 | 0.748 | 14 |
| | наша int8, ORG 0.85 | — | — | **0.694 / 0.956 / 0.804** | 0.819 | 12 |
| | Natasha, по строкам | 0.788 / 0.867 / 0.825 | 0.917 | 0.364 / 0.978 / 0.530 | 0.464 | 64 |
| | Natasha, по строкам + мостики | **0.873 / 0.917 / 0.894** | 0.917 | 0.367 / 0.978 / 0.533 | 0.467 | 64 |

### Размер и скорость (CPU, одна нить, 1 000 предложений `test_ru`)

| | Наша (onnxruntime CPU, int8) | Natasha |
|---|---|---|
| Файлы модели | 32.9 МБ | 29.0 МБ |
| Холодный старт (загрузка + первый вызов) | **72 мс** | 352 мс |
| 1 000 предложений, по одному | **402 мс** | 463 мс |
| 1 000 предложений, батч 8 (наша) / одним документом (Natasha) | 531 мс | **263 мс** |

Батч 8 у нас медленнее по одному: окна дополняются до самого длинного, а в одну нить батч не даёт параллелизма.
Предложения WikiANN короткие; на полных окнах (128 субтокенов) наша модель — 2.7 мс/окно в ORT CPU (`bench_ort.py`),
в WASM расширения — медленнее; Natasha в браузере не запускается вовсе, так что сравнение скорости — справочное.

### Выводы

* **Где лучше наша.** WikiANN ru (micro 0.852 против 0.404; без характерной для WikiANN разметки «Фамилия , Имя» —
  0.820 против 0.548), организации везде (ORG F1 0.77 против 0.35 на WikiANN, 0.72 против 0.51 на factRuEval), и главное
  для расширения — тишина на деловом тексте: 2 ложных спана на 514 предложений без сущностей против 214 у Natasha,
  на корпусе жанров COMPANY precision 0.80 против 0.37 (Natasha называет организациями ЭДО, УПД, Excel, PDF, «Дебет
  Кредит Сальдо»). Холодный старт в 5 раз быстрее.
* **Где лучше Natasha.** Люди в документах: на корпусе жанров PERSON F1 по значениям 0.84–0.92 против 0.59–0.65 у
  нашей. Наша касается каждого человека (перекрытие R = 1.000 против 0.92–0.96 у Natasha), но рвёт ФИО с инициалами без
  пробела: «Комаров Р.А.» → «Комаров Р.» + «А.» (модель ставит B-PER на второй инициал, а `joinAdjacent` расширения
  склеивает только спаны через пробел); у Natasha токенизатор держит инициалы вместе. На factRuEval Natasha лучше по PER
  (0.907 против 0.859) и LOC (0.904 против 0.886), а по перекрытию — и в целом (0.912 против 0.879); с оговоркой об утечке
  ниже. Скорость потока коротких предложений одним документом у Natasha выше (263 мс на 1 000 против 402).
* **Соглашения разметки решают многое.** Natasha не обучалась на WikiANN: в `test_ru` 27 % предложений — заголовки вида
  «Баланта , Дейви» с запятой внутри PER-спана; по перекрытию разрыв на WikiANN сокращается с 0.45 до 0.19 micro F1.
  На factRuEval ORG у Natasha 0.51 точно против 0.87 по перекрытию: из 278 несовпавших gold-ORG 169 — Natasha дала спан
  короче, почти всегда без кавычек («Яблоко» вместо «« Яблоко »»), а наша конвертация factRuEval дотягивает ORG до
  кавычек и ОПФ (соглашение расширения); 81 — пропуск.
* **Для 1.2.0** (WP12-E): в синтетику — ФИО с инициалами без пробела («Р.А.», «Е.И.») в подписях, реквизитах и актах
  сверки, чтобы модель держала инициалы одним спаном; альтернатива на стороне расширения — склейка соседних PER без
  промежутка в `joinAdjacent` (вне зоны `tools/ner-train`).

### Оговорки

* **factRuEval — справочно, возможна утечка в пользу Natasha.** NER Natasha обучен на Nerus, а Nerus размечен
  моделью Slovnet BERT NER, которая училась в том числе на factRuEval-2016; документы нашего отложенного `test_factru`
  могли быть в её обучении. Наша модель этих 20 % документов не видела.
* **`test_synth_genre` — преимущество нашей модели.** Наша модель обучалась на синтетике того же генератора `synth.py`
  (словари имён и названий разбиты на train/test, но шаблоны и соглашения разметки общие), поэтому 0.995 против 0.587 —
  верхняя оценка разрыва, а не независимый тест. Корпус жанров сгенерирован другим генератором
  (`scripts/gen-genre-fixtures.mjs`), его gold исключён из обучения (раздел 1.1.0), но жанры и стиль те же.
* **WikiANN — домен нашей модели** (обучение на WikiANN train с той же разметкой); Natasha видит его впервые.
* Документная метрика по значениям строгая: «Комаров Р.» вместо «Комаров Р.А.» — и ложный, и пропуск. Для маскирования
  важнее перекрытие (имя закрыто хотя бы частично), но в выдаче одной NER-модели остаток («А.») не закрывается
  (`filterSpans` выбрасывает однобуквенный спан); закрывает ли его словарный детектор ФИО — здесь не проверялось.
* Natasha получает склеенные пробелами токены (`" , "`, `"( 1862—1918 )"`) — для её токенизатора `razdel` это почти не
  важно; погрешность сведения спанов — выше (≤ 2.2 % спанов `test_ru`).
* Скорость — onnxruntime CPU и Python на одной машине; в расширении наша модель работает в WASM (медленнее CPU-сборки).

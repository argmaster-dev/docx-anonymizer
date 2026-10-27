// Доработка 0.5 по прогону коммерческого предложения (`docs/tasks.md`, «0.5: доработка по прогону КП»): синтетические аналоги
// найденных случаев — ИНН при подписи «ИНН/ КПП» (FR-20, fail-closed), ложные PER модели на нарицательном («Анонимайзер») и
// голосовом помощнике («Алису»), метки-заглушки «⟦ORG_1.ACC⟧», продукты ИИ и «Tax ID» в стоп-списке, одиночные слова
// STOP_DOCS_05, склейка двух ФИО с инициалами в `joinAdjacent`. Все значения вымышленные.
import { describe, it, expect } from 'vitest';
import { fromText } from '../../src/core/text/model.js';
import { analyze } from '../../src/core/detect/runner.js';
import { registerBuiltinDetectors } from '../../src/core/index.js';
import { defaultSettings } from '../../src/core/settings.js';
import { createOrgFilterContext, filterOrgSpans } from '../../src/core/ner/filters.js';
import { filterPersonLocSpans } from '../../src/core/ner/filters-pl.js';
import { productContext } from '../../src/core/ner/product-context.js';
import { BUILTIN_STOPLIST, stopKey } from '../../src/core/ner/stoplist.js';
import { joinAdjacent, mergeBio } from '../../src/core/ner/bio.js';
import { findVocativeNames } from '../../src/core/detect/names/vocative.js';

const doc = (...texts) => fromText(texts.map((text) => ({ kind: 'p', text, page: 1 })));
const commercial = () => ({ ...defaultSettings(), commercial: true });
const groups = (r) => r.groups.map((g) => `${g.category}:${g.value}`).sort();
/** Стаб-провайдер NER: метка на первое вхождение каждой подстроки. */
const stub = (pairs) => ({
  name: 'stub',
  init: async () => {},
  detect: async (text) =>
    pairs.flatMap(([w, label]) => {
      const out = [];
      for (let i = text.indexOf(w); i >= 0; i = text.indexOf(w, i + w.length)) out.push({ start: i, end: i + w.length, label, score: 0.99 });
      return out;
    }),
});

// встроенные детекторы регистрируются один раз (повторный вызов после clearDetectors ничего не делает)
registerBuiltinDetectors();

describe('1. ИНН при подписи «ИНН/ КПП» с пробелами вокруг дроби', () => {
  // 7701234567 — контрольная сумма неверна: с явной подписью ИНН маскируется (labeled, fail-closed), без подписи — нет
  for (const label of ['ИНН/ КПП', 'ИНН / КПП', 'ИНН /КПП', 'ИНН/ КПП:', 'ИНН/КПП', 'инн/ кпп']) {
    it(`«${label} 7701234567/770101001» — ИНН и КПП`, async () => {
      const r = await analyze(doc(`Реквизиты: ${label} 7701234567/770101001, внутри фразы.`), defaultSettings());
      expect(groups(r)).toEqual(['INN:7701234567', 'KPP:770101001']);
      expect(r.groups.find((g) => g.category === 'INN').level).toBe('labeled');
    });
  }
  it('в кавычках внутри фразы («ИНН/ КПП …»), верная контрольная сумма — validated', async () => {
    const r = await analyze(doc('Схема через дробь («ИНН/ КПП 7736050003/773601001»), в блоке под «Поставщик:».'), defaultSettings());
    expect(groups(r)).toEqual(['INN:7736050003', 'KPP:773601001']);
    expect(r.groups.find((g) => g.category === 'INN').level).toBe('validated');
  });
  it('подпись «ИНН» с неверной контрольной суммой — маскируется; без подписи — нет', async () => {
    expect(groups(await analyze(doc('ИНН 7701234567.'), defaultSettings()))).toEqual(['INN:7701234567']);
    expect(groups(await analyze(doc('Номер 7701234567 в тексте.'), defaultSettings()))).toEqual([]);
  });
  it('«р / с» с пробелами — тоже метка счёта', async () => {
    expect(groups(await analyze(doc('р / с 40702810400000001234'), defaultSettings()))).toEqual(['ACCOUNT:40702810400000001234']);
  });
});

describe('2. Ложные PER модели: нарицательное и голосовой помощник', () => {
  it('одно слово не из словарей имён, которое в документе пишется и со строчной, — не человек', async () => {
    const d = doc(
      'Главное отличие. Анонимайзер не настраивается под бланки.',
      'Всё работает у вас: анонимайзер документов ставится на компьютер.',
      'Айгерим подготовила отчёт.',
    );
    const provider = stub([
      ['Анонимайзер', 'PER'],
      ['Айгерим', 'PER'],
    ]);
    const r = await analyze(d, defaultSettings(), { nerProvider: provider });
    // «Айгерим» нет в словарях имён, но со строчной в документе не пишется — человек остаётся
    expect(r.entities.filter((e) => e.source === 'ner').map((e) => e.text)).toEqual(['Айгерим']);
  });
  it('то же слово рядом с другим словом с заглавной («Анонимайзер Петров») — остаётся', () => {
    const d = doc('Подписал Анонимайзер Петров.', 'Слово анонимайзер встречается и со строчной.');
    const ctx = createOrgFilterContext(d, defaultSettings());
    const text = d.streams[0].text;
    const i = text.indexOf('Анонимайзер');
    expect(filterPersonLocSpans([{ start: i, end: i + 11, label: 'PER', score: 0.9 }], { ...ctx, text })).toHaveLength(1);
  });
  it('контекст продукта: имя помощника после «Яндекс», «голосовой помощник»; перечисление продуктов ИИ', () => {
    const at = (t, w) => productContext(t, t.indexOf(w), t.indexOf(w) + w.length);
    expect(at('до отправки в GigaChat, Алису, DeepSeek и другие модели', 'Алису')).toBe(true);
    expect(at('Пользуемся ChatGPT, Алисой и др.', 'Алисой')).toBe(true);
    expect(at('Ответы готовит голосовой помощник Алиса.', 'Алиса')).toBe(true);
    expect(at('Спросите у Яндекс Алисы прогноз.', 'Алисы')).toBe(true);
    expect(at('Спросите у Яндекс.Алисы прогноз.', 'Алисы')).toBe(true);
    // неоднозначно — человек из компании: остаётся ФИО (fail-closed); «голосовой помощник» — только перед именем помощника
    expect(at('В Яндексе Алиса отвечает за продажи.', 'Алиса')).toBe(false);
    expect(at('Алиса от Яндекса приедет на встречу.', 'Алиса')).toBe(false);
    expect(at('Звонил голосовой помощник Мария.', 'Мария')).toBe(false);
    // один продукт рядом — не перечисление; имя человека
    expect(at('Excel, Мария, пришлите до пятницы.', 'Мария')).toBe(false);
    expect(at('Алиса подписала акт.', 'Алиса')).toBe(false);
    expect(at('Отчёт в Excel и Алиса проверит.', 'Алиса')).toBe(false);
  });
  it('раннер: «Алису» в перечислении продуктов и помощник — не PERSON (и не вариант лица «Алиса Котова»); Алиса-человек — PERSON', async () => {
    const d = doc(
      'Заменяет данные метками до отправки в GigaChat, Алису, DeepSeek и другие модели.',
      'Ответы готовит голосовой помощник Алиса.',
      'Акт подписала Алиса Котова.',
    );
    const provider = stub([
      ['Алису', 'PER'],
      ['Алиса', 'PER'],
    ]);
    const r = await analyze(d, defaultSettings(), { nerProvider: provider });
    expect(r.groups.filter((g) => g.category === 'PERSON').map((g) => g.value)).toEqual(['Алиса Котова']);
  });
  it('правила без модели: «Яндекс Алиса» — не пара имя-фамилия; «голосовой помощник Алиса.» — не обращение', async () => {
    expect(groups(await analyze(doc('Яндекс Алиса ответила на вопрос.'), defaultSettings()))).toEqual([]);
    expect(findVocativeNames('Ответы готовит голосовой помощник Алиса.')).toEqual([]);
    expect(findVocativeNames('Спасибо, Алиса!').map((v) => v.name)).toEqual(['Алиса']);
  });
});

describe('3. Коммерческий режим: метки-заглушки «⟦…⟧», продукты ИИ, «Tax ID»', () => {
  it('текст внутри «⟦ORG_1.ACC⟧» не становится сущностью ни у модели, ни у правил', async () => {
    const d = doc('Уходит в модель: Поставщик: ⟦ORG_1⟧ , ИНН ⟦ORG_1.INN⟧ , р/с ⟦ORG_1.ACC⟧ , сумма ⟦AMT_1⟧, подписал ⟦ФИО_2⟧.');
    const provider = stub([
      ['ORG', 'ORG'],
      ['ACC', 'ORG'],
      ['AMT', 'ORG'],
      ['ФИО', 'PER'],
    ]);
    const r = await analyze(d, commercial(), { nerProvider: provider });
    expect(r.entities).toEqual([]);
  });
  it('обычный текст в таких скобках («⟦Иванов⟧») — не заглушка: маскируется', async () => {
    const r = await analyze(doc('Контекст: в лице ⟦Иванов⟧ действует.'), defaultSettings(), { nerProvider: stub([['Иванов', 'PER']]) });
    expect(r.entities.map((e) => e.text)).toEqual(['Иванов']);
  });
  it('продукты ИИ и «Tax ID» — в стоп-списке, ORG модели на них отброшены', () => {
    for (const w of ['DeepSeek', 'ChatGPT', 'Claude', 'GigaChat', 'YandexGPT', 'Яндекс GPT', 'Gemini', 'Яндекс Алиса', 'Tax ID'])
      expect(BUILTIN_STOPLIST.has(stopKey(w)), w).toBe(true);
    // «Алиса» одна — женское имя: не в стоп-списке
    expect(BUILTIN_STOPLIST.has(stopKey('Алиса'))).toBe(false);
    const text = 'Иностранные реквизиты (SWIFT, IBAN, VAT и Tax ID); отправка в DeepSeek и Gemini.';
    const sp = ['Tax ID', 'DeepSeek', 'Gemini'].map((w) => ({ start: text.indexOf(w), end: text.indexOf(w) + w.length, label: 'ORG', score: 0.95 }));
    expect(filterOrgSpans(sp, { text })).toEqual([]);
  });
});

describe('4. STOP_DOCS_05: одним словом — только не названия', () => {
  it('«Полис», «Почта», «ФС» одним словом — не в стоп-списке; составные записи — на месте', () => {
    for (const w of ['Полис', 'Почта', 'ФС']) expect(BUILTIN_STOPLIST.has(stopKey(w)), w).toBe(false);
    for (const w of ['Полис ОМС', 'Полис ОСАГО', 'Электронная почта', 'Эл. почта', 'СТС', 'КУСП']) expect(BUILTIN_STOPLIST.has(stopKey(w)), w).toBe(true);
  });
  it('ORG «Почта России», «Почта» — организация; «серии ФС» — обрывок кода', () => {
    const t = 'Договор с Почтой России; доставку выполнит Почта, срок — неделя. Исполнительный лист серии ФС № 012345678.';
    // спан на слово `w`, начиная с позиции `from`
    const sp = (w, from = 0) => ({ start: t.indexOf(w, from), end: t.indexOf(w, from) + w.length, label: 'ORG', score: 0.95 });
    const spans = [sp('Почтой России'), sp('Почта', t.indexOf('выполнит')), sp('ФС')];
    expect(filterOrgSpans(spans, { text: t }).map((s) => t.slice(s.start, s.end))).toEqual(['Почтой России', 'Почта']);
  });
});

describe('5. joinAdjacent: две полные «Фамилия И.О.» подряд — два человека', () => {
  /** Слова текста с тегами: «Котова/B-PER». */
  const preds = (text, tagged) => {
    let pos = 0;
    return tagged.map((item) => {
      const [word, lab = 'O'] = item.split('/');
      const start = text.indexOf(word, pos);
      pos = start + word.length;
      const [tag, type] = lab === 'O' ? ['O', null] : lab.split('-');
      return { start, end: pos, tag, type, prob: 0.9 };
    });
  };
  const join = (text, tagged) => joinAdjacent(mergeBio(preds(text, tagged), { withWords: true, text }), text).map((s) => text.slice(s.start, s.end));
  it('вплотную, через пробел и через табуляцию; инициалы впереди', () => {
    const tags = ['Котова/B-PER', 'А.Б./I-PER', 'Лебедев/B-PER', 'В.Г./I-PER'];
    expect(join('Подписали: Котова А.Б.Лебедев В.Г.', ['Подписали:', ...tags])).toEqual(['Котова А.Б.', 'Лебедев В.Г.']);
    expect(join('Подписали: Котова А.Б. Лебедев В.Г.', ['Подписали:', ...tags])).toEqual(['Котова А.Б.', 'Лебедев В.Г.']);
    expect(join('Котова А.Б.\tЛебедев В.Г.', tags)).toEqual(['Котова А.Б.', 'Лебедев В.Г.']);
    // модель ставит I на второе ФИО — один спан из mergeBio тоже делится
    expect(join('Котова А.Б. Лебедев В.Г.', ['Котова/B-PER', 'А.Б./I-PER', 'Лебедев/I-PER', 'В.Г./I-PER'])).toEqual(['Котова А.Б.', 'Лебедев В.Г.']);
    expect(join('А.Б. Котова В.Г. Лебедев', ['А.Б./B-PER', 'Котова/I-PER', 'В.Г./I-PER', 'Лебедев/I-PER'])).toEqual(['А.Б. Котова', 'В.Г. Лебедев']);
  });
  it('табуляция и перенос строки делят любой спан; одно ФИО не делится', () => {
    expect(join('ООО Ромашка\tООО Вектор', ['ООО/B-ORG', 'Ромашка/I-ORG', 'ООО/I-ORG', 'Вектор/I-ORG'])).toEqual(['ООО Ромашка', 'ООО Вектор']);
    expect(join('Иванов Иван Иванович', ['Иванов/B-PER', 'Иван/B-PER', 'Иванович/I-PER'])).toEqual(['Иванов Иван Иванович']);
    expect(join('Комаров Р. А. Петрович', ['Комаров/B-PER', 'Р./I-PER', 'А./B-PER', 'Петрович/I-PER'])).toEqual(['Комаров Р. А. Петрович']);
    expect(join('John A. Smith', ['John/B-PER', 'A./I-PER', 'Smith/I-PER'])).toEqual(['John A. Smith']);
  });
});

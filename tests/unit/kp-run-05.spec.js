// Доработка 0.5 по прогону коммерческого предложения (`docs/tasks.md`, «0.5: доработка по прогону КП»): синтетические аналоги
// найденных случаев — ИНН при подписи «ИНН/ КПП» (FR-20, fail-closed), ложные PER модели на нарицательном («Анонимайзер») и
// голосовом помощнике («Алису»), метки-заглушки «⟦ORG_1.ACC⟧», продукты ИИ и «Tax ID» в стоп-списке, одиночные слова
// STOP_DOCS_05, склейка двух ФИО с инициалами в `joinAdjacent`. Все значения вымышленные.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { loadNerProvider } from '../../scripts/eval-genres.mjs';
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
  it('составная подпись в любом порядке и через «,», «\\», три реквизита (ревью доработки)', async () => {
    const cases = [
      ['Реквизиты: КПП/ ИНН 773601001/7736050003.', ['INN:7736050003', 'KPP:773601001']],
      ['Реквизиты: ИНН, КПП 7736050003, 773601001.', ['INN:7736050003', 'KPP:773601001']],
      ['Реквизиты: ИНН\\КПП 7736050003\\773601001.', ['INN:7736050003', 'KPP:773601001']],
      ['Реквизиты: КПП/ ИНН 770101001/7701234567.', ['INN:7701234567', 'KPP:770101001']],
      ['Реквизиты: ИНН, КПП 7701234567, 770101001.', ['INN:7701234567', 'KPP:770101001']],
      ['Реквизиты: ИНН / КПП / ОГРН 7701234567/770101001/1027700132195.', ['INN:7701234567', 'KPP:770101001', 'OGRN:1027700132195']],
      ['ИНН / КПП 7701234567 / 770101001', ['INN:7701234567', 'KPP:770101001']],
    ];
    for (const [t, want] of cases) expect(groups(await analyze(doc(t), defaultSettings())), t).toEqual(want);
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
    expect(at('Пользуемся ChatGPT, Алисой и другими нейросетями.', 'Алисой')).toBe(true);
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
    // ревью доработки: перечисление — только имена помощников и «и другие» — только перед «модели/сервисы/нейросети…»;
    // глагол сразу за именем — человек
    expect(at('Отчёт сверстан в Excel, Петров и другие сотрудники внесли правки.', 'Петров')).toBe(false);
    expect(at('Участники: Word, Петров, Excel.', 'Петров')).toBe(false);
    expect(at('Таблицы Excel, Алиса и другие участники заполнят к пятнице.', 'Алиса')).toBe(false);
    expect(at('Пользуемся ChatGPT, Алисой и др.', 'Алисой')).toBe(false);
    expect(at('Со стороны Яндекс Алиса подтвердила сроки поставки.', 'Алиса')).toBe(false);
    expect(at('Обращение в чат-бот Маруся передала юристу.', 'Маруся')).toBe(false);
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
    expect(groups(await analyze(doc('Вопрос задали Яндекс Алисе.'), defaultSettings()))).toEqual([]);
    // глагол за именем — человек: пара «Яндекс Алиса» маскируется (ревью доработки, fail-closed)
    expect(groups(await analyze(doc('Со стороны Яндекс Алиса подтвердила сроки поставки.'), defaultSettings())).length).toBeGreaterThan(0);
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
  it('значения в таких скобках — не заглушки: маскируются (ревью доработки)', async () => {
    for (const [t, w] of [
      ['Контекст: в лице ⟦Иванов⟧ действует.', 'Иванов'],
      ['Подписант договора ⟦ИВАНОВ⟧ согласовал.', 'ИВАНОВ'],
      ['Signed by ⟦IVANOV_1⟧ on behalf of the company.', 'IVANOV'],
      ['Ответственный ⟦Петров_2⟧ подтвердил.', 'Петров'],
    ]) {
      const r = await analyze(doc(t), defaultSettings(), { nerProvider: stub([[w, 'PER']]) });
      expect(
        r.entities.map((e) => e.text),
        t,
      ).toContain(w);
    }
    // правила идентификаторов внутри скобок работают: госномер, VIN
    expect(groups(await analyze(doc('Автомобиль госномер ⟦А123ВС77⟧ передан.'), defaultSettings()))).toContain('PLATE:А123ВС77');
    expect(groups(await analyze(doc('VIN ⟦XTA21099012345678⟧ указан в ПТС.'), defaultSettings()))).toContain('VIN:XTA21099012345678');
  });
  it('продукты ИИ и «Tax ID» — в стоп-списке, ORG модели на них отброшены', () => {
    for (const w of ['DeepSeek', 'ChatGPT', 'Claude', 'GigaChat', 'YandexGPT', 'Яндекс GPT', 'Gemini', 'Яндекс Алиса', 'Tax ID'])
      expect(BUILTIN_STOPLIST.has(stopKey(w)), w).toBe(true);
    // «Алиса» одна — женское имя, Kandinsky — фамилия («Anna Kandinsky»): не в стоп-списке
    expect(BUILTIN_STOPLIST.has(stopKey('Алиса'))).toBe(false);
    expect(BUILTIN_STOPLIST.has(stopKey('Kandinsky'))).toBe(false);
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
  it('одно ФИО не делится; табуляция без двух полных ФИО — тоже', () => {
    // табуляция сама по себе спан не делит (ревью доработки): фамилия и имя в соседних ячейках — один человек
    expect(join('Takahashi\tJun', ['Takahashi/B-PER', 'Jun/B-PER'])).toEqual(['Takahashi\tJun']);
    expect(join('Мороз\tИван Петрович', ['Мороз/B-PER', 'Иван/B-PER', 'Петрович/I-PER'])).toEqual(['Мороз\tИван Петрович']);
    expect(join('Иванов Иван Иванович', ['Иванов/B-PER', 'Иван/B-PER', 'Иванович/I-PER'])).toEqual(['Иванов Иван Иванович']);
    expect(join('Комаров Р. А. Петрович', ['Комаров/B-PER', 'Р./I-PER', 'А./B-PER', 'Петрович/I-PER'])).toEqual(['Комаров Р. А. Петрович']);
    expect(join('John A. Smith', ['John/B-PER', 'A./I-PER', 'Smith/I-PER'])).toEqual(['John A. Smith']);
  });
});

describe('ревью доработки: одиночные фамилии-нарицательные не открываются (без модели — стаб-провайдер)', () => {
  // фамилия от модели одним словом; в документе то же слово со строчной или однокоренное — фамилия всё равно маскируется
  const cases = [
    ['Как сообщил Мороз, работы на объекте завершены.', 'Из-за того что ударил мороз, бетон не заливали.', 'Мороз'],
    ['Как сообщил Мороз, работы на объекте завершены.', 'С документами была морока.', 'Мороз'],
    ['Мороз сообщил, что работы завершены.', 'Ударил мороз.', 'Мороз'],
    ['Отчёт по проекту подготовил Кузнец.', 'Каждый сам кузнец своего счастья.', 'Кузнец'],
    ['Замечания направил Лебедь в среду.', 'Монтаж выполнен, лебёдка исправна.', 'Лебедь'],
    ['Позицию юристов изложила Коваль на совещании.', 'Договор согласован, кованый забор установлен.', 'Коваль'],
    ['Претензию подписал Мельник.', 'Ремонт водяной мельницы оплачен.', 'Мельник'],
    ['По словам Гончар, оплата поступила.', 'Заказ у мастера: гончар сделал вазы.', 'Гончар'],
    ['Ответственный — Бондарь, телефон у секретаря.', 'Бондарь — старинная профессия, бондарь делает бочки.', 'Бондарь'],
    ['Вопрос задал Орёл, ему ответили письменно.', 'На гербе изображён орёл.', 'Орёл'],
    ['Документы передала Зима в бухгалтерию.', 'Наступила зима, работы приостановлены.', 'Зима'],
    ['Замечания передал Король.', 'Покупатель — король.', 'Король'],
    ['Айгерим подготовила отчёт.', 'Слово айгерим встречается и со строчной.', 'Айгерим'],
  ];
  for (const [a, b, w] of cases)
    it(`«${w}» + «${b}»`, async () => {
      const r = await analyze(doc(a, b), defaultSettings(), { nerProvider: stub([[w, 'PER']]) });
      expect(r.entities.some((e) => e.text.includes(w))).toBe(true);
    });
  it('«Исполнитель:\\tМороз\\tИван Петрович» + «Ударил мороз.» — пара через табуляцию', async () => {
    const r = await analyze(doc('Исполнитель:\tМороз\tИван Петрович', 'Ударил мороз.'), defaultSettings(), { nerProvider: stub([['Мороз', 'PER']]) });
    expect(r.entities.some((e) => e.text.includes('Мороз'))).toBe(true);
  });
  it('фамилия в перечислении с продуктами — маскируется', async () => {
    for (const [t, w] of [
      ['Отчёт сверстан в Excel, Петров и другие сотрудники внесли правки.', 'Петров'],
      ['Рассылка через Telegram, Смирнова и др. сотрудники ответили.', 'Смирнова'],
      ['Участники: Word, Петров, Excel.', 'Петров'],
      ['Доступы выдали: Slack, Мороз, Zoom.', 'Мороз'],
    ]) {
      const r = await analyze(doc(t), defaultSettings(), { nerProvider: stub([[w, 'PER']]) });
      expect(
        r.entities.some((e) => e.text.includes(w)),
        t,
      ).toBe(true);
    }
  });
});

// Случаи ревью доработки на настоящей модели: NER_MODEL_DIR=<каталог пакета 1.2.0> npx vitest run tests/unit/kp-run-05.spec.js
const MODEL_DIR = process.env.NER_MODEL_DIR ? resolve(process.env.NER_MODEL_DIR) : '';
describe.skipIf(!MODEL_DIR)('ревью доработки с моделью NER (NER_MODEL_DIR): ни одной утечки', () => {
  let provider;
  beforeAll(async () => {
    provider = await loadNerProvider(MODEL_DIR);
  });
  afterAll(() => provider?.dispose?.());
  // [тексты, что должно быть замаскировано]; известные утечки до доработки (модель даёт LOC вне адреса: «Письмо отправила Береза»,
  // «Kandinsky approved…»; номер паспорта в скобках «⟦123456⟧») — вне этой доработки
  const cases = [
    [['Как сообщил Мороз, работы на объекте завершены.', 'Из-за того что ударил мороз, бетон не заливали.'], ['Мороз']],
    [['Как сообщил Мороз, работы на объекте завершены.', 'С документами была морока.'], ['Мороз']],
    [['Мороз сообщил, что работы завершены.', 'Ударил мороз.'], ['Мороз']],
    [['Отчёт по проекту подготовил Кузнец.', 'Каждый сам кузнец своего счастья.'], ['Кузнец']],
    [['Замечания направил Лебедь в среду.', 'Монтаж выполнен, лебёдка исправна.'], ['Лебедь']],
    [['Позицию юристов изложила Коваль на совещании.', 'Договор согласован, кованый забор установлен.'], ['Коваль']],
    [['Претензию подписал Мельник.', 'Ремонт водяной мельницы оплачен.'], ['Мельник']],
    [['По словам Гончар, оплата поступила.', 'Заказ у мастера: гончар сделал вазы.'], ['Гончар']],
    [['Ответственный — Бондарь, телефон у секретаря.', 'Бондарь — старинная профессия, бондарь делает бочки.'], ['Бондарь']],
    [['Вопрос задал Орёл, ему ответили письменно.', 'На гербе изображён орёл.'], ['Орёл']],
    [['Документы передала Зима в бухгалтерию.', 'Наступила зима, работы приостановлены.'], ['Зима']],
    [['Замечания передал Король.', 'Покупатель — король.'], ['Король']],
    [['Отчёт сдал Лис.', 'В лесу бегает лиса.'], ['Лис']],
    [['Отчёт сверстан в Excel, Петров и другие сотрудники внесли правки.'], ['Петров']],
    [['Рассылка через Telegram, Смирнова и др. сотрудники ответили.'], ['Смирнова']],
    [['Участники: Word, Петров, Excel.'], ['Петров']],
    [['Доступы выдали: Slack, Мороз, Zoom.'], ['Мороз']],
    [['Обращение в чат-бот Маруся передала юристу.'], ['Маруся']],
    // повторное ревью
    [['Со стороны Яндекс Алиса, руководитель группы, подтвердила сроки.'], ['Алиса']],
    [['Со стороны Яндекс Алиса быстро ответила на претензию.'], ['Алиса']],
    [['От Яндекс Алиса и Пётр подписали акт.'], ['Алиса']],
    [['Документы от Яндекс Алисе передали вчера.'], ['Алисе']],
    [['Проект нейросеть курирует Алиса, менеджер по продукту.'], ['Алиса']],
    [['На встрече были GigaChat, Алиса, DeepSeek и другие модели, а Алиса Котова вела протокол.'], ['Алиса Котова']],
    [['Отчёт сдал Кондуктор в пятницу.', 'В автобусе работает кондуктор.'], ['Кондуктор']],
    [['Документы передал Виктор.', 'Слово виктор пишется со строчной.'], ['Виктор']],
    [['Подписант ⟦ФИО_1.ПЕТРОВ⟧ согласовал.'], ['ПЕТРОВ']],
    [['Перевод ⟦СУММА_1.ИВАНОВ_ПЕТР⟧ получен.'], ['ИВАНОВ']],
    [['Подписант ⟦PER_1⟧Иванов согласовал документ.'], ['Иванов']],
    [['Подписант ⟦ФИО_1⟧ Петров согласовал документ.'], ['Петров']],
    [['ИНН ⟦ИНН_1⟧ 7736050003 указан.'], ['7736050003']],
    [['Grok Smith signed the NDA.'], ['Grok Smith']],
    // третье ревью
    [['Контакт со стороны Яндекс Алиса — менеджер проекта.'], ['Алиса']],
    [['Контакт со стороны Яндекс Алиса, менеджер проекта.'], ['Алиса']],
    [['Нужно позвонить в Яндекс Алисе завтра.'], ['Алисе']],
    [['Со стороны Яндекс Алиса подтвердила сроки поставки.'], ['Алиса']],
    [['Акт подписала Алиса Котова.', 'Таблицы Excel, Алиса и другие участники заполнят к пятнице.'], ['Алиса Котова']],
    [
      ['Исполнитель:\tМороз\tИван Петрович', 'Ударил мороз.'],
      ['Мороз', 'Иван'],
    ],
    [['Котова А.Б.\tЛебедев В.Г.'], ['Котова', 'Лебедев']],
    [['Подписант договора ⟦ИВАНОВ⟧ согласовал.'], ['ИВАНОВ']],
    [['Signed by ⟦IVANOV_1⟧ on behalf of the company.'], ['IVANOV']],
    [['Ответственный ⟦Петров_2⟧ подтвердил.'], ['Петров']],
    [['The agreement was signed by Anna Kandinsky on behalf of the buyer.'], ['Kandinsky']],
    [['Please send the invoice to Mr. Kandinsky by Friday.'], ['Kandinsky']],
  ];
  for (const [texts, must] of cases)
    for (const settings of [defaultSettings(), commercial()])
      it(`${texts[0]} (${settings.commercial ? 'коммерческий' : 'обычный'})`, async () => {
        const r = await analyze(doc(...texts), settings, { nerProvider: provider });
        for (const m of must)
          expect(
            r.entities.some((e) => e.text.includes(m)),
            m,
          ).toBe(true);
      });
  it('КП-аналог: «Алису», «Анонимайзер», «⟦ORG_1.ACC⟧», DeepSeek, Tax ID — не сущности', async () => {
    const d = doc(
      'Анонимайзер находит персональные данные и заменяет их метками до отправки в GigaChat, Алису, DeepSeek и другие модели.',
      'Главное отличие. Анонимайзер не настраивается под бланки: анонимайзер знает схемы.',
      'Уходит в модель: Поставщик: ⟦ORG_1⟧ , ИНН ⟦ORG_1.INN⟧ , р/с ⟦ORG_1.ACC⟧ , сумма ⟦AMT_1⟧.',
      'Иностранные реквизиты (SWIFT, IBAN, VAT и Tax ID) — в рабочем продукте.',
    );
    for (const settings of [defaultSettings(), commercial()]) expect((await analyze(d, settings, { nerProvider: provider })).entities).toEqual([]);
  });
});

describe('ревью доработки: слово стоп-списка из словарей имён не отрезается от PER', () => {
  const keep = (text, w) => {
    const i = text.indexOf(w);
    return filterPersonLocSpans([{ start: i, end: i + w.length, label: 'PER', score: 0.95 }], { text }).map((s) => text.slice(s.start, s.end));
  };
  // записи STOP_PRODUCTS / STOP_ABBREVIATIONS / STOP_DOCS_05, совпадающие с именами и фамилиями словарей: Claude, Tilda, Slack,
  // SWIFT, MAC, Word; «Dear» — служебное слово (обращение) из словаря фамилий: в начале отрезается, в конце — нет
  for (const [text, name] of [
    ['Договор подписал Claude Dubois.', 'Claude Dubois'],
    ['Договор подписал Dubois Claude.', 'Dubois Claude'],
    ['Письмо отправила Tilda Swinton.', 'Tilda Swinton'],
    ['Отчёт сдал John Slack.', 'John Slack'],
    ['Согласовала Taylor Swift.', 'Taylor Swift'],
    ['Ответил Bernie Mac.', 'Bernie Mac'],
    ['Подписал Ethan Word.', 'Ethan Word'],
    ['Ответ дала Jane Dear.', 'Jane Dear'],
    ['Пришли Claude Slack и другие.', 'Claude Slack'],
  ])
    it(`«${name}» — целиком`, () => expect(keep(text, name)).toEqual([name]));
  it('одиночный продукт и перечисление продуктов — по-прежнему не человек; «Dear Anna» — обращение отрезается', () => {
    expect(keep('Отправляем запросы в ChatGPT и Claude.', 'Claude')).toEqual([]);
    expect(keep('Работаем в Word и Excel.', 'Word и Excel')).toEqual([]);
    expect(keep('Dear Anna, thank you.', 'Dear Anna')).toEqual(['Anna']);
  });
  it.skipIf(!MODEL_DIR)('с моделью: «Claude Dubois», «Jane Dear», «Taylor Swift» маскируются целиком', async () => {
    const provider = await loadNerProvider(MODEL_DIR);
    try {
      for (const [t, name] of [
        ['Ответ дала Jane Dear.', 'Jane Dear'],
        ['Договор подписал Claude Dubois.', 'Claude Dubois'],
        ['Согласовала Taylor Swift.', 'Taylor Swift'],
      ])
        for (const settings of [defaultSettings(), commercial()]) {
          const r = await analyze(doc(t), settings, { nerProvider: provider });
          expect(
            r.entities.some((e) => e.text === name),
            t,
          ).toBe(true);
        }
    } finally {
      provider?.dispose?.();
    }
  });
});

describe('повторное ревью: составная подпись реквизитов сопоставляется по виду (без модели)', () => {
  const cases = [
    ['ИНН/КПП 7736050003/773601001, 4951234567 — телефон.', ['INN:7736050003', 'KPP:773601001']],
    ['ИНН/КПП 7736050003/773601001, 1027700132195 — ОГРН.', ['INN:7736050003', 'KPP:773601001', 'OGRN:1027700132195']],
    ['Стороны: ИНН/КПП 7736050003/773601001, 7707083893/773601002.', ['INN:7707083893', 'INN:7736050003', 'KPP:773601001', 'KPP:773601002']],
    ['ИНН/КПП 7736050003/773601001/1027700132195', ['INN:7736050003', 'KPP:773601001', 'OGRN:1027700132195']],
    ['ИНН/КПП 7736050003/773601001, ОГРН 1027700132195.', ['INN:7736050003', 'KPP:773601001', 'OGRN:1027700132195']],
    ['ИНН/КПП 773601001/7736050003', ['INN:7736050003', 'KPP:773601001']],
    ['ИНН/КПП/ОГРН 7736050003/773601001', ['INN:7736050003', 'KPP:773601001']],
    ['КПП/ИНН 773601001/500100732259', ['INN:500100732259', 'KPP:773601001']],
    ['ИНН/ОГРНИП 500100732259/304500116000157', ['INN:500100732259', 'OGRN:304500116000157']],
    ['Указать ИНН, КПП и банк: 7736050003, 773601001, Сбербанк.', ['INN:7736050003', 'KPP:773601001']],
    ['ИНН/КПП 7736050003/773601001 р/с 40702810400000001234', ['ACCOUNT:40702810400000001234', 'INN:7736050003', 'KPP:773601001']],
    // неверная контрольная сумма — labeled (fail-closed); две метки ИНН-вида — обе маскируются
    ['ИНН, КПП 7701234567, 770101001', ['INN:7701234567', 'KPP:770101001']],
    ['ИНН/КПП 7701234567/7701234560', ['INN:7701234560', 'INN:7701234567']],
  ];
  for (const [t, want] of cases) it(t, async () => expect(groups(await analyze(doc(t), defaultSettings()))).toEqual(want));
  it('лишнее значение после пары через запятую составная подпись не помечает («…, 8001234567 — горячая линия»)', async () => {
    const t = 'ИНН, КПП 7736050003, 773601001, 8001234567 — горячая линия.';
    const r = await analyze(doc(t), defaultSettings());
    expect(groups(r)).toEqual(expect.arrayContaining(['INN:7736050003', 'KPP:773601001']));
    // 8001234567 проходит контрольную сумму ИНН — его без метки берёт обычный детектор ИНН (как до 0.5), не составная подпись
    const { compoundRequisites } = await import('../../src/core/detect/identifiers/numeric.js');
    expect(compoundRequisites(t).map((v) => v.text)).toEqual(['7736050003', '773601001']);
  });
});

describe('повторное ревью: помощник с признаками человека, поля заглушек, суффиксы, модели ИИ на краю PER (без модели)', () => {
  it('глагол до конца оборота и «и + имя» после «Яндекс Алиса» — человек', () => {
    const at = (t, w) => productContext(t, t.indexOf(w), t.indexOf(w) + w.length);
    expect(at('Со стороны Яндекс Алиса, руководитель группы, подтвердила сроки.', 'Алиса')).toBe(false);
    expect(at('Со стороны Яндекс Алиса быстро ответила на претензию.', 'Алиса')).toBe(false);
    expect(at('От Яндекс Алиса и Пётр подписали акт.', 'Алиса')).toBe(false);
    expect(at('Документы от Яндекс Алисе передали вчера.', 'Алисе')).toBe(false);
    expect(at('GigaChat, Алиса и Пётр', 'Алиса')).toBe(false);
    // без признаков — помощник; глагол в другом обороте не в счёт
    expect(at('Ответы готовит голосовой помощник Алиса.', 'Алиса')).toBe(true);
    expect(at('Подключили Яндекс Алису. Она отвечает быстро.', 'Алису')).toBe(true);
    expect(at('до отправки в GigaChat, Алису, DeepSeek и другие модели', 'Алису')).toBe(true);
  });
  it('«.ПОЛЕ» заглушки — только из закрытого списка; «поле» в заглушке лица — ФИО', async () => {
    let r = await analyze(doc('Перевод ⟦СУММА_1.ИВАНОВ_ПЕТР⟧ получен.'), defaultSettings(), { nerProvider: stub([['ИВАНОВ', 'PER']]) });
    expect(r.entities.map((e) => e.text)).toContain('ИВАНОВ');
    r = await analyze(doc('Подписант ⟦ФИО_1.ПЕТРОВ⟧ согласовал.'), defaultSettings());
    expect(groups(r)).toEqual(['PERSON:ПЕТРОВ']);
    r = await analyze(doc('Поставщик ⟦ORG_1⟧, ИНН ⟦ORG_1.INN⟧, р/с ⟦ORG_1.ACC⟧, ⟦ФИО_2.NAME⟧.'), commercial(), {
      nerProvider: stub([
        ['ORG', 'ORG'],
        ['ACC', 'ORG'],
        ['ФИО', 'PER'],
      ]),
    });
    expect(r.entities).toEqual([]);
  });
  it('суффиксы -атор/-ктор/-итор больше не нарицательные: «Кондуктор», «Сенатор», «Аудитор» + строчный двойник — ФИО', async () => {
    for (const [a, b, w] of [
      ['Отчёт сдал Кондуктор в пятницу.', 'В автобусе работает кондуктор.', 'Кондуктор'],
      ['Претензию подписал Сенатор.', 'Закон внёс сенатор.', 'Сенатор'],
      ['Замечания направил Аудитор.', 'Отчёт проверил аудитор.', 'Аудитор'],
    ]) {
      const r = await analyze(doc(a, b), defaultSettings(), { nerProvider: stub([[w, 'PER']]) });
      expect(
        r.entities.some((e) => e.text === w),
        w,
      ).toBe(true);
    }
  });
  it('модель ИИ на краю многословного PER не срезается («Grok Smith»); одна — отбрасывается', () => {
    const keep = (text, w) => {
      const i = text.indexOf(w);
      return filterPersonLocSpans([{ start: i, end: i + w.length, label: 'PER', score: 0.95 }], { text }).map((s) => text.slice(s.start, s.end));
    };
    expect(keep('Grok Smith signed the NDA.', 'Grok Smith')).toEqual(['Grok Smith']);
    expect(keep('Anna Gemini signed.', 'Anna Gemini')).toEqual(['Anna Gemini']);
    expect(keep('Спросили у Grok.', 'Grok')).toEqual([]);
  });
});

describe('третье ревью: должность после имени помощника и звонок — человек (без модели)', () => {
  const at = (t, w) => productContext(t, t.indexOf(w), t.indexOf(w) + w.length);
  it('должность или роль в обороте, в том числе после « — »', async () => {
    expect(at('Контакт со стороны Яндекс Алиса — менеджер проекта.', 'Алиса')).toBe(false);
    expect(at('Контакт со стороны Яндекс Алиса, менеджер проекта.', 'Алиса')).toBe(false);
    expect(at('Со стороны Яндекс Алиса, руководитель направления.', 'Алиса')).toBe(false);
    for (const s of ['Контакт со стороны Яндекс Алиса — менеджер проекта.', 'Контакт со стороны Яндекс Алиса, менеджер проекта.']) {
      const r = await analyze(doc(s), defaultSettings(), { nerProvider: stub([['Алиса', 'PER']]) });
      expect(
        r.entities.some((e) => e.text.includes('Алиса')),
        s,
      ).toBe(true);
    }
  });
  it('глагол связи перед «Яндекс Алисой» — человек; без признаков — помощник', () => {
    expect(at('Нужно позвонить в Яндекс Алисе завтра.', 'Алисе')).toBe(false);
    expect(at('Спросите у Яндекс Алисы прогноз погоды.', 'Алисы')).toBe(true);
    expect(at('Ответы готовит голосовой помощник Алиса.', 'Алиса')).toBe(true);
  });
});

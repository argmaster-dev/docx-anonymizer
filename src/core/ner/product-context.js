// Контекст продукта для одиночного имени (доработка 0.5 по прогону КП и ревью; §5.2 NLP `docs/spec-full.md`, FR-61, FR-62):
// «Алиса» — и женское имя, и голосовой помощник Яндекса. Только имена голосовых помощников («Алиса», «Маруся», «Салют», Siri,
// Alexa — все падежи) и только когда (1) перед именем — «Яндекс», «голосовой помощник/ассистент», «умная колонка», «чат-бот»,
// «нейросеть» («Яндекс Алису», «голосовой помощник Алиса»), или (2) имя стоит в перечислении между двумя продуктами либо после
// продукта перед «и другие модели/сервисы/нейросети…» («в GigaChat, Алису, DeepSeek и другие модели»). Сразу за именем глагол
// («Яндекс Алиса подтвердила», «чат-бот Маруся передала»), а после «Яндекс»/«помощник» — глагол до конца оборота или «и + имя»
// («Яндекс Алиса, руководитель группы, подтвердила», «Яндекс Алиса и Пётр») — человек, маскируется (fail-closed: утечка дороже).
// Фамилии и другие имена в перечислении продуктов («Excel, Петров и другие сотрудники») правило не трогает.
// Общий для фильтра PER модели (`filters-pl.js`), обращений (`names/vocative.js`), пар (`names/person.js`) и вариантов лица (`names/kb.js`).
// Чистый JS без chrome.* и DOM.
import { PRODUCT_NAMES, stopKey } from './stoplist.js';
import { inStoplist } from './filters.js';
import { bigFirstNameInfo, surnameLemmas } from '../detect/names/dict/index.js';
import { lowerE, isRoleNoun, POSITION_RE_SRC } from '../detect/names/lexicon.js';

/** Продукты для перечисления (ключи `stopKey`): программы, сервисы, модели ИИ — без обращений и бренда владельца. */
const PRODUCTS = new Set(PRODUCT_NAMES.map(stopKey));
/** Имена голосовых помощников во всех падежах: «Алиса/Алисы/Алисе/Алису/Алисой», «Маруся», «Салют», Siri, Alexa. */
const ASSISTANT_RE = /^(?:алис(?:а|ы|е|у|ой|ою)|марус(?:я|и|е|ю|ей|ею)|салют(?:а|у|ом|е)?|сири|siri|alexa)$/iu;
/** Перед словом — название помощника или сервиса: «Яндекс Алиса», «голосовой помощник Алиса», «умной колонке «Алиса»». */
const PRODUCT_LEAD_RE =
  /(?<![\p{L}])(?:яндекс\.?|yandex\.?|голосов\p{L}*[ \u00a0]+(?:помощник|ассистент)\p{L}*|умн\p{L}*[ \u00a0]+колонк\p{L}*|чат-?бот\p{L}*|нейросет\p{L}*|(?:ии|ai)-?(?:помощник|ассистент)\p{L}*)[ \u00a0]*[«"“„]?$/iu;
/** Сразу за именем — глагол в личной форме или прошедшего времени: «Алиса подтвердила», «Маруся передаёт» — человек. */
const VERB_AFTER_RE =
  /^[»"”]?[ \u00a0]+(?:не[ \u00a0]+)?\p{Ll}+(?:л|ла|ло|ли|лся|лась|лось|лись|ет|ёт|ют|ит|ят|ут|ат|ется|ётся|ются|ится|ятся|ет|ешь|ит)(?![\p{L}])/u;
/** Глагол в личной форме или прошедшего времени — слово целиком (для просмотра до конца оборота). */
const VERB_WORD_RE = /^\p{Ll}+(?:л|ла|ло|ли|лся|лась|лось|лись|ет|ёт|ют|ит|ят|ут|ется|ётся|ются|ится|ятся)$/u;
/** Должность из словаря «в лице …» (директор, руководитель, представитель, начальник…) как отдельное слово. */
const POSITION_IN_RE = new RegExp(`(?<![\\p{L}])${POSITION_RE_SRC}(?![\\p{L}])`, 'iu');
/** Перед «Яндекс Алисой» — глагол связи с человеком: «позвонить в Яндекс Алисе», «написать Яндекс Алисе» (fail-closed). */
const CONTACT_BEFORE_RE = /(?<![\p{L}])(?:по|при|со)?(?:звон|связ|пис|напис)\p{L}*[^.!?;\n]{0,30}$/iu;
/** Конец оборота: точка, «!», «?», «;», двоеточие, тире с пробелами, перенос строки. */
const CLAUSE_END_RE = /[.!?;:\n]|[ \u00a0][—–][ \u00a0]/u;
/**
 * Признак человека после имени помощника в том же обороте (ревью доработки 0.5): глагол в пределах 8 слов до конца оборота
 * («Яндекс Алиса, руководитель группы, подтвердила», «Яндекс Алиса быстро ответила») или «и + имя/фамилия» («Алиса и Пётр»).
 * @param {string} after  текст сразу за именем
 */
function personAfter(after) {
  // должность или роль до конца предложения, и после « — »: «Яндекс Алиса — менеджер проекта», «Яндекс Алиса, менеджер проекта» (третье ревью)
  const sentence = after.split(/[.!?;\n]/u)[0];
  if (
    POSITION_IN_RE.test(sentence) ||
    sentence
      .split(/[^\p{L}-]+/u)
      .filter(Boolean)
      .slice(0, 8)
      .some((w) => isRoleNoun(w))
  )
    return true;
  const m = CLAUSE_END_RE.exec(after);
  const clause = m ? after.slice(0, m.index) : after;
  if (
    clause
      .split(/[^\p{L}-]+/u)
      .filter(Boolean)
      .slice(0, 8)
      .some((w) => VERB_WORD_RE.test(w))
  )
    return true;
  return andName(after);
}
/** Сразу за именем «и/или + имя или фамилия из словарей»: «Алиса и Пётр подписали». */
function andName(after) {
  const and = /^[ \u00a0]+(?:и|или)[ \u00a0]+(\p{Lu}\p{Ll}+)/u.exec(after);
  return !!and && (bigFirstNameInfo(lowerE(and[1])).length > 0 || surnameLemmas(lowerE(and[1])).length > 0);
}

/** Соседи в перечислении: слово перед «,»/«и»/«или» слева и после них справа. */
const LIST_LEFT_RE = /([\p{L}\p{N}][\p{L}\p{N}.+-]*)[»"”]?[ \u00a0]*(?:,|[ \u00a0]и|[ \u00a0]или)[ \u00a0]*$/u;
const LIST_RIGHT_RE = /^[ \u00a0]*(?:,|и(?=[ \u00a0])|или(?=[ \u00a0]))[ \u00a0]*[«"“„]?([\p{L}\p{N}][\p{L}\p{N}.+-]*)/u;
/** Конец перечисления продуктов: «и другие модели», «и др. сервисы», «и прочие нейросети». */
const LIST_END_RE =
  /^[ \u00a0]*,?[ \u00a0]*(?:и|или)[ \u00a0]+(?:други\p{L}*|др\.|прочи\p{L}*)[ \u00a0]+(?:модел|сервис|нейросет|продукт|помощник|ассистент|чат-?бот|платформ|ии(?![\p{L}])|llm)/iu;
const isProduct = (w) => !!w && inStoplist(stopKey(w), PRODUCTS, w);

/**
 * Имя голосового помощника в контексте продукта (см. шапку модуля).
 * @param {string} text @param {number} start @param {number} end
 */
export function productContext(text, start, end) {
  if (!ASSISTANT_RE.test(text.slice(start, end))) return false;
  const before = text.slice(Math.max(0, start - 40), start);
  const after = text.slice(end, end + 40);
  if (VERB_AFTER_RE.test(after)) return false;
  // после «Яндекс», «голосовой помощник»…: глагол до конца оборота или «и + имя» — человек (fail-closed)
  if (PRODUCT_LEAD_RE.test(before)) return !personAfter(text.slice(end, end + 120)) && !CONTACT_BEFORE_RE.test(before);
  const left = LIST_LEFT_RE.exec(before);
  if (!left || !isProduct(left[1])) return false;
  // в перечислении глагол оборота не в счёт («…, DeepSeek и другие модели» — «модели» похоже на глагол), только «и + имя»
  if (andName(after)) return false;
  const right = LIST_RIGHT_RE.exec(after);
  return (!!right && isProduct(right[1])) || LIST_END_RE.test(after);
}

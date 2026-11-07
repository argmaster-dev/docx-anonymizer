// Чистые функции работы с файлами перехвата (FR-04, FR-05, FR-06). Без DOM-событий — тестируются в Node.
import { KEY_SNIFF_BYTES, looksLikeKeyText, sniffDecode } from '../core/recovery-key-sniff.js';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const PDF_MIME = 'application/pdf';

/** FR-04: расширение .docx/.docm без учёта регистра или MIME документа Word. */
export function isDocx(file) {
  if (!file) return false;
  if (/\.(docx|docm)$/i.test(file.name || '')) return true;
  return file.type === DOCX_MIME;
}

/** Есть ли среди файлов хотя бы один .docx. */
export function hasDocx(files) {
  return Array.from(files || []).some(isDocx);
}

/** PDF (версия 0.3): расширение .pdf без учёта регистра или MIME application/pdf. */
export function isPdfFile(file) {
  if (!file) return false;
  return /\.pdf$/i.test(file.name || '') || file.type === PDF_MIME;
}

/** Форматы 0.5 (WP12-B): расширение без учёта регистра или MIME. Сканы и изображения не обрабатываются (OCR — версия 0.6); с 0.5.2 они идут в панель строкой-отказом (FR-04б). */
const OTHER_KINDS = [
  {
    kind: 'xlsx',
    re: /\.(xlsx|xlsm)$/i,
    mime: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel.sheet.macroEnabled.12'],
  },
  {
    kind: 'pptx',
    re: /\.(pptx|pptm)$/i,
    mime: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-powerpoint.presentation.macroEnabled.12'],
  },
  // текстовые — только по расширению: формат (CSV, JSON, строки) хост определяет по имени
  { kind: 'text', re: /\.(txt|text|log|md|markdown|csv|json)$/i, mime: [] },
];

/** Вид файла для обработки: 'docx' | 'pdf' | 'xlsx' | 'pptx' | 'text' | null (неподдерживаемый: с 0.5.2 — строка-отказ в панели или список «не спрашивать»). */
export function fileKind(file) {
  if (isDocx(file)) return 'docx';
  if (isPdfFile(file)) return 'pdf';
  if (!file) return null;
  const name = file.name || '';
  for (const k of OTHER_KINDS) if (k.re.test(name)) return k.kind;
  // по MIME — только если у имени нет другого расширения («фото.png» с типом text/plain — не текст)
  if (!/\.[^./\\]+$/.test(name)) for (const k of OTHER_KINDS) if (k.mime.includes(file.type)) return k.kind;
  return null;
}

/** Расширение имени без точки, строчными; '' — имени без расширения. */
export const extOf = (file) => /\.([^./\\]+)$/.exec(file?.name || '')?.[1].toLowerCase() || '';

/**
 * Файл из списка «не спрашивать» (0.5.2, FR-04в): уходит на сайт без панели, как до 0.5.2. Поддерживаемый формат — никогда, даже если
 * список в хранилище поправлен вручную: ключ восстановления (.json, .txt, *.mapping.json) не должен уйти без проверки.
 */
export function isSkipped(file, settings) {
  const ext = extOf(file);
  return !!ext && fileKind(file) === null && (settings?.skipExtensions || []).includes(ext);
}

/** Обрабатывает ли расширение файл при этих настройках: PDF — если pdfMode не 'off' (FR-04, версия 0.3), остальные виды — всегда. */
export function isSupported(file, settings) {
  const kind = fileKind(file);
  if (kind === 'pdf') return (settings?.pdfMode ?? 'markdown') !== 'off';
  return kind !== null;
}

/**
 * Имя ключа восстановления, как его сохраняет расширение: «договор.mapping.json» (0.5.1). Сам ключ узнаёт по содержимому хост
 * (core/recovery-key.js, код RECOVERY_KEY); по имени перехват не отдаёт файл сайту, пока хост не подтвердил, что это не ключ.
 */
export const isKeyFileName = (file) => /\.mapping\.json$/i.test(file?.name || '');

/**
 * Перехваченный текстовый файл похож на ключ восстановления — по первым KEY_SNIFF_BYTES байтам, без хоста (0.5.1, ревью):
 * те же правила по тексту, что у хоста (core/recovery-key-sniff.js); кодировка — sniffDecode. Форматы Office не читаются;
 * неподдерживаемые (0.5.2, FR-04б) — читаются: переименованный в «.dat» ключ не получит «Загрузить как есть». PDF (ревью 0.5.2) —
 * если в первых 1024 байтах нет сигнатуры `%PDF-`: такой «PDF» при pdfMode 'off' получил бы «как есть», а при включённом — отказ
 * PDF_INVALID с «как есть».
 * @param {File} file
 */
export async function sniffRecoveryKey(file) {
  const kind = fileKind(file);
  if (kind && kind !== 'text' && kind !== 'pdf') return false;
  try {
    const head = new Uint8Array(await file.slice(0, KEY_SNIFF_BYTES).arrayBuffer());
    if (kind === 'pdf' && String.fromCharCode(...head.subarray(0, 1024)).includes('%PDF-')) return false;
    return looksLikeKeyText(sniffDecode(head));
  } catch {
    return false; // не прочитался — решит хост; файл с именем ключа и так не уйдёт без его ответа
  }
}

/** Есть ли среди файлов хотя бы один обрабатываемый. */
export function hasSupported(files, settings) {
  return Array.from(files || []).some((f) => isSupported(f, settings));
}

/** Сигнатура файла: по ней узнаём собственные результаты при повторной отправке события страницей. */
export function fileSignature(file) {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

/**
 * Собирает итоговый список файлов в исходном порядке (FR-06):
 * для каждого исходного файла — его замена или он сам.
 * @template T
 * @param {T[]} originals
 * @param {Map<number, T>} replacements индекс в originals → новый файл
 */
export function mergeInOrder(originals, replacements) {
  return originals.map((f, i) => replacements.get(i) ?? f);
}

/** Расширения результатов «тот же формат» (WP12-B): имя результата сохраняет расширение исходника. */
const SAME_EXT_RE = /\.(docx|docm|xlsx|xlsm|pptx|pptm|txt|text|log|md|markdown|csv|json)$/i;

/** Имя файла для скачивания маппинга: «договор.anon.docx» (или «.anon.md», «.anon.txt» из PDF, «.anon.xlsx»…) → «договор.mapping.json». */
export function mappingFileName(resultName) {
  const base = String(resultName || 'document')
    .replace(SAME_EXT_RE, '')
    .replace(/\.anon$/i, '');
  return `${base}.mapping.json`;
}

/**
 * Тип результата: MIME исходника сохраняется (FR-05); пустой — MIME результата от хоста, без него — документа Word;
 * для PDF — тип текста от хоста (text/markdown или text/plain, версия 0.3).
 * @param {{type?: string}} original @param {string} [mime] MIME результата из RESULT_BEGIN
 */
export function resultType(original, mime) {
  if (mime && /^text\//.test(mime)) return mime;
  return original?.type || mime || DOCX_MIME;
}

/** Содержит ли сообщение ошибки признак инвалидации контекста расширения (FR-09). */
export function isInvalidatedError(err) {
  const msg = String((err && err.message) || err || '');
  return /Extension context invalidated|context invalidated|Receiving end does not exist/i.test(msg);
}

/** «1,2 МБ» / «340 КБ». */
export function formatSize(bytes, lang = 'ru') {
  const mb = lang === 'ru' ? 'МБ' : 'MB';
  const kb = lang === 'ru' ? 'КБ' : 'KB';
  const sep = lang === 'ru' ? ',' : '.';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace('.', sep)} ${mb}`;
  return `${Math.max(1, Math.round(bytes / 1024))} ${kb}`;
}

/**
 * Имя результата на стороне клиента: 'договор.docx' → 'договор.anon.docx' (Excel, PowerPoint, текст — так же); с `{ext}` — 'договор.pdf' → 'договор.anon.md'. Нужно, потому что при повторной
 * загрузке файла с тем же содержимым хост возвращает прежнюю сессию (§3.6) вместе с её именем.
 */
export function makeResultName(name, suffix = '.anon', opts = {}) {
  if (opts.ext) {
    // PDF → текст (версия 0.3): 'договор.pdf' → 'договор.anon.md'
    const base = String(name || 'document').replace(/\.(docx|docm|pdf)$/i, '') || 'document';
    return `${base}${suffix}${opts.ext}`;
  }
  // тот же формат (0.5): 'реестр.xlsx' → 'реестр.anon.xlsx', 'выгрузка.csv' → 'выгрузка.anon.csv'; без расширения — .docx, как раньше
  const n = name || 'document.docx';
  const m = SAME_EXT_RE.exec(n);
  return `${(m ? n.slice(0, m.index) : n) || 'document'}${suffix}${m ? m[0] : '.docx'}`;
}

/**
 * Нейтральное имя вместо исходного (fail-closed, ревью WP12-B): «Кравченко_Ольга.docx» → «document.docx» — если имя результата от
 * хоста недоступно, в чат не уходит исходное имя (в нём могут быть данные).
 * @param {string} name
 */
export function neutralName(name) {
  const m = /\.[^./\\]+$/.exec(String(name || ''));
  return `document${m ? m[0] : '.docx'}`;
}

/**
 * Имя результата без повтора в одной отправке: «a.anon.docx», затем «a (2).anon.docx» (суффикс и расширение — на месте).
 * @param {string} name
 * @param {Set<string>} used  имена, уже выданные в этой отправке (дополняется)
 * @param {string} [suffix]
 */
export function uniqueResultName(name, used, suffix = '.anon') {
  const ext = /\.[^./\\]+$/.exec(name)?.[0] || '';
  let base = name.slice(0, name.length - ext.length);
  let sfx = '';
  if (suffix && base.toLowerCase().endsWith(suffix.toLowerCase())) {
    sfx = base.slice(base.length - suffix.length);
    base = base.slice(0, base.length - suffix.length);
  }
  let out = name;
  for (let k = 2; used.has(out.toLowerCase()); k++) out = `${base} (${k})${sfx}${ext}`;
  used.add(out.toLowerCase());
  return out;
}

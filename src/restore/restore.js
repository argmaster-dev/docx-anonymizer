// Обратная замена (С3, FR-36, FR-36а, FR-37): ответ ИИ с плейсхолдерами + маппинг (сессия или .mapping.json) → настоящие значения.
// Ответ — вставленный текст или файл от ИИ (.docx/.docm/.md/.txt, WP10-B; с 0.5 — .xlsx/.xlsm, .pptx/.pptm, .csv, .json, .log, WP12-B).
// Карта: из файла (разбор на странице) или из сессии по GET_MAPPING; замена всегда идёт здесь, ядром: restoreText() для текста,
// restoreDocx() для DOCX, restoreDocument() с адаптером формата для Excel, PowerPoint, CSV и JSON (структура и форматирование
// сохраняются). Адаптеры форматов в бандле страницы (esbuild встраивает динамический import в IIFE) — сети нет.
// Склонение ФИО по контексту (FR-37, редакция 0.2) включено по умолчанию; склонённые подстановки подсвечиваются зелёным.
// Ключ, защищённый паролем (0.5, WP12-D, К8): страница распознаёт зашифрованный .mapping.json и спрашивает пароль; неверный —
// KEY_PASSWORD и понятный текст без частичного вывода; пароль нигде не хранится, расшифрованная карта живёт только в памяти страницы.
// Сохранение ключа с паролем — тоже здесь (restore.html?save=1&docId=…&name=…, панель открывает через background, MSG.OPEN_KEY_SAVE):
// пароль, набранный на сайте чата, видели бы слушатели клавиатуры страницы (ревью WP12-D); страница расширения сайту недоступна.
import './restore.css';
import { restoreDocx, restoreDocument, restoreText } from '../core/restore-doc.js';
import { loadAdapter } from '../core/adapters.js';
import { encryptMapping, MIN_PASSWORD_LENGTH } from '../core/key-crypto.js';
import { mergeMappings } from '../core/mapping.js';
import { MSG } from '../shared/protocol.js';
import { connectClient } from '../shared/port-client.js';
import { loadSettings } from '../shared/settings-store.js';
import { createT, resolveUiLanguage } from '../ui/i18n/index.js';
import { RESTORE_DICT } from '../ui/i18n/restore.js';
import {
  aiFileAdapterKind,
  aiFileKind,
  countUnresolved,
  mimeFor,
  mixedValueWarnings,
  readMappingFiles,
  pickSession,
  restoredName,
  toSegments,
} from '../ui/deanon/index.js';
import { downloadBlob, h } from '../ui/deanon/dom.js';
import { madeByLine, helpLink } from '../ui/brand.js';

let t = createT(RESTORE_DICT, 'ru');
let client = null;
/** @type {{maxFileSizeMB: number, outputSuffix: string}} */
let limits = { maxFileSizeMB: 50, outputSuffix: '.anon' };
/** @type {{docId: string, name: string, createdAt: number, entities: number}[]} */
let sessions = [];
let source = 'session';
let sessionId = '';
let fileMapping = null;
/** Выбранные файлы ключа, среди которых есть зашифрованные, — ждут пароля (WP12-D); сам пароль не хранится */
/** @type {string[] | null} */
let lockedTexts = null;
/** Что восстанавливаем: вставленный текст или файл от ИИ (FR-36а) */
let mode = 'text';
/** @type {{name: string, size: number, kind: 'docx'|'xlsx'|'pptx'|'csv'|'json'|'text', bytes?: Uint8Array, text?: string} | null} */
let aiFile = null;
/** Склонять ФИО по контексту метки (FR-37) */
let decline = true;

const getClient = () => (client ||= connectClient());

async function init() {
  const settings = await loadSettings();
  const lang = resolveUiLanguage(settings.uiLanguage);
  t = createT(RESTORE_DICT, lang);
  limits = { maxFileSizeMB: settings.maxFileSizeMB || 50, outputSuffix: settings.outputSuffix || '.anon' };
  document.documentElement.lang = lang;
  document.title = `DOCX Anonymizer — ${t('title').toLowerCase()}`;
  try {
    const r = await getClient().request(MSG.LIST_SESSIONS);
    sessions = [...(r.sessions || [])].sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    sessions = [];
  }
  // popup открывает страницу как restore.html?docId=… — предвыбираем эту обработку (неизвестная → самая свежая)
  sessionId = pickSession(sessions, new URLSearchParams(location.search).get('docId'));
  if (!sessions.length) source = 'file';
  render(lang);
}

/** Радиогруппа-переключатель в стиле .seg. */
function segGroup(name, label, options, current, onPick, testPrefix) {
  return h(
    'div',
    { class: 'seg', role: 'radiogroup', 'aria-label': label },
    options.map(([v, text]) =>
      h(
        'label',
        {},
        h('input', { type: 'radio', name, value: v, checked: current === v, dataset: { testid: `${testPrefix}${v}` }, onchange: () => onPick(v) }),
        text,
      ),
    ),
  );
}

function render(lang) {
  const input = h('textarea', { class: 'big', placeholder: t('input_placeholder'), dataset: { testid: 'restore-input' }, 'aria-label': t('input_h') });
  const out = h('div', { class: 'result placeholder', dataset: { testid: 'restore-output' }, 'aria-live': 'polite' }, t('result_empty'));
  const stat = h('div', { class: 'hint', dataset: { testid: 'restore-stat' } });
  const unres = h('div', { dataset: { testid: 'restore-unresolved' } });
  const msg = h('div', { class: 'err', role: 'alert', dataset: { testid: 'restore-error' } });
  const declineBox = h(
    'label',
    { class: 'check' },
    h('input', {
      type: 'checkbox',
      checked: decline,
      dataset: { testid: 'restore-decline' },
      onchange: (e) => {
        decline = e.target.checked;
        invalidate(); // прежний файл собран с другим режимом склонения
      },
    }),
    t('decline_label'),
  );
  const copyBtn = h('button', { type: 'button', class: 'btn', disabled: true, dataset: { testid: 'restore-copy' } }, t('copy'));
  const downloadBtn = h('button', { type: 'button', class: 'btn', disabled: true, dataset: { testid: 'restore-download' } }, t('download'));
  let lastText = '';
  /** @type {{name: string, blob: Blob} | null} */
  let lastDownload = null;
  const warn = h('div', { dataset: { testid: 'restore-warnings' } });
  /** Входные данные поменялись (файл от ИИ, карта, источник, обработка): прежний результат больше не скачивается. */
  const invalidate = () => {
    lastDownload = null;
    downloadBtn.disabled = true;
  };

  /* ---------- 1. Ответ ИИ: текст или файл ---------- */
  const inputBox = h('div', { class: 'input-box' });
  const fileInfo = h('div', { class: 'hint', dataset: { testid: 'ai-file-info' } });
  const aiInput = h('input', {
    type: 'file',
    accept: '.docx,.docm,.xlsx,.xlsm,.pptx,.pptm,.csv,.json,.md,.txt,.markdown,.log',
    dataset: { testid: 'ai-file' },
    'aria-label': t('ai_file_pick'),
    onchange: async () => {
      const f = aiInput.files?.[0];
      aiFile = null;
      invalidate();
      fileInfo.className = 'err';
      if (!f) return (fileInfo.textContent = '');
      const kind = aiFileKind(f.name);
      if (!kind) return (fileInfo.textContent = t('ai_file_bad'));
      if (f.size > limits.maxFileSizeMB * 1024 * 1024) return (fileInfo.textContent = t('file_too_big', { limit: limits.maxFileSizeMB }));
      try {
        aiFile =
          kind !== 'text'
            ? { name: f.name, size: f.size, kind, bytes: new Uint8Array(await f.arrayBuffer()) }
            : { name: f.name, size: f.size, kind, text: await f.text() };
      } catch (err) {
        return (fileInfo.textContent = t('error', { msg: String(err?.message || err) }));
      }
      fileInfo.className = 'hint';
      fileInfo.textContent = t('ai_file_loaded', { name: f.name, kb: Math.max(1, Math.round(f.size / 1024)) });
    },
  });
  const fileField = h('div', { class: 'field' }, h('span', { class: 'lbl' }, t('ai_file_pick')), aiInput, fileInfo);
  const drawInput = () => {
    const seg = segGroup(
      'mode',
      t('input_h'),
      [
        ['text', t('mode_text')],
        ['file', t('mode_file')],
      ],
      mode,
      (v) => {
        mode = v;
        invalidate();
        drawInput();
      },
      'restore-mode-',
    );
    inputBox.replaceChildren(seg, mode === 'text' ? input : fileField);
  };
  drawInput();

  /* ---------- 2. Карта замен ---------- */
  const sourceBox = h('div');
  const drawSource = () => {
    const seg = segGroup(
      'source',
      t('source_h'),
      [
        ['session', t('source_session')],
        ['file', t('source_file')],
      ],
      source,
      (v) => {
        source = v;
        invalidate();
        drawSource();
      },
      'source-',
    );
    let body;
    if (source === 'session') {
      body = sessions.length
        ? h(
            'div',
            { class: 'sessions', role: 'radiogroup', 'aria-label': t('session_pick') },
            sessions.map((s) =>
              h(
                'label',
                { class: 'sess' },
                h('input', {
                  type: 'radio',
                  name: 'session',
                  value: s.docId,
                  checked: s.docId === sessionId,
                  dataset: { testid: 'session-radio' },
                  onchange: () => {
                    sessionId = s.docId;
                    invalidate();
                  },
                }),
                t('session_item', { name: s.name, time: new Date(s.createdAt).toLocaleString(lang), n: s.entities }),
              ),
            ),
          )
        : h('div', { class: 'empty' }, t('session_none'));
    } else {
      const info = h('div', { class: 'hint', dataset: { testid: 'file-info' } });
      if (fileMapping) info.textContent = t('file_loaded', { n: fileMapping.entries.length });
      /** Итог разбора файлов ключа: карта, просьба пароля или понятная ошибка (без содержимого ключа). */
      const show = (r) => {
        fileMapping = r.mapping || null;
        lockedTexts = r.needPassword || r.error === 'password' ? lockedTexts : null;
        unlock.hidden = !lockedTexts;
        info.className = r.mapping || r.needPassword ? 'hint' : 'err';
        if (r.mapping) info.textContent = t(r.encrypted ? 'key_unlocked' : 'file_loaded', { n: r.mapping.entries.length });
        else if (r.needPassword) info.textContent = t('key_encrypted');
        else if (r.error === 'password') info.textContent = t('key_password_bad');
        else if (r.error === 'invalid') info.textContent = t('key_invalid');
        else info.textContent = t('file_bad', { why: t(r.error === 'json' ? 'file_bad_json' : 'file_bad_shape') });
      };
      const password = h('input', {
        type: 'password',
        autocomplete: 'current-password',
        dataset: { testid: 'key-password' },
        'aria-label': t('key_password'),
        placeholder: t('key_password'),
        onkeydown: (e) => {
          if (e.key === 'Enter') tryUnlock();
        },
      });
      const unlockBtn = h('button', { type: 'button', class: 'btn', dataset: { testid: 'key-unlock' }, onclick: () => tryUnlock() }, t('key_unlock'));
      // обёртка без класса: у .row свой display, он перебил бы атрибут hidden
      const unlock = h('div', { hidden: !lockedTexts }, h('div', { class: 'row' }, password, unlockBtn));
      const tryUnlock = async () => {
        if (!lockedTexts) return;
        const pw = password.value;
        password.value = ''; // пароль не задерживается в поле и нигде не запоминается
        if (!pw) return show({ needPassword: true, encrypted: 1 });
        unlockBtn.disabled = true;
        try {
          show(await readMappingFiles(lockedTexts, pw));
        } finally {
          unlockBtn.disabled = false;
        }
        if (fileMapping) lockedTexts = null;
        unlock.hidden = !lockedTexts;
      };
      const file = h('input', {
        type: 'file',
        multiple: true,
        accept: '.json,application/json',
        dataset: { testid: 'mapping-file' },
        'aria-label': t('file_pick'),
        onchange: async () => {
          invalidate();
          const texts = await Promise.all([...file.files].map((f) => f.text()));
          lockedTexts = texts;
          show(await readMappingFiles(texts));
          if (lockedTexts && !unlock.hidden) password.focus();
        },
      });
      body = h('div', { class: 'field' }, h('span', { class: 'lbl' }, t('file_pick')), file, info, unlock);
    }
    sourceBox.replaceChildren(seg, body);
  };
  drawSource();

  /** Карта: из файла или из сессии (GET_MAPPING); null — сообщение уже показано. */
  const getMapping = async () => {
    if (source === 'file') {
      if (!fileMapping) msg.textContent = t(lockedTexts ? 'need_password' : 'need_mapping');
      return fileMapping;
    }
    if (!sessionId) {
      msg.textContent = t('need_mapping');
      return null;
    }
    const res = await getClient().request(MSG.GET_MAPPING, { docId: sessionId });
    return res.mapping;
  };

  /** Список нераспознанных меток (общий для текста и DOCX). */
  const showUnresolved = (list) => {
    const groups = countUnresolved(list);
    unres.replaceChildren(
      groups.length
        ? h(
            'div',
            {},
            h('strong', {}, t('unresolved_h', { n: list.length })),
            h('p', { class: 'hint' }, t('unresolved_hint')),
            h(
              'ul',
              { class: 'unres' },
              groups.map((g) => h('li', {}, h('mark', {}, g.text), g.count > 1 ? ` × ${g.count}` : '')),
            ),
          )
        : h('div', { class: 'good' }, t('unresolved_none')),
    );
  };
  /** Метки, под которыми в документе были разные значения (паспорт: серия/номер, орган, код) — проверить вручную. */
  const showWarnings = (mapping, tokens) => {
    const list = mixedValueWarnings(mapping, tokens);
    warn.replaceChildren(
      ...(list.length
        ? [
            h(
              'div',
              { class: 'mixed' },
              h('strong', {}, t('mixed_h')),
              h(
                'ul',
                {},
                list.map((w) => h('li', { dataset: { testid: 'restore-warning' } }, t('mixed_item', { token: w.token, n: w.n }))),
              ),
            ),
          ]
        : []),
    );
  };
  const statLine = (replaced, declinedN) => t('stat', { n: replaced }) + (declinedN ? ` · ${t('declined_stat', { n: declinedN })}` : '');

  const showText = (r) => {
    lastText = r.text;
    out.className = 'result';
    out.replaceChildren(
      ...toSegments(r.text, r.unresolved, r.declined).map((s) => {
        if (s.unresolved) return h('mark', { dataset: { testid: 'unresolved-mark' } }, s.text);
        if (s.declined) {
          const title = t('declined_title', { case: t(`case_${s.item.case}`), original: s.item.original });
          return h('mark', { class: 'declined', title, dataset: { testid: 'declined-mark' } }, s.text);
        }
        return s.text;
      }),
    );
    stat.textContent = statLine(r.replaced, r.declined.length);
    copyBtn.disabled = false;
    showUnresolved(r.unresolved);
  };

  const showDocx = (r) => {
    lastText = '';
    out.className = 'result summary';
    out.replaceChildren(
      h(
        'div',
        { dataset: { testid: 'restore-docx-summary' } },
        h('p', { class: 'good' }, t('docx_done', { n: r.replaced })),
        r.declined.length
          ? h(
              'div',
              {},
              h('strong', {}, t('docx_declined_h', { n: r.declined.length })),
              h(
                'ul',
                { class: 'declined-list' },
                r.declined.map((d) =>
                  h('li', {}, `${t(`case_${d.case}`)} · ${d.original} → `, h('mark', { class: 'declined', dataset: { testid: 'declined-mark' } }, d.text)),
                ),
              ),
            )
          : null,
        r.skipped.length ? h('p', { class: 'err' }, t('docx_skipped', { n: r.skipped.length })) : null,
        h('p', { class: 'hint' }, t('docx_hint')),
      ),
    );
    stat.textContent = statLine(r.replaced, r.declined.length);
    copyBtn.disabled = true;
    showUnresolved(r.unresolved);
  };

  const run = async () => {
    msg.textContent = '';
    invalidate();
    warn.replaceChildren();
    const file = mode === 'file' ? aiFile : null;
    if (mode === 'text' && !input.value.trim()) {
      msg.textContent = t('need_text');
      return;
    }
    if (mode === 'file' && !file) {
      msg.textContent = t('need_file');
      return;
    }
    let mapping;
    try {
      mapping = await getMapping();
    } catch (err) {
      // различаем по ERROR.reason, а не по тексту сообщения (тексты хоста могут меняться)
      if (err?.reason === 'NO_MAPPING') msg.textContent = t('session_missing');
      else if (err?.reason === 'NO_SESSION') msg.textContent = t('session_gone');
      else msg.textContent = t('error', { msg: String(err?.message || err) });
      return;
    }
    if (!mapping) return;
    const name = file ? restoredName(file.name, limits.outputSuffix) : '';
    if (file && file.kind !== 'text') {
      let r;
      try {
        const kind = aiFileAdapterKind(file.kind);
        r = kind
          ? restoreDocument(/** @type {Uint8Array} */ (file.bytes), mapping, { adapter: await loadAdapter(kind), name: file.name, decline })
          : restoreDocx(/** @type {Uint8Array} */ (file.bytes), mapping, { decline });
      } catch (err) {
        msg.textContent = ['NOT_DOCX', 'ENCRYPTED', 'PARSE_FAILED'].includes(err?.code)
          ? t('error_not_docx')
          : err?.code === 'NOT_SUPPORTED'
            ? t('error_bad_file')
            : t('error', { msg: String(err?.message || err) });
        return;
      }
      showDocx(r);
      showWarnings(mapping, r.tokens);
      lastDownload = { name, blob: new Blob([r.bytes], { type: mimeFor(name) }) };
    } else {
      const r = restoreText(file ? /** @type {string} */ (file.text) : input.value, mapping, { decline });
      showText(r);
      showWarnings(mapping, r.tokens);
      if (file) lastDownload = { name, blob: new Blob([r.text], { type: mimeFor(name) }) };
    }
    downloadBtn.disabled = !lastDownload;
  };

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(lastText);
      copyBtn.textContent = t('copied');
    } catch {
      const range = document.createRange();
      range.selectNodeContents(out);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
    }
    setTimeout(() => (copyBtn.textContent = t('copy')), 1500);
  });
  downloadBtn.addEventListener('click', () => {
    if (lastDownload) downloadBlob(lastDownload.name, lastDownload.blob);
  });

  document
    .getElementById('app')
    .replaceChildren(
      h(
        'div',
        { class: 'restore' },
        h('header', { class: 'page-head' }, h('h1', {}, t('title')), h('p', {}, t('subtitle'))),
        keySaveCard(),
        h('section', { class: 'card' }, h('h2', {}, t('input_h')), inputBox),
        h('section', { class: 'card' }, h('h2', {}, t('source_h')), sourceBox),
        h(
          'div',
          { class: 'row' },
          h('button', { type: 'button', class: 'btn primary', dataset: { testid: 'restore-run' }, onclick: run }, t('restore')),
          declineBox,
          msg,
        ),
        h(
          'section',
          { class: 'card' },
          h('h2', {}, t('result_h')),
          out,
          h('div', { class: 'row between', style: 'margin-top:10px' }, stat, h('div', { class: 'row' }, copyBtn, downloadBtn)),
          unres,
          warn,
          h('p', { class: 'hint' }, t('declension_hint')),
        ),
        h('div', { class: 'row between' }, helpLink(lang), madeByLine(lang)),
      ),
    );
}

/** Имя файла ключа из ссылки: только «*.mapping.json» без путей, иначе нейтральное. */
function keyFileName(raw) {
  const ok = typeof raw === 'string' && raw.length <= 200 && /\.mapping\.json$/i.test(raw) && !/[\\/]/.test(raw);
  return ok ? raw : 'document.mapping.json';
}

/**
 * «Сохранить ключ восстановления с паролем» (0.5, WP12-D, Ц5, К8) — только при ?save=1: пароль и повтор (не короче
 * MIN_PASSWORD_LENGTH), индикатор длины, предупреждение «забытый пароль = потерянный ключ»; карта — у хоста по docId (GET_MAPPING,
 * несколько файлов одной отправки склеиваются), шифрование — core/key-crypto.js, файл скачивается отсюда. Поля пароля очищаются
 * после сохранения и при уходе со страницы; пароль никуда не пишется.
 */
function keySaveCard() {
  const params = new URLSearchParams(location.search);
  if (params.get('save') !== '1') return null;
  const docIds = params.getAll('docId').filter((x) => /^d\d{1,9}$/.test(x));
  const name = keyFileName(params.get('name'));
  const field = (testid, label) =>
    h('input', { type: 'password', autocomplete: 'new-password', placeholder: label, 'aria-label': label, dataset: { testid }, oninput: () => meter() });
  const pw1 = field('key-save-password', t('save_password'));
  const pw2 = field('key-save-password2', t('save_password2'));
  const meterEl = h('div', { class: 'hint', dataset: { testid: 'key-save-meter' }, 'aria-live': 'polite' });
  const status = h('div', { class: 'hint', role: 'alert', dataset: { testid: 'key-save-status' } });
  const meter = () => {
    const n = pw1.value.length;
    const grade = n < MIN_PASSWORD_LENGTH ? 'short' : n < 12 ? 'fair' : 'good';
    meterEl.className = grade === 'short' ? 'err' : grade === 'good' ? 'good' : 'hint';
    meterEl.textContent = n ? t('save_meter', { n, grade: t(`save_${grade}`, { min: MIN_PASSWORD_LENGTH }) }) : '';
    status.textContent = '';
  };
  const clear = () => {
    pw1.value = '';
    pw2.value = '';
    meterEl.textContent = '';
  };
  // пароль не задерживается в полях: уход со страницы и скрытие вкладки — очистка
  addEventListener('pagehide', clear);
  const fail = (key, params2) => {
    status.className = 'err';
    status.textContent = t(key, params2);
  };
  const run = h('button', { type: 'button', class: 'btn primary', dataset: { testid: 'key-save-run' } }, t('save_run'));
  const save = async () => {
    if (!docIds.length) return fail('save_no_session');
    if (pw1.value.length < MIN_PASSWORD_LENGTH) return fail('save_too_short', { min: MIN_PASSWORD_LENGTH });
    if (pw1.value !== pw2.value) return fail('save_mismatch');
    run.disabled = true;
    run.textContent = t('save_busy');
    try {
      let mappings;
      try {
        mappings = await Promise.all(docIds.map(async (docId) => (await getClient().request(MSG.GET_MAPPING, { docId })).mapping));
      } catch (err) {
        return fail(err?.reason === 'NO_SESSION' ? 'session_gone' : err?.reason === 'NO_MAPPING' ? 'session_missing' : 'save_no_session');
      }
      let enc;
      try {
        enc = await encryptMapping(mappings.length === 1 ? mappings[0] : mergeMappings(mappings), pw1.value);
      } catch {
        return fail('save_failed');
      }
      downloadBlob(name, new Blob([JSON.stringify(enc, null, 2)], { type: 'application/json' }));
      clear();
      status.className = 'good';
      status.textContent = t('save_done', { name });
    } finally {
      run.disabled = false;
      run.textContent = t('save_run');
    }
  };
  run.addEventListener('click', save);
  pw2.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save();
  });
  return h(
    'section',
    { class: 'card', dataset: { testid: 'key-save' } },
    h('h2', {}, t('save_h')),
    h('p', { class: 'hint' }, t('save_hint', { name })),
    h('div', { class: 'field' }, pw1, pw2, meterEl),
    h('p', { class: 'err' }, t('save_warn')),
    h('div', { class: 'row' }, run),
    status,
  );
}

init();

// Перехват выбора файла (FR-01), drag&drop (FR-02) и вставки (FR-03). FR-05: подмена через DataTransfer.
// Обработчики вешаются на window в фазе capture — раньше обработчиков страницы (content script на document_start).
// С 0.5.2 (FR-04б) перехватывается любой файл: неподдерживаемый не уходит без выбора человека; без панели проходят только
// файлы, которые мы сами подставили, и расширения из списка «не спрашивать» (FR-04в).
import { fileSignature } from './files.js';

const isFileInput = (n) => !!n && n.tagName === 'INPUT' && /** @type {HTMLInputElement} */ (n).type === 'file';

/**
 * @param {{run: (files: File[], pass: boolean[]) => Promise<{action: string, files: File[]}>}} flow
 *   pass[i] — файл уходит без панели (наш результат или список «не спрашивать»)
 * @param {{win?: Window, isSkipped?: (file: File) => boolean}} [env]
 *   isSkipped — список «не спрашивать» (content.js: isSkipped по настройкам, читаются в момент события); по умолчанию — пусто
 */
export function createInterceptor(flow, env = {}) {
  const win = env.win || window;
  const skipped = env.isSkipped || (() => false);
  const doc = win.document;
  let bypass = false; // наши собственные события не перехватываем повторно (FR-05)
  const produced = new Set(); // сигнатуры файлов, которые мы сами подставили
  // исходные файлы, которые мы сами отдали сайту («как есть», «оригинал», файлы мимо панели): если сайт перешлёт те же объекты
  // в своё поле выбора, панель не откроется второй раз. Повторный выбор того же файла с диска даёт новые объекты — спросим снова
  const handed = new WeakSet();
  const held = new WeakSet(); // inputs, по которым идёт обработка
  const hooked = new WeakSet();
  const roots = [];
  let observer = null;
  let scanTimer = 0;
  const pendingNodes = new Set();
  let attached = false;

  /** Что уходит без панели; null — перехватывать нечего. */
  function plan(files) {
    const pass = files.map((f) => handed.has(f) || produced.has(fileSignature(f)) || skipped(f));
    return pass.every(Boolean) ? null : pass;
  }

  function withBypass(fn) {
    bypass = true;
    try {
      fn();
    } finally {
      bypass = false;
    }
  }

  function setInputFiles(input, files) {
    const dt = new win.DataTransfer();
    for (const f of files) dt.items.add(f);
    input.files = dt.files;
  }

  function fireInputEvents(input) {
    withBypass(() => {
      input.dispatchEvent(new win.Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new win.Event('change', { bubbles: true }));
    });
  }

  function remember(originals, res) {
    // по членству, а не по индексу: ключ восстановления выпадает из списка (0.5.1), индексы результата сдвигаются
    for (const f of res.files)
      if (originals.includes(f)) handed.add(f);
      else produced.add(fileSignature(f));
  }

  /* ---------- input[type=file] ---------- */
  function onInputEvent(e) {
    if (bypass) return;
    const input = e.composedPath?.()[0] ?? e.target;
    if (!isFileInput(input)) return;
    // input (composed) доходит до window раньше change (не composed). Если открытый Shadow DOM ещё не досканирован
    // (MutationObserver сканирует с задержкой 150 мс), подписываемся на его корень сейчас — иначе change с исходным
    // файлом уйдёт странице мимо перехвата (FR-01, NFR-01).
    const root = input.getRootNode?.();
    if (root && root !== doc && root.host) hookRoot(root);
    if (held.has(input)) {
      e.stopImmediatePropagation(); // input → change: второе событие той же выборки
      return;
    }
    const files = Array.from(input.files || []);
    const pass = plan(files);
    if (!pass) return;
    e.stopImmediatePropagation();
    held.add(input);
    // 0.5.2 (FR-01а): поле очищается сразу — сайт, читающий input.files напрямую, пока идёт обработка, видит пустое поле;
    // повторный выбор того же файла после «Отмены» снова вызовет change
    input.value = '';
    flow
      .run(files, pass)
      .then((res) => {
        if (res.action === 'cancel') return;
        remember(files, res);
        // результат подставляется явно при любом решении: обезличенные файлы, «как есть», «оригинал» (без ключа восстановления)
        setInputFiles(input, res.files);
        fireInputEvents(input);
      })
      .catch(() => {})
      .finally(() => held.delete(input));
  }

  /* ---------- drop ---------- */
  function onDrop(e) {
    if (bypass) return;
    const files = Array.from(e.dataTransfer?.files || []);
    const pass = plan(files);
    if (!pass) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const target = e.composedPath?.()[0] ?? e.target;
    const init = { clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY, bubbles: true, cancelable: true, composed: true };
    flow
      .run(files, pass)
      .then((res) => {
        if (res.action === 'cancel') return;
        remember(files, res);
        if (isFileInput(target)) {
          setInputFiles(target, res.files);
          fireInputEvents(target);
          return;
        }
        const dt = new win.DataTransfer();
        for (const f of res.files) dt.items.add(f);
        withBypass(() => target.dispatchEvent(new win.DragEvent('drop', { ...init, dataTransfer: dt })));
      })
      .catch(() => {});
  }

  /* ---------- paste ---------- */
  function onPaste(e) {
    if (bypass) return;
    const files = Array.from(e.clipboardData?.files || []);
    const pass = plan(files);
    if (!pass) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const target = e.composedPath?.()[0] ?? e.target;
    flow
      .run(files, pass)
      .then((res) => {
        if (res.action === 'cancel') return;
        remember(files, res);
        const dt = new win.DataTransfer();
        for (const f of res.files) dt.items.add(f);
        withBypass(() => target.dispatchEvent(new win.ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true })));
      })
      .catch(() => {});
  }

  /* ---------- открытые Shadow DOM: change не «composed», слушаем корни ---------- */
  function hookRoot(root) {
    if (hooked.has(root)) return;
    hooked.add(root);
    roots.push(root);
    root.addEventListener('change', onInputEvent, true);
    root.addEventListener('input', onInputEvent, true);
    observer?.observe(root, { childList: true, subtree: true });
    scan(root);
  }

  function scan(node) {
    if (node.nodeType === 1 && /** @type {Element} */ (node).shadowRoot) hookRoot(/** @type {Element} */ (node).shadowRoot);
    const list = node.querySelectorAll ? node.querySelectorAll('*') : [];
    for (const el of list) if (el.shadowRoot) hookRoot(el.shadowRoot);
  }

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = win.setTimeout(() => {
      scanTimer = 0;
      const nodes = [...pendingNodes];
      pendingNodes.clear();
      for (const n of nodes) if (n.isConnected) scan(n);
    }, 150);
  }

  function attach() {
    if (attached) return;
    attached = true;
    win.addEventListener('input', onInputEvent, true);
    win.addEventListener('change', onInputEvent, true);
    win.addEventListener('drop', onDrop, true);
    win.addEventListener('paste', onPaste, true);
    observer = new win.MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) pendingNodes.add(n);
      if (pendingNodes.size) scheduleScan();
    });
    const start = () => {
      if (!attached || !doc.documentElement) return;
      observer.observe(doc.documentElement, { childList: true, subtree: true });
      scan(doc.documentElement);
    };
    if (doc.documentElement) start();
    else doc.addEventListener('DOMContentLoaded', start, { once: true });
  }

  /** Снять все обработчики и наблюдатели (FR-07, FR-09). */
  function detach() {
    if (!attached) return;
    attached = false;
    win.removeEventListener('input', onInputEvent, true);
    win.removeEventListener('change', onInputEvent, true);
    win.removeEventListener('drop', onDrop, true);
    win.removeEventListener('paste', onPaste, true);
    for (const r of roots) {
      r.removeEventListener('change', onInputEvent, true);
      r.removeEventListener('input', onInputEvent, true);
    }
    roots.length = 0;
    observer?.disconnect();
    observer = null;
    win.clearTimeout(scanTimer);
    scanTimer = 0;
    pendingNodes.clear();
  }

  return {
    attach,
    detach,
    get attached() {
      return attached;
    },
  };
}

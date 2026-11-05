// Точка входа тестового бандла (ревью 0.5.1): сценарий перехвата content/flow.js и интерсептор на обычной странице с поддельным
// chrome — хост недоступен (каждый запрос → ERROR HOST_UNAVAILABLE) или контекст расширения инвалидирован. Собирается esbuild в тесте.
import { createFlow } from '../../../src/content/flow.js';
import { createInterceptor } from '../../../src/content/interceptor.js';
import { isSupported } from '../../../src/content/files.js';
import { defaultSettings } from '../../../src/core/settings.js';

/** Порт к «background»: на всё, кроме кусков файла, отвечает ошибкой HOST_UNAVAILABLE. */
function unavailablePort() {
  const listeners = [];
  return {
    onMessage: { addListener: (fn) => listeners.push(fn) },
    onDisconnect: { addListener: () => {} },
    disconnect() {},
    postMessage(m) {
      if (!m?.requestId || m.type === 'FILE_BEGIN' || m.type === 'FILE_CHUNK') return;
      setTimeout(() => {
        for (const fn of listeners) fn({ type: 'ERROR', requestId: m.requestId, code: 'HOST_UNAVAILABLE', message: 'нет хоста' });
      }, 20);
    },
  };
}

/** @param {'unavailable'|'invalidated'} mode */
window.__startFlow = (mode) => {
  const runtime = { id: mode === 'invalidated' ? undefined : 'fake-extension', connect: () => unavailablePort() };
  const chromeFake = { runtime, storage: { local: { get: async () => ({}), set: async () => {} } } };
  Object.defineProperty(window, 'chrome', { value: chromeFake, configurable: true, writable: true });
  // закрытый Shadow DOM панели — открытым, чтобы тест видел панель (как флаг __e2eOpenShadow в настоящем расширении)
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (o) {
    return attach.call(this, { ...o, mode: 'open' });
  };
  const settings = { ...defaultSettings(), interceptEnabled: true, uiLanguage: 'ru', hintMappingShown: true };
  const flow = createFlow({ getSettings: () => settings });
  createInterceptor(flow, { win: window, isSupported: (f) => isSupported(f, settings) }).attach();
};

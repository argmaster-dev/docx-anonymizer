// Сигнатура PDF (версия 0.3; с 0.5, WP12-A — отдельный модуль): хосту нужно распознать PDF, не загружая разбор
// (core/pdf/extract.js и layout.js грузятся воркером лениво, отдельным модулем, при первом PDF — бюджет worker.js, К14).

/**
 * Сигнатура PDF: «%PDF-» в первых 1024 байтах (так проверяют и читатели PDF — перед заголовком бывает мусор).
 * @param {Uint8Array} bytes
 */
export function isPdf(bytes) {
  if (!bytes || bytes.length < 5) return false;
  const n = Math.min(bytes.length - 4, 1024);
  for (let i = 0; i < n; i++) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) return true;
  }
  return false;
}

// Имя файла — тоже данные (ревью WP12-B, п. 16): «Иванов_ИНН.xlsx» → «Иванов_ИНН.anon.xlsx» ушло бы в чат с фамилией. Имя без
// расширения становится потоком документа (детекторы ищут в нём, как в тексте), правки по нему — новым именем результата с
// метками той же карты. В файл результата поток не пишется. Восстановление имени файла не делается. Чистый JS (NFR-14).

/** Часть-метка потока имени файла (не часть пакета: сериализаторы её не видят). */
export const FILE_NAME_PART = '#file-name';
const ID = 'fname';

/**
 * Добавляет поток имени файла (без расширения; «_» и «.» читаются как пробелы — позиции те же). Повторно — не добавляет.
 * @param {any} doc
 * @param {string} name
 */
export function addFileNameStream(doc, name) {
  if (!name || doc.streamById?.has(ID)) return;
  const base = String(name).replace(/\.[^./\\]+$/, '');
  if (!/\p{L}|\d{5}/u.test(base)) return;
  const s = {
    id: ID,
    part: FILE_NAME_PART,
    pid: null,
    type: 'attr',
    attrKind: 'file-name',
    xpath: 'file name',
    text: base.replace(/[_.]/g, ' '),
    pos: 0,
    order: doc.streams.length,
    base,
    ext: String(name).slice(base.length),
  };
  doc.streams.push(s);
  doc.streamById.set(ID, s);
}

/**
 * Правки имени файла → новое имя (с прежним расширением); правки остальных потоков — как есть.
 * @param {any} doc
 * @param {{streamId: string, start: number, end: number, newText: string}[]} edits
 * @returns {{edits: any[], fileName: string | undefined}}
 */
export function splitFileNameEdits(doc, edits) {
  const s = doc.streamById?.get(ID);
  if (!s) return { edits, fileName: undefined };
  const own = edits.filter((e) => e.streamId === ID).sort((a, b) => b.start - a.start);
  let base = s.base;
  for (const e of own) base = base.slice(0, e.start) + e.newText + base.slice(e.end);
  // в имени файла нельзя / \ : * ? " < > |
  base = base.replace(/[/\\:*?"<>|]/g, '_');
  return { edits: edits.filter((e) => e.streamId !== ID), fileName: own.length ? base + s.ext : undefined };
}

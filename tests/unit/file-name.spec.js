// Имя файла — тоже данные (ревью WP12-B; core/file-name.js, content/files.js): точки в имени остаются («Иванов И.И. договор»),
// «_» — пробел, слова-типы документа не становятся частью ФИО; нейтральное имя при сбое (fail-closed); имена в одной отправке
// не повторяются.
import { describe, it, expect, beforeAll } from 'vitest';
import { addFileNameStream, splitFileNameEdits } from '../../src/core/file-name.js';
import { parsePlain } from '../../src/core/plain/plain-adapter.js';
import { analyze, applyDecisions, defaultSettings, registerBuiltinDetectors, clearDetectors } from '../../src/core/index.js';
import { neutralName, uniqueResultName } from '../../src/content/files.js';

beforeAll(() => {
  clearDetectors();
  registerBuiltinDetectors();
});

async function nameOf(name) {
  const doc = parsePlain(new TextEncoder().encode('Текст без данных.\n'), 'x.txt');
  addFileNameStream(doc, name);
  const an = await analyze(doc, defaultSettings());
  return applyDecisions(doc, an.groups, {}).fileName;
}

describe('имя файла', () => {
  it.each([
    ['Иванов И.И. договор.docx', '[ФИО_1] договор.docx'],
    ['Договор_Иванов_И.И..docx', 'Договор_[ФИО_1].docx'],
    ['Лебедева А.В. заявка.docx', '[ФИО_1] заявка.docx'],
    ['Гаврилов_Евгений_Сергеевич.xlsx', '[ФИО_1].xlsx'],
    ['СНИЛС 112-233-445 95.pdf', 'СНИЛС [СНИЛС_1].pdf'],
  ])('%s → %s', async (name, want) => {
    expect(await nameOf(name)).toBe(want);
  });

  it('«Резюме Анна», «Договор Анна» — тип документа не делает имя ФИО; без данных — имени нет (как было)', async () => {
    expect(await nameOf('Резюме Анна.pdf')).toBeUndefined();
    expect(await nameOf('Договор Анна.docx')).toBeUndefined();
    expect(await nameOf('выгрузка.xlsx')).toBeUndefined();
  });

  it('правки имени не уходят в файл; запрещённые в имени символы заменяются', () => {
    const doc = { streams: [], streamById: new Map() };
    addFileNameStream(doc, 'a_b.txt');
    const r = splitFileNameEdits(doc, [
      { streamId: 'fname', start: 0, end: 1, newText: 'x/y' },
      { streamId: 'p0:live', start: 0, end: 1, newText: 'z' },
    ]);
    expect(r.fileName).toBe('x_y_b.txt');
    expect(r.edits).toEqual([{ streamId: 'p0:live', start: 0, end: 1, newText: 'z' }]);
  });

  it('fail-closed и уникальность в отправке', () => {
    expect(neutralName('Кравченко_Ольга.docx')).toBe('document.docx');
    expect(neutralName('без расширения')).toBe('document.docx');
    const used = new Set();
    expect(uniqueResultName('[ФИО_1].anon.docx', used)).toBe('[ФИО_1].anon.docx');
    expect(uniqueResultName('[ФИО_1].anon.docx', used)).toBe('[ФИО_1] (2).anon.docx');
    expect(uniqueResultName('[ФИО_1].x.docx', used, '.x')).toBe('[ФИО_1].x.docx');
  });
});

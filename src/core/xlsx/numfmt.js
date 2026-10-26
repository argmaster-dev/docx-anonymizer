// Числа в ячейках Excel → то, что видит пользователь (ревью WP12-B, п. 2 и 11; FR-18): ИНН и СНИЛС с ведущим нулём хранятся
// числом (27409876579) и показываются по формату ячейки («000000000000» → 027409876579, «000-000-000 00» → 012-345-679 20);
// инструменты пишут целые и как «7.728168971E9», «74951234567.0». Детекторы ищут по показанному тексту; без формата —
// ведущие нули по заголовку столбца («ИНН», «СНИЛС», «БИК», «КПП», «Паспорт»). Чистый JS, значения в логи не попадают.
import { tokenize, parseAttrs, unescapeXml } from '../ooxml/xml.js';

/**
 * Целое из записи числа ячейки: «7707083893», «7.728168971E9», «74951234567.0» → цифры; дробь, отрицательное, не число — null.
 * @param {string} raw
 * @returns {string | null}
 */
export function intDigits(raw) {
  const m = /^(\d+)(?:\.(\d*))?(?:[eE]\+?(\d+))?$/.exec(String(raw || '').trim());
  if (!m) return null;
  const digits = m[1] + (m[2] || '');
  const point = m[1].length + Number(m[3] || 0);
  if (digits.slice(point).replace(/0/g, '')) return null; // есть дробная часть
  const out = (point >= digits.length ? digits.padEnd(point, '0') : digits.slice(0, point)).replace(/^0+(?=\d)/, '');
  return out;
}

/** Встроенные форматы с цифрами без разделителей: 0 — «Общий», 1 — «0». */
const BUILTIN = { 0: 'General', 1: '0', 49: '@' };

/**
 * Стили книги: номер формата каждого cellXfs и коды своих форматов.
 * @param {string} xml  xl/styles.xml
 * @returns {{xf: number[], codes: Map<number, string>}}
 */
export function parseStyles(xml) {
  const xf = [];
  const codes = new Map();
  let inXfs = false;
  tokenize(xml || '', (t) => {
    if (t.type === 'open' && t.name === 'cellXfs') inXfs = true;
    else if (t.type === 'close' && t.name === 'cellXfs') inXfs = false;
    else if ((t.type === 'open' || t.type === 'selfclose') && (t.name === 'numFmt' || (inXfs && t.name === 'xf'))) {
      const a = Object.fromEntries(parseAttrs(xml, t.attrStart, t.attrEnd).map((x) => [x.name, x.raw]));
      if (t.name === 'numFmt') codes.set(Number(a.numFmtId), unescapeXml(a.formatCode || ''));
      else xf.push(Number(a.numFmtId || 0));
    }
  });
  return { xf, codes };
}

/**
 * Код формата ячейки по индексу стиля `s`.
 * @param {{xf: number[], codes: Map<number, string>}} styles
 * @param {string | undefined} s
 */
export function formatOf(styles, s) {
  const id = styles.xf[Number(s || 0)] ?? 0;
  return styles.codes.get(id) ?? BUILTIN[id] ?? null;
}

/**
 * Показанный текст целого по формату из цифр и литералов («000000000000», «000-000-000 00», «+0 (000) 000-00-00»):
 * «0» — цифра или ведущий ноль, «#»/«?» — цифра, если есть; лишние цифры — слева. Формат с дробью, процентом, датой,
 * условием или цветом — null (показ как есть).
 * @param {string} digits
 * @param {string | null} code
 * @returns {string | null}
 */
export function renderDigits(digits, code) {
  if (!code || code === 'General' || code === '@') return null;
  const first = code.split(';')[0];
  /** @type {{ph?: string, lit?: string}[]} */
  const tokens = [];
  for (let i = 0; i < first.length; i++) {
    const ch = first[i];
    if (ch === '"') {
      const j = first.indexOf('"', i + 1);
      if (j < 0) return null;
      tokens.push({ lit: first.slice(i + 1, j) });
      i = j;
    } else if (ch === '\\') tokens.push({ lit: first[++i] ?? '' });
    else if (ch === '0' || ch === '#' || ch === '?') tokens.push({ ph: ch });
    else if (/[-()+ /]/.test(ch)) tokens.push({ lit: ch });
    else return null; // «.», «,», «%», «E», «[», буквы даты…
  }
  const phs = tokens.filter((t) => t.ph);
  if (!phs.length) return null;
  let rest = digits;
  const out = [];
  for (let k = tokens.length - 1; k >= 0; k--) {
    const t = tokens[k];
    if (t.lit !== undefined) {
      out.unshift(t.lit);
      continue;
    }
    if (rest) {
      out.unshift(rest[rest.length - 1]);
      rest = rest.slice(0, -1);
    } else if (t.ph === '0') out.unshift('0');
    else if (t.ph === '?') out.unshift(' ');
    // самая левая цифровая позиция забирает оставшиеся цифры
    if (t === phs[0] && rest) {
      out.unshift(rest);
      rest = '';
    }
  }
  return out.join('').trim();
}

/**
 * Ведущие нули по заголовку столбца, если формат ячейки их не задаёт: ИНН — 10 или 12 цифр, СНИЛС — 11, БИК и КПП — 9,
 * паспорт — 10. Не похоже — как есть.
 * @param {string} digits
 * @param {string | undefined} header
 */
export function padByHeader(digits, header) {
  const h = String(header || '').toLowerCase();
  const want = /инн|\binn\b/.test(h)
    ? [10, 12]
    : /снилс|snils/.test(h)
      ? [11]
      : /бик|кпп|\bbik\b|\bkpp\b/.test(h)
        ? [9]
        : /паспорт|passport/.test(h)
          ? [10]
          : [];
  if (want.includes(digits.length)) return digits;
  for (const n of want) if (digits.length < n && digits.length >= n - 2) return digits.padStart(n, '0');
  return digits;
}

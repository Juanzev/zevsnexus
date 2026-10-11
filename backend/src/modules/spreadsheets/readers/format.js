// Valor de célula do XLSX como texto pt-BR, pelo formato da célula. Não pretende reproduzir o Excel
// inteiro: datas, horas, moeda, porcentagem e casas decimais — o que importa para conferir números.

/** IDs embutidos de formato de data/hora (ECMA-376 §18.8.30). */
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
const BUILTIN = {
  9: '0%',
  10: '0.00%',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  11: '0.00E+00',
  44: '"R$" #,##0.00',
};

/** Tira o que é texto literal ("...", \x) e seções de cor/condição ([Red], [<100]) do código. */
function strip(code) {
  return code
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[(?!h\]|m\]|s\])[^\]]*\]/gi, '');
}

export function resolveFormat(numFmtId, customFormats) {
  const id = Number(numFmtId ?? 0);
  const code = customFormats.get(id) ?? BUILTIN[id] ?? (BUILTIN_DATE.has(id) ? 'dd/mm/yyyy' : 'General');
  const plain = strip(code.split(';')[0]);
  const isDate = BUILTIN_DATE.has(id) || /[dy]/i.test(plain) || (/[hs]/i.test(plain) && !/[0#]/.test(plain));
  return {
    code,
    isDate,
    hasTime: /[hs]/i.test(plain) || [18, 19, 20, 21, 22, 45, 46, 47].includes(id),
    hasDate: /[dy]/i.test(plain) || [14, 15, 16, 17, 22, 27, 30, 36, 50, 57].includes(id),
    percent: plain.includes('%'),
    currency: /R\$/.test(code),
    decimals: (/\.([0#]+)/.exec(plain)?.[1].length) ?? null,
    grouping: /#,##|0,0/.test(plain),
  };
}

const pad = (value) => String(value).padStart(2, '0');

/** Número serial do Excel → "dd/mm/aaaa" e/ou "hh:mm". */
export function formatSerialDate(serial, { date1904 = false, hasDate = true, hasTime = false } = {}) {
  if (!Number.isFinite(serial)) return String(serial);
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const millis = Math.round((serial * 86_400_000) / 1000) * 1000;
  const date = new Date(base + millis);
  const datePart = `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
  const timePart = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  if (hasDate && hasTime) return `${datePart} ${timePart}`;
  return hasDate ? datePart : timePart;
}

/** Número em pt-BR sem ruído de ponto flutuante (0.1 + 0.2 aparece como 0,3). */
function plainNumber(value) {
  const clean = Number(value.toPrecision(15));
  return clean.toLocaleString('pt-BR', { maximumFractionDigits: 10, useGrouping: false });
}

export function formatNumber(value, format) {
  if (format.isDate) return formatSerialDate(value, format);
  if (format.percent) {
    const decimals = format.decimals ?? 0;
    return `${(value * 100).toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`;
  }
  if (format.decimals !== null || format.grouping) {
    const decimals = format.decimals ?? 0;
    const text = Math.abs(value).toLocaleString('pt-BR', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: format.grouping,
    });
    return `${value < 0 ? '-' : ''}${format.currency ? 'R$ ' : ''}${text}`;
  }
  return plainNumber(value);
}

// Dinheiro na tela (pág. 07): a API trabalha só com centavos inteiros; aqui só formatação e leitura.
// Nada de float no caminho: o texto digitado vira centavos por manipulação de string.

const formatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** 123456 → "R$ 1.234,56". */
export function formatCents(cents) {
  const value = Number(cents);
  if (!Number.isSafeInteger(value)) return '';
  return formatter.format(value / 100);
}

/** Valor para o campo de edição: 123456 → "1.234,56". */
export function centsToInput(cents) {
  // \s também casa o espaço inseparável que o Intl põe depois de "R$".
  return formatCents(cents).replace(/^-?R\$\s?/, '').replace(/\s/g, '');
}

/**
 * Texto digitado (pt-BR) → centavos, ou null se não for um valor válido.
 * Aceita "1.234,56", "1234,56", "1234", "R$ 10,5", e "1234.56" (ponto decimal, se for o único separador
 * com 1 ou 2 casas). Até 2 casas decimais.
 */
export function parseMoney(text) {
  let value = String(text ?? '')
    .replace(/R\$/gi, '')
    .replace(/\s/g, '');
  if (!value) return null;
  if (!value.includes(',') && /^\d+\.\d{1,2}$/.test(value)) value = value.replace('.', ',');
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(value)) return null;
  const [integer, decimals = ''] = value.replace(/\./g, '').split(',');
  const cents = Number(integer) * 100 + Number(decimals.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

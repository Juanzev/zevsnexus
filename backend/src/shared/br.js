// Documentos e formatos brasileiros (pág. 07): validados por dígito verificador e guardados
// normalizados. CNPJ aceita o formato alfanumérico (Receita Federal, a partir de jul/2026).

export const UFS = Object.freeze([
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
  'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
]);

/** Remove máscara (pontos, barra, hífen, espaços) e põe em maiúsculas. */
export function normalizeCnpj(value) {
  return String(value ?? '').replace(/[.\-/\s]/g, '').toUpperCase();
}

// Valor de cada caractere no cálculo: código ASCII − 48 ('0'→0 … '9'→9, 'A'→17 … 'Z'→42).
function cnpjCheckDigit(base, weights) {
  const sum = [...base].reduce((total, char, index) => total + (char.charCodeAt(0) - 48) * weights[index], 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidCnpj(value) {
  const cnpj = normalizeCnpj(value);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj)) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const first = cnpjCheckDigit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = cnpjCheckDigit(cnpj.slice(0, 12) + first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return cnpj.endsWith(`${first}${second}`);
}

/** CPF sem máscara (só dígitos). */
export function normalizeCpf(value) {
  return String(value ?? '').replace(/[.\-\s]/g, '');
}

export function isValidCpf(value) {
  const cpf = normalizeCpf(value);
  if (!/^[0-9]{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (length) => {
    const sum = [...cpf.slice(0, length)].reduce((total, char, index) => total + Number(char) * (length + 1 - index), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

/** Telefone brasileiro com DDD: só dígitos, 10 (fixo) ou 11 (celular). */
export function normalizePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length === 12 || digits.length === 13 ? digits.replace(/^55/, '') : digits;
}

export function isValidPhone(digits) {
  return /^[1-9]{2}[0-9]{8,9}$/.test(digits);
}

export function normalizeCep(value) {
  return String(value ?? '').replace(/\D/g, '');
}

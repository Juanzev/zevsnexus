// Formatação para exibição (pt-BR). O backend guarda tudo normalizado.

export function formatCnpj(value) {
  const cnpj = String(value ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  if (cnpj.length !== 14) return value ?? '';
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}

export function formatPhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return value ?? '';
}

export function formatCep(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : (value ?? '');
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

export function formatDate(value) {
  if (!value) return '';
  return dateFormatter.format(new Date(value));
}

/** Aplica a formatação ao sair do campo (evita o cursor pular enquanto a pessoa digita). */
export function formatOnBlur(input, formatter) {
  input.addEventListener('blur', () => {
    if (input.value.trim()) input.value = formatter(input.value);
  });
}

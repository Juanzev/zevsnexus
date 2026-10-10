// Regras de texto compartilhadas com o backend (a validação que vale é a do servidor).

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

export function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

export function passwordProblem(password) {
  if (password.length < PASSWORD_MIN_LENGTH) return `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  if (byteLength(password) > PASSWORD_MAX_BYTES) {
    return `A senha pode ter no máximo ${PASSWORD_MAX_BYTES} bytes (cerca de ${PASSWORD_MAX_BYTES} caracteres sem acento).`;
  }
  return null;
}

export function firstName(name) {
  return String(name ?? '').trim().split(/\s+/)[0] ?? '';
}

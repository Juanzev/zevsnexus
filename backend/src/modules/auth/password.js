// Senhas (pág. 04): bcryptjs (custo 12 em produção), mínimo 8 caracteres e máximo 72 bytes.
// Acima de 72 bytes a senha é recusada, nunca truncada em silêncio.
import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

export function exceedsMaxBytes(password) {
  return Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES;
}

export function hashPassword(password) {
  return bcrypt.hash(password, env.BCRYPT_ROUNDS);
}

let dummyHashPromise;

/** Hash fixo para comparar quando o usuário não existe: o tempo de resposta fica igual. */
function dummyHash() {
  dummyHashPromise ??= bcrypt.hash('zevs-nexus-senha-ficticia', env.BCRYPT_ROUNDS);
  return dummyHashPromise;
}

/**
 * Compara a senha com o hash. Sem hash (usuário inexistente) ou com senha acima de 72 bytes,
 * compara contra o hash fictício e devolve false — sempre gastando o mesmo tempo de bcrypt.
 */
export async function verifyPassword(password, passwordHash) {
  if (!passwordHash || exceedsMaxBytes(password)) {
    await bcrypt.compare(password.slice(0, PASSWORD_MAX_BYTES), await dummyHash());
    return false;
  }
  return bcrypt.compare(password, passwordHash);
}

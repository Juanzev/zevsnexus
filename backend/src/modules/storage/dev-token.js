// "URL assinada" dos providers local e memory (ARCHITECTURE §10.3): token HMAC no caminho de
// /dev-storage/*, com operação, chave, validade e as condições do envio (tipo e tamanho exatos).
// A chave HMAC é derivada do JWT_SECRET com rótulo próprio: um token de storage nunca vale como JWT.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';

const SECRET = createHmac('sha256', env.JWT_SECRET).update('zevs-nexus:dev-storage:v1').digest();
const TOKEN = /^[A-Za-z0-9_-]{16,4096}\.[A-Za-z0-9_-]{43}$/;

function sign(body) {
  return createHmac('sha256', SECRET).update(body).digest('base64url');
}

export function signDevToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

/** Payload do token se a assinatura, a operação e a validade conferirem; senão null. */
export function verifyDevToken(token, op, now = Date.now()) {
  if (typeof token !== 'string' || !TOKEN.test(token)) return null;
  const [body, signature] = token.split('.');
  const expected = Buffer.from(sign(body));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (payload?.op !== op || typeof payload.exp !== 'number' || payload.exp * 1000 <= now) return null;
  return payload;
}

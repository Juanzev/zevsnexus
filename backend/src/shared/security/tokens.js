// Tokens de sessão (pág. 04):
// - access token: JWT HS256, curto, só { sub, aud, jti } — sem papel e sem tenant;
// - tokens opacos (refresh, reset, verificação): aleatórios, guardados só como hash SHA-256.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

const ISSUER = 'zevs-nexus';
const AUDIENCE = 'app';
const ALGORITHM = 'HS256';

export function generateOpaqueToken(bytes = 48) {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function signAccessToken(userId) {
  return jwt.sign({}, env.JWT_SECRET, {
    algorithm: ALGORITHM,
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: ISSUER,
    audience: AUDIENCE,
    subject: userId,
    jwtid: randomUUID(),
  });
}

/**
 * Valida assinatura, algoritmo fixo (token "none" é recusado), emissor, audiência e expiração.
 * Lança o erro do jsonwebtoken (TokenExpiredError / JsonWebTokenError).
 */
export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_SECRET, {
    algorithms: [ALGORITHM],
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

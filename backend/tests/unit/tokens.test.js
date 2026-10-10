import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  generateOpaqueToken,
  hashToken,
  signAccessToken,
  verifyAccessToken,
} from '../../src/shared/security/tokens.js';

const SECRET = process.env.JWT_SECRET;

describe('tokens opacos', () => {
  test('são aleatórios e em base64url', () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{64}$/);
  });

  test('hash SHA-256 em hex, determinístico', () => {
    expect(hashToken('abc')).toHaveLength(64);
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });
});

describe('access token', () => {
  test('carrega só sub, aud, iss, jti, iat e exp — sem papel nem tenant', () => {
    const userId = randomUUID();
    const payload = verifyAccessToken(signAccessToken(userId));
    expect(payload.sub).toBe(userId);
    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'jti', 'sub']);
    expect(payload.exp - payload.iat).toBe(900);
  });

  test('recusa algoritmo "none"', () => {
    const forged = jwt.sign({}, null, { algorithm: 'none', subject: randomUUID(), audience: 'app', issuer: 'zevs-nexus' });
    expect(() => verifyAccessToken(forged)).toThrow();
  });

  test('recusa audiência ou emissor errados', () => {
    const wrongAud = jwt.sign({}, SECRET, { algorithm: 'HS256', subject: randomUUID(), audience: 'customer', issuer: 'zevs-nexus' });
    const wrongIss = jwt.sign({}, SECRET, { algorithm: 'HS256', subject: randomUUID(), audience: 'app', issuer: 'outro' });
    expect(() => verifyAccessToken(wrongAud)).toThrow();
    expect(() => verifyAccessToken(wrongIss)).toThrow();
  });

  test('recusa outro segredo e outro algoritmo HMAC', () => {
    const otherSecret = jwt.sign({}, 'y'.repeat(40), { algorithm: 'HS256', subject: randomUUID(), audience: 'app', issuer: 'zevs-nexus' });
    const hs512 = jwt.sign({}, SECRET, { algorithm: 'HS512', subject: randomUUID(), audience: 'app', issuer: 'zevs-nexus' });
    expect(() => verifyAccessToken(otherSecret)).toThrow();
    expect(() => verifyAccessToken(hs512)).toThrow();
  });
});

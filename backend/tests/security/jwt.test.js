import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../../src/shared/db.js';
import { api, makeApp } from '../helpers/http.js';
import { createUser, loginAs } from '../helpers/users.js';

const app = makeApp({ serveFrontend: false });
const SECRET = process.env.JWT_SECRET;

function me(token) {
  return api(app).get('/api/v1/me').set('Authorization', `Bearer ${token}`);
}

function forge(userId, { secret = SECRET, ...options } = {}) {
  return jwt.sign({}, secret, {
    algorithm: 'HS256',
    subject: userId,
    audience: 'app',
    issuer: 'zevs-nexus',
    expiresIn: '15m',
    ...options,
  });
}

describe('ataques ao access token', () => {
  let user;
  beforeAll(async () => {
    user = await createUser();
  });

  test('token válido funciona (controle)', async () => {
    expect((await me(forge(user.id))).status).toBe(200);
  });

  test('alg "none" → 401', async () => {
    const token = jwt.sign({}, null, { algorithm: 'none', subject: user.id, audience: 'app', issuer: 'zevs-nexus' });
    expect((await me(token)).status).toBe(401);
  });

  test('assinatura adulterada → 401', async () => {
    const token = forge(user.id);
    const [header, , signature] = token.split('.');
    const otherPayload = Buffer.from(JSON.stringify({ sub: randomUUID(), aud: 'app', iss: 'zevs-nexus', exp: 9_999_999_999 })).toString('base64url');
    expect((await me(`${header}.${otherPayload}.${signature}`)).status).toBe(401);
  });

  test('outro segredo → 401', async () => {
    expect((await me(forge(user.id, { secret: 'z'.repeat(48) }))).status).toBe(401);
  });

  test('audiência errada (ex.: portal do cliente) → 401', async () => {
    expect((await me(forge(user.id, { audience: 'customer' }))).status).toBe(401);
  });

  test('expirado → 401 TOKEN_EXPIRED (o front renova a sessão)', async () => {
    const res = await me(forge(user.id, { expiresIn: -10 }));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  test('sub que não é UUID ou usuário inexistente → 401', async () => {
    expect((await me(forge('1 OR 1=1'))).status).toBe(401);
    expect((await me(forge(randomUUID()))).status).toBe(401);
  });

  test('usuário excluído (soft delete) → 401', async () => {
    const removed = await createUser();
    const { accessToken } = await loginAs(api(app), removed);
    await pool.query('UPDATE users SET deleted_at = now() WHERE id = $1', [removed.id]);
    expect((await me(accessToken)).status).toBe(401);
  });

  test('esquema diferente de Bearer → 401', async () => {
    const res = await api(app).get('/api/v1/me').set('Authorization', `Basic ${Buffer.from('a:b').toString('base64')}`);
    expect(res.status).toBe(401);
  });
});

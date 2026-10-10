import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../../src/shared/db.js';
import { CSRF_HEADERS, refreshCookieFrom } from './http.js';

export const DEFAULT_PASSWORD = 'senha-forte-123';

export function uniqueEmail(prefix = 'pessoa') {
  return `${prefix}-${randomUUID().slice(0, 8)}@teste.zevs.local`;
}

/** Cria um usuário direto no banco (fora da API), já verificado por padrão. */
export async function createUser({
  email = uniqueEmail(),
  name = 'Pessoa Teste',
  password = DEFAULT_PASSWORD,
  verified = true,
  status = 'active',
} = {}) {
  const passwordHash = await bcrypt.hash(password, 4);
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, password_hash, status, email_verified_at, terms_accepted_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN now() END, now())
     RETURNING id, email, name`,
    [email, name, passwordHash, status, verified],
  );
  return { ...rows[0], password };
}

/** Faz login pela API e devolve o access token e o cookie de refresh. */
export async function loginAs(client, user) {
  const res = await client.post('/api/v1/auth/login').send({ email: user.email, password: user.password });
  if (res.status !== 200) throw new Error(`login falhou: ${res.status} ${JSON.stringify(res.body)}`);
  return { accessToken: res.body.data.access_token, cookie: refreshCookieFrom(res), res };
}

export function refreshWith(client, cookie) {
  const req = client.post('/api/v1/auth/refresh').set(CSRF_HEADERS);
  return cookie ? req.set('Cookie', cookie) : req;
}

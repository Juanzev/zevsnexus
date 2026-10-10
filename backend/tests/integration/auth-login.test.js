import { pool } from '../../src/shared/db.js';
import { api, makeApp, refreshSetCookieHeader } from '../helpers/http.js';
import { createUser, loginAs } from '../helpers/users.js';

const app = makeApp({ serveFrontend: false });

describe('POST /api/v1/auth/login', () => {
  test('emite access token e grava o refresh em cookie HttpOnly, SameSite=Strict, restrito a /api/v1/auth', async () => {
    const user = await createUser({ name: 'Bruno Lima' });
    const res = await api(app).post('/api/v1/auth/login').send({ email: user.email, password: user.password });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      token_type: 'Bearer',
      expires_in: 900,
      user: { id: user.id, name: 'Bruno Lima', email: user.email, email_verified: true },
    });
    expect(res.body.data.access_token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(JSON.stringify(res.body)).not.toMatch(/password|refresh/i);

    const cookie = refreshSetCookieHeader(res);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookie).toMatch(/Expires=/);

    const { rows } = await pool.query('SELECT last_login_at FROM users WHERE id = $1', [user.id]);
    expect(rows[0].last_login_at).toBeInstanceOf(Date);
  });

  test('guarda só o hash do refresh token no banco', async () => {
    const user = await createUser();
    const { cookie } = await loginAs(api(app), user);
    const raw = decodeURIComponent(cookie.split('=')[1]);
    const { rows } = await pool.query('SELECT token_hash FROM refresh_tokens WHERE user_id = $1', [user.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toHaveLength(64);
    expect(rows[0].token_hash).not.toBe(raw);
  });

  test('aceita e-mail com maiúsculas e espaços', async () => {
    const user = await createUser();
    const res = await api(app).post('/api/v1/auth/login').send({ email: ` ${user.email.toUpperCase()} `, password: user.password });
    expect(res.status).toBe(200);
  });

  test('conta ainda não verificada pode entrar (a verificação é exigida para ativar a empresa)', async () => {
    const user = await createUser({ verified: false });
    const res = await api(app).post('/api/v1/auth/login').send({ email: user.email, password: user.password });
    expect(res.status).toBe(200);
    expect(res.body.data.user.email_verified).toBe(false);
  });

  test('conta desativada: 403 só depois de a senha conferir', async () => {
    const user = await createUser({ status: 'disabled' });
    const right = await api(app).post('/api/v1/auth/login').send({ email: user.email, password: user.password });
    expect(right.status).toBe(403);
    expect(right.body.error.code).toBe('ACCOUNT_DISABLED');

    const wrong = await api(app).post('/api/v1/auth/login').send({ email: user.email, password: 'senha-errada-999' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('GET /api/v1/me', () => {
  test('devolve o usuário da sessão', async () => {
    const user = await createUser({ name: 'Carla Dias' });
    const { accessToken } = await loginAs(api(app), user);
    const res = await api(app).get('/api/v1/me').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user).toEqual({
      id: user.id,
      name: 'Carla Dias',
      email: user.email,
      email_verified: true,
      created_at: expect.any(String),
    });
  });

  test('sem token → 401 AUTH_REQUIRED', async () => {
    const res = await api(app).get('/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  test('conta desativada depois do login perde o acesso na próxima requisição', async () => {
    const user = await createUser();
    const { accessToken } = await loginAs(api(app), user);
    await pool.query("UPDATE users SET status = 'disabled' WHERE id = $1", [user.id]);
    const res = await api(app).get('/api/v1/me').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(401);
  });
});

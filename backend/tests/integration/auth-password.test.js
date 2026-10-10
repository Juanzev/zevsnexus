import { pool } from '../../src/shared/db.js';
import { emailsTo, flushEmails, tokenFromEmail, waitForEmail } from '../helpers/email.js';
import { api, makeApp, refreshCookieFrom } from '../helpers/http.js';
import { createUser, loginAs, refreshWith } from '../helpers/users.js';

const app = makeApp({ serveFrontend: false });
const client = () => api(app);

async function requestReset(email) {
  return client().post('/api/v1/auth/password/forgot').send({ email });
}

async function resetToken(email) {
  await requestReset(email);
  const message = await waitForEmail(email, 'auth.password_reset');
  return tokenFromEmail(message);
}

describe('recuperação de senha', () => {
  test('pedido sempre responde igual; e-mail só para conta existente', async () => {
    const user = await createUser();
    const existing = await requestReset(user.email);
    const missing = await requestReset('ninguem-aqui@teste.zevs.local');
    expect(existing.status).toBe(202);
    expect(missing.status).toBe(202);
    expect(missing.body).toEqual(existing.body);

    const message = await waitForEmail(user.email, 'auth.password_reset');
    expect(message.text).toContain('http://localhost:3000/redefinir-senha?token=');
    await flushEmails();
    expect(emailsTo('ninguem-aqui@teste.zevs.local')).toHaveLength(0);
  });

  test('redefinir troca a senha, derruba todas as sessões e marca o e-mail como verificado', async () => {
    const user = await createUser({ verified: false });
    const session = await loginAs(client(), user);
    const token = await resetToken(user.email);

    const res = await client().post('/api/v1/auth/password/reset').send({ token, password: 'nova-senha-456' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: 'password_reset' } });

    expect((await refreshWith(client(), session.cookie)).status).toBe(401);
    expect((await client().post('/api/v1/auth/login').send({ email: user.email, password: user.password })).status).toBe(401);
    expect((await client().post('/api/v1/auth/login').send({ email: user.email, password: 'nova-senha-456' })).status).toBe(200);

    const { rows } = await pool.query('SELECT email_verified_at FROM users WHERE id = $1', [user.id]);
    expect(rows[0].email_verified_at).toBeInstanceOf(Date);
    await waitForEmail(user.email, 'auth.password_changed');
  });

  test('o link é de uso único', async () => {
    const user = await createUser();
    const token = await resetToken(user.email);
    expect((await client().post('/api/v1/auth/password/reset').send({ token, password: 'nova-senha-456' })).status).toBe(200);
    const second = await client().post('/api/v1/auth/password/reset').send({ token, password: 'outra-senha-789' });
    expect(second.status).toBe(422);
    expect(second.body.error.code).toBe('RESET_TOKEN_INVALID');
  });

  test('só o link mais recente vale', async () => {
    const user = await createUser();
    const first = await resetToken(user.email);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await resetToken(user.email);
    expect(second).not.toBe(first);

    expect((await client().post('/api/v1/auth/password/reset').send({ token: first, password: 'nova-senha-456' })).status).toBe(422);
    expect((await client().post('/api/v1/auth/password/reset').send({ token: second, password: 'nova-senha-456' })).status).toBe(200);
  });

  test('link expirado → 422', async () => {
    const user = await createUser();
    const token = await resetToken(user.email);
    await pool.query("UPDATE password_reset_tokens SET expires_at = now() - interval '1 second' WHERE user_id = $1", [user.id]);
    const res = await client().post('/api/v1/auth/password/reset').send({ token, password: 'nova-senha-456' });
    expect(res.status).toBe(422);
  });

  test('nova senha passa pela mesma política', async () => {
    const user = await createUser();
    const token = await resetToken(user.email);
    const res = await client().post('/api/v1/auth/password/reset').send({ token, password: 'curta' });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].field).toBe('password');
  });

  test('conta desativada não recebe e-mail de redefinição', async () => {
    const user = await createUser({ status: 'disabled' });
    expect((await requestReset(user.email)).status).toBe(202);
    await flushEmails();
    expect(emailsTo(user.email, 'auth.password_reset')).toHaveLength(0);
  });
});

describe('troca de senha logado', () => {
  test('exige a senha atual', async () => {
    const user = await createUser();
    const { accessToken } = await loginAs(client(), user);
    const res = await client()
      .post('/api/v1/auth/password/change')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ current_password: 'nao-e-esta', new_password: 'nova-senha-456' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CURRENT_PASSWORD_INVALID');
  });

  test('mantém a sessão atual, derruba as outras e devolve um access token novo', async () => {
    const user = await createUser();
    const other = await loginAs(client(), user);
    const current = await loginAs(client(), user);
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const res = await client()
      .post('/api/v1/auth/password/change')
      .set('Authorization', `Bearer ${current.accessToken}`)
      .set('Cookie', current.cookie)
      .send({ current_password: user.password, new_password: 'nova-senha-456' });
    expect(res.status).toBe(200);
    const newAccess = res.body.data.access_token;

    // Access tokens antigos caem; o novo vale.
    expect((await client().get('/api/v1/me').set('Authorization', `Bearer ${current.accessToken}`)).status).toBe(401);
    expect((await client().get('/api/v1/me').set('Authorization', `Bearer ${newAccess}`)).status).toBe(200);

    // A outra sessão não renova; a atual sim.
    expect((await refreshWith(client(), other.cookie)).status).toBe(401);
    const renewed = await refreshWith(client(), current.cookie);
    expect(renewed.status).toBe(200);
    expect(refreshCookieFrom(renewed)).toBeTruthy();

    await waitForEmail(user.email, 'auth.password_changed');
  });
});

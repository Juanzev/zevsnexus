import { pool } from '../../src/shared/db.js';
import { emailsTo, flushEmails, tokenFromEmail, waitForEmail } from '../helpers/email.js';
import { api, makeApp } from '../helpers/http.js';
import { createUser, loginAs, uniqueEmail } from '../helpers/users.js';

const app = makeApp({ serveFrontend: false });
const client = () => api(app);

async function registerAndGetToken() {
  const email = uniqueEmail('verificacao');
  await client().post('/api/v1/auth/register').send({ name: 'Davi Rocha', email, password: 'senha-forte-123', accept_terms: true });
  const message = await waitForEmail(email, 'auth.verify_email');
  return { email, token: tokenFromEmail(message) };
}

function verify(token) {
  return client().post('/api/v1/auth/email/verify').send({ token });
}

describe('verificação de e-mail', () => {
  test('o link do cadastro confirma o e-mail', async () => {
    const { email, token } = await registerAndGetToken();
    const res = await verify(token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: 'email_verified' } });

    const { rows } = await pool.query('SELECT email_verified_at FROM users WHERE email = $1', [email]);
    expect(rows[0].email_verified_at).toBeInstanceOf(Date);
  });

  test('o link é de uso único', async () => {
    const { token } = await registerAndGetToken();
    expect((await verify(token)).status).toBe(200);
    const again = await verify(token);
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('VERIFICATION_TOKEN_INVALID');
  });

  test('link expirado ou adulterado → 422', async () => {
    const { email, token } = await registerAndGetToken();
    await pool.query(
      "UPDATE email_verification_tokens SET expires_at = now() - interval '1 second' WHERE email = $1",
      [email],
    );
    expect((await verify(token)).status).toBe(422);
    expect((await verify(`${token.slice(0, -2)}xx`)).status).toBe(422);
    expect((await verify('curto')).status).toBe(422);
  });

  test('se a conta mudou de e-mail, o link antigo não vale', async () => {
    const { email, token } = await registerAndGetToken();
    await pool.query('UPDATE users SET email = $2 WHERE email = $1', [email, uniqueEmail('trocado')]);
    expect((await verify(token)).status).toBe(422);
  });

  test('reenviar invalida o link anterior', async () => {
    const user = await createUser({ verified: false });
    const { accessToken } = await loginAs(client(), user);

    const first = await client().post('/api/v1/auth/email/resend').set('Authorization', `Bearer ${accessToken}`);
    expect(first.status).toBe(202);
    expect(first.body).toEqual({ data: { status: 'check_email' } });
    const firstToken = tokenFromEmail(await waitForEmail(user.email, 'auth.verify_email'));

    await client().post('/api/v1/auth/email/resend').set('Authorization', `Bearer ${accessToken}`);
    await flushEmails();
    const secondToken = tokenFromEmail(emailsTo(user.email, 'auth.verify_email').at(-1));
    expect(secondToken).not.toBe(firstToken);

    expect((await verify(firstToken)).status).toBe(422);
    expect((await verify(secondToken)).status).toBe(200);
  });

  test('reenviar para conta já verificada não envia nada', async () => {
    const user = await createUser({ verified: true });
    const { accessToken } = await loginAs(client(), user);
    const res = await client().post('/api/v1/auth/email/resend').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ data: { status: 'already_verified' } });
  });
});

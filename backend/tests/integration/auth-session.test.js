import { pool } from '../../src/shared/db.js';
import { hashToken } from '../../src/shared/security/tokens.js';
import { waitForEmail } from '../helpers/email.js';
import { api, CSRF_HEADERS, makeApp, rawRefreshToken, refreshCookieFrom } from '../helpers/http.js';
import { createUser, loginAs, refreshWith } from '../helpers/users.js';

const app = makeApp({ serveFrontend: false });
const client = () => api(app);

async function tokenRow(cookie) {
  const { rows } = await pool.query(
    'SELECT id, family_id, replaced_by_id, revoked_at, revoked_reason, expires_at, family_expires_at FROM refresh_tokens WHERE token_hash = $1',
    [hashToken(rawRefreshToken(cookie))],
  );
  return rows[0];
}

describe('POST /api/v1/auth/refresh', () => {
  test('rotaciona: novo access token, novo cookie, mesma família e mesmo teto', async () => {
    const user = await createUser();
    const { cookie } = await loginAs(client(), user);

    const res = await refreshWith(client(), cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.access_token).toBeTruthy();
    expect(res.body.data.user.id).toBe(user.id);

    const nextCookie = refreshCookieFrom(res);
    expect(nextCookie).toBeTruthy();
    expect(nextCookie).not.toBe(cookie);

    const before = await tokenRow(cookie);
    const after = await tokenRow(nextCookie);
    expect(before.replaced_by_id).toBe(after.id);
    expect(after.family_id).toBe(before.family_id);
    expect(after.family_expires_at.getTime()).toBe(before.family_expires_at.getTime());
  });

  test('o refresh nunca passa do teto de 30 dias da família', async () => {
    const user = await createUser();
    const { cookie } = await loginAs(client(), user);
    const first = await tokenRow(cookie);
    const days = (first.family_expires_at - first.expires_at) / 86_400_000;
    expect(Math.round(days)).toBe(23);

    // Família a 1 dia do teto: a rotação não pode dar os 7 dias cheios.
    await pool.query(
      "UPDATE refresh_tokens SET expires_at = now() + interval '12 hours', family_expires_at = now() + interval '1 day' WHERE id = $1",
      [first.id],
    );
    const res = await refreshWith(client(), cookie);
    const next = await tokenRow(refreshCookieFrom(res));
    expect(next.expires_at.getTime()).toBe(next.family_expires_at.getTime());
  });

  test('o banco recusa refresh com validade além do teto da família', async () => {
    const user = await createUser();
    const { cookie } = await loginAs(client(), user);
    const row = await tokenRow(cookie);
    await expect(
      pool.query("UPDATE refresh_tokens SET expires_at = family_expires_at + interval '1 second' WHERE id = $1", [row.id]),
    ).rejects.toThrow(/check constraint/);
  });

  test('sem cookie → 401', async () => {
    const res = await refreshWith(client(), null);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_INVALID');
  });

  test('token desconhecido → 401 e cookie apagado', async () => {
    const res = await refreshWith(client(), 'zn_rt=inexistente');
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie'].join(';')).toMatch(/zn_rt=;/);
  });

  test('refresh expirado → 401', async () => {
    const user = await createUser();
    const { cookie } = await loginAs(client(), user);
    const row = await tokenRow(cookie);
    await pool.query("UPDATE refresh_tokens SET expires_at = now() - interval '1 minute' WHERE id = $1", [row.id]);
    const res = await refreshWith(client(), cookie);
    expect(res.status).toBe(401);
  });

  test('reuso dentro de 15 s (corrida entre abas): devolve só access token, sem rotacionar de novo', async () => {
    const user = await createUser();
    const { cookie } = await loginAs(client(), user);
    await refreshWith(client(), cookie);

    const again = await refreshWith(client(), cookie);
    expect(again.status).toBe(200);
    expect(again.body.data.access_token).toBeTruthy();
    expect(refreshCookieFrom(again)).toBeNull();
    const row = await tokenRow(cookie);
    expect(row.revoked_at).toBeNull();
  });

  test('reuso depois de 15 s: revoga a família inteira e avisa o usuário por e-mail', async () => {
    const user = await createUser();
    const { cookie } = await loginAs(client(), user);
    const rotated = await refreshWith(client(), cookie);
    const currentCookie = refreshCookieFrom(rotated);

    const old = await tokenRow(cookie);
    await pool.query("UPDATE refresh_tokens SET rotated_at = now() - interval '1 minute' WHERE id = $1", [old.id]);

    const reuse = await refreshWith(client(), cookie);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('REFRESH_REUSED');

    const { rows } = await pool.query('SELECT revoked_reason FROM refresh_tokens WHERE family_id = $1', [old.family_id]);
    expect(rows.every((row) => row.revoked_reason === 'reuse')).toBe(true);

    // Até o token legítimo mais novo da família deixa de valer.
    const legit = await refreshWith(client(), currentCookie);
    expect(legit.status).toBe(401);

    await waitForEmail(user.email, 'auth.session_reuse_alert');
  });

  test('conta desativada não renova a sessão', async () => {
    const user = await createUser();
    const { cookie } = await loginAs(client(), user);
    await pool.query("UPDATE users SET status = 'disabled' WHERE id = $1", [user.id]);
    const res = await refreshWith(client(), cookie);
    expect(res.status).toBe(401);
  });
});

describe('logout', () => {
  test('POST /logout revoga a família e apaga o cookie', async () => {
    const user = await createUser();
    const { cookie } = await loginAs(client(), user);
    const res = await client().post('/api/v1/auth/logout').set(CSRF_HEADERS).set('Cookie', cookie);
    expect(res.status).toBe(204);
    expect(res.headers['set-cookie'].join(';')).toMatch(/zn_rt=;/);

    const row = await tokenRow(cookie);
    expect(row.revoked_reason).toBe('logout');
    expect((await refreshWith(client(), cookie)).status).toBe(401);
  });

  test('POST /logout sem cookie também responde 204', async () => {
    const res = await client().post('/api/v1/auth/logout').set(CSRF_HEADERS);
    expect(res.status).toBe(204);
  });

  test('POST /logout-all encerra todas as sessões, inclusive access tokens já emitidos', async () => {
    const user = await createUser();
    const phone = await loginAs(client(), user);
    const desktop = await loginAs(client(), user);

    // Garante que o logout aconteça num segundo posterior à emissão dos tokens.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const res = await client().post('/api/v1/auth/logout-all').set('Authorization', `Bearer ${desktop.accessToken}`);
    expect(res.status).toBe(204);

    expect((await refreshWith(client(), phone.cookie)).status).toBe(401);
    expect((await refreshWith(client(), desktop.cookie)).status).toBe(401);

    const me = await client().get('/api/v1/me').set('Authorization', `Bearer ${phone.accessToken}`);
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('SESSION_REVOKED');

    // Um login novo funciona normalmente.
    const fresh = await loginAs(client(), user);
    expect((await client().get('/api/v1/me').set('Authorization', `Bearer ${fresh.accessToken}`)).status).toBe(200);
  });
});

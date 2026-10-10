import { pool } from '../../src/shared/db.js';
import { tokenFromEmail, waitForEmail } from '../helpers/email.js';
import { api, makeApp, refreshCookieFrom } from '../helpers/http.js';
import { createUser, loginAs, refreshWith } from '../helpers/users.js';

const app = makeApp({ serveFrontend: false });

describe('concorrência na sessão', () => {
  test('5 refresh simultâneos com o mesmo token: uma rotação só, os demais na tolerância, família intacta', async () => {
    const user = await createUser();
    const { cookie } = await loginAs(api(app), user);

    const results = await Promise.all(Array.from({ length: 5 }, () => refreshWith(api(app), cookie)));
    expect(results.every((res) => res.status === 200)).toBe(true);
    const rotated = results.filter((res) => refreshCookieFrom(res) !== null);
    expect(rotated).toHaveLength(1);

    const { rows } = await pool.query(
      `SELECT count(*) AS total, count(*) FILTER (WHERE revoked_at IS NOT NULL) AS revoked
         FROM refresh_tokens WHERE user_id = $1`,
      [user.id],
    );
    expect(rows[0]).toEqual({ total: 2, revoked: 0 });
  });

  test('o mesmo link de redefinição usado 3 vezes ao mesmo tempo: só uma troca de senha', async () => {
    const user = await createUser();
    await api(app).post('/api/v1/auth/password/forgot').send({ email: user.email });
    const token = tokenFromEmail(await waitForEmail(user.email, 'auth.password_reset'));

    const results = await Promise.all(
      ['nova-senha-aaa', 'nova-senha-bbb', 'nova-senha-ccc'].map((password) =>
        api(app).post('/api/v1/auth/password/reset').send({ token, password }),
      ),
    );
    expect(results.map((res) => res.status).sort()).toEqual([200, 422, 422]);
  });
});

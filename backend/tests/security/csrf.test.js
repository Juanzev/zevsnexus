import { api, makeApp, ORIGIN } from '../helpers/http.js';
import { createUser, loginAs } from '../helpers/users.js';

const app = makeApp({ serveFrontend: false });

describe('guarda CSRF nas rotas autenticadas por cookie', () => {
  let cookie;
  beforeAll(async () => {
    ({ cookie } = await loginAs(api(app), await createUser()));
  });

  function refresh(headers) {
    return api(app).post('/api/v1/auth/refresh').set('Cookie', cookie).set(headers);
  }

  test('sem o header X-ZN-CSRF → 403', async () => {
    const res = await refresh({ Origin: ORIGIN });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
  });

  test('Origin de outro site → 403', async () => {
    expect((await refresh({ Origin: 'https://atacante.exemplo', 'X-ZN-CSRF': '1' })).status).toBe(403);
  });

  test('sem Origin → 403', async () => {
    expect((await refresh({ 'X-ZN-CSRF': '1' })).status).toBe(403);
  });

  test('Sec-Fetch-Site: cross-site → 403, mesmo com Origin permitida', async () => {
    expect((await refresh({ Origin: ORIGIN, 'X-ZN-CSRF': '1', 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
  });

  test('logout também exige a guarda', async () => {
    const res = await api(app).post('/api/v1/auth/logout').set('Cookie', cookie).set('Origin', 'https://atacante.exemplo');
    expect(res.status).toBe(403);
  });

  test('a própria origem do app, com o header, passa', async () => {
    const res = await refresh({ Origin: ORIGIN, 'X-ZN-CSRF': '1', 'Sec-Fetch-Site': 'same-origin' });
    expect(res.status).toBe(200);
  });
});

describe('login não é forjável por formulário de outro site', () => {
  test('corpo form-urlencoded não é lido → 422', async () => {
    const user = await createUser();
    const res = await api(app)
      .post('/api/v1/auth/login')
      .type('form')
      .send({ email: user.email, password: user.password });
    expect(res.status).toBe(422);
  });
});

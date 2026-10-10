import { api, makeApp } from '../helpers/http.js';

const app = makeApp({ serveFrontend: true });

describe('SPA servida pelo backend', () => {
  test.each(['/', '/login', '/app', '/redefinir-senha', '/qualquer/rota/profunda'])(
    'GET %s devolve o index.html com a versão carimbada e no-cache',
    async (route) => {
      const res = await api(app).get(route);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.text).toContain('<meta name="app-version" content="dev">');
      expect(res.text).not.toContain('%%APP_VERSION%%');
    },
  );

  test('o index.html sai com a CSP do app e ETag (revalidação barata)', async () => {
    const first = await api(app).get('/login');
    expect(first.headers['content-security-policy']).toContain("script-src 'self'");
    expect(first.headers.etag).toBeTruthy();
    const second = await api(app).get('/login').set('If-None-Match', first.headers.etag);
    expect(second.status).toBe(304);
  });

  test('módulos JS saem com MIME de JavaScript e no-cache', async () => {
    const res = await api(app).get('/src/app.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  test('arquivo inexistente é 404, nunca o index.html', async () => {
    const res = await api(app).get('/src/nao-existe.js');
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('<!doctype html>');
  });

  test('a SPA não engole rotas da API', async () => {
    const res = await api(app).get('/api/v1/rota-inexistente');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});

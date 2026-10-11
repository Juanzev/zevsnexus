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

describe('PWA (ARCHITECTURE §19.1)', () => {
  test('manifest com MIME certo, início em /app e ícones PNG que existem', async () => {
    const res = await api(app).get('/manifest.webmanifest');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/manifest\+json/);
    const manifest = JSON.parse(res.text);
    expect(manifest).toMatchObject({ name: 'ZEVS Nexus', start_url: '/app', scope: '/', display: 'standalone' });
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(['192x192', '512x512', '512x512']);
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
    for (const icon of [...manifest.icons.map((item) => item.src), '/icons/apple-touch-icon.png']) {
      const image = await api(app).get(icon);
      expect({ icon, status: image.status, type: image.headers['content-type'] }).toEqual({ icon, status: 200, type: 'image/png' });
    }
  });

  test('o index.html liga o manifest, o apple-touch-icon e as metas do Safari', async () => {
    const res = await api(app).get('/app');
    expect(res.text).toContain('<link rel="manifest" href="/manifest.webmanifest">');
    expect(res.text).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">');
    expect(res.text).toContain('<meta name="apple-mobile-web-app-capable" content="yes">');
  });

  test('/sw.js nunca vai para cache e é rede primeiro, sem /api nem arquivos', async () => {
    const res = await api(app).get('/sw.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain("const NEVER_CACHE = ['/api/', '/dev-storage/', '/sw.js'];");
    expect(res.text).toContain('networkFirst');
  });

  test('kill switch: com SW_KILL_SWITCH, /sw.js limpa os caches e se desregistra', async () => {
    const killed = makeApp({ serveFrontend: true, swKillSwitch: true });
    const res = await api(killed).get('/sw.js');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain('self.registration.unregister()');
    expect(res.text).toContain('caches.delete');
  });

  test('a página "Sem conexão" existe e não depende de script', async () => {
    const res = await api(app).get('/offline.html');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Sem conexão');
    expect(res.text).not.toMatch(/<script/);
  });
});

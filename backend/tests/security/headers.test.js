import { api, makeApp } from '../helpers/http.js';

const app = makeApp({ serveFrontend: false });

describe('headers de segurança', () => {
  test('respostas da API: no-store, CSP fechada, nosniff, sem x-powered-by', async () => {
    const res = await api(app).get('/api/version');
    expect(res.headers['cache-control']).toBe('no-cache');
    const notFound = await api(app).get('/api/v1/nada');
    expect(notFound.headers['cache-control']).toBe('no-store');
    expect(notFound.headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(notFound.headers['x-content-type-options']).toBe('nosniff');
    expect(notFound.headers['x-powered-by']).toBeUndefined();
    expect(notFound.headers['referrer-policy']).toBe('no-referrer');
  });

  test('HSTS só em produção', async () => {
    const res = await api(app).get('/health');
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  test('CSP do app proíbe script inline e de terceiros', async () => {
    const res = await api(app).get('/health');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  test('CORS: origem desconhecida não recebe Access-Control-Allow-Origin', async () => {
    const res = await api(app).get('/api/version').set('Origin', 'https://atacante.exemplo');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    const own = await api(app).get('/api/version').set('Origin', 'http://localhost:3000');
    expect(own.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });
});

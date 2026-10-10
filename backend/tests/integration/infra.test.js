import { api, makeApp } from '../helpers/http.js';

const app = makeApp({ serveFrontend: false });

describe('endpoints de infraestrutura', () => {
  test('GET /health responde sem tocar no banco', async () => {
    const res = await api(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('GET /ready confirma banco acessível e migrations em dia', async () => {
    const res = await api(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  test('GET /api/version devolve a versão do deploy com no-cache', async () => {
    const res = await api(app).get('/api/version');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { version: 'dev' } });
    expect(res.headers['cache-control']).toBe('no-cache');
  });
});

describe('formato de erro e limites da API', () => {
  test('rota inexistente em /api → 404 no formato padrão, com requestId', async () => {
    const res = await api(app).get('/api/v1/nao-existe');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'ROUTE_NOT_FOUND', message: expect.any(String) });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  test('JSON malformado → 400 INVALID_JSON', async () => {
    const res = await api(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  test('corpo acima de 1 MB → 413', async () => {
    const res = await api(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.com', password: 'x'.repeat(1_100_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('X-Request-Id válido é ecoado; inválido é substituído por um UUID', async () => {
    const valid = await api(app).get('/health').set('X-Request-Id', 'abc-123-def-456');
    expect(valid.headers['x-request-id']).toBe('abc-123-def-456');

    const invalid = await api(app).get('/health').set('X-Request-Id', 'não vale <script>');
    expect(invalid.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('sem frontend servido, rota fora de /api → 404', async () => {
    const res = await api(app).get('/login');
    expect(res.status).toBe(404);
  });
});

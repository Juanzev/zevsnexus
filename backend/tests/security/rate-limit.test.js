import { api, makeApp } from '../helpers/http.js';
import { createUser } from '../helpers/users.js';

describe('rate limit de login (5 falhas em 15 min por IP + e-mail)', () => {
  test('a 6ª falha seguida é bloqueada com 429; outro e-mail não é afetado', async () => {
    const app = makeApp({ serveFrontend: false, rateLimits: true });
    const user = await createUser();
    const other = await createUser();

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = await api(app).post('/api/v1/auth/login').send({ email: user.email, password: 'errada-123' });
      expect(res.status).toBe(401);
    }
    const blocked = await api(app).post('/api/v1/auth/login').send({ email: user.email, password: user.password });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');

    const otherLogin = await api(app).post('/api/v1/auth/login').send({ email: other.email, password: other.password });
    expect(otherLogin.status).toBe(200);
  });

  test('logins com sucesso não contam como falha', async () => {
    const app = makeApp({ serveFrontend: false, rateLimits: true });
    const user = await createUser();
    for (let attempt = 1; attempt <= 7; attempt += 1) {
      const res = await api(app).post('/api/v1/auth/login').send({ email: user.email, password: user.password });
      expect(res.status).toBe(200);
    }
  });
});

describe('rate limit de cadastro e recuperação (10 em 15 min por IP)', () => {
  test('o 11º pedido de recuperação é bloqueado', async () => {
    const app = makeApp({ serveFrontend: false, rateLimits: true });
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const res = await api(app).post('/api/v1/auth/password/forgot').send({ email: `x${attempt}@teste.zevs.local` });
      expect(res.status).toBe(202);
    }
    const blocked = await api(app).post('/api/v1/auth/password/forgot').send({ email: 'y@teste.zevs.local' });
    expect(blocked.status).toBe(429);
  });
});

describe('o limite global vale só para /api', () => {
  test('/health continua respondendo e traz o header RateLimit só na API', async () => {
    const app = makeApp({ serveFrontend: false, rateLimits: true });
    const health = await api(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.headers.ratelimit).toBeUndefined();

    const version = await api(app).get('/api/version');
    expect(version.headers.ratelimit).toBeDefined();
  });
});

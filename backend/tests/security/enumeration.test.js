import { api, makeApp } from '../helpers/http.js';
import { createUser } from '../helpers/users.js';

const app = makeApp({ serveFrontend: false });

function stripRequestId(body) {
  if (!body?.error) return body;
  const { requestId: _requestId, ...error } = body.error;
  return { error };
}

describe('nenhuma rota pública revela se um e-mail está cadastrado', () => {
  let existing;
  const missingEmail = 'nao-cadastrado-xyz@teste.zevs.local';

  beforeAll(async () => {
    existing = await createUser();
  });

  test('login: e-mail inexistente e senha errada têm a mesma resposta', async () => {
    const wrongPassword = await api(app).post('/api/v1/auth/login').send({ email: existing.email, password: 'errada-123' });
    const unknownEmail = await api(app).post('/api/v1/auth/login').send({ email: missingEmail, password: 'errada-123' });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(stripRequestId(unknownEmail.body)).toEqual(stripRequestId(wrongPassword.body));
  });

  test('cadastro: e-mail novo e já cadastrado têm a mesma resposta', async () => {
    const body = { name: 'Eva', password: 'senha-forte-123', accept_terms: true };
    const fresh = await api(app).post('/api/v1/auth/register').send({ ...body, email: 'novo-enum@teste.zevs.local' });
    const taken = await api(app).post('/api/v1/auth/register').send({ ...body, email: existing.email });
    expect(taken.status).toBe(fresh.status);
    expect(taken.body).toEqual(fresh.body);
  });

  test('recuperação de senha: mesma resposta para os dois casos', async () => {
    const known = await api(app).post('/api/v1/auth/password/forgot').send({ email: existing.email });
    const unknown = await api(app).post('/api/v1/auth/password/forgot').send({ email: missingEmail });
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
  });
});

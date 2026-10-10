import { randomUUID } from 'node:crypto';
import { pool } from '../../src/shared/db.js';
import { signAccessToken } from '../../src/shared/security/tokens.js';
import { api, makeApp } from '../helpers/http.js';
import { auditEvents, bearer } from '../helpers/tenants.js';
import { createUser } from '../helpers/users.js';

const app = makeApp({ serveFrontend: false });

function onboard(user, body, key = randomUUID()) {
  return api(app)
    .post('/api/v1/companies')
    .set(bearer(signAccessToken(user.id)))
    .set('Idempotency-Key', key)
    .send(body);
}

describe('POST /api/v1/companies (onboarding)', () => {
  test('cria a empresa em análise, com a pessoa como proprietária, plano padrão em teste e auditoria', async () => {
    const user = await createUser();
    const res = await onboard(user, {
      legal_name: 'Construtora Exemplo Ltda',
      trade_name: 'Exemplo Engenharia',
      cnpj: '11.222.333/0001-81',
      timezone: 'America/Manaus',
    });
    expect(res.status).toBe(201);
    const { company } = res.body.data;
    expect(company).toMatchObject({
      name: 'Exemplo Engenharia',
      legal_name: 'Construtora Exemplo Ltda',
      cnpj: '11222333000181',
      status: 'pending',
      timezone: 'America/Manaus',
      version: 1,
    });

    const { rows: roles } = await pool.query(
      `SELECT mr.role_code FROM memberships m JOIN membership_roles mr ON mr.membership_id = m.id
        WHERE m.company_id = $1 AND m.user_id = $2`,
      [company.id, user.id],
    );
    expect(roles.map((row) => row.role_code)).toEqual(['owner']);

    const { rows: subscriptions } = await pool.query(
      'SELECT plan_code, status, trial_ends_at FROM subscriptions WHERE company_id = $1',
      [company.id],
    );
    expect(subscriptions[0]).toMatchObject({ plan_code: 'standard', status: 'trialing' });
    expect(subscriptions[0].trial_ends_at).toBeInstanceOf(Date);

    const branding = await pool.query('SELECT primary_color FROM company_branding WHERE company_id = $1', [company.id]);
    expect(branding.rows[0].primary_color).toBe('#1d4ed8');

    const [event] = await auditEvents({ companyId: company.id, action: 'company.created' });
    expect(event).toMatchObject({ actor_type: 'user', actor_user_id: user.id, entity_id: company.id });
  });

  test('exige e-mail confirmado', async () => {
    const user = await createUser({ verified: false });
    const res = await onboard(user, { legal_name: 'Empresa Sem Confirmação' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  test('uma empresa em análise por vez', async () => {
    const user = await createUser();
    expect((await onboard(user, { legal_name: 'Primeira Empresa' })).status).toBe(201);
    const second = await onboard(user, { legal_name: 'Segunda Empresa' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('PENDING_COMPANY_EXISTS');
  });

  test('exige Idempotency-Key; mesma chave e mesmo corpo devolvem a mesma resposta sem criar outra empresa', async () => {
    const user = await createUser();
    const withoutKey = await api(app).post('/api/v1/companies').set(bearer(signAccessToken(user.id))).send({ legal_name: 'Sem Chave' });
    expect(withoutKey.status).toBe(422);
    expect(withoutKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

    const key = randomUUID();
    const first = await onboard(user, { legal_name: 'Empresa Idempotente' }, key);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const replay = await onboard(user, { legal_name: 'Empresa Idempotente' }, key);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);

    const { rows } = await pool.query('SELECT count(*) AS total FROM companies WHERE created_by = $1', [user.id]);
    expect(rows[0].total).toBe(1);

    const otherBody = await onboard(user, { legal_name: 'Outro Nome' }, key);
    expect(otherBody.status).toBe(422);
    expect(otherBody.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  test('erro não consome a chave: depois de corrigir o corpo, a mesma chave funciona', async () => {
    const user = await createUser();
    const key = randomUUID();
    const invalid = await onboard(user, { legal_name: 'Empresa', cnpj: '11.222.333/0001-00' }, key);
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.details[0].field).toBe('cnpj');
    const ok = await onboard(user, { legal_name: 'Empresa', cnpj: '11.222.333/0001-81' }, key);
    expect(ok.status).toBe(201);
  });

  test.each([
    ['razão social curta', { legal_name: 'A' }, 'legal_name'],
    ['CNPJ inválido', { legal_name: 'Empresa X', cnpj: '123' }, 'cnpj'],
    ['fuso inexistente', { legal_name: 'Empresa X', timezone: 'Marte/Olympus' }, 'timezone'],
    ['company_id no corpo', { legal_name: 'Empresa X', company_id: randomUUID() }, 'company_id'],
    ['status no corpo', { legal_name: 'Empresa X', status: 'active' }, 'status'],
  ])('recusa %s', async (_caso, body, field) => {
    const res = await onboard(await createUser(), body);
    expect(res.status).toBe(422);
    expect(res.body.error.details.map((detail) => detail.field)).toContain(field);
  });

  test('sem login → 401', async () => {
    const res = await api(app).post('/api/v1/companies').set('Idempotency-Key', randomUUID()).send({ legal_name: 'X' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/me', () => {
  test('lista as empresas da pessoa com status e papéis', async () => {
    const user = await createUser();
    await onboard(user, { legal_name: 'Empresa da Me' });
    const res = await api(app).get('/api/v1/me').set(bearer(signAccessToken(user.id)));
    expect(res.status).toBe(200);
    expect(res.body.data.platform_admin).toBe(false);
    expect(res.body.data.companies).toEqual([
      expect.objectContaining({ name: 'Empresa da Me', status: 'pending', membership_status: 'active', roles: ['owner'] }),
    ]);
  });
});

import { randomUUID } from 'node:crypto';
import { pool } from '../../src/shared/db.js';
import { signAccessToken } from '../../src/shared/security/tokens.js';
import { api, makeApp } from '../helpers/http.js';
import { bearer, createTenant } from '../helpers/tenants.js';
import { createUser } from '../helpers/users.js';

const app = makeApp({ serveFrontend: false });

function onboard(user, key, legalName = 'Empresa Concorrente') {
  return api(app)
    .post('/api/v1/companies')
    .set(bearer(signAccessToken(user.id)))
    .set('Idempotency-Key', key)
    .send({ legal_name: legalName });
}

async function companiesCreatedBy(userId) {
  const { rows } = await pool.query('SELECT count(*) AS total FROM companies WHERE created_by = $1', [userId]);
  return rows[0].total;
}

describe('concorrência no onboarding', () => {
  test('3 cadastros simultâneos com chaves diferentes: uma empresa, os outros 409', async () => {
    const user = await createUser();
    const results = await Promise.all([1, 2, 3].map((n) => onboard(user, randomUUID(), `Empresa ${n}`)));
    expect(results.map((res) => res.status).sort()).toEqual([201, 409, 409]);
    expect(results.filter((res) => res.status === 409).every((res) => res.body.error.code === 'PENDING_COMPANY_EXISTS')).toBe(true);
    expect(await companiesCreatedBy(user.id)).toBe(1);
  });

  test('duplo clique (mesma chave, mesmo corpo, ao mesmo tempo): uma empresa só', async () => {
    const user = await createUser();
    const key = randomUUID();
    const results = await Promise.all([onboard(user, key), onboard(user, key), onboard(user, key)]);
    expect(results.filter((res) => res.status === 201).length).toBeGreaterThanOrEqual(1);
    for (const res of results) {
      expect([201, 409]).toContain(res.status);
      if (res.status === 409) expect(res.body.error.code).toBe('IDEMPOTENCY_IN_PROGRESS');
    }
    expect(await companiesCreatedBy(user.id)).toBe(1);
  });
});

describe('concorrência otimista no perfil da empresa', () => {
  test('5 edições simultâneas com a mesma versão: uma vence, as outras 409', async () => {
    const tenant = await createTenant();
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        api(app).patch('/api/v1/company').set(tenant.headers('owner')).send({ version: 1, trade_name: `Nome ${n}` }),
      ),
    );
    expect(results.map((res) => res.status).sort()).toEqual([200, 409, 409, 409, 409]);
    const { rows } = await pool.query('SELECT version FROM companies WHERE id = $1', [tenant.company.id]);
    expect(rows[0].version).toBe(2);
  });
});

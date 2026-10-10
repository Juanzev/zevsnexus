import { randomUUID } from 'node:crypto';
import { isPlatformAdmin } from '../../src/modules/platform/platform.service.js';
import { pool } from '../../src/shared/db.js';
import { signAccessToken } from '../../src/shared/security/tokens.js';
import { waitForEmail } from '../helpers/email.js';
import { api, makeApp } from '../helpers/http.js';
import { auditEvents, bearer, createTenant } from '../helpers/tenants.js';
import { createUser } from '../helpers/users.js';

const app = makeApp({ serveFrontend: false });
const ADMIN_EMAIL = 'admin-zevs@teste.zevs.local';

let admin;
beforeAll(async () => {
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [ADMIN_EMAIL]);
  admin = existing.rows[0] ?? (await createUser({ email: ADMIN_EMAIL, name: 'Equipe ZEVS' }));
});

const asAdmin = () => bearer(signAccessToken(admin.id));

async function pendingCompany() {
  const owner = await createUser();
  const res = await api(app)
    .post('/api/v1/companies')
    .set(bearer(signAccessToken(owner.id)))
    .set('Idempotency-Key', randomUUID())
    .send({ legal_name: `Empresa ${randomUUID().slice(0, 6)}` });
  return { owner, company: res.body.data.company };
}

describe('acesso ao Painel ZEVS', () => {
  test('dono de empresa recebe 403', async () => {
    const tenant = await createTenant();
    const res = await api(app).get('/api/v1/admin/companies').set(bearer(tenant.members.owner.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PLATFORM_ADMIN_REQUIRED');
  });

  test('e-mail de bootstrap só vale verificado (senão qualquer um o cadastraria)', async () => {
    const id = randomUUID();
    await expect(isPlatformAdmin({ id, email: ADMIN_EMAIL, email_verified_at: null })).resolves.toBe(false);
    await expect(isPlatformAdmin({ id, email: ADMIN_EMAIL.toUpperCase(), email_verified_at: new Date() })).resolves.toBe(true);
    await expect(isPlatformAdmin({ id, email: `x-${ADMIN_EMAIL}`, email_verified_at: new Date() })).resolves.toBe(false);
  });

  test('a própria conta do bootstrap, sem verificação, não entra', async () => {
    await pool.query('UPDATE users SET email_verified_at = NULL WHERE id = $1', [admin.id]);
    try {
      expect((await api(app).get('/api/v1/admin/companies').set(asAdmin())).status).toBe(403);
    } finally {
      await pool.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [admin.id]);
    }
  });

  test('admin verificado acessa e /me informa platform_admin', async () => {
    expect((await api(app).get('/api/v1/admin/companies').set(asAdmin())).status).toBe(200);
    expect((await api(app).get('/api/v1/me').set(asAdmin())).body.data.platform_admin).toBe(true);
  });

  test('registro em platform_admins também dá acesso', async () => {
    const staff = await createUser();
    await pool.query('INSERT INTO platform_admins (user_id) VALUES ($1)', [staff.id]);
    expect((await api(app).get('/api/v1/admin/companies').set(bearer(signAccessToken(staff.id)))).status).toBe(200);
  });
});

describe('gestão de empresas', () => {
  test('lista com filtro de status, busca e dono', async () => {
    const { company, owner } = await pendingCompany();
    const res = await api(app).get('/api/v1/admin/companies').set(asAdmin()).query({ status: 'pending', q: company.legal_name });
    expect(res.status).toBe(200);
    expect(res.body.data.companies).toEqual([
      expect.objectContaining({
        id: company.id,
        status: 'pending',
        members: 1,
        owner: { name: owner.name, email: owner.email, email_verified: true },
      }),
    ]);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 1 });
  });

  test('busca trata % e _ como texto', async () => {
    const res = await api(app).get('/api/v1/admin/companies').set(asAdmin()).query({ q: '%' });
    expect(res.status).toBe(200);
    expect(res.body.data.companies).toHaveLength(0);
  });

  test('aprovar: empresa ativa, e-mail ao dono, auditoria na empresa como platform_admin', async () => {
    const { company, owner } = await pendingCompany();
    const res = await api(app).post(`/api/v1/admin/companies/${company.id}/approve`).set(asAdmin());
    expect(res.status).toBe(200);
    expect(res.body.data.company).toMatchObject({ status: 'active', approved_at: expect.any(String) });

    const [event] = await auditEvents({ companyId: company.id, action: 'platform.company_approved' });
    expect(event).toMatchObject({ actor_type: 'platform_admin', actor_user_id: admin.id, metadata: { from: 'pending', to: 'active' } });
    await waitForEmail(owner.email, 'platform.company_approved');

    // O dono já entra na empresa.
    const ctx = await api(app)
      .get('/api/v1/company/context')
      .set({ ...bearer(signAccessToken(owner.id)), 'X-Company-Id': company.id });
    expect(ctx.status).toBe(200);

    const again = await api(app).post(`/api/v1/admin/companies/${company.id}/approve`).set(asAdmin());
    expect(again.status).toBe(409);
  });

  test('suspender bloqueia o acesso; reativar devolve', async () => {
    const tenant = await createTenant();
    const suspend = await api(app)
      .post(`/api/v1/admin/companies/${tenant.company.id}/suspend`)
      .set(asAdmin())
      .send({ reason: 'Pedido do cliente' });
    expect(suspend.body.data.company).toMatchObject({ status: 'suspended', suspended_reason: 'Pedido do cliente' });
    expect((await api(app).get('/api/v1/company/context').set(tenant.headers('owner'))).body.error.code).toBe('COMPANY_SUSPENDED');

    const reactivate = await api(app).post(`/api/v1/admin/companies/${tenant.company.id}/reactivate`).set(asAdmin());
    expect(reactivate.body.data.company.status).toBe('active');
    expect((await api(app).get('/api/v1/company/context').set(tenant.headers('owner'))).status).toBe(200);
  });

  test('suspender exige motivo; empresa inexistente → 404', async () => {
    const tenant = await createTenant();
    expect((await api(app).post(`/api/v1/admin/companies/${tenant.company.id}/suspend`).set(asAdmin()).send({})).status).toBe(422);
    expect((await api(app).post(`/api/v1/admin/companies/${randomUUID()}/approve`).set(asAdmin())).status).toBe(404);
  });
});

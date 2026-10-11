import { randomUUID } from 'node:crypto';
import { pool } from '../../src/shared/db.js';
import { api, makeApp } from '../helpers/http.js';
import { bearer, createTenant } from '../helpers/tenants.js';

const app = makeApp({ serveFrontend: false });

function context(headers) {
  return api(app).get('/api/v1/company/context').set(headers);
}

describe('contexto do tenant (X-Company-Id)', () => {
  test('membro ativo recebe empresa, papéis, permissões, features e marca', async () => {
    const tenant = await createTenant({ roles: ['owner', 'viewer'] });
    const res = await context(tenant.headers('viewer'));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      company: { id: tenant.company.id, status: 'active', timezone: 'America/Sao_Paulo' },
      membership: { id: tenant.members.viewer.membershipId, roles: ['viewer'] },
      features: ['multiple_users', 'spreadsheet_import'],
      branding: { primary_color: '#1d4ed8' },
      // Empresa sem as pastas sugeridas (factory): atalhos vazios.
      document_folders: { company: null, receipts: null, invoices: null, spreadsheets: null },
    });
    expect(res.body.data.permissions).toContain('company.view');
    expect(res.body.data.permissions).not.toContain('company.manage');
  });

  test('sem X-Company-Id → 400 COMPANY_REQUIRED', async () => {
    const tenant = await createTenant();
    const res = await context(bearer(tenant.members.owner.token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('COMPANY_REQUIRED');
  });

  test('inválido, inexistente e de outra empresa → o mesmo 404', async () => {
    const tenant = await createTenant();
    const other = await createTenant();
    const token = bearer(tenant.members.owner.token);
    const responses = await Promise.all([
      context({ ...token, 'X-Company-Id': 'nao-e-uuid' }),
      context({ ...token, 'X-Company-Id': randomUUID() }),
      context({ ...token, 'X-Company-Id': other.company.id }),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('COMPANY_NOT_FOUND');
    }
  });

  test('empresa em análise → 403 COMPANY_PENDING; suspensa → 403 COMPANY_SUSPENDED', async () => {
    const pending = await createTenant({ status: 'pending' });
    expect((await context(pending.headers('owner'))).body.error.code).toBe('COMPANY_PENDING');

    const suspended = await createTenant({ status: 'suspended' });
    const res = await context(suspended.headers('owner'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('COMPANY_SUSPENDED');
  });

  test('vínculo suspenso → 403 MEMBERSHIP_SUSPENDED; vínculo removido → 404', async () => {
    const tenant = await createTenant({ roles: ['owner', 'assistant'] });
    await pool.query("UPDATE memberships SET status = 'suspended' WHERE id = $1", [tenant.members.assistant.membershipId]);
    expect((await context(tenant.headers('assistant'))).body.error.code).toBe('MEMBERSHIP_SUSPENDED');

    await pool.query('UPDATE memberships SET deleted_at = now() WHERE id = $1', [tenant.members.assistant.membershipId]);
    expect((await context(tenant.headers('assistant'))).status).toBe(404);
  });

  test('mudança de acesso vale na próxima requisição (sem esperar o token expirar)', async () => {
    const tenant = await createTenant({ roles: ['owner', 'viewer'] });
    const { membershipId } = tenant.members.viewer;
    await pool.query(
      "INSERT INTO membership_permissions (company_id, membership_id, permission_code, effect) VALUES ($1, $2, 'company.manage', 'grant')",
      [tenant.company.id, membershipId],
    );
    await pool.query(
      "INSERT INTO membership_permissions (company_id, membership_id, permission_code, effect) VALUES ($1, $2, 'company.view', 'deny')",
      [tenant.company.id, membershipId],
    );
    const { permissions } = (await context(tenant.headers('viewer'))).body.data;
    expect(permissions).toContain('company.manage');
    expect(permissions).not.toContain('company.view');
  });

  test('feature desligada para a empresa sai da lista; ligada fora do plano entra', async () => {
    const tenant = await createTenant();
    await pool.query(
      "INSERT INTO company_features (company_id, feature_code, enabled) VALUES ($1, 'spreadsheet_import', false)",
      [tenant.company.id],
    );
    expect((await context(tenant.headers('owner'))).body.data.features).toEqual(['multiple_users']);
  });
});

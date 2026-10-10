// Suíte de isolamento A × B (pág. 03, camada 5): a empresa A nunca lê, altera ou exclui dados da B.
import { pool } from '../../src/shared/db.js';
import { api, makeApp } from '../helpers/http.js';
import { createTenant } from '../helpers/tenants.js';

const app = makeApp({ serveFrontend: false });

let a;
let b;
let contactOfB;

beforeAll(async () => {
  a = await createTenant({ legalName: 'Empresa A' });
  b = await createTenant({ legalName: 'Empresa B' });
  const res = await api(app)
    .post('/api/v1/company/contacts')
    .set(b.headers('owner'))
    .send({ name: 'Contato da B', email: 'contato@b.com.br' });
  contactOfB = res.body.data.contact;
});

/** Dono da A pedindo a empresa B pelo cabeçalho. */
const aAskingForB = () => ({ ...a.headers('owner'), 'X-Company-Id': b.company.id });

describe('A × B pelo cabeçalho X-Company-Id', () => {
  test.each([
    { method: 'get', path: '/api/v1/company/context' },
    { method: 'get', path: '/api/v1/company' },
    { method: 'patch', path: '/api/v1/company', body: { version: 1, trade_name: 'Invadida' } },
    { method: 'get', path: '/api/v1/company/settings' },
    { method: 'patch', path: '/api/v1/company/settings', body: { primary_color: '#000000' } },
    { method: 'get', path: '/api/v1/company/contacts' },
    { method: 'post', path: '/api/v1/company/contacts', body: { name: 'Intruso' } },
  ])('$method $path → 404 igual a inexistente', async ({ method, path, body }) => {
    const request = api(app)[method](path).set(aAskingForB());
    const res = body ? await request.send(body) : await request;
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COMPANY_NOT_FOUND');
  });
});

describe('A × B pelo id do recurso', () => {
  test('editar contato da B usando a própria empresa → 404, e o contato da B não muda', async () => {
    const res = await api(app).patch(`/api/v1/company/contacts/${contactOfB.id}`).set(a.headers('owner')).send({ name: 'Trocado' });
    expect(res.status).toBe(404);
    const { rows } = await pool.query('SELECT name FROM company_contacts WHERE id = $1', [contactOfB.id]);
    expect(rows[0].name).toBe('Contato da B');
  });

  test('excluir contato da B → 404, e o contato continua ativo', async () => {
    expect((await api(app).delete(`/api/v1/company/contacts/${contactOfB.id}`).set(a.headers('owner'))).status).toBe(404);
    const { rows } = await pool.query('SELECT deleted_at FROM company_contacts WHERE id = $1', [contactOfB.id]);
    expect(rows[0].deleted_at).toBeNull();
  });

  test('a lista da A nunca traz contatos da B', async () => {
    const res = await api(app).get('/api/v1/company/contacts').set(a.headers('owner'));
    expect(res.body.data.contacts.map((contact) => contact.id)).not.toContain(contactOfB.id);
  });

  test('o perfil e as configurações da B ficam intactos', async () => {
    const { rows } = await pool.query(
      'SELECT c.trade_name, b.primary_color FROM companies c JOIN company_branding b ON b.company_id = c.id WHERE c.id = $1',
      [b.company.id],
    );
    expect(rows[0]).toEqual({ trade_name: null, primary_color: '#1d4ed8' });
  });
});

describe('o banco recusa referência cruzada (FK composta)', () => {
  test('papel de um vínculo da B gravado com company_id da A → erro de FK', async () => {
    await expect(
      pool.query("INSERT INTO membership_roles (company_id, membership_id, role_code) VALUES ($1, $2, 'viewer')", [
        a.company.id,
        b.members.owner.membershipId,
      ]),
    ).rejects.toThrow(/foreign key/);
  });

  test('grant de permissão para vínculo da B com company_id da A → erro de FK', async () => {
    await expect(
      pool.query(
        "INSERT INTO membership_permissions (company_id, membership_id, permission_code, effect) VALUES ($1, $2, 'company.view', 'grant')",
        [a.company.id, b.members.owner.membershipId],
      ),
    ).rejects.toThrow(/foreign key/);
  });
});

import { PERSONAL_DATA } from '../../src/modules/audit/audit.service.js';
import { pool } from '../../src/shared/db.js';
import { createDocument, uploadFile } from '../helpers/documents.js';
import { CNPJ, CPF, createExpense, createParty, denyPermission, pay, post } from '../helpers/finance.js';
import { api, makeApp } from '../helpers/http.js';
import { auditEvents, createTenant } from '../helpers/tenants.js';

const app = makeApp({ serveFrontend: false });

function get(tenant, path, role = 'owner') {
  return api(app).get(`/api/v1${path}`).set(tenant.headers(role));
}

describe('cadastro de prestadores e fornecedores', () => {
  test('pessoa física com CPF e jurídica com CNPJ (inclusive alfanumérico), guardados sem máscara', async () => {
    const tenant = await createTenant();
    const person = await post(app, tenant.headers('owner'), '/parties', {
      person_type: 'individual',
      name: 'José da Silva',
      document: '529.982.247-25',
      roles: ['service_provider', 'service_provider'],
      specialty: 'Eletricista',
      phone: '(92) 99876-5432',
      pix_key: 'jose@exemplo.com',
    });
    expect(person.status).toBe(201);
    expect(person.body.data.party).toMatchObject({
      person_type: 'individual',
      document: CPF[0],
      roles: ['service_provider'],
      phone: '92998765432',
      version: 1,
    });

    const company = await post(app, tenant.headers('owner'), '/parties', {
      person_type: 'company',
      name: 'Materiais Exemplo Ltda',
      document: '12.ABC.345/01DE-35',
      roles: ['supplier'],
    });
    expect(company.status).toBe(201);
    expect(company.body.data.party.document).toBe(CNPJ[1]);

    // Auditoria sem dado pessoal (LGPD): só tipo, papéis e se tem documento.
    const [event] = await auditEvents({ companyId: tenant.company.id, action: 'party.created', entityId: person.body.data.party.id });
    expect(event.metadata).toEqual({ person_type: 'individual', roles: ['service_provider'], has_document: true });
  });

  test('documento inválido, de outro tipo ou repetido é recusado', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const invalid = await post(app, headers, '/parties', { person_type: 'individual', name: 'X', document: '111.111.111-11', roles: ['supplier'] });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.details[0]).toMatchObject({ field: 'document', message: 'CPF inválido. Confira os números.' });
    const wrongType = await post(app, headers, '/parties', { person_type: 'company', name: 'X', document: CPF[0], roles: ['supplier'] });
    expect(wrongType.status).toBe(422);
    expect((await post(app, headers, '/parties', { person_type: 'individual', name: 'X', roles: [] })).status).toBe(422);

    await createParty(app, headers, { document: CPF[1] });
    const duplicate = await post(app, headers, '/parties', { person_type: 'individual', name: 'Outro', document: CPF[1], roles: ['supplier'] });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('PARTY_DOCUMENT_TAKEN');
  });

  test('PATCH com versão; trocar o tipo exige documento compatível; auditoria mascara dado pessoal', async () => {
    const tenant = await createTenant();
    const party = await createParty(app, tenant.headers('owner'), { document: CPF[0], name: 'Maria Souza' });
    const res = await api(app)
      .patch(`/api/v1/parties/${party.id}`)
      .set(tenant.headers('owner'))
      .send({ version: 1, name: 'Maria de Souza', roles: ['service_provider', 'supplier'], specialty: 'Pintora' });
    expect(res.status).toBe(200);
    expect(res.body.data.party).toMatchObject({ name: 'Maria de Souza', version: 2, specialty: 'Pintora' });

    const [event] = await auditEvents({ companyId: tenant.company.id, action: 'party.updated', entityId: party.id });
    expect(event.metadata.changes.name).toBe(PERSONAL_DATA);
    expect(event.metadata.changes.specialty).toEqual({ from: null, to: 'Pintora' });

    const stale = await api(app).patch(`/api/v1/parties/${party.id}`).set(tenant.headers('owner')).send({ version: 1, name: 'X' });
    expect(stale.status).toBe(409);
    const typeOnly = await api(app).patch(`/api/v1/parties/${party.id}`).set(tenant.headers('owner')).send({ version: 2, person_type: 'company' });
    expect(typeOnly.status).toBe(422);
    const typeAndDocument = await api(app)
      .patch(`/api/v1/parties/${party.id}`)
      .set(tenant.headers('owner'))
      .send({ version: 2, person_type: 'company', document: CNPJ[0] });
    expect(typeAndDocument.status).toBe(200);
  });

  test('busca por nome sem acento, documento parcial e telefone; filtro por papel', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const joao = await createParty(app, headers, { name: 'João Gonçalves', document: CPF[0], phone: '92988887777' });
    const loja = await createParty(app, headers, { person_type: 'company', name: 'Loja de Materiais', roles: ['supplier'] });
    const ids = async (query) => (await get(tenant, `/parties?${query}`)).body.data.parties.map((party) => party.id);

    expect(await ids('q=goncalves')).toEqual([joao.id]);
    expect(await ids('q=529.982')).toEqual([joao.id]);
    expect(await ids('q=8888-7777')).toEqual([joao.id]);
    expect(await ids('role=supplier')).toEqual([loja.id]);
    expect(await ids('q=%25')).toEqual([]);
    expect((await get(tenant, '/parties?sort=name;drop')).status).toBe(422);
  });

  test('excluir é soft delete: some da lista, mas despesas antigas mantêm o nome', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const party = await createParty(app, headers, { name: 'Antigo Fornecedor' });
    const expense = await createExpense(app, headers, { party_id: party.id });
    expect((await api(app).delete(`/api/v1/parties/${party.id}`).set(headers).send({})).status).toBe(204);
    expect((await get(tenant, `/parties/${party.id}`)).status).toBe(404);
    expect((await get(tenant, `/expenses/${expense.id}`)).body.data.expense.party).toEqual({ id: party.id, name: 'Antigo Fornecedor' });
  });
});

describe('ficha do prestador', () => {
  test('totais financeiros só para quem tem finance.view; histórico de despesas filtrado', async () => {
    const tenant = await createTenant({ roles: ['owner', 'assistant'] });
    const headers = tenant.headers('owner');
    const party = await createParty(app, headers);
    const first = await createExpense(app, headers, { party_id: party.id, amount_cents: 30_000, due_date: '2026-01-10' });
    await createExpense(app, headers, { party_id: party.id, amount_cents: 20_000, due_date: '2099-01-10' });
    await createExpense(app, headers, { amount_cents: 99_999 });
    await pay(app, headers, first.id, { amount_cents: 10_000 });

    const detail = await get(tenant, `/parties/${party.id}`);
    expect(detail.body.data.party.finance).toEqual({ expense_count: 2, open_cents: 40_000, overdue_cents: 20_000, paid_cents: 10_000 });
    const history = await get(tenant, `/parties/${party.id}/expenses?tab=all`);
    expect(history.body.data.expenses).toHaveLength(2);

    await denyPermission(tenant.company, tenant.members.assistant.membershipId, 'finance.view');
    const limited = await get(tenant, `/parties/${party.id}`, 'assistant');
    expect(limited.status).toBe(200);
    expect(limited.body.data.party.finance).toBeUndefined();
    expect((await get(tenant, `/parties/${party.id}/expenses`, 'assistant')).status).toBe(403);
  });

  test('anexar arquivo novo (pasta padrão de prestadores) ou documento da Central; desvincular', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const { rows } = await pool.query(
      "INSERT INTO folders (company_id, name, created_by) VALUES ($1, 'Prestadores', $2) RETURNING id",
      [tenant.company.id, tenant.members.owner.user.id],
    );
    await pool.query('UPDATE company_settings SET parties_folder_id = $2 WHERE company_id = $1', [tenant.company.id, rows[0].id]);
    const party = await createParty(app, headers);

    const fileId = await uploadFile(app, headers, { filename: 'Contrato de prestação.pdf' });
    const uploaded = await post(app, headers, `/parties/${party.id}/documents`, { file_id: fileId });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.data.documents).toEqual([expect.objectContaining({ title: 'Contrato de prestação', extension: 'pdf' })]);
    const docId = uploaded.body.data.documents[0].id;
    expect((await get(tenant, `/documents/${docId}`)).body.data.document.folder_id).toBe(rows[0].id);

    const existing = await createDocument(app, headers, { filename: 'RG.png', content: (await import('../helpers/documents.js')).FIXTURES.png() });
    const linked = await post(app, headers, `/parties/${party.id}/documents`, { document_id: existing.id });
    expect(linked.body.data.documents).toHaveLength(2);
    expect((await post(app, headers, `/parties/${party.id}/documents`, { file_id: fileId, document_id: existing.id })).status).toBe(422);

    expect((await api(app).delete(`/api/v1/parties/${party.id}/documents/${existing.id}`).set(headers).send({})).status).toBe(204);
    expect((await get(tenant, `/parties/${party.id}/documents`)).body.data.documents).toHaveLength(1);
    // O documento continua na Central.
    expect((await get(tenant, `/documents/${existing.id}`)).status).toBe(200);
    const events = await auditEvents({ companyId: tenant.company.id, action: 'party.document_linked', entityId: party.id });
    expect(events).toHaveLength(2);
  });
});

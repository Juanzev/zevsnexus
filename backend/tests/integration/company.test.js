import { randomUUID } from 'node:crypto';
import { pool } from '../../src/shared/db.js';
import { PERSONAL_DATA } from '../../src/modules/audit/audit.service.js';
import { api, makeApp } from '../helpers/http.js';
import { auditEvents, createTenant } from '../helpers/tenants.js';

const app = makeApp({ serveFrontend: false });

describe('perfil da empresa', () => {
  test('GET devolve o perfil completo com versão', async () => {
    const tenant = await createTenant();
    const res = await api(app).get('/api/v1/company').set(tenant.headers('owner'));
    expect(res.status).toBe(200);
    expect(res.body.data.company).toMatchObject({
      id: tenant.company.id,
      legal_name: tenant.company.legal_name,
      status: 'active',
      version: 1,
      address: { cep: null, street: null, number: null, complement: null, district: null, city: null, state: null },
    });
  });

  test('PATCH atualiza, normaliza, incrementa a versão e audita sem guardar dado pessoal', async () => {
    const tenant = await createTenant();
    const res = await api(app)
      .patch('/api/v1/company')
      .set(tenant.headers('owner'))
      .send({
        version: 1,
        trade_name: 'Exemplo Engenharia',
        cnpj: '12.ABC.345/01DE-35',
        tax_regime: 'simples',
        email: 'Contato@Exemplo.com.br',
        phone: '(92) 3234-5678',
        address: { cep: '69050-010', street: 'Av. Djalma Batista', number: '1000', city: 'Manaus', state: 'AM' },
      });
    expect(res.status).toBe(200);
    expect(res.body.data.company).toMatchObject({
      name: 'Exemplo Engenharia',
      cnpj: '12ABC34501DE35',
      email: 'contato@exemplo.com.br',
      phone: '9232345678',
      address: { cep: '69050010', city: 'Manaus', state: 'AM' },
      version: 2,
    });

    const [event] = await auditEvents({ companyId: tenant.company.id, action: 'company.updated' });
    expect(event.actor_user_id).toBe(tenant.members.owner.user.id);
    expect(event.metadata.changes.trade_name).toEqual({ from: null, to: 'Exemplo Engenharia' });
    expect(event.metadata.changes.email).toBe(PERSONAL_DATA);
    expect(event.metadata.changes.phone).toBe(PERSONAL_DATA);
    expect(JSON.stringify(event.metadata)).not.toContain('contato@exemplo.com.br');
  });

  test('texto vazio limpa o campo', async () => {
    const tenant = await createTenant();
    await api(app).patch('/api/v1/company').set(tenant.headers('owner')).send({ version: 1, trade_name: 'Fantasia' });
    const res = await api(app).patch('/api/v1/company').set(tenant.headers('owner')).send({ version: 2, trade_name: '' });
    expect(res.body.data.company.trade_name).toBeNull();
  });

  test('versão desatualizada → 409 VERSION_CONFLICT com a versão atual', async () => {
    const tenant = await createTenant();
    await api(app).patch('/api/v1/company').set(tenant.headers('owner')).send({ version: 1, trade_name: 'Primeira' });
    const stale = await api(app).patch('/api/v1/company').set(tenant.headers('owner')).send({ version: 1, trade_name: 'Segunda' });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'VERSION_CONFLICT', details: { current_version: 2 } });
  });

  test.each([
    ['sem versão', { trade_name: 'X' }, 'version'],
    ['CNPJ inválido', { version: 1, cnpj: '11.111.111/1111-11' }, 'cnpj'],
    ['UF inexistente', { version: 1, address: { state: 'XX' } }, 'address.state'],
    ['CEP curto', { version: 1, address: { cep: '6905' } }, 'address.cep'],
    ['telefone sem DDD', { version: 1, phone: '32345678' }, 'phone'],
    ['status (não editável)', { version: 1, status: 'active' }, 'status'],
    ['company_id', { version: 1, company_id: randomUUID() }, 'company_id'],
  ])('recusa %s', async (_caso, body, field) => {
    const tenant = await createTenant();
    const res = await api(app).patch('/api/v1/company').set(tenant.headers('owner')).send(body);
    expect(res.status).toBe(422);
    expect(res.body.error.details.map((detail) => detail.field)).toContain(field);
  });
});

describe('configurações (fuso e cor da marca)', () => {
  test('lê e altera; a mudança de fuso aparece no contexto e é auditada', async () => {
    const tenant = await createTenant();
    expect((await api(app).get('/api/v1/company/settings').set(tenant.headers('owner'))).body.data.settings).toEqual({
      timezone: 'America/Sao_Paulo',
      primary_color: '#1d4ed8',
      upcoming_window_days: 7,
    });

    const res = await api(app)
      .patch('/api/v1/company/settings')
      .set(tenant.headers('owner'))
      .send({ timezone: 'America/Manaus', primary_color: '#0F766E' });
    expect(res.body.data.settings).toEqual({ timezone: 'America/Manaus', primary_color: '#0f766e', upcoming_window_days: 7 });

    const ctx = await api(app).get('/api/v1/company/context').set(tenant.headers('owner'));
    expect(ctx.body.data.company.timezone).toBe('America/Manaus');
    expect(ctx.body.data.branding.primary_color).toBe('#0f766e');

    const [event] = await auditEvents({ companyId: tenant.company.id, action: 'settings.updated' });
    expect(event.metadata.changes.timezone).toEqual({ from: 'America/Sao_Paulo', to: 'America/Manaus' });
  });

  test('cor fora de #RRGGBB (ex.: tentativa de CSS) → 422', async () => {
    const tenant = await createTenant();
    for (const color of ['red', '#fff', 'url(javascript:alert(1))', '#1d4ed8;background:red']) {
      const res = await api(app).patch('/api/v1/company/settings').set(tenant.headers('owner')).send({ primary_color: color });
      expect(res.status).toBe(422);
    }
  });
});

describe('contatos e responsáveis', () => {
  test('criar, listar, editar e excluir (soft delete), com auditoria sem dado pessoal', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');

    const created = await api(app)
      .post('/api/v1/company/contacts')
      .set(headers)
      .send({ name: 'Rita Lopes', role_title: 'Sócia', email: 'rita@exemplo.com.br', phone: '92987654321', is_responsible: true });
    expect(created.status).toBe(201);
    const { contact } = created.body.data;
    expect(contact).toMatchObject({ name: 'Rita Lopes', is_responsible: true, phone: '92987654321' });

    const list = await api(app).get('/api/v1/company/contacts').set(headers);
    expect(list.body.data.contacts).toHaveLength(1);

    const updated = await api(app).patch(`/api/v1/company/contacts/${contact.id}`).set(headers).send({ role_title: 'Diretora', email: '' });
    expect(updated.body.data.contact).toMatchObject({ role_title: 'Diretora', email: null });

    const removed = await api(app).delete(`/api/v1/company/contacts/${contact.id}`).set(headers);
    expect(removed.status).toBe(204);
    expect((await api(app).get('/api/v1/company/contacts').set(headers)).body.data.contacts).toHaveLength(0);
    const { rows } = await pool.query('SELECT deleted_at FROM company_contacts WHERE id = $1', [contact.id]);
    expect(rows[0].deleted_at).toBeInstanceOf(Date);

    const [update] = await auditEvents({ companyId: tenant.company.id, action: 'company_contact.updated' });
    expect(update.metadata.changes).toEqual({ role_title: { from: 'Sócia', to: 'Diretora' }, email: PERSONAL_DATA });
    expect(await auditEvents({ companyId: tenant.company.id, action: 'company_contact.deleted' })).toHaveLength(1);
  });

  test('contato excluído ou inexistente → 404; id malformado → 422', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    expect((await api(app).patch(`/api/v1/company/contacts/${randomUUID()}`).set(headers).send({ name: 'X' })).status).toBe(404);
    expect((await api(app).delete('/api/v1/company/contacts/123').set(headers)).status).toBe(422);
  });
});

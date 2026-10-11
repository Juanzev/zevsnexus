import { randomUUID } from 'node:crypto';
import { PERSONAL_DATA } from '../../src/modules/audit/audit.service.js';
import { fileKey } from '../../src/modules/storage/storage.keys.js';
import { pool } from '../../src/shared/db.js';
import { addDays, todayIn } from '../../src/shared/timezones.js';
import { createDocument, devStoragePath, FIXTURES, memoryStorage, uploadFile } from '../helpers/documents.js';
import { api, makeApp } from '../helpers/http.js';
import { auditEvents, createTenant } from '../helpers/tenants.js';

const app = makeApp({ serveFrontend: false });

function get(tenant, path, role = 'owner') {
  return api(app).get(`/api/v1${path}`).set(tenant.headers(role));
}

function send(tenant, method, path, body, role = 'owner') {
  return api(app)[method](`/api/v1${path}`).set(tenant.headers(role)).send(body ?? {});
}

async function folder(tenant, name, parentId = null) {
  const res = await send(tenant, 'post', '/folders', { name, parent_id: parentId });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.data.folder;
}

describe('lista de documentos', () => {
  test('filtros por pasta, raiz, tipo, tag, busca sem acento e ordenação no servidor', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const contracts = await folder(tenant, 'Contratos');
    const type = (await send(tenant, 'post', '/document-types', { name: 'Certidão' })).body.data.document_type;

    const a = await createDocument(app, headers, { filename: 'Certidão negativa.pdf', folder_id: contracts.id, document_type_id: type.id });
    const b = await createDocument(app, headers, { filename: 'Planilha de custos.xlsx', content: FIXTURES.xlsx(), tags: ['Orçamento'] });
    const c = await createDocument(app, headers, { filename: 'Zebra.png', content: FIXTURES.png(), title: 'Foto do canteiro' });

    const ids = (res) => res.body.data.documents.map((doc) => doc.id);
    expect(ids(await get(tenant, `/documents?folder=${contracts.id}`))).toEqual([a.id]);
    expect(ids(await get(tenant, '/documents?folder=root')).sort()).toEqual([b.id, c.id].sort());
    expect(ids(await get(tenant, `/documents?type_id=${type.id}`))).toEqual([a.id]);
    expect(ids(await get(tenant, '/documents?q=certidao'))).toEqual([a.id]);
    expect(ids(await get(tenant, '/documents?q=orcamento'))).toEqual([b.id]); // pela tag
    expect(ids(await get(tenant, '/documents?q=%25'))).toEqual([]); // curinga é literal

    const byTitle = await get(tenant, '/documents?sort=title');
    expect(byTitle.body.data.documents.map((doc) => doc.title)).toEqual(['Certidão negativa', 'Foto do canteiro', 'Planilha de custos']);
    expect(byTitle.body.meta).toEqual({ page: 1, limit: 20, total: 3 });

    const paged = await get(tenant, '/documents?sort=title&limit=1&page=2');
    expect(paged.body.data.documents.map((doc) => doc.title)).toEqual(['Foto do canteiro']);
    expect(paged.body.meta.total).toBe(3);

    const tag = (await get(tenant, '/tags?q=orc')).body.data.tags[0];
    expect(tag).toMatchObject({ name: 'Orçamento', document_count: 1 });
    expect(ids(await get(tenant, `/documents?tag_id=${tag.id}`))).toEqual([b.id]);
  });

  test('ordenação e filtros fora da allowlist são recusados', async () => {
    const tenant = await createTenant();
    expect((await get(tenant, '/documents?sort=title;DROP TABLE documents')).status).toBe(422);
    expect((await get(tenant, '/documents?folder=../x')).status).toBe(422);
    expect((await get(tenant, '/documents?company_id=x')).status).toBe(422);
    expect((await get(tenant, '/documents?limit=1000')).status).toBe(422);
  });

  test('"Vencendo" calcula no fuso da empresa: vencidos e até 30 dias', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const { rows } = await pool.query('SELECT timezone FROM companies WHERE id = $1', [tenant.company.id]);
    const today = todayIn(rows[0].timezone);
    const expired = await createDocument(app, headers, { expires_on: addDays(today, -1) });
    const soon = await createDocument(app, headers, { expires_on: addDays(today, 30) });
    await createDocument(app, headers, { expires_on: addDays(today, 31) });
    await createDocument(app, headers);

    const res = await get(tenant, '/documents?expiring=true&sort=expires_on');
    expect(res.body.data.documents.map((doc) => [doc.id, doc.expiry_status])).toEqual([
      [expired.id, 'expired'],
      [soon.id, 'expiring'],
    ]);
  });

  test('arquivados e lixeira saem da lista padrão', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const archived = await createDocument(app, headers);
    const trashed = await createDocument(app, headers);
    const active = await createDocument(app, headers);
    await send(tenant, 'post', `/documents/${archived.id}/archive`);
    await send(tenant, 'delete', `/documents/${trashed.id}`);

    const ids = (res) => res.body.data.documents.map((doc) => doc.id);
    expect(ids(await get(tenant, '/documents'))).toEqual([active.id]);
    expect(ids(await get(tenant, '/documents?archived=true'))).toEqual([archived.id]);
    expect(ids(await get(tenant, '/trash'))).toEqual([trashed.id]);
  });
});

describe('detalhe, edição e movimentação', () => {
  test('GET traz caminho da pasta e versões', async () => {
    const tenant = await createTenant();
    const parent = await folder(tenant, 'Financeiro');
    const child = await folder(tenant, 'Comprovantes', parent.id);
    const doc = await createDocument(app, tenant.headers('owner'), { folder_id: child.id });

    const res = await get(tenant, `/documents/${doc.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.document.path.map((item) => item.name)).toEqual(['Financeiro', 'Comprovantes']);
    expect(res.body.data.document.versions).toHaveLength(1);
    expect(res.body.data.document.versions[0]).toMatchObject({ number: 1, file: { extension: 'pdf' } });
  });

  test('PATCH com versão: altera, audita sem dado pessoal e recusa versão velha', async () => {
    const tenant = await createTenant();
    const doc = await createDocument(app, tenant.headers('owner'));
    const res = await send(tenant, 'patch', `/documents/${doc.id}`, {
      version: 1,
      title: 'Contrato com João',
      description: 'Assinado em cartório',
      expires_on: '2027-01-31',
      tags: ['Jurídico'],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.document).toMatchObject({ title: 'Contrato com João', expires_on: '2027-01-31', tags: ['Jurídico'], version: 2 });

    const [event] = await auditEvents({ companyId: tenant.company.id, action: 'document.updated', entityId: doc.id });
    expect(event.metadata.changes).toEqual({
      title: PERSONAL_DATA,
      description: PERSONAL_DATA,
      expires_on: { from: null, to: '2027-01-31' },
      tags: PERSONAL_DATA,
    });

    const stale = await send(tenant, 'patch', `/documents/${doc.id}`, { version: 1, title: 'Outro' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');

    const bad = await send(tenant, 'patch', `/documents/${doc.id}`, { version: 2, expires_on: '2027-02-30' });
    expect(bad.status).toBe(422);
  });

  test('mover para pasta e de volta para a raiz', async () => {
    const tenant = await createTenant();
    const target = await folder(tenant, 'Contratos');
    const doc = await createDocument(app, tenant.headers('owner'));
    const moved = await send(tenant, 'post', `/documents/${doc.id}/move`, { folder_id: target.id });
    expect(moved.body.data.document.folder_id).toBe(target.id);
    const back = await send(tenant, 'post', `/documents/${doc.id}/move`, { folder_id: null });
    expect(back.body.data.document.folder_id).toBeNull();
    const events = await auditEvents({ companyId: tenant.company.id, action: 'document.moved', entityId: doc.id });
    expect(events.map((event) => event.metadata)).toEqual([
      { from: null, to: target.id },
      { from: target.id, to: null },
    ]);
  });

  test('tipo arquivado não classifica documento novo', async () => {
    const tenant = await createTenant();
    const type = (await send(tenant, 'post', '/document-types', { name: 'Antigo' })).body.data.document_type;
    await send(tenant, 'post', `/document-types/${type.id}/archive`);
    const doc = await createDocument(app, tenant.headers('owner'));
    const res = await send(tenant, 'patch', `/documents/${doc.id}`, { version: 1, document_type_id: type.id });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DOCUMENT_TYPE_NOT_FOUND');
  });
});

describe('versões e download', () => {
  test('nova versão, restaurar versão antiga (sem reescrever o histórico) e baixar uma versão', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const doc = await createDocument(app, headers, { filename: 'Projeto.pdf' });

    const fileId = await uploadFile(app, headers, { filename: 'Projeto revisado.pdf' });
    const added = await api(app)
      .post(`/api/v1/documents/${doc.id}/versions`)
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ file_id: fileId, comment: 'Revisão B' });
    expect(added.status).toBe(201);
    expect(added.body.data.document).toMatchObject({ current_version: 2, file: { original_name: 'Projeto revisado.pdf' } });

    const restored = await send(tenant, 'post', `/documents/${doc.id}/versions/1/restore`);
    expect(restored.status).toBe(201);
    expect(restored.body.data.document).toMatchObject({ current_version: 3, file: { original_name: 'Projeto.pdf' } });
    const detail = await get(tenant, `/documents/${doc.id}`);
    expect(detail.body.data.document.versions.map((v) => [v.number, v.comment])).toEqual([
      [3, 'Restaurada da versão 1'],
      [2, 'Revisão B'],
      [1, null],
    ]);
    expect((await send(tenant, 'post', `/documents/${doc.id}/versions/3/restore`)).body.error.code).toBe('VERSION_IS_CURRENT');
    expect((await send(tenant, 'post', `/documents/${doc.id}/versions/9/restore`)).status).toBe(404);

    // Restaurar não consome cota de novo: são 2 arquivos.
    const { rows } = await pool.query('SELECT file_count FROM company_usage WHERE company_id = $1', [tenant.company.id]);
    expect(rows[0].file_count).toBe(2);

    const url = await send(tenant, 'post', `/documents/${doc.id}/download-url`, { version: 2, disposition: 'inline' });
    expect(url.status).toBe(200);
    expect(url.body.data).toMatchObject({ disposition: 'inline' });
    const file = await api(app).get(devStoragePath(url.body.data.url));
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toMatch(/^inline; filename="Projeto revisado.pdf"/);
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['content-security-policy']).toMatch(/script-src 'none'/);
    expect(file.body).toEqual(await memoryStorage().read(fileKey(tenant.company.id, fileId)));

    const [event] = await auditEvents({ companyId: tenant.company.id, action: 'document.downloaded', entityId: doc.id });
    expect(event.metadata).toEqual({ version_number: 2, disposition: 'inline' });
  });

  test('inline só para PDF e imagem; o resto baixa como anexo', async () => {
    const tenant = await createTenant();
    const doc = await createDocument(app, tenant.headers('owner'), { filename: 'nota.xml', content: FIXTURES.xml() });
    const res = await send(tenant, 'post', `/documents/${doc.id}/download-url`, { disposition: 'inline' });
    expect(res.body.data.disposition).toBe('attachment');
    const file = await api(app).get(devStoragePath(res.body.data.url));
    expect(file.headers['content-disposition']).toMatch(/^attachment;/);
    expect(file.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(file.headers['content-type']).toMatch(/^application\/xml/);
  });

  test('nova versão em documento da lixeira é recusada', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const doc = await createDocument(app, headers);
    await send(tenant, 'delete', `/documents/${doc.id}`);
    const fileId = await uploadFile(app, headers);
    const res = await api(app)
      .post(`/api/v1/documents/${doc.id}/versions`)
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ file_id: fileId });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DOCUMENT_IN_TRASH');
  });
});

describe('estados, favoritos e histórico', () => {
  test('arquivar, lixeira e restaurar (volta para a raiz se a pasta sumiu)', async () => {
    const tenant = await createTenant();
    const box = await folder(tenant, 'Temporária');
    const doc = await createDocument(app, tenant.headers('owner'), { folder_id: box.id });

    expect((await send(tenant, 'post', `/documents/${doc.id}/archive`)).body.data.document.archived_at).not.toBeNull();
    expect((await send(tenant, 'post', `/documents/${doc.id}/unarchive`)).body.data.document.archived_at).toBeNull();

    expect((await send(tenant, 'delete', `/documents/${doc.id}`)).status).toBe(204);
    expect((await send(tenant, 'delete', `/folders/${box.id}`)).status).toBe(204); // vazia: o documento está na lixeira
    const restored = await send(tenant, 'post', `/trash/${doc.id}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.data.document).toMatchObject({ deleted_at: null, folder_id: null });
    const [event] = await auditEvents({ companyId: tenant.company.id, action: 'document.restored', entityId: doc.id });
    expect(event.metadata).toEqual({ folder_id: null, moved_to_root: true });

    expect((await send(tenant, 'post', `/trash/${doc.id}/restore`)).status).toBe(404); // não está mais na lixeira
  });

  test('favorito é por membro', async () => {
    const tenant = await createTenant({ roles: ['owner', 'viewer'] });
    const doc = await createDocument(app, tenant.headers('owner'));
    expect((await send(tenant, 'put', `/documents/${doc.id}/favorite`, {}, 'viewer')).status).toBe(204);
    expect((await send(tenant, 'put', `/documents/${doc.id}/favorite`, {}, 'viewer')).status).toBe(204);

    const ids = async (role) => (await get(tenant, '/documents?favorites=true', role)).body.data.documents.map((d) => d.id);
    expect(await ids('viewer')).toEqual([doc.id]);
    expect(await ids('owner')).toEqual([]);
    await send(tenant, 'delete', `/documents/${doc.id}/favorite`, {}, 'viewer');
    expect(await ids('viewer')).toEqual([]);
  });

  test('histórico mostra quem fez o quê, sem dado pessoal', async () => {
    const tenant = await createTenant();
    const doc = await createDocument(app, tenant.headers('owner'));
    await send(tenant, 'patch', `/documents/${doc.id}`, { version: 1, title: 'Nome de pessoa' });
    await send(tenant, 'post', `/documents/${doc.id}/download-url`, {});

    const res = await get(tenant, `/documents/${doc.id}/history`);
    expect(res.status).toBe(200);
    const events = res.body.data.events;
    expect(events.map((event) => event.action)).toEqual(['document.downloaded', 'document.updated', 'document.uploaded']);
    expect(events[1]).toMatchObject({ actor: { name: tenant.members.owner.user.name }, changed_fields: ['title'] });
    expect(JSON.stringify(events)).not.toContain('Nome de pessoa');
  });
});

describe('pastas', () => {
  test('nome único entre irmãs, sem / e até 8 níveis', async () => {
    const tenant = await createTenant();
    await folder(tenant, 'Obras');
    const dup = await send(tenant, 'post', '/folders', { name: 'OBRAS' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('FOLDER_NAME_TAKEN');
    expect((await send(tenant, 'post', '/folders', { name: 'a/b' })).status).toBe(422);

    let parent = null;
    for (let level = 1; level <= 8; level += 1) parent = await folder(tenant, `Nível ${level}`, parent?.id ?? null);
    const deep = await send(tenant, 'post', '/folders', { name: 'Nível 9', parent_id: parent.id });
    expect(deep.status).toBe(422);
    expect(deep.body.error.code).toBe('FOLDER_TOO_DEEP');
  });

  test('mover: sem ciclo, sem passar de 8 níveis, com auditoria', async () => {
    const tenant = await createTenant();
    const a = await folder(tenant, 'A');
    const b = await folder(tenant, 'B', a.id);
    const c = await folder(tenant, 'C', b.id);

    const cycle = await send(tenant, 'post', `/folders/${a.id}/move`, { parent_id: c.id });
    expect(cycle.status).toBe(422);
    expect(cycle.body.error.code).toBe('FOLDER_CYCLE');
    expect((await send(tenant, 'post', `/folders/${a.id}/move`, { parent_id: a.id })).body.error.code).toBe('FOLDER_CYCLE');

    const moved = await send(tenant, 'post', `/folders/${c.id}/move`, { parent_id: null });
    expect(moved.body.data.folder.parent_id).toBeNull();

    // Corrente de 6 níveis + subárvore de 3 (A › B › X) passaria de 8.
    let chain = null;
    for (let level = 1; level <= 6; level += 1) chain = await folder(tenant, `Fundo ${level}`, chain?.id ?? null);
    await folder(tenant, 'X', b.id);
    const tooDeep = await send(tenant, 'post', `/folders/${a.id}/move`, { parent_id: chain.id });
    expect(tooDeep.body.error.code).toBe('FOLDER_TOO_DEEP');

    const [event] = await auditEvents({ companyId: tenant.company.id, action: 'folder.moved', entityId: c.id });
    expect(event.metadata).toEqual({ from: b.id, to: null });
  });

  test('só exclui pasta vazia; pasta padrão excluída limpa a configuração', async () => {
    const tenant = await createTenant();
    const parent = await folder(tenant, 'Cheia');
    await folder(tenant, 'Filha', parent.id);
    const blocked = await send(tenant, 'delete', `/folders/${parent.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('FOLDER_NOT_EMPTY');

    const receipts = await folder(tenant, 'Comprovantes');
    await pool.query('UPDATE company_settings SET receipts_folder_id = $2 WHERE company_id = $1', [tenant.company.id, receipts.id]);
    expect((await send(tenant, 'delete', `/folders/${receipts.id}`)).status).toBe(204);
    const { rows } = await pool.query('SELECT receipts_folder_id FROM company_settings WHERE company_id = $1', [tenant.company.id]);
    expect(rows[0].receipts_folder_id).toBeNull();
    expect((await get(tenant, `/folders/${receipts.id}`)).status).toBe(404);
  });

  test('lista plana com contagem de documentos e renomear', async () => {
    const tenant = await createTenant();
    const box = await folder(tenant, 'Caixa');
    await createDocument(app, tenant.headers('owner'), { folder_id: box.id });
    const renamed = await send(tenant, 'patch', `/folders/${box.id}`, { name: 'Caixa 2026' });
    expect(renamed.body.data.folder.name).toBe('Caixa 2026');
    const list = await get(tenant, '/folders');
    expect(list.body.data.folders).toEqual([expect.objectContaining({ id: box.id, name: 'Caixa 2026', document_count: 1 })]);
  });
});

describe('tipos de documento', () => {
  test('criar, renomear, nome único entre ativos e arquivar', async () => {
    const tenant = await createTenant();
    const type = (await send(tenant, 'post', '/document-types', { name: 'Alvará' })).body.data.document_type;
    expect((await send(tenant, 'post', '/document-types', { name: 'alvará' })).status).toBe(409);
    expect((await send(tenant, 'patch', `/document-types/${type.id}`, { name: 'Alvará de obra' })).body.data.document_type.name).toBe(
      'Alvará de obra',
    );
    await send(tenant, 'post', `/document-types/${type.id}/archive`);
    expect((await get(tenant, '/document-types')).body.data.document_types).toEqual([]);
    expect((await get(tenant, '/document-types?include_archived=true')).body.data.document_types).toHaveLength(1);
    // Arquivado libera o nome.
    expect((await send(tenant, 'post', '/document-types', { name: 'Alvará de obra' })).status).toBe(201);
  });
});

describe('empresa nova (onboarding)', () => {
  test('nasce com pastas sugeridas, tipos e configurações apontando para as pastas padrão', async () => {
    const { createUser } = await import('../helpers/users.js');
    const { signAccessToken } = await import('../../src/shared/security/tokens.js');
    const user = await createUser();
    const res = await api(app)
      .post('/api/v1/companies')
      .set({ Authorization: `Bearer ${signAccessToken(user.id)}` })
      .set('Idempotency-Key', randomUUID())
      .send({ legal_name: 'Empresa com Pastas' });
    expect(res.status).toBe(201);
    const companyId = res.body.data.company.id;

    const { rows: folders } = await pool.query(
      `SELECT f.name, p.name AS parent FROM folders f LEFT JOIN folders p ON p.id = f.parent_id
        WHERE f.company_id = $1 ORDER BY f.name`,
      [companyId],
    );
    expect(folders).toEqual(
      expect.arrayContaining([
        { name: 'Empresa', parent: null },
        { name: 'Comprovantes', parent: 'Financeiro' },
        { name: 'Notas fiscais', parent: null },
        { name: 'Planilhas', parent: null },
        { name: 'Outros', parent: null },
      ]),
    );
    expect(folders).toHaveLength(8);

    const { rows: types } = await pool.query('SELECT count(*) AS total FROM document_types WHERE company_id = $1', [companyId]);
    expect(types[0].total).toBe(8);

    const { rows: settings } = await pool.query(
      `SELECT r.name AS receipts, i.name AS invoices, s.name AS spreadsheets, c.name AS company
         FROM company_settings cs
         JOIN folders r ON r.id = cs.receipts_folder_id
         JOIN folders i ON i.id = cs.invoices_folder_id
         JOIN folders s ON s.id = cs.spreadsheets_folder_id
         JOIN folders c ON c.id = cs.company_folder_id
        WHERE cs.company_id = $1`,
      [companyId],
    );
    expect(settings[0]).toEqual({ receipts: 'Comprovantes', invoices: 'Notas fiscais', spreadsheets: 'Planilhas', company: 'Empresa' });
  });
});

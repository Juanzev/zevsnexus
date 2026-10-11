// Isolamento A × B (CLAUDE.md, checklist por rota): recurso de outra empresa responde 404, igual a
// inexistente, e nunca muda. Referência de outra empresa no corpo responde 422.
import { randomUUID } from 'node:crypto';
import { pool } from '../../src/shared/db.js';
import { createDocument, postDocument, uploadFile } from '../helpers/documents.js';
import { api, makeApp } from '../helpers/http.js';
import { createTenant } from '../helpers/tenants.js';

const app = makeApp({ serveFrontend: false });

let a;
let b;
let docB;
let folderB;
let typeB;

beforeAll(async () => {
  a = await createTenant();
  b = await createTenant();
  docB = await createDocument(app, b.headers('owner'), { filename: 'Segredo B.pdf' });
  folderB = (await api(app).post('/api/v1/folders').set(b.headers('owner')).send({ name: 'Pasta B' })).body.data.folder;
  typeB = (await api(app).post('/api/v1/document-types').set(b.headers('owner')).send({ name: 'Tipo B' })).body.data.document_type;
});

function asA(method, path, body) {
  const req = api(app)[method](`/api/v1${path}`).set(a.headers('owner')).set('Idempotency-Key', randomUUID());
  return body === undefined ? req : req.send(body);
}

async function documentB() {
  const { rows } = await pool.query(
    'SELECT title, folder_id, archived_at, deleted_at, version FROM documents WHERE id = $1',
    [docB.id],
  );
  return rows[0];
}

describe('documento de outra empresa → 404 e nada muda', () => {
  test.each([
    ['get', () => `/documents/${docB.id}`, undefined],
    ['get', () => `/documents/${docB.id}/history`, undefined],
    ['patch', () => `/documents/${docB.id}`, { version: 1, title: 'Invadido' }],
    ['post', () => `/documents/${docB.id}/move`, { folder_id: null }],
    ['post', () => `/documents/${docB.id}/archive`, {}],
    ['post', () => `/documents/${docB.id}/unarchive`, {}],
    ['delete', () => `/documents/${docB.id}`, {}],
    ['post', () => `/documents/${docB.id}/download-url`, {}],
    ['post', () => `/documents/${docB.id}/versions/1/restore`, {}],
    ['put', () => `/documents/${docB.id}/favorite`, {}],
    ['delete', () => `/documents/${docB.id}/favorite`, {}],
    ['post', () => `/trash/${docB.id}/restore`, {}],
  ])('%s %s', async (method, path, body) => {
    const before = await documentB();
    const res = await asA(method, path(), body);
    expect(res.status).toBe(404);
    expect(await documentB()).toEqual(before);
  });

  test('nova versão em documento de B: 404 antes de tocar no arquivo de A', async () => {
    const fileId = await uploadFile(app, a.headers('owner'));
    const res = await asA('post', `/documents/${docB.id}/versions`, { file_id: fileId });
    expect(res.status).toBe(404);
    const { rows } = await pool.query('SELECT status FROM files WHERE id = $1', [fileId]);
    expect(rows[0].status).toBe('pending');
  });

  test('listas e busca de A não mostram nada de B', async () => {
    const list = await asA('get', '/documents?q=segredo');
    expect(list.body.data.documents).toEqual([]);
    expect((await asA('get', `/documents?folder=${folderB.id}`)).body.data.documents).toEqual([]);
    expect((await asA('get', '/folders')).body.data.folders.map((f) => f.id)).not.toContain(folderB.id);
    expect((await asA('get', '/document-types')).body.data.document_types.map((t) => t.id)).not.toContain(typeB.id);
    expect((await asA('get', '/tags')).body.data.tags).toEqual([]);
  });
});

describe('pasta e tipo de outra empresa', () => {
  test.each([
    ['get', () => `/folders/${folderB.id}`, undefined],
    ['patch', () => `/folders/${folderB.id}`, { name: 'Invadida' }],
    ['post', () => `/folders/${folderB.id}/move`, { parent_id: null }],
    ['delete', () => `/folders/${folderB.id}`, {}],
    ['patch', () => `/document-types/${typeB.id}`, { name: 'Invadido' }],
    ['post', () => `/document-types/${typeB.id}/archive`, {}],
  ])('%s %s → 404', async (method, path, body) => {
    expect((await asA(method, path(), body)).status).toBe(404);
  });

  test('como referência no corpo → 422', async () => {
    const fileId = await uploadFile(app, a.headers('owner'));
    const withFolder = await postDocument(app, a.headers('owner'), { file_id: fileId, folder_id: folderB.id });
    expect(withFolder.status).toBe(422);
    const withType = await postDocument(app, a.headers('owner'), { file_id: fileId, document_type_id: typeB.id });
    expect(withType.status).toBe(422);
    expect(withType.body.error.code).toBe('DOCUMENT_TYPE_NOT_FOUND');

    const docA = await createDocument(app, a.headers('owner'));
    expect((await asA('post', `/documents/${docA.id}/move`, { folder_id: folderB.id })).status).toBe(422);
    expect((await asA('post', '/folders', { name: 'Filha', parent_id: folderB.id })).status).toBe(422);
  });
});

describe('arquivo de outra empresa', () => {
  test('file_id de B não confirma em A (e continua pendente em B)', async () => {
    const fileB = await uploadFile(app, b.headers('owner'));
    const res = await postDocument(app, a.headers('owner'), { file_id: fileB });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('FILE_NOT_FOUND');
    const { rows } = await pool.query('SELECT status FROM files WHERE id = $1', [fileB]);
    expect(rows[0].status).toBe('pending');
  });

  test('X-Company-Id de B com token de A → 404 da empresa', async () => {
    const res = await api(app)
      .get(`/api/v1/documents/${docB.id}`)
      .set({ Authorization: a.headers('owner').Authorization, 'X-Company-Id': b.company.id });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COMPANY_NOT_FOUND');
  });
});

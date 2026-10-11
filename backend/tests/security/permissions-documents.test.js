// Permissões da Central de Documentos (D10): documents.view para todos os papéis; documents.manage
// para todos menos Visualização. A lixeira é de quem gerencia.
import { randomUUID } from 'node:crypto';
import { createDocument } from '../helpers/documents.js';
import { api, makeApp } from '../helpers/http.js';
import { createTenant } from '../helpers/tenants.js';

const app = makeApp({ serveFrontend: false });
const ROLES = ['owner', 'admin', 'finance', 'assistant', 'viewer'];

let tenant;
let doc;
let trashed;
let folderId;

beforeAll(async () => {
  tenant = await createTenant({ roles: ROLES });
  doc = await createDocument(app, tenant.headers('owner'));
  trashed = await createDocument(app, tenant.headers('owner'));
  await api(app).delete(`/api/v1/documents/${trashed.id}`).set(tenant.headers('owner')).send({});
  folderId = (await api(app).post('/api/v1/folders').set(tenant.headers('owner')).send({ name: 'Base' })).body.data.folder.id;
});

function call(role, method, path, body = {}) {
  return api(app)[method](`/api/v1${path}`).set(tenant.headers(role)).set('Idempotency-Key', randomUUID()).send(body);
}

describe('leitura: todos os papéis', () => {
  test.each(ROLES)('%s lista, abre, vê o histórico e baixa', async (role) => {
    expect((await call(role, 'get', '/documents')).status).toBe(200);
    expect((await call(role, 'get', `/documents/${doc.id}`)).status).toBe(200);
    expect((await call(role, 'get', `/documents/${doc.id}/history`)).status).toBe(200);
    expect((await call(role, 'post', `/documents/${doc.id}/download-url`)).status).toBe(200);
    expect((await call(role, 'get', '/folders')).status).toBe(200);
    expect((await call(role, 'put', `/documents/${doc.id}/favorite`)).status).toBe(204);
  });
});

describe('Visualização não altera nada', () => {
  test.each([
    ['post', '/files/upload-intents', { filename: 'a.pdf', size_bytes: 10 }],
    ['patch', () => `/documents/${doc.id}`, { version: 1, title: 'x' }],
    ['post', () => `/documents/${doc.id}/move`, { folder_id: null }],
    ['post', () => `/documents/${doc.id}/archive`, {}],
    ['delete', () => `/documents/${doc.id}`, {}],
    ['post', () => `/documents/${doc.id}/versions/1/restore`, {}],
    ['post', '/folders', { name: 'Nova' }],
    ['patch', () => `/folders/${folderId}`, { name: 'Outra' }],
    ['delete', () => `/folders/${folderId}`, {}],
    ['post', '/document-types', { name: 'Novo' }],
    ['get', '/trash', undefined],
    ['post', () => `/trash/${trashed.id}/restore`, {}],
  ])('%s %s → 403', async (method, path, body) => {
    const res = await call('viewer', method, typeof path === 'function' ? path() : path, body);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });

  test('documento da lixeira não aparece nem por id para quem não gerencia', async () => {
    expect((await call('viewer', 'get', `/documents/${trashed.id}`)).status).toBe(404);
    expect((await call('viewer', 'post', `/documents/${trashed.id}/download-url`)).status).toBe(404);
    expect((await call('assistant', 'get', `/documents/${trashed.id}`)).status).toBe(200);
  });
});

describe('quem gerencia', () => {
  test.each(['owner', 'admin', 'finance', 'assistant'])('%s cria pasta e vê a lixeira', async (role) => {
    expect((await call(role, 'post', '/folders', { name: `Pasta ${role}` })).status).toBe(201);
    expect((await call(role, 'get', '/trash')).status).toBe(200);
  });
});

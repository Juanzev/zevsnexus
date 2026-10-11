// Permissões das planilhas (D10): spreadsheets.view para todos os papéis; spreadsheets.manage para
// todos menos Visualização. A prévia é leitura.
import { randomUUID } from 'node:crypto';
import { createDocument } from '../helpers/documents.js';
import { api, makeApp } from '../helpers/http.js';
import { ghost, GHOSTS } from '../helpers/spreadsheets.js';
import { createTenant } from '../helpers/tenants.js';

const app = makeApp({ serveFrontend: false });
const ROLES = ['owner', 'admin', 'finance', 'assistant', 'viewer'];

let tenant;
let sheet;

beforeAll(async () => {
  tenant = await createTenant({ roles: ROLES });
  sheet = await createDocument(app, tenant.headers('owner'), { filename: GHOSTS.diaristas, content: ghost(GHOSTS.diaristas) });
});

function call(role, method, path, body = {}) {
  return api(app)[method](`/api/v1${path}`).set(tenant.headers(role)).set('Idempotency-Key', randomUUID()).send(body);
}

describe('leitura: todos os papéis', () => {
  test.each(ROLES)('%s lista, abre e vê a prévia', async (role) => {
    expect((await call(role, 'get', '/spreadsheets?view=all')).status).toBe(200);
    expect((await call(role, 'get', `/spreadsheets/${sheet.id}`)).status).toBe(200);
    expect((await call(role, 'get', `/spreadsheets/${sheet.id}/preview`)).status).toBe(200);
  });
});

describe('Visualização não altera nada', () => {
  test.each([
    ['patch', () => `/spreadsheets/${sheet.id}`, () => ({ in_use: true })],
    ['post', () => '/spreadsheets/bulk', () => ({ ids: [sheet.id], action: 'mark_in_use' })],
    ['post', () => '/spreadsheets/bulk', () => ({ ids: [sheet.id], action: 'archive' })],
  ])('%s %s → 403', async (method, path, body) => {
    const res = await call('viewer', method, path(), body());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });
});

describe('quem gerencia', () => {
  test.each(['owner', 'admin', 'finance', 'assistant'])('%s marca em uso e muda o ano', async (role) => {
    expect((await call(role, 'patch', `/spreadsheets/${sheet.id}`, { in_use: true })).status).toBe(200);
    const bulk = await call(role, 'post', '/spreadsheets/bulk', { ids: [sheet.id], action: 'set_year', reference_year: 2025 });
    expect(bulk.status).toBe(200);
    expect(bulk.body.data.updated).toBe(1);
  });
});

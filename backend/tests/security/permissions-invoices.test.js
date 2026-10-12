// Permissões das notas (D10): invoices.view para todos os papéis; invoices.manage para todos menos
// Visualização (registrar, emitir, receber, cancelar, arquivar e anexar).
import { randomUUID } from 'node:crypto';
import { api, makeApp } from '../helpers/http.js';
import { createInvoice, createIssuedInvoice } from '../helpers/invoices.js';
import { createTenant } from '../helpers/tenants.js';

const app = makeApp({ serveFrontend: false });
const ROLES = ['owner', 'admin', 'finance', 'assistant', 'viewer'];

let tenant;
let invoice;

beforeAll(async () => {
  tenant = await createTenant({ roles: ROLES });
  invoice = await createIssuedInvoice(app, tenant.headers('owner'));
});

function call(role, method, path, body = {}) {
  return api(app)[method](`/api/v1${path}`).set(tenant.headers(role)).set('Idempotency-Key', randomUUID()).send(body);
}

describe('leitura: todos os papéis', () => {
  test.each(ROLES)('%s lista, abre e vê o histórico', async (role) => {
    expect((await call(role, 'get', '/invoices?tab=all')).status).toBe(200);
    expect((await call(role, 'get', `/invoices/${invoice.id}`)).status).toBe(200);
    expect((await call(role, 'get', `/invoices/${invoice.id}/history`)).status).toBe(200);
  });
});

describe('Visualização não altera nada', () => {
  test.each([
    ['post', () => '/invoices', () => ({ description: 'x', gross_amount_cents: 1 })],
    ['patch', () => `/invoices/${invoice.id}`, () => ({ version: invoice.version, notes: 'x' })],
    ['post', () => `/invoices/${invoice.id}/issue`, () => ({})],
    ['post', () => `/invoices/${invoice.id}/mark-paid`, () => ({ received_on: '2026-10-05' })],
    ['post', () => `/invoices/${invoice.id}/unmark-paid`, () => ({ reason: 'x' })],
    ['post', () => `/invoices/${invoice.id}/cancel`, () => ({ reason: 'x' })],
    ['post', () => `/invoices/${invoice.id}/archive`, () => ({})],
    ['post', () => `/invoices/${invoice.id}/documents`, () => ({ document_id: randomUUID(), role: 'pdf' })],
  ])('%s %s → 403', async (method, path, body) => {
    const res = await call('viewer', method, path(), body());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });
});

describe('quem gerencia', () => {
  test.each(['owner', 'admin', 'finance', 'assistant'])('%s registra, emite e recebe', async (role) => {
    const created = await createInvoice(app, tenant.headers(role));
    const issued = await call(role, 'post', `/invoices/${created.id}/issue`, { number: `${role}-1`, issue_date: '2026-10-01' });
    expect(issued.status).toBe(200);
    expect((await call(role, 'post', `/invoices/${created.id}/mark-paid`, { received_on: '2026-10-02' })).status).toBe(200);
  });
});

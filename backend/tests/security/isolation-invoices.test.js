// Isolamento A × B das notas: nota de outra empresa → 404 e nada muda; tomador ou documento de outra
// empresa no corpo → 422.
import { randomUUID } from 'node:crypto';
import { createDocument } from '../helpers/documents.js';
import { createParty, post } from '../helpers/finance.js';
import { api, makeApp } from '../helpers/http.js';
import { createInvoice, createIssuedInvoice, invoiceRow } from '../helpers/invoices.js';
import { createTenant } from '../helpers/tenants.js';

const app = makeApp({ serveFrontend: false });

let a;
let b;
let invoiceB;
let paidB;
let partyB;
let documentB;

beforeAll(async () => {
  a = await createTenant();
  b = await createTenant();
  invoiceB = await createIssuedInvoice(app, b.headers('owner'), { description: 'Nota secreta de B' });
  paidB = await createIssuedInvoice(app, b.headers('owner'));
  await post(app, b.headers('owner'), `/invoices/${paidB.id}/mark-paid`, { received_on: '2026-10-05' });
  partyB = await createParty(app, b.headers('owner'), { roles: ['customer'] });
  documentB = await createDocument(app, b.headers('owner'), { filename: 'Contrato B.pdf' });
});

function asA(method, path, body) {
  const req = api(app)[method](`/api/v1${path}`).set(a.headers('owner')).set('Idempotency-Key', randomUUID());
  return body === undefined ? req : req.send(body);
}

describe('nota de outra empresa → 404 e nada muda', () => {
  test.each([
    ['get', () => `/invoices/${invoiceB.id}`, undefined],
    ['get', () => `/invoices/${invoiceB.id}/history`, undefined],
    ['patch', () => `/invoices/${invoiceB.id}`, () => ({ version: 2, description: 'Invadida' })],
    ['post', () => `/invoices/${invoiceB.id}/issue`, () => ({ number: '1', issue_date: '2026-10-01' })],
    ['post', () => `/invoices/${invoiceB.id}/cancel`, () => ({ reason: 'Invasão' })],
    ['post', () => `/invoices/${invoiceB.id}/mark-paid`, () => ({ received_on: '2026-10-05' })],
    ['post', () => `/invoices/${paidB.id}/unmark-paid`, () => ({ reason: 'Invasão' })],
    ['post', () => `/invoices/${invoiceB.id}/archive`, () => ({})],
    ['post', () => `/invoices/${invoiceB.id}/documents`, () => ({ document_id: documentB.id, role: 'pdf' })],
    ['delete', () => `/invoices/${invoiceB.id}/documents/${documentB.id}`, () => ({})],
  ])('%s %s', async (method, path, body) => {
    const before = [await invoiceRow(invoiceB.id), await invoiceRow(paidB.id)];
    const res = await asA(method, path(), body?.());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('INVOICE_NOT_FOUND');
    expect([await invoiceRow(invoiceB.id), await invoiceRow(paidB.id)]).toEqual(before);
  });

  test('listas e busca de A não mostram nada de B', async () => {
    const res = await asA('get', '/invoices?tab=all&q=secreta');
    expect(res.body.data.invoices).toEqual([]);
    expect((await asA('get', '/invoices?tab=all')).body.meta.total).toBe(0);
  });
});

describe('referências de outra empresa no corpo → 422', () => {
  test('tomador de B na nota de A (criar e editar)', async () => {
    const created = await asA('post', '/invoices', { description: 'x', gross_amount_cents: 1, party_id: partyB.id });
    expect(created.status).toBe(422);
    expect(created.body.error.code).toBe('PARTY_NOT_FOUND');
    const own = await createInvoice(app, a.headers('owner'));
    const edited = await asA('patch', `/invoices/${own.id}`, { version: own.version, party_id: partyB.id });
    expect(edited.status).toBe(422);
  });

  test('documento de B anexado à nota de A', async () => {
    const own = await createInvoice(app, a.headers('owner'));
    const res = await asA('post', `/invoices/${own.id}/documents`, { document_id: documentB.id, role: 'pdf' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DOCUMENT_NOT_FOUND');
  });
});

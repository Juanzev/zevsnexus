// Matriz D10 no Financeiro e em Prestadores: todos veem; Visualização não altera; lançar ≠ pagar
// (Assistente lança, mas só Owner, Admin e Financeiro registram e estornam pagamento).
import { createExpense, createParty, pay, post } from '../helpers/finance.js';
import { api, makeApp } from '../helpers/http.js';
import { createTenant } from '../helpers/tenants.js';

const app = makeApp({ serveFrontend: false });
const ROLES = ['owner', 'admin', 'finance', 'assistant', 'viewer'];
const PAYERS = ['owner', 'admin', 'finance'];

let tenant;
let expense;
let party;

beforeAll(async () => {
  tenant = await createTenant({ roles: ROLES });
  expense = await createExpense(app, tenant.headers('owner'), { amount_cents: 1_000_000 });
  party = await createParty(app, tenant.headers('owner'));
});

function call(role, method, path, body) {
  const req = api(app)[method](`/api/v1${path}`).set(tenant.headers(role)).set('Idempotency-Key', crypto.randomUUID());
  return body === undefined ? req : req.send(body);
}

test.each(ROLES)('%s vê despesas, prestadores, categorias e o dashboard', async (role) => {
  for (const path of ['/expenses', `/expenses/${expense.id}`, `/expenses/${expense.id}/history`, '/parties', `/parties/${party.id}`, '/finance-categories', '/dashboard']) {
    expect({ role, path, status: (await call(role, 'get', path)).status }).toEqual({ role, path, status: 200 });
  }
});

test.each([
  ['post', '/expenses', { description: 'X', amount_cents: 100, due_date: '2026-10-20' }],
  ['patch', () => `/expenses/${expense.id}`, { version: 1, description: 'Y' }],
  ['post', () => `/expenses/${expense.id}/cancel`, { reason: 'X' }],
  ['post', '/finance-categories', { name: 'Nova' }],
  ['post', '/parties', { person_type: 'individual', name: 'X', roles: ['supplier'] }],
  ['patch', () => `/parties/${party.id}`, { version: 1, name: 'Y' }],
  ['delete', () => `/parties/${party.id}`, {}],
])('Visualização não altera: %s %s', async (method, path, body) => {
  const res = await call('viewer', method, typeof path === 'function' ? path() : path, body);
  expect(res.status).toBe(403);
  expect(res.body.error.code).toBe('PERMISSION_DENIED');
});

test.each(ROLES)('pagamento e estorno: %s', async (role) => {
  const res = await pay(app, tenant.headers(role), expense.id, { amount_cents: 100 });
  const canPay = PAYERS.includes(role);
  expect(res.status).toBe(canPay ? 201 : 403);
  if (!canPay) return;
  const paymentId = res.body.data.expense.payments.at(-1).id;
  expect((await post(app, tenant.headers(role), `/expense-payments/${paymentId}/void`, { reason: 'Teste' })).status).toBe(200);
});

test('Assistente e Financeiro lançam despesa; Visualização e Assistente não estornam', async () => {
  expect((await post(app, tenant.headers('assistant'), '/expenses', { description: 'X', amount_cents: 100, due_date: '2026-10-20' })).status).toBe(201);
  expect((await post(app, tenant.headers('finance'), '/expenses', { description: 'X', amount_cents: 100, due_date: '2026-10-20' })).status).toBe(201);
  const paid = await pay(app, tenant.headers('owner'), expense.id, { amount_cents: 100 });
  const paymentId = paid.body.data.expense.payments.at(-1).id;
  for (const role of ['assistant', 'viewer']) {
    expect((await post(app, tenant.headers(role), `/expense-payments/${paymentId}/void`, { reason: 'X' })).status).toBe(403);
  }
});

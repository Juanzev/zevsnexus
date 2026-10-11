// Isolamento A × B no Financeiro e em Prestadores: recurso de outra empresa → 404 e nada muda;
// referência de outra empresa no corpo → 422.
import { createDocument, uploadFile } from '../helpers/documents.js';
import { createCategory, createExpense, createParty, expenseRow, pay, post } from '../helpers/finance.js';
import { api, makeApp } from '../helpers/http.js';
import { createTenant } from '../helpers/tenants.js';
import { pool } from '../../src/shared/db.js';

const app = makeApp({ serveFrontend: false });

let a;
let b;
let expenseB;
let paymentB;
let partyB;
let categoryB;
let documentB;

beforeAll(async () => {
  a = await createTenant();
  b = await createTenant();
  const headersB = b.headers('owner');
  partyB = await createParty(app, headersB, { name: 'Prestador de B' });
  categoryB = await createCategory(app, headersB, 'Categoria de B');
  expenseB = await createExpense(app, headersB, { amount_cents: 10_000, party_id: partyB.id, category_id: categoryB.id });
  const paid = await pay(app, headersB, expenseB.id, { amount_cents: 1_000 });
  paymentB = paid.body.data.expense.payments[0];
  documentB = await createDocument(app, headersB, { filename: 'Documento de B.pdf' });
});

function asA(method, path, body) {
  const req = api(app)[method](`/api/v1${path}`).set(a.headers('owner')).set('Idempotency-Key', crypto.randomUUID());
  return body === undefined ? req : req.send(body);
}

async function snapshotB() {
  const { rows } = await pool.query(
    `SELECT e.status, e.amount_cents, e.paid_amount_cents, e.version, p.voided_at,
            (SELECT version FROM parties WHERE id = $3) AS party_version,
            (SELECT name FROM finance_categories WHERE id = $4) AS category_name
       FROM expenses e JOIN expense_payments p ON p.expense_id = e.id
      WHERE e.id = $1 AND p.id = $2`,
    [expenseB.id, paymentB.id, partyB.id, categoryB.id],
  );
  return rows[0];
}

describe('recurso de outra empresa → 404 e nada muda', () => {
  test.each([
    ['get', () => `/expenses/${expenseB.id}`, undefined],
    ['get', () => `/expenses/${expenseB.id}/history`, undefined],
    ['patch', () => `/expenses/${expenseB.id}`, { version: 2, amount_cents: 1 }],
    ['post', () => `/expenses/${expenseB.id}/cancel`, { reason: 'Invasão' }],
    ['post', () => `/expenses/${expenseB.id}/payments`, { paid_on: '2026-10-01', amount_cents: 100, method: 'pix' }],
    ['post', () => `/expense-payments/${paymentB.id}/void`, { reason: 'Invasão' }],
    ['post', () => `/expenses/${expenseB.id}/documents`, () => ({ document_id: documentB.id, role: 'other' })],
    ['get', () => `/parties/${partyB.id}`, undefined],
    ['get', () => `/parties/${partyB.id}/expenses`, undefined],
    ['get', () => `/parties/${partyB.id}/documents`, undefined],
    ['patch', () => `/parties/${partyB.id}`, { version: 1, name: 'Invadido' }],
    ['delete', () => `/parties/${partyB.id}`, {}],
    ['post', () => `/parties/${partyB.id}/documents`, () => ({ document_id: documentB.id })],
    ['patch', () => `/finance-categories/${categoryB.id}`, { name: 'Invadida' }],
    ['post', () => `/finance-categories/${categoryB.id}/archive`, {}],
  ])('%s %s', async (method, path, body) => {
    const before = await snapshotB();
    // A tabela é montada antes do beforeAll: corpos que dependem dos dados de B são funções.
    const res = await asA(method, path(), typeof body === 'function' ? body() : body);
    expect(res.status).toBe(404);
    expect(await snapshotB()).toEqual(before);
  });

  test('listas, busca, totais e dashboard de A não enxergam B', async () => {
    const expenses = await asA('get', '/expenses?tab=all&q=despesa');
    expect(expenses.body.data.expenses).toEqual([]);
    expect(expenses.body.meta.totals).toEqual({ amount_cents: 0, paid_cents: 0, open_cents: 0 });
    expect((await asA('get', `/expenses?tab=all&party_id=${partyB.id}`)).body.data.expenses).toEqual([]);
    expect((await asA('get', '/parties?q=prestador')).body.data.parties).toEqual([]);
    expect((await asA('get', '/finance-categories')).body.data.categories).toEqual([]);
    const dashboard = await asA('get', '/dashboard?period=this_year');
    expect(dashboard.body.data.finance.paid_in_period).toEqual({ count: 0, amount_cents: 0 });
  });
});

describe('referência de outra empresa no corpo → 422', () => {
  test('prestador, categoria, documento e arquivo de B não servem em A', async () => {
    const headersA = a.headers('owner');
    const base = { description: 'X', amount_cents: 100, due_date: '2026-10-20' };
    const withParty = await post(app, headersA, '/expenses', { ...base, party_id: partyB.id });
    expect(withParty.status).toBe(422);
    expect(withParty.body.error.code).toBe('PARTY_NOT_FOUND');
    const withCategory = await post(app, headersA, '/expenses', { ...base, category_id: categoryB.id });
    expect(withCategory.body.error.code).toBe('CATEGORY_NOT_FOUND');

    const expenseA = await createExpense(app, headersA);
    const withDocument = await post(app, headersA, `/expenses/${expenseA.id}/documents`, { document_id: documentB.id });
    expect(withDocument.status).toBe(422);
    expect(withDocument.body.error.code).toBe('DOCUMENT_NOT_FOUND');

    const fileB = await uploadFile(app, b.headers('owner'));
    const withFile = await post(app, headersA, '/expenses', { ...base, payment: { paid_on: '2026-10-01', method: 'pix', receipt_file_id: fileB } });
    expect(withFile.status).toBe(422);
    expect(withFile.body.error.code).toBe('FILE_NOT_FOUND');

    const patchParty = await api(app)
      .patch(`/api/v1/expenses/${expenseA.id}`)
      .set(headersA)
      .send({ version: 1, party_id: partyB.id });
    expect(patchParty.status).toBe(422);
    expect((await expenseRow(expenseA.id)).version).toBe(1);
  });
});

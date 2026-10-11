// Concorrência no saldo da despesa (STRUCTURE pág. 07, "saldo derivado"): a soma dos pagamentos nunca
// passa do valor, o estorno vale uma vez e a edição concorrente tem um vencedor só.
import { pool } from '../../src/shared/db.js';
import { createExpense, expenseRow, pay, post } from '../helpers/finance.js';
import { api, makeApp } from '../helpers/http.js';
import { createTenant } from '../helpers/tenants.js';

const app = makeApp({ serveFrontend: false });

async function activePaymentsSum(expenseId) {
  const { rows } = await pool.query(
    'SELECT COALESCE(sum(amount_cents), 0)::bigint AS total FROM expense_payments WHERE expense_id = $1 AND voided_at IS NULL',
    [expenseId],
  );
  return rows[0].total;
}

test('5 pagamentos simultâneos de 40 numa despesa de 100: só 2 passam e o saldo bate', async () => {
  const tenant = await createTenant();
  const headers = tenant.headers('owner');
  const expense = await createExpense(app, headers, { amount_cents: 100 });
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => pay(app, headers, expense.id, { amount_cents: 40 })));
  expect(results.map((res) => res.status).sort()).toEqual([201, 201, 422, 422, 422]);
  expect(results.filter((res) => res.status === 422).every((res) => res.body.error.code === 'PAYMENT_EXCEEDS_BALANCE')).toBe(true);
  const row = await expenseRow(expense.id);
  expect(row).toMatchObject({ paid_amount_cents: 80, status: 'partially_paid' });
  expect(await activePaymentsSum(expense.id)).toBe(80);
});

test('o mesmo estorno 3 vezes ao mesmo tempo: um vale, os outros 409', async () => {
  const tenant = await createTenant();
  const headers = tenant.headers('owner');
  const expense = await createExpense(app, headers, { amount_cents: 1_000 });
  const res = await pay(app, headers, expense.id, { amount_cents: 600 });
  const paymentId = res.body.data.expense.payments[0].id;
  const results = await Promise.all([1, 2, 3].map(() => post(app, headers, `/expense-payments/${paymentId}/void`, { reason: 'Erro' })));
  expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
  expect(await expenseRow(expense.id)).toMatchObject({ paid_amount_cents: 0, status: 'pending' });
});

test('pagamento e estorno cruzados mantêm pago = soma dos pagamentos ativos', async () => {
  const tenant = await createTenant();
  const headers = tenant.headers('owner');
  const expense = await createExpense(app, headers, { amount_cents: 1_000 });
  const first = await pay(app, headers, expense.id, { amount_cents: 500 });
  const paymentId = first.body.data.expense.payments[0].id;
  await Promise.all([
    post(app, headers, `/expense-payments/${paymentId}/void`, { reason: 'Erro' }),
    pay(app, headers, expense.id, { amount_cents: 300 }),
    pay(app, headers, expense.id, { amount_cents: 300 }),
  ]);
  const row = await expenseRow(expense.id);
  expect(row.paid_amount_cents).toBe(await activePaymentsSum(expense.id));
  expect(row.paid_amount_cents).toBeLessThanOrEqual(1_000);
});

test('duas edições com a mesma versão: uma vence, a outra 409', async () => {
  const tenant = await createTenant();
  const headers = tenant.headers('owner');
  const expense = await createExpense(app, headers);
  const edit = (description) => api(app).patch(`/api/v1/expenses/${expense.id}`).set(headers).send({ version: 1, description });
  const results = await Promise.all([edit('Primeira'), edit('Segunda')]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
});

test('cancelar e pagar ao mesmo tempo: nunca fica cancelada com pagamento ativo', async () => {
  const tenant = await createTenant();
  const headers = tenant.headers('owner');
  for (let round = 0; round < 5; round += 1) {
    const expense = await createExpense(app, headers, { amount_cents: 1_000 });
    await Promise.all([
      post(app, headers, `/expenses/${expense.id}/cancel`, { reason: 'Corrida' }),
      pay(app, headers, expense.id, { amount_cents: 1_000 }),
    ]);
    const row = await expenseRow(expense.id);
    expect(row.status === 'cancelled' && (await activePaymentsSum(expense.id)) > 0).toBe(false);
    expect(row.paid_amount_cents).toBe(await activePaymentsSum(expense.id));
  }
});

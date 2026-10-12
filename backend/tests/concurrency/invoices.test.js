// Concorrência nas notas (mexe em estado): cada transição trava a nota e confere o estado; o banco
// ainda garante as combinações (CHECKs) e o número único.
import { post } from '../helpers/finance.js';
import { makeApp } from '../helpers/http.js';
import { createIssuedInvoice, invoiceRow } from '../helpers/invoices.js';
import { createTenant } from '../helpers/tenants.js';

const app = makeApp({ serveFrontend: false });

test('3 "marcar paga" simultâneos: um passa, os outros recebem 409', async () => {
  const tenant = await createTenant();
  const headers = tenant.headers('owner');
  const invoice = await createIssuedInvoice(app, headers);
  const results = await Promise.all(
    [1, 2, 3].map((day) => post(app, headers, `/invoices/${invoice.id}/mark-paid`, { received_on: `2026-10-0${day}` })),
  );
  expect(results.map((res) => res.status).sort()).toEqual([200, 409, 409]);
  expect(results.filter((res) => res.status === 409).every((res) => res.body.error.code === 'INVOICE_ALREADY_PAID')).toBe(true);
});

test('cancelar × marcar paga ao mesmo tempo: nunca fica cancelada e paga', async () => {
  const tenant = await createTenant();
  const headers = tenant.headers('owner');
  for (let round = 0; round < 5; round += 1) {
    const invoice = await createIssuedInvoice(app, headers);
    const [cancel, paid] = await Promise.all([
      post(app, headers, `/invoices/${invoice.id}/cancel`, { reason: 'Erro' }),
      post(app, headers, `/invoices/${invoice.id}/mark-paid`, { received_on: '2026-10-05' }),
    ]);
    expect([cancel.status, paid.status].sort()).toEqual([200, 409]);
    const row = await invoiceRow(invoice.id);
    expect(row.status === 'cancelled' && row.payment_status === 'paid').toBe(false);
  }
});

test('o mesmo número registrado duas vezes ao mesmo tempo: uma nota, um 409', async () => {
  const tenant = await createTenant();
  const headers = tenant.headers('owner');
  const body = { description: 'x', gross_amount_cents: 1, issue: true, number: '777', issue_date: '2026-10-01' };
  const results = await Promise.all([post(app, headers, '/invoices', body), post(app, headers, '/invoices', body)]);
  expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
});

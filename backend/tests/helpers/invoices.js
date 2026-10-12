// Notas fiscais nos testes: atalhos pela API (o caminho real, com validação e auditoria).
import { pool } from '../../src/shared/db.js';
import { post } from './finance.js';

let sequence = 1000;

/** Número novo a cada chamada (o número é único por empresa, tipo e série). */
export function nextNumber() {
  sequence += 1;
  return String(sequence);
}

export async function createInvoice(app, headers, body = {}) {
  const res = await post(app, headers, '/invoices', {
    description: 'Serviços de engenharia — medição 1',
    gross_amount_cents: 100_000,
    ...body,
  });
  if (res.status !== 201) throw new Error(`POST /invoices ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data.invoice;
}

/** Nota já emitida (o caso comum: a nota saiu na prefeitura e só é registrada aqui). */
export function createIssuedInvoice(app, headers, body = {}) {
  return createInvoice(app, headers, { issue: true, number: nextNumber(), issue_date: '2026-10-01', ...body });
}

export async function invoiceRow(id) {
  const { rows } = await pool.query(
    `SELECT status, payment_status, number, received_on, received_amount_cents, archived_at, cancel_reason,
            payment_undo_reason, version
       FROM invoices WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

// Prestadores e despesas nos testes: atalhos pela API (o caminho real, com validação e auditoria).
import { randomUUID } from 'node:crypto';
import { pool } from '../../src/shared/db.js';
import { api } from './http.js';

/** CPFs e CNPJs válidos para os testes (dígito verificador correto). */
export const CPF = Object.freeze(['52998224725', '11144477735', '12345678909']);
export const CNPJ = Object.freeze(['11222333000181', '12ABC34501DE35']);

export function post(app, headers, path, body, { key = randomUUID() } = {}) {
  return api(app).post(`/api/v1${path}`).set(headers).set('Idempotency-Key', key).send(body ?? {});
}

export async function createParty(app, headers, body = {}) {
  const res = await post(app, headers, '/parties', {
    person_type: 'individual',
    name: `Prestador ${randomUUID().slice(0, 6)}`,
    roles: ['service_provider'],
    ...body,
  });
  if (res.status !== 201) throw new Error(`POST /parties ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data.party;
}

export async function createExpense(app, headers, body = {}) {
  const res = await post(app, headers, '/expenses', {
    description: 'Despesa de teste',
    amount_cents: 10_000,
    due_date: '2026-10-20',
    ...body,
  });
  if (res.status !== 201) throw new Error(`POST /expenses ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data.expense;
}

export function pay(app, headers, expenseId, body = {}, options) {
  return post(app, headers, `/expenses/${expenseId}/payments`, { paid_on: '2026-10-01', method: 'pix', ...body }, options);
}

/** Categoria de despesa nova na empresa (a factory não cria as sugeridas). */
export async function createCategory(app, headers, name = `Categoria ${randomUUID().slice(0, 6)}`) {
  const res = await post(app, headers, '/finance-categories', { name });
  if (res.status !== 201) throw new Error(`POST /finance-categories ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data.category;
}

/** Nega uma permissão a um membro (grant/deny da F2). */
export async function denyPermission(company, membershipId, code) {
  await pool.query(
    "INSERT INTO membership_permissions (company_id, membership_id, permission_code, effect) VALUES ($1, $2, $3, 'deny')",
    [company.id, membershipId, code],
  );
}

export async function expenseRow(id) {
  const { rows } = await pool.query('SELECT status, amount_cents, paid_amount_cents, version FROM expenses WHERE id = $1', [id]);
  return rows[0] ?? null;
}

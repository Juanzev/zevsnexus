import { randomUUID } from 'node:crypto';
import { PERSONAL_DATA } from '../../src/modules/audit/audit.service.js';
import { pool } from '../../src/shared/db.js';
import { addDays, todayIn } from '../../src/shared/timezones.js';
import { createDocument, FIXTURES, uploadFile } from '../helpers/documents.js';
import {
  createCategory,
  createExpense,
  createParty,
  denyPermission,
  expenseRow,
  pay,
  post,
} from '../helpers/finance.js';
import { api, makeApp } from '../helpers/http.js';
import { auditEvents, createTenant } from '../helpers/tenants.js';

const app = makeApp({ serveFrontend: false });
const today = () => todayIn('America/Sao_Paulo');

function get(tenant, path, role = 'owner') {
  return api(app).get(`/api/v1${path}`).set(tenant.headers(role));
}

function patch(tenant, path, body, role = 'owner') {
  return api(app).patch(`/api/v1${path}`).set(tenant.headers(role)).send(body);
}

describe('despesas', () => {
  test('cria pendente ou agendada, com prestador, categoria e tags; auditoria sem descrição', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const party = await createParty(app, headers, { name: 'Carlos Pedreiro' });
    const category = await createCategory(app, headers, 'Mão de obra');

    const expense = await createExpense(app, headers, {
      description: 'Diária do Carlos',
      amount_cents: 25_050,
      due_date: '2026-11-05',
      party_id: party.id,
      category_id: category.id,
      tags: ['Obra Residencial X', 'obra residencial x'],
    });
    expect(expense).toMatchObject({
      status: 'pending',
      amount_cents: 25_050,
      paid_amount_cents: 0,
      open_amount_cents: 25_050,
      party: { id: party.id, name: 'Carlos Pedreiro' },
      category: { id: category.id, name: 'Mão de obra' },
      tags: ['Obra Residencial X'],
      payments: [],
      version: 1,
    });

    const scheduled = await createExpense(app, headers, { scheduled_for: '2026-11-04' });
    expect(scheduled.status).toBe('scheduled');

    const [event] = await auditEvents({ companyId: tenant.company.id, action: 'expense.created', entityId: expense.id });
    expect(event.metadata).toMatchObject({ amount_cents: 25_050, due_date: '2026-11-05', with_payment: false });
    expect(JSON.stringify(event.metadata)).not.toContain('Carlos');
  });

  test('valor em centavos inteiros; decimal, zero, negativo e campos extras são recusados', async () => {
    const tenant = await createTenant();
    const base = { description: 'X', due_date: '2026-11-05' };
    for (const amount of [10.5, 0, -100, '100']) {
      expect((await post(app, tenant.headers('owner'), '/expenses', { ...base, amount_cents: amount })).status).toBe(422);
    }
    const extra = await post(app, tenant.headers('owner'), '/expenses', { ...base, amount_cents: 100, paid_amount_cents: 100, status: 'paid' });
    expect(extra.status).toBe(422);
    expect((await post(app, tenant.headers('owner'), '/expenses', { ...base, amount_cents: 100, due_date: '0202-01-01' })).status).toBe(422);
  });

  test('PATCH com versão: valor não fica abaixo do pago; igualar ao pago quita; cancelada não edita', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const expense = await createExpense(app, headers, { amount_cents: 10_000, description: 'Material com Pedro' });
    await pay(app, headers, expense.id, { amount_cents: 4_000 });

    const below = await patch(tenant, `/expenses/${expense.id}`, { version: 2, amount_cents: 3_000 });
    expect(below.status).toBe(422);
    expect(below.body.error.code).toBe('AMOUNT_BELOW_PAID');
    const stale = await patch(tenant, `/expenses/${expense.id}`, { version: 1, amount_cents: 4_000 });
    expect(stale.status).toBe(409);

    const settled = await patch(tenant, `/expenses/${expense.id}`, { version: 2, amount_cents: 4_000, description: 'Material' });
    expect(settled.status).toBe(200);
    expect(settled.body.data.expense).toMatchObject({ status: 'paid', open_amount_cents: 0, version: 3 });
    const [event] = await auditEvents({ companyId: tenant.company.id, action: 'expense.updated', entityId: expense.id });
    expect(event.metadata.changes).toEqual({ amount_cents: { from: 10_000, to: 4_000 }, description: PERSONAL_DATA });

    const other = await createExpense(app, headers);
    await post(app, headers, `/expenses/${other.id}/cancel`, { reason: 'Lançada em duplicidade' });
    expect((await patch(tenant, `/expenses/${other.id}`, { version: 2, amount_cents: 1 })).body.error.code).toBe('EXPENSE_CANCELLED');
  });

  test('cancelar exige motivo e nenhum pagamento ativo (estorne antes)', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const expense = await createExpense(app, headers);
    const res = await pay(app, headers, expense.id, { amount_cents: 1_000 });
    const paymentId = res.body.data.expense.payments[0].id;

    expect((await post(app, headers, `/expenses/${expense.id}/cancel`, {})).status).toBe(422);
    const blocked = await post(app, headers, `/expenses/${expense.id}/cancel`, { reason: 'Erro' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('EXPENSE_HAS_PAYMENTS');

    await post(app, headers, `/expense-payments/${paymentId}/void`, { reason: 'Pagamento lançado errado' });
    const cancelled = await post(app, headers, `/expenses/${expense.id}/cancel`, { reason: 'Serviço não feito' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.expense).toMatchObject({ status: 'cancelled', cancel_reason: 'Serviço não feito', open_amount_cents: 0 });
    expect((await pay(app, headers, expense.id, { amount_cents: 1 })).body.error.code).toBe('EXPENSE_CANCELLED');
  });
});

describe('pagamentos', () => {
  test('parcial → partially_paid; o resto → paid; acima do saldo e data futura são recusados', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const expense = await createExpense(app, headers, { amount_cents: 10_000 });

    const partial = await pay(app, headers, expense.id, { amount_cents: 3_000, method: 'cash', reference: 'Recibo 12' });
    expect(partial.status).toBe(201);
    expect(partial.body.data.expense).toMatchObject({ status: 'partially_paid', paid_amount_cents: 3_000, open_amount_cents: 7_000 });

    const over = await pay(app, headers, expense.id, { amount_cents: 7_001 });
    expect(over.status).toBe(422);
    expect(over.body.error.details[0]).toMatchObject({ code: 'PAYMENT_EXCEEDS_BALANCE', remaining_cents: 7_000 });

    const future = await pay(app, headers, expense.id, { amount_cents: 100, paid_on: addDays(today(), 2) });
    expect(future.status).toBe(422);
    expect(future.body.error.code).toBe('PAYMENT_DATE_IN_FUTURE');

    const rest = await pay(app, headers, expense.id, { amount_cents: 7_000, method: 'pix' });
    expect(rest.body.data.expense).toMatchObject({ status: 'paid', paid_amount_cents: 10_000, open_amount_cents: 0 });
    expect(rest.body.data.expense.payments.map((p) => [p.amount_cents, p.method])).toEqual([
      [3_000, 'cash'],
      [7_000, 'pix'],
    ]);

    const events = await auditEvents({ companyId: tenant.company.id, action: 'expense.payment_registered', entityId: expense.id });
    expect(events.map((e) => [e.metadata.paid_amount_after, e.metadata.status_after])).toEqual([
      [3_000, 'partially_paid'],
      [10_000, 'paid'],
    ]);
  });

  test('estorno: motivo obrigatório, recalcula o status e não estorna duas vezes', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const expense = await createExpense(app, headers, { amount_cents: 5_000, scheduled_for: '2026-11-01' });
    const res = await pay(app, headers, expense.id, { amount_cents: 5_000 });
    const paymentId = res.body.data.expense.payments[0].id;

    expect((await post(app, headers, `/expense-payments/${paymentId}/void`, {})).status).toBe(422);
    const voided = await post(app, headers, `/expense-payments/${paymentId}/void`, { reason: 'Valor errado' });
    expect(voided.status).toBe(200);
    // Volta para "agendada": o agendamento continua.
    expect(voided.body.data.expense).toMatchObject({ status: 'scheduled', paid_amount_cents: 0 });
    expect(voided.body.data.expense.payments[0]).toMatchObject({ void_reason: 'Valor errado', voided_by: { name: expect.any(String) } });

    const again = await post(app, headers, `/expense-payments/${paymentId}/void`, { reason: 'De novo' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('PAYMENT_ALREADY_VOIDED');
    const [event] = await auditEvents({ companyId: tenant.company.id, action: 'expense.payment_voided', entityId: expense.id });
    expect(event.metadata).toMatchObject({ amount_cents: 5_000, paid_amount_after: 0, status_after: 'scheduled' });
  });

  test('no banco, pagamento não se apaga nem se edita; o estorno vale uma vez só', async () => {
    const tenant = await createTenant();
    const expense = await createExpense(app, tenant.headers('owner'));
    const res = await pay(app, tenant.headers('owner'), expense.id, { amount_cents: 1_000 });
    const id = res.body.data.expense.payments[0].id;
    const userId = tenant.members.owner.user.id;

    await expect(pool.query('UPDATE expense_payments SET amount_cents = 1 WHERE id = $1', [id])).rejects.toThrow(/não se edita/);
    await expect(pool.query('DELETE FROM expense_payments WHERE id = $1', [id])).rejects.toThrow(/não se apaga/);
    await expect(pool.query('TRUNCATE expense_payments CASCADE')).rejects.toThrow(/append-only/);
    await pool.query("UPDATE expense_payments SET voided_at = now(), voided_by = $2, void_reason = 'x' WHERE id = $1", [id, userId]);
    await expect(
      pool.query("UPDATE expense_payments SET void_reason = 'outro' WHERE id = $1", [id]),
    ).rejects.toThrow(/não se edita/);
  });

  test('"Já paguei": despesa + pagamento + comprovante numa requisição', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const { rows } = await pool.query(
      "INSERT INTO folders (company_id, name, created_by) VALUES ($1, 'Comprovantes', $2) RETURNING id",
      [tenant.company.id, tenant.members.owner.user.id],
    );
    await pool.query('UPDATE company_settings SET receipts_folder_id = $2 WHERE company_id = $1', [tenant.company.id, rows[0].id]);
    const fileId = await uploadFile(app, headers, { filename: 'pix.png', content: FIXTURES.png() });

    const res = await post(app, headers, '/expenses', {
      description: 'Areia e cimento',
      amount_cents: 48_990,
      payment: { paid_on: today(), method: 'pix', receipt_file_id: fileId },
    });
    expect(res.status).toBe(201);
    const { expense } = res.body.data;
    expect(expense).toMatchObject({ status: 'paid', due_date: today(), has_receipt: true, paid_amount_cents: 48_990 });
    expect(expense.payments[0].receipt_document_id).toEqual(expect.any(String));
    expect(expense.documents).toEqual([expect.objectContaining({ role: 'receipt', payment_id: expense.payments[0].id })]);

    const receipt = await get(tenant, `/documents/${expense.payments[0].receipt_document_id}`);
    expect(receipt.body.data.document).toMatchObject({ title: 'Comprovante · Areia e cimento', folder_id: rows[0].id });
  });

  test('"Já paguei" exige finance.pay: o Assistente lança, mas não paga (nada é criado)', async () => {
    const tenant = await createTenant({ roles: ['owner', 'assistant'] });
    const res = await post(app, tenant.headers('assistant'), '/expenses', {
      description: 'Tentativa',
      amount_cents: 1_000,
      payment: { paid_on: today(), method: 'cash' },
    });
    expect(res.status).toBe(403);
    expect(res.body.error.details).toEqual({ permissions: ['finance.pay'] });
    const { rows } = await pool.query('SELECT count(*) AS total FROM expenses WHERE company_id = $1', [tenant.company.id]);
    expect(rows[0].total).toBe(0);
    expect((await post(app, tenant.headers('assistant'), '/expenses', { description: 'Lançar só', amount_cents: 1_000, due_date: today() })).status).toBe(201);
  });
});

describe('lista do Financeiro', () => {
  test('abas, vencida calculada, totais do filtro, busca, tag e período', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const party = await createParty(app, headers, { name: 'Elétrica Silva' });
    const now = today();
    const overdue = await createExpense(app, headers, { description: 'Fiação', amount_cents: 1_000, due_date: addDays(now, -3), party_id: party.id });
    const soon = await createExpense(app, headers, { description: 'Tinta', amount_cents: 2_000, due_date: addDays(now, 3), tags: ['Obra A'] });
    const later = await createExpense(app, headers, { description: 'Aluguel', amount_cents: 4_000, due_date: addDays(now, 30), tags: ['Obra A'] });
    const paid = await createExpense(app, headers, { description: 'Pago', amount_cents: 8_000, due_date: addDays(now, -1) });
    await pay(app, headers, paid.id, { amount_cents: 8_000, paid_on: now });
    const cancelled = await createExpense(app, headers, { description: 'Cancelada', amount_cents: 16_000, due_date: addDays(now, 60) });
    await post(app, headers, `/expenses/${cancelled.id}/cancel`, { reason: 'Erro' });

    const list = async (query) => (await get(tenant, `/expenses?${query}`)).body;
    const ids = async (query) => (await list(query)).data.expenses.map((expense) => expense.id);

    const open = await list('tab=open');
    expect(open.data.expenses.map((e) => e.id)).toEqual([overdue.id, soon.id, later.id]);
    expect(open.data.expenses[0].overdue).toBe(true);
    expect(open.meta).toMatchObject({ total: 3, totals: { amount_cents: 7_000, paid_cents: 0, open_cents: 7_000 }, today: now });
    expect(await ids('tab=overdue')).toEqual([overdue.id]);
    expect(await ids('tab=upcoming')).toEqual([soon.id]);
    expect(await ids('tab=paid')).toEqual([paid.id]);
    expect(await ids('tab=cancelled')).toEqual([cancelled.id]);
    expect((await list('tab=all')).meta.total).toBe(5);

    // Busca pela descrição, pelo prestador (sem acento) e pela tag; filtro por tag com total (custo por obra).
    expect(await ids('tab=all&q=fiacao')).toEqual([overdue.id]);
    expect(await ids('tab=all&q=eletrica')).toEqual([overdue.id]);
    const tag = (await get(tenant, '/tags?q=obra')).body.data.tags[0];
    expect(tag).toMatchObject({ name: 'Obra A', expense_count: 2 });
    const byTag = await list(`tab=all&tag_id=${tag.id}`);
    expect(byTag.meta.totals.amount_cents).toBe(6_000);
    expect(await ids(`tab=all&due_from=${addDays(now, 1)}&due_to=${addDays(now, 10)}`)).toEqual([soon.id]);
    expect(await ids('tab=open&sort=-amount')).toEqual([later.id, soon.id, overdue.id]);
    expect((await get(tenant, '/expenses?sort=amount;drop')).status).toBe(422);
  });

  test('a janela de "Próximas" vem das configurações da empresa', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const inTen = await createExpense(app, headers, { due_date: addDays(today(), 10) });
    expect((await get(tenant, '/expenses?tab=upcoming')).body.data.expenses).toEqual([]);
    await patch(tenant, '/company/settings', { upcoming_window_days: 15 });
    const res = await get(tenant, '/expenses?tab=upcoming');
    expect(res.body.data.expenses.map((e) => e.id)).toEqual([inTen.id]);
    expect(res.body.meta.upcoming_window_days).toBe(15);
  });

  test('histórico da despesa mostra quem fez o quê, sem dado pessoal', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const expense = await createExpense(app, headers, { description: 'Pagamento ao José' });
    await pay(app, headers, expense.id, { amount_cents: 2_500 });
    const events = (await get(tenant, `/expenses/${expense.id}/history`)).body.data.events;
    expect(events.map((event) => event.action)).toEqual(['expense.payment_registered', 'expense.created']);
    expect(events[0].details).toMatchObject({ amount_cents: 2_500, method: 'pix', status_after: 'partially_paid' });
    expect(JSON.stringify(events)).not.toContain('José');
  });
});

describe('anexos da despesa', () => {
  test('arquivo novo (boleto) ou documento existente; desvincular mantém o documento', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const expense = await createExpense(app, headers);
    const fileId = await uploadFile(app, headers, { filename: 'boleto.pdf' });
    const withBoleto = await post(app, headers, `/expenses/${expense.id}/documents`, { file_id: fileId, role: 'boleto' });
    expect(withBoleto.status).toBe(201);
    expect(withBoleto.body.data.expense.documents).toEqual([expect.objectContaining({ role: 'boleto', title: 'boleto' })]);

    const contract = await createDocument(app, headers, { filename: 'Contrato.pdf' });
    const linked = await post(app, headers, `/expenses/${expense.id}/documents`, { document_id: contract.id, role: 'contract' });
    expect(linked.body.data.expense.documents.map((d) => d.role)).toEqual(['boleto', 'contract']);

    const removed = await api(app).delete(`/api/v1/expenses/${expense.id}/documents/${contract.id}`).set(headers).send({});
    expect(removed.status).toBe(200);
    expect(removed.body.data.expense.documents.map((d) => d.role)).toEqual(['boleto']);
    expect((await get(tenant, `/documents/${contract.id}`)).status).toBe(200);
  });
});

describe('categorias', () => {
  test('criar, nome único entre ativas, renomear, arquivar; arquivada não recebe despesa nova', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const category = await createCategory(app, headers, 'Combustível');
    expect((await post(app, headers, '/finance-categories', { name: 'combustível' })).status).toBe(409);
    const renamed = await patch(tenant, `/finance-categories/${category.id}`, { name: 'Combustível e pedágio' });
    expect(renamed.body.data.category.name).toBe('Combustível e pedágio');

    await post(app, headers, `/finance-categories/${category.id}/archive`, {});
    expect((await get(tenant, '/finance-categories')).body.data.categories).toEqual([]);
    const res = await post(app, headers, '/expenses', { description: 'X', amount_cents: 100, due_date: today(), category_id: category.id });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
  });

  test('empresa nova nasce com as categorias sugeridas', async () => {
    const { createUser } = await import('../helpers/users.js');
    const { signAccessToken } = await import('../../src/shared/security/tokens.js');
    const user = await createUser();
    const res = await api(app)
      .post('/api/v1/companies')
      .set({ Authorization: `Bearer ${signAccessToken(user.id)}`, 'Idempotency-Key': randomUUID() })
      .send({ legal_name: 'Empresa Nova Categorias' });
    const { rows } = await pool.query(
      "SELECT name FROM finance_categories WHERE company_id = $1 AND kind = 'expense' ORDER BY sort_order",
      [res.body.data.company.id],
    );
    expect(rows.map((row) => row.name)).toEqual([
      'Mão de obra',
      'Materiais',
      'Serviços de terceiros',
      'Impostos e taxas',
      'Aluguel',
      'Contas de consumo',
      'Folha e pró-labore',
      'Equipamentos e ferramentas',
      'Transporte e combustível',
      'Tarifas bancárias',
      'Outros',
    ]);
  });
});

describe('dashboard', () => {
  test('indicadores da D4 no período, no fuso da empresa; valores omitidos sem finance.view', async () => {
    const tenant = await createTenant({ roles: ['owner', 'viewer'] });
    const headers = tenant.headers('owner');
    const now = today();
    const late = await createExpense(app, headers, { amount_cents: 1_000, due_date: addDays(now, -2) });
    await createExpense(app, headers, { amount_cents: 2_000, due_date: addDays(now, 7) });
    await createExpense(app, headers, { amount_cents: 4_000, due_date: addDays(now, 8) });
    await pay(app, headers, late.id, { amount_cents: 400, paid_on: now });

    const res = await get(tenant, '/dashboard?period=custom&from=' + addDays(now, -30) + '&to=' + addDays(now, 30));
    expect(res.status).toBe(200);
    expect(res.body.data.finance).toEqual({
      overdue: { count: 1, open_cents: 600 },
      due_soon: { count: 1, open_cents: 2_000, days: 7 },
      paid_in_period: { count: 1, amount_cents: 400 },
      expenses_in_period: { count: 3, amount_cents: 7_000 },
    });
    expect(res.body.data.documents).toEqual({ expired_count: 0, expiring_count: 0, expiring_days: 30 });

    const thisMonth = await get(tenant, '/dashboard');
    expect(thisMonth.body.data.period).toMatchObject({ key: 'this_month', from: `${now.slice(0, 7)}-01` });

    await denyPermission(tenant.company, tenant.members.viewer.membershipId, 'finance.view');
    const viewer = await get(tenant, '/dashboard', 'viewer');
    expect(viewer.status).toBe(200);
    expect(viewer.body.data.finance).toBeUndefined();
    expect(viewer.body.data.documents).toBeDefined();
  });

  test('período personalizado: início e fim obrigatórios, fim depois do início, até 2 anos', async () => {
    const tenant = await createTenant();
    expect((await get(tenant, '/dashboard?period=custom')).status).toBe(422);
    expect((await get(tenant, '/dashboard?period=custom&from=2026-02-01&to=2026-01-01')).status).toBe(422);
    expect((await get(tenant, '/dashboard?period=custom&from=2020-01-01&to=2026-01-01')).status).toBe(422);
    expect((await get(tenant, '/dashboard?period=semana')).status).toBe(422);
    expect((await get(tenant, '/dashboard?period=last_month')).status).toBe(200);
  });

  test('a despesa e o pagamento contam no fuso da empresa', async () => {
    const tenant = await createTenant();
    await pool.query("UPDATE companies SET timezone = 'America/Manaus' WHERE id = $1", [tenant.company.id]);
    const res = await get(tenant, '/dashboard?period=today');
    expect(res.body.data.today).toBe(todayIn('America/Manaus'));
    expect(await expenseRow(randomUUID())).toBeNull();
  });
});

// Despesas e pagamentos (FASE-0 D4, ARCHITECTURE §12 e §12.1).
// - Mutação só depois da despesa travada (FOR UPDATE); com pagamento, trava a despesa e depois o pagamento.
// - `paid_amount_cents` só muda por expensesRepository.settle (a função única, UPDATE atômico condicional).
// - Pagamento não se edita: estorna (com motivo) e lança outro. "Vencida" é calculada, nunca gravada.
// - Auditoria na mesma transação; descrição e observações podem ter nome de pessoa → [dado pessoal].
import { withTenant } from '../../shared/db.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js';
import { todayIn } from '../../shared/timezones.js';
import { auditChanges, PERSONAL_DATA, recordAudit } from '../audit/audit.service.js';
import { auditRepository } from '../audit/audit.repository.js';
import { ensureTags, normalizeTagNames } from '../documents/catalog.service.js';
import * as documentsService from '../documents/documents.service.js';
import * as filesService from '../files/files.service.js';
import { assertParty } from '../parties/parties.service.js';
import { assertExpenseCategory } from './categories.service.js';
import { expensesRepository, OPEN_STATUSES } from './expenses.repository.js';

const HISTORY_LIMIT = 100;
const EDITABLE_FIELDS = ['description', 'party_id', 'category_id', 'amount_cents', 'due_date', 'scheduled_for', 'notes'];
const PERSONAL_FIELDS = ['description', 'notes'];
const HISTORY_DETAILS = ['amount_cents', 'paid_on', 'method', 'paid_amount_after', 'status_after', 'role', 'due_date'];
/** "Vence em 7 dias" (definição da D4). */
const DUE_SOON_DAYS = 7;

function expenseNotFound() {
  return new NotFoundError('EXPENSE_NOT_FOUND', 'Despesa não encontrada.');
}

function expenseCancelled() {
  return new ConflictError('EXPENSE_CANCELLED', 'Esta despesa está cancelada.');
}

function fieldError(field, code, message) {
  return new ValidationError([{ field, code, message }], code, message);
}

function versionConflict(currentVersion) {
  return new ConflictError(
    'VERSION_CONFLICT',
    'Esta despesa foi alterada em outro lugar. Recarregue a tela para ver a versão mais recente.',
    { current_version: currentVersion },
  );
}

function today(ctx) {
  return todayIn(ctx.timezone);
}

export function toExpense(row, todayDate) {
  const open = OPEN_STATUSES.includes(row.status);
  return {
    id: row.id,
    description: row.description,
    party: row.party_id ? { id: row.party_id, name: row.party_name } : null,
    category: row.category_id ? { id: row.category_id, name: row.category_name } : null,
    amount_cents: row.amount_cents,
    paid_amount_cents: row.paid_amount_cents,
    open_amount_cents: open ? row.amount_cents - row.paid_amount_cents : 0,
    due_date: row.due_date,
    scheduled_for: row.scheduled_for,
    status: row.status,
    overdue: open && row.due_date < todayDate,
    tags: row.tags,
    has_receipt: row.has_receipt,
    notes: row.notes,
    cancelled_at: row.cancelled_at,
    cancel_reason: row.cancel_reason,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toPayment(row) {
  return {
    id: row.id,
    paid_on: row.paid_on,
    amount_cents: row.amount_cents,
    method: row.method,
    reference: row.reference,
    notes: row.notes,
    created_by: { name: row.created_by_name },
    created_at: row.created_at,
    voided_at: row.voided_at,
    void_reason: row.void_reason,
    voided_by: row.voided_at ? { name: row.voided_by_name } : null,
    receipt_document_id: row.receipt_document_id,
  };
}

function toAttachment(row) {
  return {
    document_id: row.document_id,
    role: row.role,
    payment_id: row.payment_id,
    title: row.title,
    extension: row.extension,
    size_bytes: row.size_bytes,
    linked_at: row.linked_at,
  };
}

/** Janela da aba "Próximas" (Configurações), em dias. */
async function upcomingWindow(client, companyId) {
  const { rows } = await client.query('SELECT upcoming_window_days FROM company_settings WHERE company_id = $1', [companyId]);
  return rows[0]?.upcoming_window_days ?? 7;
}

async function detail(client, ctx, id) {
  const repo = expensesRepository(client);
  const row = await repo.find(ctx.companyId, id);
  if (!row) throw expenseNotFound();
  const [payments, documents] = await Promise.all([repo.listPayments(ctx.companyId, id), repo.listDocuments(ctx.companyId, id)]);
  return { ...toExpense(row, today(ctx)), payments: payments.map(toPayment), documents: documents.map(toAttachment) };
}

// ---------- leitura ----------

const DEFAULT_SORT = { open: 'due_date', overdue: 'due_date', upcoming: 'due_date' };

export function listExpenses(ctx, filters) {
  return withTenant(ctx.companyId, async (client) => {
    const todayDate = today(ctx);
    const windowDays = await upcomingWindow(client, ctx.companyId);
    const tab = filters.tab ?? 'open';
    const sort = filters.sort ?? DEFAULT_SORT[tab] ?? '-due_date';
    const { rows, totals } = await expensesRepository(client).list(ctx.companyId, {
      ...filters,
      tab,
      sort,
      today: todayDate,
      windowDays,
    });
    return {
      expenses: rows.map((row) => toExpense(row, todayDate)),
      meta: {
        page: filters.page,
        limit: filters.limit,
        total: totals.count,
        totals: { amount_cents: totals.amount_cents, paid_cents: totals.paid_cents, open_cents: totals.open_cents },
        today: todayDate,
        upcoming_window_days: windowDays,
      },
    };
  });
}

export function getExpense(ctx, id) {
  return withTenant(ctx.companyId, (client) => detail(client, ctx, id));
}

export function getHistory(ctx, id) {
  return withTenant(ctx.companyId, async (client) => {
    if (!(await expensesRepository(client).find(ctx.companyId, id))) throw expenseNotFound();
    const rows = await auditRepository(client).listForEntity(ctx.companyId, 'expense', id, HISTORY_LIMIT);
    return rows.map((row) => ({
      action: row.action,
      created_at: row.created_at,
      actor: { name: row.actor_name ?? (row.actor_type === 'platform_admin' ? 'Equipe ZEVS' : null) },
      details: Object.fromEntries(HISTORY_DETAILS.filter((key) => key in row.metadata).map((key) => [key, row.metadata[key]])),
      changed_fields: row.metadata.changes ? Object.keys(row.metadata.changes) : [],
    }));
  });
}

/** 404 antes de qualquer trabalho no storage. */
async function ensureExpense(ctx, id) {
  await withTenant(ctx.companyId, async (client) => {
    if (!(await expensesRepository(client).find(ctx.companyId, id))) throw expenseNotFound();
  });
}

// ---------- pagamentos ----------

/**
 * Registra o pagamento na transação dada, com a despesa JÁ travada: confere saldo e data, insere,
 * aplica a função única do saldo, guarda o comprovante (documento na pasta padrão) e audita.
 */
async function registerPaymentLocked(client, ctx, expense, input, receiptFile) {
  if (expense.status === 'cancelled') throw expenseCancelled();
  const remaining = expense.amount_cents - expense.paid_amount_cents;
  if (input.amount_cents > remaining) {
    // O saldo vai no detalhe para a tela sugerir o valor certo.
    throw new ValidationError(
      [
        {
          field: 'amount_cents',
          code: 'PAYMENT_EXCEEDS_BALANCE',
          message: 'O valor passa do saldo em aberto da despesa.',
          remaining_cents: remaining,
        },
      ],
      'PAYMENT_EXCEEDS_BALANCE',
      'O valor passa do saldo em aberto da despesa.',
    );
  }
  if (input.paid_on > today(ctx)) {
    throw fieldError('paid_on', 'PAYMENT_DATE_IN_FUTURE', 'A data do pagamento não pode ser no futuro. Para pagar depois, agende a despesa.');
  }

  const repo = expensesRepository(client);
  const payment = await repo.insertPayment(ctx.companyId, expense.id, input, ctx.userId);
  const settled = await repo.settle(ctx.companyId, expense.id, input.amount_cents, ctx.userId);
  if (!settled) throw new ConflictError('PAYMENT_REJECTED', 'O pagamento não pôde ser registrado. Recarregue a tela.');

  let receiptDocumentId = null;
  if (receiptFile) {
    const folderId = await documentsService.defaultFolder(client, ctx.companyId, 'receipts');
    ({ id: receiptDocumentId } = await documentsService.createFromUpload(client, ctx, receiptFile.id, {
      folder_id: folderId,
      title: `Comprovante · ${expense.description}`,
    }));
    await repo.linkDocument(ctx.companyId, expense.id, receiptDocumentId, {
      role: 'receipt',
      paymentId: payment.id,
      userId: ctx.userId,
    });
  }
  await recordAudit(client, ctx, {
    action: 'expense.payment_registered',
    entityType: 'expense',
    entityId: expense.id,
    metadata: {
      payment_id: payment.id,
      amount_cents: input.amount_cents,
      paid_on: input.paid_on,
      method: input.method,
      paid_amount_after: settled.paid_amount_cents,
      status_after: settled.status,
      receipt_document_id: receiptDocumentId,
    },
  });
  return payment;
}

/** POST /expenses/:id/payments (finance.pay). */
export async function registerPayment(ctx, id, input) {
  await ensureExpense(ctx, id);
  const receiptFile = input.receipt_file_id ? await filesService.verifyUpload(ctx, input.receipt_file_id) : null;
  return withTenant(ctx.companyId, async (client) => {
    const expense = await expensesRepository(client).lock(ctx.companyId, id);
    if (!expense) throw expenseNotFound();
    await registerPaymentLocked(client, ctx, expense, input, receiptFile);
    return detail(client, ctx, id);
  });
}

/** POST /expense-payments/:id/void (finance.pay): trava a despesa, depois o pagamento. */
export function voidPayment(ctx, paymentId, { reason }) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = expensesRepository(client);
    const found = await repo.findPayment(ctx.companyId, paymentId);
    if (!found) throw new NotFoundError('PAYMENT_NOT_FOUND', 'Pagamento não encontrado.');
    await repo.lock(ctx.companyId, found.expense_id);
    const payment = await repo.lockPayment(ctx.companyId, paymentId);
    if (payment.voided_at) throw new ConflictError('PAYMENT_ALREADY_VOIDED', 'Este pagamento já foi estornado.');

    await repo.voidPayment(ctx.companyId, paymentId, { reason, userId: ctx.userId });
    const settled = await repo.settle(ctx.companyId, found.expense_id, -payment.amount_cents, ctx.userId);
    if (!settled) throw new ConflictError('PAYMENT_REJECTED', 'O estorno não pôde ser registrado. Recarregue a tela.');
    await recordAudit(client, ctx, {
      action: 'expense.payment_voided',
      entityType: 'expense',
      entityId: found.expense_id,
      metadata: {
        payment_id: paymentId,
        amount_cents: payment.amount_cents,
        paid_on: payment.paid_on,
        paid_amount_after: settled.paid_amount_cents,
        status_after: settled.status,
      },
    });
    return detail(client, ctx, found.expense_id);
  });
}

// ---------- despesas ----------

/**
 * POST /expenses (finance.manage). Com `payment` é o "Já paguei" (exige também finance.pay): despesa,
 * pagamento e comprovante na mesma transação. Sem vencimento, vale a data do pagamento.
 */
export async function createExpense(ctx, input) {
  if (input.payment && !ctx.permissions.has('finance.pay')) {
    throw new AppError(403, 'PERMISSION_DENIED', 'Você não tem permissão para registrar pagamentos.', {
      permissions: ['finance.pay'],
    });
  }
  const dueDate = input.due_date ?? input.payment?.paid_on;
  if (!dueDate) throw fieldError('due_date', 'invalid_type', 'Informe o vencimento.');
  const receiptFile = input.payment?.receipt_file_id ? await filesService.verifyUpload(ctx, input.payment.receipt_file_id) : null;

  return withTenant(ctx.companyId, async (client) => {
    await assertParty(client, ctx.companyId, input.party_id ?? null);
    await assertExpenseCategory(client, ctx.companyId, input.category_id ?? null);
    const repo = expensesRepository(client);
    const { id } = await repo.insert(ctx.companyId, { ...input, due_date: dueDate }, ctx.userId);
    if (input.tags?.length) await repo.replaceTags(ctx.companyId, id, await ensureTags(client, ctx.companyId, input.tags));
    await recordAudit(client, ctx, {
      action: 'expense.created',
      entityType: 'expense',
      entityId: id,
      metadata: {
        amount_cents: input.amount_cents,
        due_date: dueDate,
        party_id: input.party_id ?? null,
        category_id: input.category_id ?? null,
        scheduled_for: input.scheduled_for ?? null,
        with_payment: Boolean(input.payment),
      },
    });
    if (input.payment) {
      const expense = await repo.lock(ctx.companyId, id);
      await registerPaymentLocked(
        client,
        ctx,
        expense,
        { ...input.payment, amount_cents: input.payment.amount_cents ?? input.amount_cents },
        receiptFile,
      );
    }
    return detail(client, ctx, id);
  });
}

export function updateExpense(ctx, id, input) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = expensesRepository(client);
    const current = await repo.lock(ctx.companyId, id);
    if (!current) throw expenseNotFound();
    if (current.status === 'cancelled') throw expenseCancelled();
    if (current.version !== input.version) throw versionConflict(current.version);

    const fields = {};
    for (const field of EDITABLE_FIELDS) {
      if (input[field] !== undefined && input[field] !== current[field]) fields[field] = input[field];
    }
    if (fields.amount_cents !== undefined && fields.amount_cents < current.paid_amount_cents) {
      throw fieldError('amount_cents', 'AMOUNT_BELOW_PAID', 'O valor não pode ficar abaixo do que já foi pago. Estorne um pagamento antes.');
    }
    if (fields.party_id) await assertParty(client, ctx.companyId, fields.party_id);
    if (fields.category_id) await assertExpenseCategory(client, ctx.companyId, fields.category_id);

    const currentTags = (await repo.find(ctx.companyId, id)).tags;
    const tagsChanged =
      input.tags !== undefined &&
      normalizeTagNames(input.tags).join('\n').toLowerCase() !== currentTags.join('\n').toLowerCase();
    if (Object.keys(fields).length === 0 && !tagsChanged) return detail(client, ctx, id);

    if (Object.keys(fields).length > 0) await repo.update(ctx.companyId, id, fields, ctx.userId);
    if (tagsChanged) {
      await repo.replaceTags(ctx.companyId, id, await ensureTags(client, ctx.companyId, input.tags));
      // Só as tags mudaram: a versão sobe do mesmo jeito (edição concorrente detecta).
      if (Object.keys(fields).length === 0) await repo.update(ctx.companyId, id, {}, ctx.userId);
    }
    const changes = auditChanges(current, { ...current, ...fields }, { fields: EDITABLE_FIELDS, personal: PERSONAL_FIELDS }) ?? {};
    if (tagsChanged) changes.tags = PERSONAL_DATA;
    await recordAudit(client, ctx, { action: 'expense.updated', entityType: 'expense', entityId: id, metadata: { changes } });
    return detail(client, ctx, id);
  });
}

/** Cancelar: só sem nada pago (estorne antes). Não há exclusão: o histórico fica. */
export function cancelExpense(ctx, id, { reason }) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = expensesRepository(client);
    const current = await repo.lock(ctx.companyId, id);
    if (!current) throw expenseNotFound();
    if (current.status === 'cancelled') throw expenseCancelled();
    if (current.paid_amount_cents > 0) {
      throw new ConflictError('EXPENSE_HAS_PAYMENTS', 'Esta despesa tem pagamentos. Estorne os pagamentos antes de cancelar.');
    }
    await repo.cancel(ctx.companyId, id, { reason, userId: ctx.userId });
    await recordAudit(client, ctx, { action: 'expense.cancelled', entityType: 'expense', entityId: id });
    return detail(client, ctx, id);
  });
}

// ---------- anexos ----------

/** Anexa um arquivo novo (vira documento na pasta de comprovantes) ou um documento da Central. */
export async function linkExpenseDocument(ctx, id, input) {
  await ensureExpense(ctx, id);
  const file = input.file_id ? await filesService.verifyUpload(ctx, input.file_id) : null;
  return withTenant(ctx.companyId, async (client) => {
    const repo = expensesRepository(client);
    const expense = await repo.lock(ctx.companyId, id);
    if (!expense) throw expenseNotFound();
    let documentId = input.document_id;
    if (file) {
      const folderId = await documentsService.defaultFolder(client, ctx.companyId, 'receipts');
      ({ id: documentId } = await documentsService.createFromUpload(client, ctx, file.id, { folder_id: folderId }));
    } else {
      await documentsService.assertLinkableDocument(client, ctx, documentId);
    }
    if (await repo.linkDocument(ctx.companyId, id, documentId, { role: input.role, userId: ctx.userId })) {
      await recordAudit(client, ctx, {
        action: 'expense.document_linked',
        entityType: 'expense',
        entityId: id,
        metadata: { document_id: documentId, role: input.role, uploaded: Boolean(file) },
      });
    }
    return detail(client, ctx, id);
  });
}

/** Desvincula (o documento continua na Central). */
export function unlinkExpenseDocument(ctx, id, documentId) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = expensesRepository(client);
    if (!(await repo.lock(ctx.companyId, id))) throw expenseNotFound();
    const removed = await repo.unlinkDocument(ctx.companyId, id, documentId);
    if (!removed) throw new NotFoundError('DOCUMENT_NOT_FOUND', 'Documento não vinculado a esta despesa.');
    await recordAudit(client, ctx, {
      action: 'expense.document_unlinked',
      entityType: 'expense',
      entityId: id,
      metadata: { document_id: documentId, role: removed.role },
    });
    return detail(client, ctx, id);
  });
}

// ---------- indicadores ----------

/** Bloco financeiro do dashboard (definições da D4). Chamar dentro da transação do dashboard. */
export async function financeIndicators(client, ctx, period) {
  const row = await expensesRepository(client).indicators(ctx.companyId, {
    today: period.today,
    from: period.from,
    to: period.to,
    soonDays: DUE_SOON_DAYS,
  });
  return {
    overdue: { count: row.overdue_count, open_cents: row.overdue_cents },
    due_soon: { count: row.due_soon_count, open_cents: row.due_soon_cents, days: DUE_SOON_DAYS },
    paid_in_period: { count: row.paid_count, amount_cents: row.paid_cents },
    expenses_in_period: { count: row.period_count, amount_cents: row.period_cents },
  };
}

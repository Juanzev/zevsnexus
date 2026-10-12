// Notas fiscais emitidas (FASE-0 D7, ARCHITECTURE §14 e §14.1). Registro e organização: o Nexus não
// emite nota nem movimenta saldo.
// - Três dimensões separadas: ciclo (status), recebimento (payment_status) e arquivamento.
// - Toda mutação trava a nota (FOR UPDATE) e grava a auditoria na mesma transação; descrição e
//   observações podem ter nome de pessoa → [dado pessoal]. Motivos ficam na nota, não na auditoria.
// - "Vencida" é calculada (emitida, pendente, vencimento antes de hoje no fuso da empresa).
import { UNIQUE_VIOLATION, withTenant } from '../../shared/db.js';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js';
import { todayIn } from '../../shared/timezones.js';
import { auditChanges, recordAudit } from '../audit/audit.service.js';
import { auditRepository } from '../audit/audit.repository.js';
import * as documentsService from '../documents/documents.service.js';
import * as filesService from '../files/files.service.js';
import { assertParty } from '../parties/parties.service.js';
import { INVOICE_EDITABLE_FIELDS, invoicesRepository } from './invoices.repository.js';

const HISTORY_LIMIT = 100;
const PERSONAL_FIELDS = ['description', 'notes'];
const HISTORY_DETAILS = ['kind', 'number', 'series', 'issue_date', 'received_on', 'received_amount_cents', 'role'];

function invoiceNotFound() {
  return new NotFoundError('INVOICE_NOT_FOUND', 'Nota fiscal não encontrada.');
}

function invoiceCancelled() {
  return new ConflictError('INVOICE_CANCELLED', 'Esta nota está cancelada.');
}

function fieldError(field, code, message) {
  return new ValidationError([{ field, code, message }], code, message);
}

function versionConflict(currentVersion) {
  return new ConflictError(
    'VERSION_CONFLICT',
    'Esta nota foi alterada em outro lugar. Recarregue a tela para ver a versão mais recente.',
    { current_version: currentVersion },
  );
}

/** Número repetido (mesmo tipo e série) vira 409 com o campo, para a tela mostrar junto do número. */
async function guardNumber(operation) {
  try {
    return await operation();
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION && err.constraint === 'invoices_number_key') {
      const message = 'Já existe uma nota deste tipo e série com este número.';
      throw new ConflictError('INVOICE_NUMBER_TAKEN', message, [{ field: 'number', code: 'INVOICE_NUMBER_TAKEN', message }]);
    }
    throw err;
  }
}

function today(ctx) {
  return todayIn(ctx.timezone);
}

/** "AAAA-MM-01" → "AAAA-MM". */
function competenceOut(value) {
  return value ? value.slice(0, 7) : null;
}

export function toInvoice(row, todayDate) {
  const issued = row.status === 'issued';
  const pending = row.payment_status === 'pending';
  return {
    id: row.id,
    kind: row.kind,
    number: row.number,
    series: row.series,
    issue_date: row.issue_date,
    competence: competenceOut(row.competence),
    party: row.party_id ? { id: row.party_id, name: row.party_name } : null,
    description: row.description,
    gross_amount_cents: row.gross_amount_cents,
    withheld_cents: row.withheld_cents,
    net_amount_cents: row.net_amount_cents,
    due_date: row.due_date,
    verification_code: row.verification_code,
    notes: row.notes,
    status: row.status,
    payment_status: row.payment_status,
    finalized: issued && !pending,
    overdue: issued && pending && row.archived_at === null && Boolean(row.due_date) && row.due_date < todayDate,
    received_on: row.received_on,
    received_amount_cents: row.received_amount_cents,
    cancelled_at: row.cancelled_at,
    cancel_reason: row.cancel_reason,
    payment_undone_at: row.payment_undone_at,
    payment_undo_reason: row.payment_undo_reason,
    archived_at: row.archived_at,
    has_pdf: row.has_pdf,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toAttachment(row) {
  return {
    document_id: row.document_id,
    role: row.role,
    title: row.title,
    extension: row.extension,
    size_bytes: row.size_bytes,
    linked_at: row.linked_at,
  };
}

async function detail(client, ctx, id) {
  const repo = invoicesRepository(client);
  const row = await repo.find(ctx.companyId, id);
  if (!row) throw invoiceNotFound();
  const documents = await repo.listDocuments(ctx.companyId, id);
  return { ...toInvoice(row, today(ctx)), documents: documents.map(toAttachment) };
}

async function lockInvoice(client, ctx, id) {
  const invoice = await invoicesRepository(client).lock(ctx.companyId, id);
  if (!invoice) throw invoiceNotFound();
  return invoice;
}

/** Número e data obrigatórios para emitir (D7): erro por campo. */
function assertIssuable({ number, issue_date: issueDate }) {
  const problems = [];
  if (!number) problems.push({ field: 'number', code: 'INVOICE_NUMBER_REQUIRED', message: 'Informe o número da nota.' });
  if (!issueDate) problems.push({ field: 'issue_date', code: 'INVOICE_DATE_REQUIRED', message: 'Informe a data de emissão.' });
  if (problems.length > 0) throw new ValidationError(problems, problems[0].code, 'Para marcar como emitida, informe o número e a data de emissão.');
}

function assertWithheld(gross, withheld) {
  if (withheld > gross) {
    throw fieldError('withheld_cents', 'WITHHELD_ABOVE_GROSS', 'As retenções não podem passar do valor bruto.');
  }
}

// ---------- leitura ----------

const DEFAULT_SORT = { processing: '-created_at', pending: 'due_date' };

export function listInvoices(ctx, filters) {
  return withTenant(ctx.companyId, async (client) => {
    const todayDate = today(ctx);
    const tab = filters.tab ?? 'pending';
    const sort = filters.sort ?? DEFAULT_SORT[tab] ?? '-issue_date';
    const { rows, totals } = await invoicesRepository(client).list(ctx.companyId, { ...filters, tab, sort });
    return {
      invoices: rows.map((row) => toInvoice(row, todayDate)),
      meta: {
        page: filters.page,
        limit: filters.limit,
        total: totals.count,
        totals: { gross_cents: totals.gross_cents, withheld_cents: totals.withheld_cents, net_cents: totals.net_cents },
        today: todayDate,
      },
    };
  });
}

export function getInvoice(ctx, id) {
  return withTenant(ctx.companyId, (client) => detail(client, ctx, id));
}

export function getHistory(ctx, id) {
  return withTenant(ctx.companyId, async (client) => {
    if (!(await invoicesRepository(client).find(ctx.companyId, id))) throw invoiceNotFound();
    const rows = await auditRepository(client).listForEntity(ctx.companyId, 'invoice', id, HISTORY_LIMIT);
    return rows.map((row) => ({
      action: row.action,
      created_at: row.created_at,
      actor: { name: row.actor_name ?? (row.actor_type === 'platform_admin' ? 'Equipe ZEVS' : null) },
      details: Object.fromEntries(HISTORY_DETAILS.filter((key) => key in row.metadata).map((key) => [key, row.metadata[key]])),
      changed_fields: row.metadata.changes ? Object.keys(row.metadata.changes) : [],
    }));
  });
}

// ---------- notas ----------

async function issueLocked(client, ctx, invoice, input) {
  const values = {
    number: input.number ?? invoice.number,
    series: input.series !== undefined ? input.series : invoice.series,
    issue_date: input.issue_date ?? invoice.issue_date,
  };
  assertIssuable(values);
  const issued = await invoicesRepository(client).issue(ctx.companyId, invoice.id, {
    number: values.number,
    series: values.series,
    issueDate: values.issue_date,
    userId: ctx.userId,
  });
  if (!issued) throw new ConflictError('INVOICE_NOT_PROCESSING', 'Só uma nota em processamento pode ser marcada como emitida.');
  await recordAudit(client, ctx, {
    action: 'invoice.issued',
    entityType: 'invoice',
    entityId: invoice.id,
    metadata: { number: values.number, series: values.series, issue_date: values.issue_date },
  });
}

/** POST /invoices. Com `issue: true`, cria já emitida (a nota que saiu na prefeitura ou na Sefaz). */
export function createInvoice(ctx, input) {
  assertWithheld(input.gross_amount_cents, input.withheld_cents ?? 0);
  if (input.issue) assertIssuable(input);
  return guardNumber(() =>
    withTenant(ctx.companyId, async (client) => {
      await assertParty(client, ctx.companyId, input.party_id ?? null);
      const repo = invoicesRepository(client);
      const { id } = await repo.insert(ctx.companyId, input, ctx.userId);
      await recordAudit(client, ctx, {
        action: 'invoice.created',
        entityType: 'invoice',
        entityId: id,
        metadata: {
          kind: input.kind,
          gross_amount_cents: input.gross_amount_cents,
          withheld_cents: input.withheld_cents ?? 0,
          party_id: input.party_id ?? null,
          issue: Boolean(input.issue),
        },
      });
      if (input.issue) await issueLocked(client, ctx, await repo.lock(ctx.companyId, id), {});
      return detail(client, ctx, id);
    }),
  );
}

export function updateInvoice(ctx, id, input) {
  return guardNumber(() =>
    withTenant(ctx.companyId, async (client) => {
      const repo = invoicesRepository(client);
      const current = await lockInvoice(client, ctx, id);
      if (current.status === 'cancelled') throw invoiceCancelled();
      if (current.version !== input.version) throw versionConflict(current.version);

      const fields = {};
      for (const field of INVOICE_EDITABLE_FIELDS) {
        if (input[field] !== undefined && input[field] !== current[field]) fields[field] = input[field];
      }
      if (Object.keys(fields).length === 0) return detail(client, ctx, id);
      const next = { ...current, ...fields };
      if (current.status === 'issued') assertIssuable(next);
      assertWithheld(next.gross_amount_cents, next.withheld_cents);
      if (fields.party_id) await assertParty(client, ctx.companyId, fields.party_id);

      await repo.update(ctx.companyId, id, fields, ctx.userId);
      const changes = auditChanges(current, next, { fields: INVOICE_EDITABLE_FIELDS, personal: PERSONAL_FIELDS });
      await recordAudit(client, ctx, { action: 'invoice.updated', entityType: 'invoice', entityId: id, metadata: { changes } });
      return detail(client, ctx, id);
    }),
  );
}

export function issueInvoice(ctx, id, input) {
  return guardNumber(() =>
    withTenant(ctx.companyId, async (client) => {
      const invoice = await lockInvoice(client, ctx, id);
      if (invoice.status === 'cancelled') throw invoiceCancelled();
      if (invoice.status === 'issued') throw new ConflictError('INVOICE_ALREADY_ISSUED', 'Esta nota já está emitida.');
      await issueLocked(client, ctx, invoice, input);
      return detail(client, ctx, id);
    }),
  );
}

/** Cancelar: em processamento ou emitida, nunca paga (desfaça o recebimento antes). */
export function cancelInvoice(ctx, id, { reason }) {
  return withTenant(ctx.companyId, async (client) => {
    const invoice = await lockInvoice(client, ctx, id);
    if (invoice.status === 'cancelled') throw invoiceCancelled();
    if (invoice.payment_status === 'paid') {
      throw new ConflictError('INVOICE_PAID', 'Esta nota está paga. Desfaça o recebimento antes de cancelar.');
    }
    await invoicesRepository(client).cancel(ctx.companyId, id, { reason, userId: ctx.userId });
    await recordAudit(client, ctx, { action: 'invoice.cancelled', entityType: 'invoice', entityId: id, metadata: { status_before: invoice.status } });
    return detail(client, ctx, id);
  });
}

/** Marcar paga: só emitida e pendente; recebimento até hoje; valor recebido padrão = líquido. */
export function markInvoicePaid(ctx, id, input) {
  if (input.received_on > today(ctx)) {
    throw fieldError('received_on', 'RECEIPT_DATE_IN_FUTURE', 'A data do recebimento não pode ser no futuro.');
  }
  return withTenant(ctx.companyId, async (client) => {
    const invoice = await lockInvoice(client, ctx, id);
    if (invoice.status === 'cancelled') throw invoiceCancelled();
    if (invoice.status !== 'issued') {
      throw new ConflictError('INVOICE_NOT_ISSUED', 'Marque a nota como emitida antes de registrar o recebimento.');
    }
    if (invoice.payment_status === 'paid') throw new ConflictError('INVOICE_ALREADY_PAID', 'Esta nota já está paga.');
    const receivedAmountCents = input.received_amount_cents ?? invoice.net_amount_cents;
    await invoicesRepository(client).markPaid(ctx.companyId, id, {
      receivedOn: input.received_on,
      receivedAmountCents,
      userId: ctx.userId,
    });
    await recordAudit(client, ctx, {
      action: 'invoice.paid',
      entityType: 'invoice',
      entityId: id,
      metadata: { received_on: input.received_on, received_amount_cents: receivedAmountCents },
    });
    return detail(client, ctx, id);
  });
}

/** Desfazer o recebimento (D7: auditado). O motivo fica na nota; a auditoria guarda o que foi desfeito. */
export function unmarkInvoicePaid(ctx, id, { reason }) {
  return withTenant(ctx.companyId, async (client) => {
    const invoice = await lockInvoice(client, ctx, id);
    if (invoice.payment_status !== 'paid') throw new ConflictError('INVOICE_NOT_PAID', 'Esta nota não está paga.');
    await invoicesRepository(client).unmarkPaid(ctx.companyId, id, { reason, userId: ctx.userId });
    await recordAudit(client, ctx, {
      action: 'invoice.unpaid',
      entityType: 'invoice',
      entityId: id,
      metadata: { received_on: invoice.received_on, received_amount_cents: invoice.received_amount_cents },
    });
    return detail(client, ctx, id);
  });
}

export function setInvoiceArchived(ctx, id, archived) {
  return withTenant(ctx.companyId, async (client) => {
    await lockInvoice(client, ctx, id);
    if (await invoicesRepository(client).setArchived(ctx.companyId, id, archived, ctx.userId)) {
      await recordAudit(client, ctx, {
        action: archived ? 'invoice.archived' : 'invoice.unarchived',
        entityType: 'invoice',
        entityId: id,
      });
    }
    return detail(client, ctx, id);
  });
}

// ---------- anexos ----------

/** 404 antes de qualquer trabalho no storage. */
async function ensureInvoice(ctx, id) {
  await withTenant(ctx.companyId, async (client) => {
    if (!(await invoicesRepository(client).find(ctx.companyId, id))) throw invoiceNotFound();
  });
}

/** Anexa um arquivo novo (vira documento na pasta "Notas fiscais") ou um documento da Central. */
export async function linkInvoiceDocument(ctx, id, input) {
  await ensureInvoice(ctx, id);
  const file = input.file_id ? await filesService.verifyUpload(ctx, input.file_id) : null;
  return withTenant(ctx.companyId, async (client) => {
    const repo = invoicesRepository(client);
    await lockInvoice(client, ctx, id);
    let documentId = input.document_id;
    if (file) {
      const folderId = await documentsService.defaultFolder(client, ctx.companyId, 'invoices');
      ({ id: documentId } = await documentsService.createFromUpload(client, ctx, file.id, { folder_id: folderId }));
    } else {
      await documentsService.assertLinkableDocument(client, ctx, documentId);
    }
    if (await repo.linkDocument(ctx.companyId, id, documentId, { role: input.role, userId: ctx.userId })) {
      await recordAudit(client, ctx, {
        action: 'invoice.document_linked',
        entityType: 'invoice',
        entityId: id,
        metadata: { document_id: documentId, role: input.role, uploaded: Boolean(file) },
      });
    }
    return detail(client, ctx, id);
  });
}

/** Desvincula (o documento continua na Central). */
export function unlinkInvoiceDocument(ctx, id, documentId) {
  return withTenant(ctx.companyId, async (client) => {
    await lockInvoice(client, ctx, id);
    const removed = await invoicesRepository(client).unlinkDocument(ctx.companyId, id, documentId);
    if (!removed) throw new NotFoundError('DOCUMENT_NOT_FOUND', 'Documento não vinculado a esta nota.');
    await recordAudit(client, ctx, {
      action: 'invoice.document_unlinked',
      entityType: 'invoice',
      entityId: id,
      metadata: { document_id: documentId, role: removed.role },
    });
    return detail(client, ctx, id);
  });
}

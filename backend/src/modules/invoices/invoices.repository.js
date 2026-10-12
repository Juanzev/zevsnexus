// SQL das notas fiscais e dos anexos. companyId sempre primeiro; ordenação e abas por allowlist; busca
// com curingas escapados. Toda transição é um UPDATE condicional ao estado (o banco ainda confere
// com os CHECKs da 0013). "Vencida" é calculada aqui com a data de hoje como parâmetro.
import { isUuid } from '../../shared/db.js';
import { likePattern } from '../../shared/sql.js';

export const INVOICE_KINDS = Object.freeze(['nfse', 'nfe', 'other']);
export const INVOICE_ATTACHMENT_ROLES = Object.freeze(['pdf', 'xml', 'receipt', 'other']);
export const INVOICE_TABS = Object.freeze(['processing', 'pending', 'paid', 'issued', 'cancelled', 'archived', 'all']);

const SORTS = Object.freeze({
  issue_date: 'i.issue_date',
  due_date: 'i.due_date',
  net_amount: 'i.net_amount_cents',
  number: 'lower(i.number)',
  created_at: 'i.created_at',
});
export const INVOICE_SORTS = Object.freeze(Object.keys(SORTS).flatMap((key) => [key, `-${key}`]));

const INVOICE_SELECT = `
  SELECT i.id, i.direction, i.kind, i.number, i.series, i.issue_date, i.competence, i.party_id, p.name AS party_name,
         i.description, i.gross_amount_cents, i.withheld_cents, i.net_amount_cents, i.due_date, i.verification_code,
         i.notes, i.status, i.cancelled_at, i.cancel_reason, i.payment_status, i.received_on, i.received_amount_cents,
         i.payment_undone_at, i.payment_undo_reason, i.archived_at, i.version, i.created_at, i.updated_at,
         EXISTS (SELECT 1 FROM invoice_documents x JOIN documents d ON d.company_id = x.company_id AND d.id = x.document_id
                  WHERE x.company_id = i.company_id AND x.invoice_id = i.id AND x.role = 'pdf' AND d.deleted_at IS NULL) AS has_pdf`;

const INVOICE_FROM = `
    FROM invoices i
    LEFT JOIN parties p ON p.company_id = i.company_id AND p.id = i.party_id`;

/** Colunas que o PATCH pode gravar (allowlist) e os casts de cada uma. */
const EDITABLE = Object.freeze({
  kind: '',
  number: '',
  series: '',
  issue_date: '::date',
  competence: '::date',
  party_id: '::uuid',
  description: '',
  gross_amount_cents: '::bigint',
  withheld_cents: '::bigint',
  due_date: '::date',
  verification_code: '',
  notes: '',
});
export const INVOICE_EDITABLE_FIELDS = Object.freeze(Object.keys(EDITABLE));

function orderBy(sort) {
  const descending = sort.startsWith('-');
  const column = SORTS[descending ? sort.slice(1) : sort] ?? SORTS.issue_date;
  const direction = descending ? 'DESC' : 'ASC';
  // Nota sem data (em processamento) vai para o fim nas duas direções.
  return `${column} ${direction} NULLS LAST, i.created_at ${direction}, i.id`;
}

function filtersSql(companyId, filters) {
  const params = [companyId];
  const where = ["i.company_id = $1", "i.direction = 'issued'"];
  const param = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const active = 'i.archived_at IS NULL';
  switch (filters.tab) {
    case 'processing':
      where.push("i.status = 'processing'", active);
      break;
    case 'pending':
      where.push("i.status = 'issued'", "i.payment_status = 'pending'", active);
      break;
    case 'paid':
      where.push("i.payment_status = 'paid'", active);
      break;
    case 'issued':
      where.push("i.status = 'issued'", active);
      break;
    case 'cancelled':
      where.push("i.status = 'cancelled'", active);
      break;
    case 'archived':
      where.push('i.archived_at IS NOT NULL');
      break;
    default:
      break;
  }
  if (filters.party_id) where.push(`i.party_id = ${param(filters.party_id)}`);
  if (filters.kind) where.push(`i.kind = ${param(filters.kind)}`);
  if (filters.issued_from) where.push(`i.issue_date >= ${param(filters.issued_from)}::date`);
  if (filters.issued_to) where.push(`i.issue_date <= ${param(filters.issued_to)}::date`);
  if (filters.q) {
    const pattern = param(likePattern(filters.q));
    where.push(`(i.search_text LIKE f_unaccent(lower(${pattern})) OR p.search_text LIKE f_unaccent(lower(${pattern})))`);
  }
  return { params, where: where.join(' AND '), param };
}

export function invoicesRepository(db) {
  return {
    /** Página da lista + totais de todo o filtro. */
    async list(companyId, filters) {
      const { params, where, param } = filtersSql(companyId, filters);
      const totals = await db.query(
        `SELECT count(*) AS count,
                COALESCE(sum(i.gross_amount_cents), 0)::bigint AS gross_cents,
                COALESCE(sum(i.withheld_cents), 0)::bigint AS withheld_cents,
                COALESCE(sum(i.net_amount_cents), 0)::bigint AS net_cents
           ${INVOICE_FROM}
          WHERE ${where}`,
        params,
      );
      const limit = param(filters.limit);
      const offset = param((filters.page - 1) * filters.limit);
      const { rows } = await db.query(
        `${INVOICE_SELECT} ${INVOICE_FROM} WHERE ${where} ORDER BY ${orderBy(filters.sort)} LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      return { rows, totals: totals.rows[0] };
    },

    async find(companyId, id) {
      if (!isUuid(id)) return null;
      const { rows } = await db.query(
        `${INVOICE_SELECT} ${INVOICE_FROM} WHERE i.company_id = $1 AND i.id = $2 AND i.direction = 'issued'`,
        [companyId, id],
      );
      return rows[0] ?? null;
    },

    /** Trava a nota (mutação só depois disto — CLAUDE.md, regra 4). */
    async lock(companyId, id) {
      if (!isUuid(id)) return null;
      const { rows } = await db.query(
        `SELECT id, kind, number, series, issue_date, competence, party_id, description, gross_amount_cents,
                withheld_cents, net_amount_cents, due_date, verification_code, notes, status, payment_status,
                received_on, received_amount_cents, archived_at, version
           FROM invoices WHERE company_id = $1 AND id = $2 AND direction = 'issued' FOR UPDATE`,
        [companyId, id],
      );
      return rows[0] ?? null;
    },

    async insert(companyId, values, userId) {
      const { rows } = await db.query(
        `INSERT INTO invoices (company_id, kind, number, series, issue_date, competence, party_id, description,
                               gross_amount_cents, withheld_cents, due_date, verification_code, notes, created_by)
         VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9::bigint, $10::bigint, $11::date, $12, $13, $14)
         RETURNING id`,
        [
          companyId,
          values.kind,
          values.number ?? null,
          values.series ?? null,
          values.issue_date ?? null,
          values.competence ?? null,
          values.party_id ?? null,
          values.description,
          values.gross_amount_cents,
          values.withheld_cents ?? 0,
          values.due_date ?? null,
          values.verification_code ?? null,
          values.notes ?? null,
          userId,
        ],
      );
      return rows[0];
    },

    /** Grava os campos dados (allowlist) e sobe a versão. Nota cancelada não muda. */
    async update(companyId, id, fields, userId) {
      const entries = Object.entries(fields).filter(([column]) => column in EDITABLE);
      const assignments = [
        'version = version + 1',
        'updated_by = $3',
        ...entries.map(([column], index) => `${column} = $${index + 4}${EDITABLE[column]}`),
      ];
      const { rows } = await db.query(
        `UPDATE invoices SET ${assignments.join(', ')}
          WHERE company_id = $1 AND id = $2 AND status <> 'cancelled'
          RETURNING id, version`,
        [companyId, id, userId, ...entries.map(([, value]) => value)],
      );
      return rows[0] ?? null;
    },

    /** Em processamento → emitida (número e data já gravados ou vindos agora). */
    async issue(companyId, id, { number, series, issueDate, userId }) {
      const { rows } = await db.query(
        `UPDATE invoices SET status = 'issued', number = $3, series = $4, issue_date = $5::date,
                version = version + 1, updated_by = $6
          WHERE company_id = $1 AND id = $2 AND status = 'processing'
          RETURNING id`,
        [companyId, id, number, series, issueDate, userId],
      );
      return rows[0] ?? null;
    },

    async cancel(companyId, id, { reason, userId }) {
      const { rows } = await db.query(
        `UPDATE invoices SET status = 'cancelled', cancelled_at = now(), cancelled_by = $3, cancel_reason = $4,
                version = version + 1, updated_by = $3
          WHERE company_id = $1 AND id = $2 AND status <> 'cancelled' AND payment_status = 'pending'
          RETURNING id`,
        [companyId, id, userId, reason],
      );
      return rows[0] ?? null;
    },

    async markPaid(companyId, id, { receivedOn, receivedAmountCents, userId }) {
      const { rows } = await db.query(
        `UPDATE invoices SET payment_status = 'paid', received_on = $3::date, received_amount_cents = $4::bigint,
                version = version + 1, updated_by = $5
          WHERE company_id = $1 AND id = $2 AND status = 'issued' AND payment_status = 'pending'
          RETURNING id`,
        [companyId, id, receivedOn, receivedAmountCents, userId],
      );
      return rows[0] ?? null;
    },

    async unmarkPaid(companyId, id, { reason, userId }) {
      const { rows } = await db.query(
        `UPDATE invoices SET payment_status = 'pending', received_on = NULL, received_amount_cents = NULL,
                payment_undone_at = now(), payment_undone_by = $3, payment_undo_reason = $4,
                version = version + 1, updated_by = $3
          WHERE company_id = $1 AND id = $2 AND payment_status = 'paid'
          RETURNING id`,
        [companyId, id, userId, reason],
      );
      return rows[0] ?? null;
    },

    async setArchived(companyId, id, archived, userId) {
      const { rows } = await db.query(
        `UPDATE invoices SET archived_at = CASE WHEN $3 THEN now() END, version = version + 1, updated_by = $4
          WHERE company_id = $1 AND id = $2 AND (archived_at IS NOT NULL) <> $3
          RETURNING id`,
        [companyId, id, archived, userId],
      );
      return rows[0] ?? null;
    },

    // ---------- anexos ----------

    async listDocuments(companyId, invoiceId) {
      const { rows } = await db.query(
        `SELECT x.document_id, x.role, x.created_at AS linked_at, d.title, f.extension, f.size_bytes
           FROM invoice_documents x
           JOIN documents d ON d.company_id = x.company_id AND d.id = x.document_id
           JOIN LATERAL (SELECT v.file_id FROM document_versions v
                          WHERE v.company_id = d.company_id AND v.document_id = d.id
                          ORDER BY v.version_number DESC LIMIT 1) cv ON true
           JOIN files f ON f.company_id = d.company_id AND f.id = cv.file_id
          WHERE x.company_id = $1 AND x.invoice_id = $2 AND d.deleted_at IS NULL
          ORDER BY x.created_at`,
        [companyId, invoiceId],
      );
      return rows;
    },

    async linkDocument(companyId, invoiceId, documentId, { role, userId }) {
      const { rowCount } = await db.query(
        `INSERT INTO invoice_documents (company_id, invoice_id, document_id, role, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [companyId, invoiceId, documentId, role, userId],
      );
      return rowCount > 0;
    },

    async unlinkDocument(companyId, invoiceId, documentId) {
      if (!isUuid(documentId)) return null;
      const { rows } = await db.query(
        'DELETE FROM invoice_documents WHERE company_id = $1 AND invoice_id = $2 AND document_id = $3 RETURNING role',
        [companyId, invoiceId, documentId],
      );
      return rows[0] ?? null;
    },
  };
}

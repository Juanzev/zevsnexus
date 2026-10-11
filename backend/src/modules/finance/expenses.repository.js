// SQL de despesas, pagamentos, anexos e tags de despesa. companyId sempre primeiro; ordenação por
// allowlist; busca com curingas escapados. `paid_amount_cents` só muda em settle() (a função única).
import { isUuid } from '../../shared/db.js';
import { likePattern } from '../../shared/sql.js';

export const OPEN_STATUSES = Object.freeze(['pending', 'scheduled', 'partially_paid']);
export const PAYMENT_METHODS = Object.freeze(['pix', 'boleto', 'transfer', 'cash', 'card', 'check', 'other']);
export const ATTACHMENT_ROLES = Object.freeze(['receipt', 'invoice', 'boleto', 'contract', 'other']);
const OPEN = `e.status IN ('pending', 'scheduled', 'partially_paid')`;

/** Abas do Financeiro → condição (a data de hoje e a janela vêm como parâmetros). */
export const EXPENSE_TABS = Object.freeze(['open', 'overdue', 'upcoming', 'paid', 'cancelled', 'all']);

const SORTS = Object.freeze({
  due_date: 'e.due_date',
  amount: 'e.amount_cents',
  description: 'lower(e.description)',
  created_at: 'e.created_at',
});
export const EXPENSE_SORTS = Object.freeze(Object.keys(SORTS).flatMap((key) => [key, `-${key}`]));

/**
 * A expressão única do status (ARCHITECTURE §12.1). Recebe expressões SQL já seguras (colunas ou
 * parâmetros) para o pago, o valor e o agendamento resultantes da operação.
 */
function statusExpression({ paid, amount, scheduled }) {
  return `CASE WHEN ${paid} = ${amount} THEN 'paid'
               WHEN ${paid} > 0 THEN 'partially_paid'
               WHEN ${scheduled} IS NOT NULL THEN 'scheduled'
               ELSE 'pending' END`;
}

const EXPENSE_SELECT = `
  SELECT e.id, e.description, e.party_id, p.name AS party_name, e.category_id, c.name AS category_name,
         e.amount_cents, e.paid_amount_cents, e.due_date, e.scheduled_for, e.status, e.cancelled_at, e.cancel_reason,
         e.notes, e.version, e.created_at, e.updated_at,
         COALESCE(tg.names, '{}'::text[]) AS tags,
         EXISTS (SELECT 1 FROM expense_documents xd
                  WHERE xd.company_id = e.company_id AND xd.expense_id = e.id AND xd.role = 'receipt') AS has_receipt`;

const EXPENSE_FROM = `
    FROM expenses e
    LEFT JOIN parties p ON p.company_id = e.company_id AND p.id = e.party_id
    LEFT JOIN finance_categories c ON c.company_id = e.company_id AND c.id = e.category_id
    LEFT JOIN LATERAL (SELECT array_agg(t.name ORDER BY lower(t.name)) AS names
                         FROM expense_tags x JOIN tags t ON t.company_id = x.company_id AND t.id = x.tag_id
                        WHERE x.company_id = e.company_id AND x.expense_id = e.id) tg ON true`;

function orderBy(sort) {
  const descending = sort.startsWith('-');
  const column = SORTS[descending ? sort.slice(1) : sort] ?? SORTS.due_date;
  const direction = descending ? 'DESC' : 'ASC';
  return `${column} ${direction}, e.created_at ${direction}, e.id`;
}

/** WHERE dos filtros da lista (o mesmo para as linhas e para os totais). */
function filtersSql(companyId, filters) {
  const params = [companyId];
  const where = ['e.company_id = $1'];
  const param = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  switch (filters.tab) {
    case 'open':
      where.push(OPEN);
      break;
    case 'overdue':
      where.push(OPEN, `e.due_date < ${param(filters.today)}::date`);
      break;
    case 'upcoming': {
      const today = param(filters.today);
      where.push(OPEN, `e.due_date BETWEEN ${today}::date AND ${today}::date + ${param(filters.windowDays)}::int`);
      break;
    }
    case 'paid':
      where.push("e.status = 'paid'");
      break;
    case 'cancelled':
      where.push("e.status = 'cancelled'");
      break;
    default:
      break;
  }
  if (filters.party_id) where.push(`e.party_id = ${param(filters.party_id)}`);
  if (filters.category_id) where.push(`e.category_id = ${param(filters.category_id)}`);
  if (filters.tag_id) {
    where.push(`EXISTS (SELECT 1 FROM expense_tags x
                         WHERE x.company_id = e.company_id AND x.expense_id = e.id AND x.tag_id = ${param(filters.tag_id)})`);
  }
  if (filters.due_from) where.push(`e.due_date >= ${param(filters.due_from)}::date`);
  if (filters.due_to) where.push(`e.due_date <= ${param(filters.due_to)}::date`);
  if (filters.q) {
    const pattern = param(likePattern(filters.q));
    where.push(`(e.search_text LIKE f_unaccent(lower(${pattern}))
                 OR p.search_text LIKE f_unaccent(lower(${pattern}))
                 OR EXISTS (SELECT 1 FROM expense_tags x JOIN tags t ON t.company_id = x.company_id AND t.id = x.tag_id
                             WHERE x.company_id = e.company_id AND x.expense_id = e.id
                               AND f_unaccent(lower(t.name)) LIKE f_unaccent(lower(${pattern}))))`);
  }
  return { params, where: where.join(' AND '), param };
}

export function expensesRepository(db) {
  return {
    /** Página da lista + totais de todo o filtro (não só da página). */
    async list(companyId, filters) {
      const { params, where, param } = filtersSql(companyId, filters);
      const totals = await db.query(
        `SELECT count(*) AS count,
                COALESCE(sum(e.amount_cents), 0)::bigint AS amount_cents,
                COALESCE(sum(e.paid_amount_cents), 0)::bigint AS paid_cents,
                COALESCE(sum(e.amount_cents - e.paid_amount_cents) FILTER (WHERE ${OPEN}), 0)::bigint AS open_cents
           ${EXPENSE_FROM}
          WHERE ${where}`,
        params,
      );
      const limit = param(filters.limit);
      const offset = param((filters.page - 1) * filters.limit);
      const { rows } = await db.query(
        `${EXPENSE_SELECT} ${EXPENSE_FROM} WHERE ${where} ORDER BY ${orderBy(filters.sort)} LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      return { rows, totals: totals.rows[0] };
    },

    async find(companyId, id) {
      if (!isUuid(id)) return null;
      const { rows } = await db.query(`${EXPENSE_SELECT} ${EXPENSE_FROM} WHERE e.company_id = $1 AND e.id = $2`, [
        companyId,
        id,
      ]);
      return rows[0] ?? null;
    },

    /** Trava a despesa (mutação só depois disto — CLAUDE.md, regra 4). */
    async lock(companyId, id) {
      if (!isUuid(id)) return null;
      const { rows } = await db.query(
        `SELECT id, description, party_id, category_id, amount_cents, paid_amount_cents, due_date, scheduled_for,
                status, notes, version
           FROM expenses WHERE company_id = $1 AND id = $2 FOR UPDATE`,
        [companyId, id],
      );
      return rows[0] ?? null;
    },

    async insert(companyId, values, userId) {
      const { rows } = await db.query(
        `INSERT INTO expenses (company_id, description, party_id, category_id, amount_cents, due_date, scheduled_for,
                               notes, status, created_by)
         VALUES ($1, $2, $3, $4, $5::bigint, $6::date, $7::date, $8,
                 ${statusExpression({ paid: '0', amount: '$5::bigint', scheduled: '$7::date' })}, $9)
         RETURNING id`,
        [
          companyId,
          values.description,
          values.party_id ?? null,
          values.category_id ?? null,
          values.amount_cents,
          values.due_date,
          values.scheduled_for ?? null,
          values.notes ?? null,
          userId,
        ],
      );
      return rows[0];
    },

    /** Grava os campos dados, recalcula o status pela expressão única e sobe a versão. */
    async update(companyId, id, fields, userId) {
      const allowed = ['description', 'party_id', 'category_id', 'amount_cents', 'due_date', 'scheduled_for', 'notes'];
      const casts = { amount_cents: '::bigint', due_date: '::date', scheduled_for: '::date' };
      const entries = Object.entries(fields).filter(([column]) => allowed.includes(column));
      const params = [companyId, id, userId, ...entries.map(([, value]) => value)];
      const ref = (column) => {
        const index = entries.findIndex(([name]) => name === column);
        return index === -1 ? null : `$${index + 4}${casts[column] ?? ''}`;
      };
      const assignments = [
        'version = version + 1',
        'updated_by = $3',
        ...entries.map(([column], index) => `${column} = $${index + 4}${casts[column] ?? ''}`),
        `status = ${statusExpression({
          paid: 'paid_amount_cents',
          amount: ref('amount_cents') ?? 'amount_cents',
          scheduled: ref('scheduled_for') ?? 'scheduled_for',
        })}`,
      ];
      const { rows } = await db.query(
        `UPDATE expenses SET ${assignments.join(', ')}
          WHERE company_id = $1 AND id = $2 AND status <> 'cancelled'
          RETURNING id, version`,
        params,
      );
      return rows[0] ?? null;
    },

    /**
     * A função única do saldo (STRUCTURE pág. 07, "saldo derivado"): soma Δ ao pago num UPDATE atômico
     * que só passa se o resultado ficar entre 0 e o valor, e recalcula o status. null = recusado.
     */
    async settle(companyId, id, deltaCents, userId) {
      const { rows } = await db.query(
        `UPDATE expenses SET
           paid_amount_cents = paid_amount_cents + $3::bigint,
           status = ${statusExpression({
             paid: 'paid_amount_cents + $3::bigint',
             amount: 'amount_cents',
             scheduled: 'scheduled_for',
           })},
           version = version + 1,
           updated_by = $4
         WHERE company_id = $1 AND id = $2 AND status <> 'cancelled'
           AND paid_amount_cents + $3::bigint BETWEEN 0 AND amount_cents
         RETURNING id, amount_cents, paid_amount_cents, status, version`,
        [companyId, id, deltaCents, userId],
      );
      return rows[0] ?? null;
    },

    async cancel(companyId, id, { reason, userId }) {
      const { rows } = await db.query(
        `UPDATE expenses SET status = 'cancelled', cancelled_at = now(), cancelled_by = $3, cancel_reason = $4,
                version = version + 1, updated_by = $3
          WHERE company_id = $1 AND id = $2 AND status <> 'cancelled' AND paid_amount_cents = 0
          RETURNING id`,
        [companyId, id, userId, reason],
      );
      return rows[0] ?? null;
    },

    // ---------- pagamentos ----------

    async insertPayment(companyId, expenseId, payment, userId) {
      const { rows } = await db.query(
        `INSERT INTO expense_payments (company_id, expense_id, paid_on, amount_cents, method, reference, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, expense_id, paid_on, amount_cents, method, reference, notes, created_at`,
        [
          companyId,
          expenseId,
          payment.paid_on,
          payment.amount_cents,
          payment.method,
          payment.reference ?? null,
          payment.notes ?? null,
          userId,
        ],
      );
      return rows[0];
    },

    async listPayments(companyId, expenseId) {
      const { rows } = await db.query(
        `SELECT pay.id, pay.paid_on, pay.amount_cents, pay.method, pay.reference, pay.notes, pay.created_at,
                cu.name AS created_by_name, pay.voided_at, pay.void_reason, vu.name AS voided_by_name,
                rd.document_id AS receipt_document_id
           FROM expense_payments pay
           LEFT JOIN users cu ON cu.id = pay.created_by
           LEFT JOIN users vu ON vu.id = pay.voided_by
           LEFT JOIN LATERAL (SELECT xd.document_id FROM expense_documents xd
                               JOIN documents d ON d.company_id = xd.company_id AND d.id = xd.document_id
                              WHERE xd.company_id = pay.company_id AND xd.payment_id = pay.id AND d.deleted_at IS NULL
                              ORDER BY xd.created_at LIMIT 1) rd ON true
          WHERE pay.company_id = $1 AND pay.expense_id = $2
          ORDER BY pay.paid_on, pay.created_at`,
        [companyId, expenseId],
      );
      return rows;
    },

    /** Pagamento por id, sem travar (para descobrir a despesa e travá-la primeiro). */
    async findPayment(companyId, id) {
      if (!isUuid(id)) return null;
      const { rows } = await db.query(
        'SELECT id, expense_id FROM expense_payments WHERE company_id = $1 AND id = $2',
        [companyId, id],
      );
      return rows[0] ?? null;
    },

    async lockPayment(companyId, id) {
      const { rows } = await db.query(
        `SELECT id, expense_id, amount_cents, paid_on, method, voided_at
           FROM expense_payments WHERE company_id = $1 AND id = $2 FOR UPDATE`,
        [companyId, id],
      );
      return rows[0] ?? null;
    },

    async voidPayment(companyId, id, { reason, userId }) {
      const { rows } = await db.query(
        `UPDATE expense_payments SET voided_at = now(), voided_by = $3, void_reason = $4
          WHERE company_id = $1 AND id = $2 AND voided_at IS NULL
          RETURNING id`,
        [companyId, id, userId, reason],
      );
      return rows[0] ?? null;
    },

    // ---------- anexos e tags ----------

    async listDocuments(companyId, expenseId) {
      const { rows } = await db.query(
        `SELECT xd.document_id, xd.role, xd.payment_id, xd.created_at AS linked_at, d.title,
                f.extension, f.size_bytes
           FROM expense_documents xd
           JOIN documents d ON d.company_id = xd.company_id AND d.id = xd.document_id
           JOIN LATERAL (SELECT v.file_id FROM document_versions v
                          WHERE v.company_id = d.company_id AND v.document_id = d.id
                          ORDER BY v.version_number DESC LIMIT 1) cv ON true
           JOIN files f ON f.company_id = d.company_id AND f.id = cv.file_id
          WHERE xd.company_id = $1 AND xd.expense_id = $2 AND d.deleted_at IS NULL
          ORDER BY xd.created_at`,
        [companyId, expenseId],
      );
      return rows;
    },

    async linkDocument(companyId, expenseId, documentId, { role, paymentId = null, userId }) {
      const { rowCount } = await db.query(
        `INSERT INTO expense_documents (company_id, expense_id, document_id, payment_id, role, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [companyId, expenseId, documentId, paymentId, role, userId],
      );
      return rowCount > 0;
    },

    async unlinkDocument(companyId, expenseId, documentId) {
      if (!isUuid(documentId)) return null;
      const { rows } = await db.query(
        'DELETE FROM expense_documents WHERE company_id = $1 AND expense_id = $2 AND document_id = $3 RETURNING role',
        [companyId, expenseId, documentId],
      );
      return rows[0] ?? null;
    },

    async replaceTags(companyId, expenseId, tagIds) {
      await db.query('DELETE FROM expense_tags WHERE company_id = $1 AND expense_id = $2', [companyId, expenseId]);
      if (tagIds.length === 0) return;
      await db.query(
        `INSERT INTO expense_tags (company_id, expense_id, tag_id)
         SELECT $1, $2, tag_id FROM unnest($3::uuid[]) AS tag_id`,
        [companyId, expenseId, tagIds],
      );
    },

    // ---------- indicadores (D4) ----------

    /** Indicadores do dashboard no período [from, to] (datas no fuso da empresa). */
    async indicators(companyId, { today, from, to, soonDays }) {
      const expenses = await db.query(
        `SELECT
           count(*) FILTER (WHERE ${OPEN} AND e.due_date < $2::date) AS overdue_count,
           COALESCE(sum(e.amount_cents - e.paid_amount_cents) FILTER (WHERE ${OPEN} AND e.due_date < $2::date), 0)::bigint
             AS overdue_cents,
           count(*) FILTER (WHERE ${OPEN} AND e.due_date BETWEEN $2::date AND $2::date + $5::int) AS due_soon_count,
           COALESCE(sum(e.amount_cents - e.paid_amount_cents)
             FILTER (WHERE ${OPEN} AND e.due_date BETWEEN $2::date AND $2::date + $5::int), 0)::bigint AS due_soon_cents,
           count(*) FILTER (WHERE e.status <> 'cancelled' AND e.due_date BETWEEN $3::date AND $4::date) AS period_count,
           COALESCE(sum(e.amount_cents) FILTER (WHERE e.status <> 'cancelled' AND e.due_date BETWEEN $3::date AND $4::date), 0)::bigint
             AS period_cents
         FROM expenses e
        WHERE e.company_id = $1`,
        [companyId, today, from, to, soonDays],
      );
      const payments = await db.query(
        `SELECT count(*) AS paid_count, COALESCE(sum(amount_cents), 0)::bigint AS paid_cents
           FROM expense_payments
          WHERE company_id = $1 AND voided_at IS NULL AND paid_on BETWEEN $2::date AND $3::date`,
        [companyId, from, to],
      );
      return { ...expenses.rows[0], ...payments.rows[0] };
    },
  };
}

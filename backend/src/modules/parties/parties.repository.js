// SQL dos prestadores e fornecedores. companyId sempre primeiro; ordenação por allowlist; busca com
// curingas escapados. Projeção explícita (nunca SELECT *).
import { isUuid } from '../../shared/db.js';
import { likePattern } from '../../shared/sql.js';

export const PARTY_ROLES = Object.freeze(['supplier', 'service_provider', 'customer']);

const PARTY_COLUMNS = `p.id, p.person_type, p.name, p.trade_name, p.document_normalized, p.roles, p.specialty,
  p.email, p.phone, p.pix_key, p.notes, p.version, p.created_at, p.updated_at`;

/** Colunas graváveis (allowlist): nada fora daqui chega ao SQL. */
export const EDITABLE_COLUMNS = Object.freeze([
  'person_type',
  'name',
  'trade_name',
  'document_normalized',
  'roles',
  'specialty',
  'email',
  'phone',
  'pix_key',
  'notes',
]);

const SORTS = Object.freeze({ name: 'lower(p.name)', created_at: 'p.created_at' });
export const PARTY_SORTS = Object.freeze(Object.keys(SORTS).flatMap((key) => [key, `-${key}`]));

function orderBy(sort) {
  const descending = sort.startsWith('-');
  const column = SORTS[descending ? sort.slice(1) : sort] ?? SORTS.name;
  return `${column} ${descending ? 'DESC' : 'ASC'}, p.id`;
}

export function partiesRepository(db) {
  return {
    /** @param filters { q, role, person_type, sort, page, limit } */
    async list(companyId, filters) {
      const params = [companyId];
      const where = ['p.company_id = $1', 'p.deleted_at IS NULL'];
      const param = (value) => {
        params.push(value);
        return `$${params.length}`;
      };
      if (filters.role) where.push(`${param(filters.role)} = ANY (p.roles)`);
      if (filters.person_type) where.push(`p.person_type = ${param(filters.person_type)}`);
      if (filters.q) {
        const pattern = param(likePattern(filters.q));
        const clauses = [
          `p.search_text LIKE f_unaccent(lower(${pattern}))`,
          `p.email LIKE ${pattern}`,
        ];
        // Documento e telefone: só os dígitos/letras do que foi digitado (busca "123.456" acha "123456…").
        const compact = filters.q.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
        if (compact.length >= 3 && /\d/.test(compact)) {
          const compactPattern = param(likePattern(compact));
          clauses.push(`p.document_normalized LIKE ${compactPattern}`, `p.phone LIKE ${compactPattern}`);
        }
        where.push(`(${clauses.join(' OR ')})`);
      }
      const limit = param(filters.limit);
      const offset = param((filters.page - 1) * filters.limit);
      const { rows } = await db.query(
        `SELECT ${PARTY_COLUMNS}, count(*) OVER () AS total
           FROM parties p
          WHERE ${where.join(' AND ')}
          ORDER BY ${orderBy(filters.sort)}
          LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      return { rows, total: rows[0]?.total ?? 0 };
    },

    async find(companyId, id, { forUpdate = false } = {}) {
      if (!isUuid(id)) return null;
      const { rows } = await db.query(
        `SELECT ${PARTY_COLUMNS} FROM parties p
          WHERE p.company_id = $1 AND p.id = $2 AND p.deleted_at IS NULL${forUpdate ? ' FOR UPDATE' : ''}`,
        [companyId, id],
      );
      return rows[0] ?? null;
    },

    async insert(companyId, values, userId) {
      const entries = EDITABLE_COLUMNS.filter((column) => values[column] !== undefined).map((column) => [column, values[column]]);
      const names = ['company_id', 'created_by', ...entries.map(([column]) => column)];
      const params = [companyId, userId, ...entries.map(([, value]) => value)];
      const { rows } = await db.query(
        `INSERT INTO parties AS p (${names.join(', ')}) VALUES (${params.map((_, index) => `$${index + 1}`).join(', ')})
         RETURNING ${PARTY_COLUMNS}`,
        params,
      );
      return rows[0];
    },

    async update(companyId, id, values, userId) {
      const entries = EDITABLE_COLUMNS.filter((column) => values[column] !== undefined).map((column) => [column, values[column]]);
      const params = [companyId, id, userId, ...entries.map(([, value]) => value)];
      const assignments = [
        'version = p.version + 1',
        'updated_by = $3',
        ...entries.map(([column], index) => `${column} = $${index + 4}`),
      ];
      const { rows } = await db.query(
        `UPDATE parties AS p SET ${assignments.join(', ')}
          WHERE p.company_id = $1 AND p.id = $2 AND p.deleted_at IS NULL
          RETURNING ${PARTY_COLUMNS}`,
        params,
      );
      return rows[0] ?? null;
    },

    async softDelete(companyId, id, userId) {
      const { rowCount } = await db.query(
        `UPDATE parties SET deleted_at = now(), updated_by = $3, version = version + 1
          WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [companyId, id, userId],
      );
      return rowCount > 0;
    },

    /** Totais da ficha (só para quem tem finance.view): em aberto, vencido e pago (sem estornos). */
    async financeSummary(companyId, partyId, today) {
      const { rows } = await db.query(
        `SELECT
           count(*) FILTER (WHERE e.status <> 'cancelled') AS expense_count,
           COALESCE(sum(e.amount_cents - e.paid_amount_cents)
             FILTER (WHERE e.status IN ('pending', 'scheduled', 'partially_paid')), 0)::bigint AS open_cents,
           COALESCE(sum(e.amount_cents - e.paid_amount_cents)
             FILTER (WHERE e.status IN ('pending', 'scheduled', 'partially_paid') AND e.due_date < $3::date), 0)::bigint AS overdue_cents,
           (SELECT COALESCE(sum(pay.amount_cents), 0)::bigint FROM expense_payments pay
              JOIN expenses pe ON pe.company_id = pay.company_id AND pe.id = pay.expense_id
             WHERE pay.company_id = $1 AND pe.party_id = $2 AND pay.voided_at IS NULL) AS paid_cents
         FROM expenses e
        WHERE e.company_id = $1 AND e.party_id = $2`,
        [companyId, partyId, today],
      );
      return rows[0];
    },

    async listDocuments(companyId, partyId) {
      const { rows } = await db.query(
        `SELECT d.id, d.title, d.expires_on, d.updated_at, pd.created_at AS linked_at,
                f.extension, f.size_bytes
           FROM party_documents pd
           JOIN documents d ON d.company_id = pd.company_id AND d.id = pd.document_id
           JOIN LATERAL (SELECT v.file_id FROM document_versions v
                          WHERE v.company_id = d.company_id AND v.document_id = d.id
                          ORDER BY v.version_number DESC LIMIT 1) cv ON true
           JOIN files f ON f.company_id = d.company_id AND f.id = cv.file_id
          WHERE pd.company_id = $1 AND pd.party_id = $2 AND d.deleted_at IS NULL
          ORDER BY pd.created_at DESC`,
        [companyId, partyId],
      );
      return rows;
    },

    async linkDocument(companyId, partyId, documentId, userId) {
      const { rowCount } = await db.query(
        `INSERT INTO party_documents (company_id, party_id, document_id, created_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [companyId, partyId, documentId, userId],
      );
      return rowCount > 0;
    },

    async unlinkDocument(companyId, partyId, documentId) {
      if (!isUuid(documentId)) return false;
      const { rowCount } = await db.query(
        'DELETE FROM party_documents WHERE company_id = $1 AND party_id = $2 AND document_id = $3',
        [companyId, partyId, documentId],
      );
      return rowCount > 0;
    },
  };
}

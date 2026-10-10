// SQL do Painel ZEVS. Cross-tenant por desenho: só é usado dentro de withSystem() e auditado.
import { pool } from '../../shared/db.js';
import { likePattern } from '../../shared/sql.js';

const COMPANY_COLUMNS = `id, legal_name, trade_name, cnpj, status, created_at, approved_at, suspended_at, suspended_reason`;

export function platformRepository(db = pool) {
  return {
    async isAdmin(userId) {
      const { rowCount } = await db.query('SELECT 1 FROM platform_admins WHERE user_id = $1', [userId]);
      return rowCount > 0;
    },

    async listCompanies({ status, q, page, limit }) {
      const { rows } = await db.query(
        `SELECT c.id, c.legal_name, c.trade_name, c.cnpj, c.status, c.created_at, c.approved_at,
                c.suspended_at, c.suspended_reason, owner.name AS owner_name, owner.email AS owner_email,
                owner.email_verified AS owner_email_verified,
                (SELECT count(*) FROM memberships m WHERE m.company_id = c.id AND m.deleted_at IS NULL) AS members,
                count(*) OVER () AS total
           FROM companies c
           LEFT JOIN LATERAL (
             SELECT u.name, u.email, u.email_verified_at IS NOT NULL AS email_verified
               FROM memberships m
               JOIN membership_roles mr ON mr.membership_id = m.id AND mr.role_code = 'owner'
               JOIN users u ON u.id = m.user_id
              WHERE m.company_id = c.id AND m.deleted_at IS NULL
              ORDER BY m.created_at
              LIMIT 1
           ) AS owner ON true
          WHERE c.deleted_at IS NULL
            AND ($1::text IS NULL OR c.status = $1)
            AND ($2::text IS NULL OR c.legal_name ILIKE $2 OR c.trade_name ILIKE $2 OR c.cnpj ILIKE $2)
          ORDER BY c.created_at DESC
          LIMIT $3 OFFSET $4`,
        [status ?? null, q ? likePattern(q) : null, limit, (page - 1) * limit],
      );
      return { rows, total: rows[0]?.total ?? 0 };
    },

    async findCompanyForUpdate(companyId) {
      const { rows } = await db.query(
        `SELECT ${COMPANY_COLUMNS} FROM companies WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [companyId],
      );
      return rows[0] ?? null;
    },

    async approve(companyId, { adminId }) {
      const { rows } = await db.query(
        `UPDATE companies
            SET status = 'active', approved_at = COALESCE(approved_at, now()), approved_by = COALESCE(approved_by, $2),
                suspended_at = NULL, suspended_reason = NULL
          WHERE id = $1
          RETURNING ${COMPANY_COLUMNS}`,
        [companyId, adminId],
      );
      return rows[0];
    },

    async suspend(companyId, { reason }) {
      const { rows } = await db.query(
        `UPDATE companies SET status = 'suspended', suspended_at = now(), suspended_reason = $2
          WHERE id = $1
          RETURNING ${COMPANY_COLUMNS}`,
        [companyId, reason],
      );
      return rows[0];
    },
  };
}

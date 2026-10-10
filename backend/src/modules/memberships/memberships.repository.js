// SQL de vínculos usuário × empresa e da resolução do contexto do tenant (pág. 03 e 05).
import { pool } from '../../shared/db.js';

export function membershipsRepository(db = pool) {
  return {
    /**
     * Contexto do tenant numa query só: vínculo, status, papéis, permissões efetivas
     * ((papéis ∪ grants) − denies) e features ((plano ∪ ligadas) − desligadas).
     * Devolve null se o usuário não tem vínculo ativo (não excluído) com a empresa.
     */
    async findTenantContext(userId, companyId) {
      const { rows } = await db.query(
        `WITH m AS (
           SELECT m.id, m.status AS membership_status, c.id AS company_id, c.status AS company_status, c.timezone
             FROM memberships m
             JOIN companies c ON c.id = m.company_id
            WHERE m.user_id = $1 AND m.company_id = $2
              AND m.deleted_at IS NULL AND c.deleted_at IS NULL
         )
         SELECT m.id AS membership_id, m.membership_status, m.company_id, m.company_status, m.timezone,
                ARRAY(SELECT mr.role_code FROM membership_roles mr WHERE mr.membership_id = m.id ORDER BY 1) AS roles,
                ARRAY(
                  (SELECT rp.permission_code
                     FROM membership_roles mr JOIN role_permissions rp ON rp.role_code = mr.role_code
                    WHERE mr.membership_id = m.id
                   UNION
                   SELECT mp.permission_code FROM membership_permissions mp
                    WHERE mp.membership_id = m.id AND mp.effect = 'grant')
                  EXCEPT
                  SELECT mp.permission_code FROM membership_permissions mp
                   WHERE mp.membership_id = m.id AND mp.effect = 'deny'
                ) AS permissions,
                ARRAY(
                  (SELECT pf.feature_code
                     FROM subscriptions s JOIN plan_features pf ON pf.plan_code = s.plan_code
                    WHERE s.company_id = m.company_id
                   UNION
                   SELECT cf.feature_code FROM company_features cf
                    WHERE cf.company_id = m.company_id AND cf.enabled)
                  EXCEPT
                  SELECT cf.feature_code FROM company_features cf
                   WHERE cf.company_id = m.company_id AND NOT cf.enabled
                ) AS features
           FROM m`,
        [userId, companyId],
      );
      return rows[0] ?? null;
    },

    /** Empresas do próprio usuário (não é escopo de tenant: é a lista de vínculos dele). */
    async listForUser(userId) {
      const { rows } = await db.query(
        `SELECT c.id, c.legal_name, c.trade_name, c.status, m.id AS membership_id, m.status AS membership_status,
                ARRAY(SELECT mr.role_code FROM membership_roles mr WHERE mr.membership_id = m.id ORDER BY 1) AS roles
           FROM memberships m
           JOIN companies c ON c.id = m.company_id
          WHERE m.user_id = $1 AND m.deleted_at IS NULL AND c.deleted_at IS NULL
          ORDER BY c.created_at`,
        [userId],
      );
      return rows;
    },

    async insert(companyId, { userId, createdBy }) {
      const { rows } = await db.query(
        `INSERT INTO memberships (company_id, user_id, created_by) VALUES ($1, $2, $3)
         RETURNING id, company_id, user_id, status`,
        [companyId, userId, createdBy],
      );
      return rows[0];
    },

    async addRole(companyId, membershipId, roleCode, { createdBy }) {
      await db.query(
        `INSERT INTO membership_roles (company_id, membership_id, role_code, created_by)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [companyId, membershipId, roleCode, createdBy],
      );
    },

    /** E-mails e nomes dos owners ativos (para avisos da plataforma). */
    async listActiveOwners(companyId) {
      const { rows } = await db.query(
        `SELECT u.id, u.name, u.email
           FROM memberships m
           JOIN membership_roles mr ON mr.membership_id = m.id AND mr.role_code = 'owner'
           JOIN users u ON u.id = m.user_id
          WHERE m.company_id = $1 AND m.status = 'active' AND m.deleted_at IS NULL AND u.deleted_at IS NULL
          ORDER BY m.created_at`,
        [companyId],
      );
      return rows;
    },
  };
}

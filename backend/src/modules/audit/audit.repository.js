// SQL da auditoria. Só INSERT e leitura: UPDATE/DELETE/TRUNCATE são bloqueados por trigger.
import { pool } from '../../shared/db.js';

export function auditRepository(db = pool) {
  return {
    async insert(row) {
      await db.query(
        `INSERT INTO audit_logs
           (company_id, actor_type, actor_user_id, action, entity_type, entity_id, request_id, ip, user_agent, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          row.companyId,
          row.actorType,
          row.actorUserId,
          row.action,
          row.entityType,
          row.entityId,
          row.requestId,
          row.ip,
          row.userAgent,
          row.metadata,
        ],
      );
    },

    /** Quantos eventos `action` sobre a entidade nos últimos `seconds` segundos. */
    async countRecent({ action, entityId, seconds }) {
      const { rows } = await db.query(
        `SELECT count(*) AS total FROM audit_logs
          WHERE action = $1 AND entity_id = $2 AND created_at > now() - make_interval(secs => $3)`,
        [action, entityId, seconds],
      );
      return rows[0].total;
    },
  };
}

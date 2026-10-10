// SQL das chaves de idempotência (o middleware fica em src/middlewares/idempotency.js).
import { pool } from '../../shared/db.js';

export function idempotencyRepository(db = pool) {
  return {
    /** Reserva a chave; se ela existe mas venceu, é reaproveitada. Devolve o id ou null se já existe viva. */
    async acquire({ userId, companyId, scope, key, requestHash }) {
      const { rows } = await db.query(
        `INSERT INTO idempotency_keys (user_id, company_id, scope, key, request_hash)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, scope, key) DO UPDATE
           SET request_hash = EXCLUDED.request_hash, status = 'processing', response_status = NULL,
               response_body = NULL, created_at = now(), expires_at = now() + interval '24 hours'
           WHERE idempotency_keys.expires_at <= now()
         RETURNING id`,
        [userId, companyId, scope, key, requestHash],
      );
      return rows[0]?.id ?? null;
    },

    async find({ userId, scope, key }) {
      const { rows } = await db.query(
        `SELECT request_hash, status, response_status, response_body FROM idempotency_keys
          WHERE user_id = $1 AND scope = $2 AND key = $3`,
        [userId, scope, key],
      );
      return rows[0] ?? null;
    },

    async complete(id, { status, body }) {
      await db.query(
        `UPDATE idempotency_keys SET status = 'completed', response_status = $2, response_body = $3 WHERE id = $1`,
        [id, status, body],
      );
    },

    async release(id) {
      await db.query('DELETE FROM idempotency_keys WHERE id = $1', [id]);
    },

    async deleteExpired() {
      const { rowCount } = await db.query('DELETE FROM idempotency_keys WHERE expires_at <= now()');
      return rowCount;
    },
  };
}

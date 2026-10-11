// SQL dos arquivos (binários no storage). Toda função de tenant recebe companyId primeiro.
// As funções de manutenção (job) ficam em filesMaintenanceRepository, cross-tenant por desenho.
import { isUuid } from '../../shared/db.js';

const FILE_COLUMNS = `id, company_id, storage_key, original_name, extension, content_type, size_bytes, status,
  expires_at, uploaded_by, created_at, confirmed_at`;

export function filesRepository(db) {
  return {
    async insertPending(companyId, file) {
      const { rows } = await db.query(
        `INSERT INTO files (id, company_id, storage_key, original_name, extension, content_type, size_bytes,
                            uploaded_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(secs => $9))
         RETURNING ${FILE_COLUMNS}`,
        [
          file.id,
          companyId,
          file.storageKey,
          file.originalName,
          file.extension,
          file.contentType,
          file.sizeBytes,
          file.uploadedBy,
          file.ttlSeconds,
        ],
      );
      return rows[0];
    },

    async find(companyId, id, { forUpdate = false } = {}) {
      if (!isUuid(id)) return null;
      const { rows } = await db.query(
        `SELECT ${FILE_COLUMNS} FROM files WHERE company_id = $1 AND id = $2${forUpdate ? ' FOR UPDATE' : ''}`,
        [companyId, id],
      );
      return rows[0] ?? null;
    },

    async markRejected(companyId, id) {
      const { rowCount } = await db.query(
        `UPDATE files SET status = 'rejected' WHERE company_id = $1 AND id = $2 AND status = 'pending'`,
        [companyId, id],
      );
      return rowCount > 0;
    },

    async markReady(companyId, id) {
      const { rows } = await db.query(
        `UPDATE files SET status = 'ready', confirmed_at = now()
          WHERE company_id = $1 AND id = $2 AND status = 'pending'
          RETURNING ${FILE_COLUMNS}`,
        [companyId, id],
      );
      return rows[0] ?? null;
    },

    /** Limites do plano e uso atual, para a pré-checagem do envio. */
    async findLimits(companyId) {
      const { rows } = await db.query(
        `SELECT p.storage_quota_bytes, p.max_file_size_bytes, u.storage_bytes
           FROM company_usage u
           JOIN subscriptions s ON s.company_id = u.company_id
           JOIN plans p ON p.code = s.plan_code
          WHERE u.company_id = $1`,
        [companyId],
      );
      return rows[0] ?? null;
    },

    /**
     * A função única da cota (CLAUDE.md, regra 8): soma o arquivo ao uso num UPDATE atômico que só
     * passa se couber no plano. Devolve o novo uso, ou null se estourar a cota.
     */
    async consumeStorage(companyId, bytes) {
      const { rows } = await db.query(
        `UPDATE company_usage u
            SET storage_bytes = u.storage_bytes + $2, file_count = u.file_count + 1, updated_at = now()
           FROM subscriptions s
           JOIN plans p ON p.code = s.plan_code
          WHERE u.company_id = $1 AND s.company_id = $1 AND u.storage_bytes + $2 <= p.storage_quota_bytes
          RETURNING u.storage_bytes`,
        [companyId, bytes],
      );
      return rows[0]?.storage_bytes ?? null;
    },
  };
}

/** Manutenção (job de limpeza, em withSystem): atravessa empresas por desenho. */
export function filesMaintenanceRepository(db) {
  return {
    /**
     * Envios vencidos há mais de 1 h (folga: nenhuma confirmação iniciada antes do vencimento ainda
     * está em andamento) e recusados há mais de um dia.
     */
    async listDiscardable(limit) {
      const { rows } = await db.query(
        `SELECT id, company_id, storage_key FROM files
          WHERE (status = 'pending' AND expires_at < now() - interval '1 hour')
             OR (status = 'rejected' AND created_at < now() - interval '1 day')
          ORDER BY created_at
          LIMIT $1`,
        [limit],
      );
      return rows;
    },

    /** Apaga a linha só se ela ainda puder ser descartada (a confirmação pode ter vencido a corrida). */
    async deleteDiscardable(id) {
      const { rowCount } = await db.query(
        `DELETE FROM files
          WHERE id = $1
            AND ((status = 'pending' AND expires_at < now() - interval '1 hour')
              OR (status = 'rejected' AND created_at < now() - interval '1 day'))`,
        [id],
      );
      return rowCount > 0;
    },

    /** Arquivos confirmados cuja chave de envio ainda existe e cuja URL de PUT já expirou. */
    async listUploadsToPurge(olderThanSeconds, limit) {
      const { rows } = await db.query(
        `SELECT id, company_id FROM files
          WHERE status = 'ready' AND upload_purged_at IS NULL
            AND created_at < now() - make_interval(secs => $1)
          ORDER BY created_at
          LIMIT $2`,
        [olderThanSeconds, limit],
      );
      return rows;
    },

    async markUploadPurged(id) {
      await db.query('UPDATE files SET upload_purged_at = now() WHERE id = $1', [id]);
    },
  };
}

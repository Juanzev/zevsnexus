// SQL das pastas (lista de adjacência por empresa; CTE recursiva para caminho, ciclo e altura).
import { isUuid } from '../../shared/db.js';

const FOLDER_COLUMNS = 'id, parent_id, name, created_at, updated_at';
// Teto de segurança das CTEs: a regra de negócio (8 níveis) é checada no service.
const RECURSION_GUARD = 64;
// Espaço das travas consultivas por empresa (pg_advisory_xact_lock de dois inteiros).
const FOLDER_LOCK_SPACE = 4201;

export function foldersRepository(db) {
  return {
    /** Serializa criação e movimento de pastas da empresa: dois movimentos simultâneos não formam ciclo. */
    async lockTree(companyId) {
      await db.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [FOLDER_LOCK_SPACE, companyId]);
    },

    async listActive(companyId, limit) {
      const { rows } = await db.query(
        `SELECT f.id, f.parent_id, f.name, f.created_at, f.updated_at,
                (SELECT count(*) FROM documents d
                  WHERE d.company_id = f.company_id AND d.folder_id = f.id AND d.deleted_at IS NULL) AS document_count
           FROM folders f
          WHERE f.company_id = $1 AND f.deleted_at IS NULL
          ORDER BY lower(f.name), f.id
          LIMIT $2`,
        [companyId, limit],
      );
      return rows;
    },

    /**
     * Pasta ativa por id. `lock`: 'update' (mudar/excluir a pasta) ou 'share' (pôr um documento ou
     * subpasta dentro: conflita com a exclusão concorrente, não com outras inserções).
     */
    async find(companyId, id, { lock } = {}) {
      if (!isUuid(id)) return null;
      const suffix = lock === 'update' ? ' FOR UPDATE' : lock === 'share' ? ' FOR SHARE' : '';
      const { rows } = await db.query(
        `SELECT ${FOLDER_COLUMNS} FROM folders WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL${suffix}`,
        [companyId, id],
      );
      return rows[0] ?? null;
    },

    /** Caminho da raiz até a pasta (inclusive), para breadcrumb e profundidade. */
    async path(companyId, id) {
      const { rows } = await db.query(
        `WITH RECURSIVE chain AS (
           SELECT id, parent_id, name, 1 AS distance FROM folders
            WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
           UNION ALL
           SELECT f.id, f.parent_id, f.name, c.distance + 1
             FROM folders f JOIN chain c ON f.company_id = $1 AND f.id = c.parent_id
            WHERE c.distance < $3
         )
         SELECT id, name FROM chain ORDER BY distance DESC`,
        [companyId, id, RECURSION_GUARD],
      );
      return rows;
    },

    /** Altura da subárvore (a própria pasta = 1) e se `candidateId` está nela (ciclo). */
    async subtree(companyId, id, candidateId) {
      const { rows } = await db.query(
        `WITH RECURSIVE sub AS (
           SELECT id, 1 AS level FROM folders WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
           UNION ALL
           SELECT f.id, s.level + 1
             FROM folders f JOIN sub s ON f.company_id = $1 AND f.parent_id = s.id
            WHERE f.deleted_at IS NULL AND s.level < $4
         )
         SELECT COALESCE(max(level), 0) AS height, COALESCE(bool_or(id = $3), false) AS contains
           FROM sub`,
        [companyId, id, candidateId, RECURSION_GUARD],
      );
      return rows[0];
    },

    async insert(companyId, { parentId, name, userId }) {
      const { rows } = await db.query(
        `INSERT INTO folders (company_id, parent_id, name, created_by) VALUES ($1, $2, $3, $4)
         RETURNING ${FOLDER_COLUMNS}`,
        [companyId, parentId, name, userId],
      );
      return rows[0];
    },

    async update(companyId, id, { name, parentId, userId }) {
      const { rows } = await db.query(
        `UPDATE folders SET name = $3, parent_id = $4, updated_by = $5
          WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
          RETURNING ${FOLDER_COLUMNS}`,
        [companyId, id, name, parentId, userId],
      );
      return rows[0] ?? null;
    },

    /** Subpastas ativas e documentos fora da lixeira (arquivados contam). */
    async contentCounts(companyId, id) {
      const { rows } = await db.query(
        `SELECT
           (SELECT count(*) FROM folders WHERE company_id = $1 AND parent_id = $2 AND deleted_at IS NULL) AS folders,
           (SELECT count(*) FROM documents WHERE company_id = $1 AND folder_id = $2 AND deleted_at IS NULL) AS documents`,
        [companyId, id],
      );
      return rows[0];
    },

    async softDelete(companyId, id, userId) {
      const { rowCount } = await db.query(
        `UPDATE folders SET deleted_at = now(), updated_by = $3
          WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [companyId, id, userId],
      );
      return rowCount > 0;
    },

    /** Linha de configurações da empresa nova, já com as pastas padrão. */
    async insertSettings(companyId, folders) {
      await db.query(
        `INSERT INTO company_settings (company_id, company_folder_id, receipts_folder_id, invoices_folder_id, spreadsheets_folder_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          companyId,
          folders.company_folder_id,
          folders.receipts_folder_id,
          folders.invoices_folder_id,
          folders.spreadsheets_folder_id,
        ],
      );
    },

    /** Pasta padrão excluída: a configuração correspondente volta para a raiz (null). */
    async clearDefaultFolder(companyId, id) {
      await db.query(
        `UPDATE company_settings SET
           company_folder_id = NULLIF(company_folder_id, $2),
           receipts_folder_id = NULLIF(receipts_folder_id, $2),
           invoices_folder_id = NULLIF(invoices_folder_id, $2),
           spreadsheets_folder_id = NULLIF(spreadsheets_folder_id, $2)
         WHERE company_id = $1 AND $2 IN (company_folder_id, receipts_folder_id, invoices_folder_id, spreadsheets_folder_id)`,
        [companyId, id],
      );
    },
  };
}

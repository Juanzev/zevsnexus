// SQL dos documentos, versões, favoritos e histórico. companyId sempre primeiro; ordenação só por
// allowlist; busca com curingas escapados (likePattern).
import { isUuid } from '../../shared/db.js';
import { likePattern } from '../../shared/sql.js';

/** sort aceito na API → expressão SQL (allowlist: nada do usuário vira identificador). */
const SORTS = Object.freeze({
  updated_at: 'd.updated_at',
  created_at: 'd.created_at',
  title: 'lower(d.title)',
  expires_on: 'd.expires_on',
  size: 'f.size_bytes',
});
export const DOCUMENT_SORTS = Object.freeze(Object.keys(SORTS).flatMap((key) => [key, `-${key}`]));

/** Dias à frente do filtro "Vencendo" (D5.3). Vencidos também aparecem. */
export const EXPIRING_DAYS = 30;

// Projeção única de documento: versão atual (maior número), arquivo, tipo, tags e favorito do membro.
// $1 = company_id, $2 = membership_id. `extra` acrescenta colunas calculadas (ex.: total da página).
const selectDocument = (extra = '') => `
  SELECT d.id, d.title, d.description, d.folder_id, d.document_type_id, dt.name AS document_type_name,
         d.expires_on, d.archived_at, d.deleted_at, d.version, d.created_at, d.updated_at,
         d.created_by, cu.name AS created_by_name,
         cv.version_number AS current_version, f.id AS file_id, f.original_name, f.extension,
         f.content_type, f.size_bytes,
         COALESCE(tg.names, '{}'::text[]) AS tags,
         EXISTS (SELECT 1 FROM document_favorites fav
                  WHERE fav.company_id = d.company_id AND fav.document_id = d.id AND fav.membership_id = $2) AS favorite
         ${extra}
    FROM documents d
    JOIN LATERAL (SELECT v.version_number, v.file_id FROM document_versions v
                   WHERE v.company_id = d.company_id AND v.document_id = d.id
                   ORDER BY v.version_number DESC LIMIT 1) cv ON true
    JOIN files f ON f.company_id = d.company_id AND f.id = cv.file_id
    LEFT JOIN document_types dt ON dt.company_id = d.company_id AND dt.id = d.document_type_id
    LEFT JOIN users cu ON cu.id = d.created_by
    LEFT JOIN LATERAL (SELECT array_agg(t.name ORDER BY lower(t.name)) AS names
                         FROM document_tags x JOIN tags t ON t.company_id = x.company_id AND t.id = x.tag_id
                        WHERE x.company_id = d.company_id AND x.document_id = d.id) tg ON true
   WHERE d.company_id = $1`;

function orderBy(sort) {
  const descending = sort.startsWith('-');
  const column = SORTS[descending ? sort.slice(1) : sort] ?? SORTS.updated_at;
  const direction = descending ? 'DESC' : 'ASC';
  return `${column} ${direction} NULLS LAST, d.id ${direction}`;
}

export function documentsRepository(db) {
  return {
    /**
     * @param filters { folder ('root' | uuid), q, type_id, tag_id, favorites, archived, expiring, trash,
     *                  timezone, sort, page, limit }
     */
    async list(companyId, membershipId, filters) {
      const params = [companyId, membershipId];
      const where = [];
      const param = (value) => {
        params.push(value);
        return `$${params.length}`;
      };

      if (filters.trash) {
        where.push('d.deleted_at IS NOT NULL');
      } else {
        where.push('d.deleted_at IS NULL');
        where.push(filters.archived ? 'd.archived_at IS NOT NULL' : 'd.archived_at IS NULL');
      }
      if (filters.folder === 'root') where.push('d.folder_id IS NULL');
      else if (filters.folder) where.push(`d.folder_id = ${param(filters.folder)}`);
      if (filters.type_id) where.push(`d.document_type_id = ${param(filters.type_id)}`);
      if (filters.tag_id) {
        where.push(`EXISTS (SELECT 1 FROM document_tags x
                             WHERE x.company_id = d.company_id AND x.document_id = d.id AND x.tag_id = ${param(filters.tag_id)})`);
      }
      if (filters.favorites) {
        where.push(`EXISTS (SELECT 1 FROM document_favorites fav
                             WHERE fav.company_id = d.company_id AND fav.document_id = d.id AND fav.membership_id = $2)`);
      }
      if (filters.expiring) {
        where.push(
          `d.expires_on IS NOT NULL AND d.expires_on <= (now() AT TIME ZONE ${param(filters.timezone)})::date + ${EXPIRING_DAYS}`,
        );
      }
      if (filters.q) {
        const pattern = param(likePattern(filters.q));
        where.push(`(d.search_text LIKE f_unaccent(lower(${pattern}))
                     OR EXISTS (SELECT 1 FROM document_tags x JOIN tags t ON t.company_id = x.company_id AND t.id = x.tag_id
                                 WHERE x.company_id = d.company_id AND x.document_id = d.id
                                   AND f_unaccent(lower(t.name)) LIKE f_unaccent(lower(${pattern}))))`);
      }

      const limit = param(filters.limit);
      const offset = param((filters.page - 1) * filters.limit);
      const { rows } = await db.query(
        `${selectDocument(', count(*) OVER () AS total')} AND ${where.join(' AND ')}
          ORDER BY ${orderBy(filters.sort)}
          LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      return { rows, total: rows[0]?.total ?? 0 };
    },

    async find(companyId, membershipId, id) {
      if (!isUuid(id)) return null;
      const { rows } = await db.query(`${selectDocument()} AND d.id = $3`, [companyId, membershipId, id]);
      return rows[0] ?? null;
    },

    /** Trava o documento (mutação só depois disto — CLAUDE.md, regra 4). Inclui os que estão na lixeira. */
    async lock(companyId, id) {
      if (!isUuid(id)) return null;
      const { rows } = await db.query(
        `SELECT id, title, description, folder_id, document_type_id, expires_on, archived_at, deleted_at, version
           FROM documents WHERE company_id = $1 AND id = $2 FOR UPDATE`,
        [companyId, id],
      );
      return rows[0] ?? null;
    },

    async insert(companyId, doc) {
      const { rows } = await db.query(
        `INSERT INTO documents (company_id, folder_id, title, description, document_type_id, expires_on, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [companyId, doc.folderId, doc.title, doc.description, doc.documentTypeId, doc.expiresOn, doc.userId],
      );
      return rows[0];
    },

    /** Grava os campos dados e sobe a versão (concorrência otimista). */
    async update(companyId, id, fields, userId) {
      const allowed = ['title', 'description', 'document_type_id', 'expires_on', 'folder_id', 'archived_at', 'deleted_at'];
      const entries = Object.entries(fields).filter(([column]) => allowed.includes(column));
      const params = [companyId, id, userId, ...entries.map(([, value]) => value)];
      const assignments = [
        'version = version + 1',
        'updated_by = $3',
        ...entries.map(([column], index) => `${column} = $${index + 4}`),
      ];
      const { rows } = await db.query(
        `UPDATE documents SET ${assignments.join(', ')} WHERE company_id = $1 AND id = $2 RETURNING id, version`,
        params,
      );
      return rows[0] ?? null;
    },

    async listVersions(companyId, documentId) {
      const { rows } = await db.query(
        `SELECT v.version_number, v.comment, v.created_at, u.name AS created_by_name,
                f.id AS file_id, f.original_name, f.extension, f.content_type, f.size_bytes
           FROM document_versions v
           JOIN files f ON f.company_id = v.company_id AND f.id = v.file_id
           LEFT JOIN users u ON u.id = v.created_by
          WHERE v.company_id = $1 AND v.document_id = $2
          ORDER BY v.version_number DESC`,
        [companyId, documentId],
      );
      return rows;
    },

    async findVersion(companyId, documentId, versionNumber) {
      const { rows } = await db.query(
        `SELECT v.version_number, f.id AS file_id, f.storage_key, f.original_name, f.extension, f.content_type, f.size_bytes
           FROM document_versions v
           JOIN files f ON f.company_id = v.company_id AND f.id = v.file_id
          WHERE v.company_id = $1 AND v.document_id = $2
            AND v.version_number = COALESCE($3, (SELECT max(version_number) FROM document_versions
                                                  WHERE company_id = $1 AND document_id = $2))`,
        [companyId, documentId, versionNumber ?? null],
      );
      return rows[0] ?? null;
    },

    /** Próximo número de versão. Chamar com o documento travado (FOR UPDATE). */
    async insertVersion(companyId, documentId, { fileId, comment, userId }) {
      const { rows } = await db.query(
        `INSERT INTO document_versions (company_id, document_id, version_number, file_id, comment, created_by)
         SELECT $1, $2, COALESCE(max(version_number), 0) + 1, $3, $4, $5
           FROM document_versions WHERE company_id = $1 AND document_id = $2
         RETURNING version_number`,
        [companyId, documentId, fileId, comment, userId],
      );
      return rows[0].version_number;
    },

    async addFavorite(companyId, membershipId, documentId) {
      await db.query(
        `INSERT INTO document_favorites (company_id, membership_id, document_id) VALUES ($1, $2, $3)
         ON CONFLICT (membership_id, document_id) DO NOTHING`,
        [companyId, membershipId, documentId],
      );
    },

    async removeFavorite(companyId, membershipId, documentId) {
      await db.query('DELETE FROM document_favorites WHERE company_id = $1 AND membership_id = $2 AND document_id = $3', [
        companyId,
        membershipId,
        documentId,
      ]);
    },

    /** Vencidos e vencendo (até `days` dias) entre os ativos — calculado, nunca gravado. */
    async expiryCounts(companyId, today, days) {
      const { rows } = await db.query(
        `SELECT count(*) FILTER (WHERE expires_on < $2::date) AS expired_count,
                count(*) FILTER (WHERE expires_on BETWEEN $2::date AND $2::date + $3::int) AS expiring_count
           FROM documents
          WHERE company_id = $1 AND deleted_at IS NULL AND archived_at IS NULL AND expires_on IS NOT NULL`,
        [companyId, today, days],
      );
      return rows[0];
    },

    /** Auditoria do documento (o histórico da tela), com o nome de quem agiu. */
    async history(companyId, documentId, limit) {
      const { rows } = await db.query(
        `SELECT a.action, a.created_at, a.metadata, u.name AS actor_name, a.actor_type
           FROM audit_logs a
           LEFT JOIN users u ON u.id = a.actor_user_id
          WHERE a.company_id = $1 AND a.entity_type = 'document' AND a.entity_id = $2
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT $3`,
        [companyId, documentId, limit],
      );
      return rows;
    },
  };
}

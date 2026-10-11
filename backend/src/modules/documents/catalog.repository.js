// SQL dos tipos de documento e das tags da empresa.
import { isUuid } from '../../shared/db.js';
import { likePattern } from '../../shared/sql.js';

const TYPE_COLUMNS = 'id, name, archived_at, created_at';

export function documentTypesRepository(db) {
  return {
    async list(companyId, { includeArchived }) {
      const { rows } = await db.query(
        `SELECT t.id, t.name, t.archived_at, t.created_at,
                (SELECT count(*) FROM documents d
                  WHERE d.company_id = t.company_id AND d.document_type_id = t.id AND d.deleted_at IS NULL) AS document_count
           FROM document_types t
          WHERE t.company_id = $1 AND ($2 OR t.archived_at IS NULL)
          ORDER BY t.archived_at IS NOT NULL, lower(t.name)`,
        [companyId, includeArchived],
      );
      return rows;
    },

    /** Tipo por id; `activeOnly` para classificar um documento (tipo arquivado não recebe novos). */
    async find(companyId, id, { activeOnly = false, forUpdate = false } = {}) {
      if (!isUuid(id)) return null;
      const { rows } = await db.query(
        `SELECT ${TYPE_COLUMNS} FROM document_types
          WHERE company_id = $1 AND id = $2${activeOnly ? ' AND archived_at IS NULL' : ''}${forUpdate ? ' FOR UPDATE' : ''}`,
        [companyId, id],
      );
      return rows[0] ?? null;
    },

    async insert(companyId, { name, userId }) {
      const { rows } = await db.query(
        `INSERT INTO document_types (company_id, name, created_by) VALUES ($1, $2, $3) RETURNING ${TYPE_COLUMNS}`,
        [companyId, name, userId],
      );
      return rows[0];
    },

    async insertMany(companyId, names, userId) {
      await db.query(
        `INSERT INTO document_types (company_id, name, created_by)
         SELECT $1, name, $3 FROM unnest($2::text[]) AS name`,
        [companyId, names, userId],
      );
    },

    async rename(companyId, id, name) {
      const { rows } = await db.query(
        `UPDATE document_types SET name = $3 WHERE company_id = $1 AND id = $2 RETURNING ${TYPE_COLUMNS}`,
        [companyId, id, name],
      );
      return rows[0] ?? null;
    },

    async archive(companyId, id) {
      const { rows } = await db.query(
        `UPDATE document_types SET archived_at = now()
          WHERE company_id = $1 AND id = $2 AND archived_at IS NULL
          RETURNING ${TYPE_COLUMNS}`,
        [companyId, id],
      );
      return rows[0] ?? null;
    },
  };
}

export function tagsRepository(db) {
  return {
    /** Autocompletar: tags que contêm o texto, as mais usadas primeiro. */
    async search(companyId, query, limit) {
      const { rows } = await db.query(
        `SELECT t.id, t.name,
                (SELECT count(*) FROM document_tags x JOIN documents d ON d.company_id = x.company_id AND d.id = x.document_id
                  WHERE x.company_id = t.company_id AND x.tag_id = t.id AND d.deleted_at IS NULL) AS document_count
           FROM tags t
          WHERE t.company_id = $1 AND ($2::text IS NULL OR f_unaccent(lower(t.name)) LIKE f_unaccent(lower($2)))
          ORDER BY document_count DESC, lower(t.name)
          LIMIT $3`,
        [companyId, query ? likePattern(query) : null, limit],
      );
      return rows;
    },

    /** Garante as tags (criadas ao marcar) e devolve os ids, sem diferenciar maiúsculas. */
    async ensure(companyId, names) {
      if (names.length === 0) return [];
      await db.query(
        `INSERT INTO tags (company_id, name) SELECT $1, name FROM unnest($2::text[]) AS name
         ON CONFLICT (company_id, lower(name)) DO NOTHING`,
        [companyId, names],
      );
      const { rows } = await db.query(
        `SELECT id FROM tags
          WHERE company_id = $1 AND lower(name) IN (SELECT lower(name) FROM unnest($2::text[]) AS name)`,
        [companyId, names],
      );
      return rows.map((row) => row.id);
    },

    async replaceDocumentTags(companyId, documentId, tagIds) {
      await db.query('DELETE FROM document_tags WHERE company_id = $1 AND document_id = $2', [companyId, documentId]);
      if (tagIds.length === 0) return;
      await db.query(
        `INSERT INTO document_tags (company_id, document_id, tag_id)
         SELECT $1, $2, tag_id FROM unnest($3::uuid[]) AS tag_id`,
        [companyId, documentId, tagIds],
      );
    },
  };
}

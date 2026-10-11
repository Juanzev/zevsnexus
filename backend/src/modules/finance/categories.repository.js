// SQL das categorias financeiras (lista editável por empresa; arquivada, nunca apagada).
import { isUuid } from '../../shared/db.js';

const CATEGORY_COLUMNS = 'c.id, c.kind, c.name, c.sort_order, c.archived_at, c.created_at';

export function categoriesRepository(db) {
  return {
    async list(companyId, { kind, includeArchived }) {
      const { rows } = await db.query(
        `SELECT ${CATEGORY_COLUMNS},
                (SELECT count(*) FROM expenses e WHERE e.company_id = c.company_id AND e.category_id = c.id) AS expense_count
           FROM finance_categories c
          WHERE c.company_id = $1 AND ($2::text IS NULL OR c.kind = $2) AND ($3 OR c.archived_at IS NULL)
          ORDER BY c.archived_at IS NOT NULL, c.sort_order, lower(c.name)`,
        [companyId, kind ?? null, includeArchived],
      );
      return rows;
    },

    async find(companyId, id, { activeOnly = false, kind, forUpdate = false } = {}) {
      if (!isUuid(id)) return null;
      const params = [companyId, id];
      let sql = `SELECT ${CATEGORY_COLUMNS} FROM finance_categories c WHERE c.company_id = $1 AND c.id = $2`;
      if (activeOnly) sql += ' AND c.archived_at IS NULL';
      if (kind) {
        params.push(kind);
        sql += ` AND c.kind = $${params.length}`;
      }
      if (forUpdate) sql += ' FOR UPDATE';
      const { rows } = await db.query(sql, params);
      return rows[0] ?? null;
    },

    async insert(companyId, { kind, name, sortOrder, userId }) {
      const { rows } = await db.query(
        `INSERT INTO finance_categories AS c (company_id, kind, name, sort_order, created_by)
         VALUES ($1, $2, $3, COALESCE($4, (SELECT COALESCE(max(sort_order), 0) + 10 FROM finance_categories
                                              WHERE company_id = $1 AND kind = $2)), $5)
         RETURNING ${CATEGORY_COLUMNS}`,
        [companyId, kind, name, sortOrder ?? null, userId],
      );
      return rows[0];
    },

    async insertMany(companyId, kind, names, userId) {
      await db.query(
        `INSERT INTO finance_categories (company_id, kind, name, sort_order, created_by)
         SELECT $1, $2, name, position * 10, $4 FROM unnest($3::text[]) WITH ORDINALITY AS d(name, position)`,
        [companyId, kind, names, userId],
      );
    },

    async update(companyId, id, { name, sortOrder }) {
      const { rows } = await db.query(
        `UPDATE finance_categories AS c SET name = COALESCE($3, c.name), sort_order = COALESCE($4, c.sort_order)
          WHERE c.company_id = $1 AND c.id = $2
          RETURNING ${CATEGORY_COLUMNS}`,
        [companyId, id, name ?? null, sortOrder ?? null],
      );
      return rows[0] ?? null;
    },

    async archive(companyId, id) {
      const { rows } = await db.query(
        `UPDATE finance_categories AS c SET archived_at = now()
          WHERE c.company_id = $1 AND c.id = $2 AND c.archived_at IS NULL
          RETURNING ${CATEGORY_COLUMNS}`,
        [companyId, id],
      );
      return rows[0] ?? null;
    },
  };
}

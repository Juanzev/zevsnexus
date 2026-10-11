// SQL das planilhas (extensão 1:1 de documents). companyId sempre primeiro; ordenação por allowlist.
// Só valem documentos fora da lixeira cuja versão atual é planilha.
import { isUuid } from '../../shared/db.js';
import { SPREADSHEET_EXTENSIONS } from '../../shared/files.js';
import { likePattern } from '../../shared/sql.js';

export const SPREADSHEET_VIEWS = Object.freeze(['in_use', 'this_year', 'older', 'archived', 'all']);

const SORTS = Object.freeze({
  updated_at: 'd.updated_at',
  title: 'lower(d.title)',
  reference_year: 's.reference_year',
});
export const SPREADSHEET_SORTS = Object.freeze(Object.keys(SORTS).flatMap((key) => [key, `-${key}`]));

// $1 = company_id, $2 = extensões de planilha. `extra` acrescenta colunas calculadas.
const select = (extra = '') => `
  SELECT d.id, d.title, d.folder_id, d.archived_at, d.created_at, d.updated_at, d.version,
         s.in_use, s.reference_year,
         cv.version_number AS current_version, f.id AS file_id, f.original_name, f.extension, f.size_bytes
         ${extra}
    FROM spreadsheets s
    JOIN documents d ON d.company_id = s.company_id AND d.id = s.document_id
    JOIN LATERAL (SELECT v.version_number, v.file_id FROM document_versions v
                   WHERE v.company_id = d.company_id AND v.document_id = d.id
                   ORDER BY v.version_number DESC LIMIT 1) cv ON true
    JOIN files f ON f.company_id = d.company_id AND f.id = cv.file_id
   WHERE s.company_id = $1 AND d.deleted_at IS NULL AND f.extension = ANY ($2::text[])`;

function orderBy(sort) {
  const descending = sort.startsWith('-');
  const column = SORTS[descending ? sort.slice(1) : sort] ?? SORTS.updated_at;
  return `${column} ${descending ? 'DESC' : 'ASC'}, d.id`;
}

export function spreadsheetsRepository(db) {
  return {
    /** @param filters { view, q, year, sort, page, limit, currentYear } */
    async list(companyId, filters) {
      const params = [companyId, [...SPREADSHEET_EXTENSIONS]];
      const where = [];
      const param = (value) => {
        params.push(value);
        return `$${params.length}`;
      };
      switch (filters.view) {
        case 'in_use':
          where.push('s.in_use', 'd.archived_at IS NULL');
          break;
        case 'this_year':
          where.push(`s.reference_year = ${param(filters.currentYear)}`, 'd.archived_at IS NULL');
          break;
        case 'older':
          where.push(`s.reference_year < ${param(filters.currentYear)}`, 'd.archived_at IS NULL');
          break;
        case 'archived':
          where.push('d.archived_at IS NOT NULL');
          break;
        default:
          break;
      }
      if (filters.year) where.push(`s.reference_year = ${param(filters.year)}`);
      if (filters.q) where.push(`d.search_text LIKE f_unaccent(lower(${param(likePattern(filters.q))}))`);
      const limit = param(filters.limit);
      const offset = param((filters.page - 1) * filters.limit);
      const { rows } = await db.query(
        `${select(', count(*) OVER () AS total')}
         ${where.length > 0 ? `AND ${where.join(' AND ')}` : ''}
         ORDER BY ${orderBy(filters.sort)}
         LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      return { rows, total: rows[0]?.total ?? 0 };
    },

    async find(companyId, id) {
      if (!isUuid(id)) return null;
      const { rows } = await db.query(`${select()} AND d.id = $3`, [companyId, [...SPREADSHEET_EXTENSIONS], id]);
      return rows[0] ?? null;
    },

    /** Anos usados pela empresa (filtro da tela). */
    async years(companyId) {
      const { rows } = await db.query(
        'SELECT DISTINCT reference_year FROM spreadsheets WHERE company_id = $1 ORDER BY reference_year DESC',
        [companyId],
      );
      return rows.map((row) => row.reference_year);
    },

    /** Registro automático: cria a linha se o documento ainda não tem (nova versão mantém o que já existe). */
    async register(companyId, documentId, referenceYear) {
      const { rowCount } = await db.query(
        `INSERT INTO spreadsheets (company_id, document_id, reference_year) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [companyId, documentId, referenceYear],
      );
      return rowCount > 0;
    },

    async update(companyId, documentId, { inUse, referenceYear, userId }) {
      const { rows } = await db.query(
        `UPDATE spreadsheets
            SET in_use = COALESCE($3, in_use), reference_year = COALESCE($4, reference_year), updated_by = $5
          WHERE company_id = $1 AND document_id = $2
          RETURNING in_use, reference_year`,
        [companyId, documentId, inUse ?? null, referenceYear ?? null, userId],
      );
      return rows[0] ?? null;
    },

    /** Trava a linha (mutação só depois disto). */
    async lock(companyId, documentId) {
      if (!isUuid(documentId)) return null;
      const { rows } = await db.query(
        `SELECT s.in_use, s.reference_year FROM spreadsheets s
           JOIN documents d ON d.company_id = s.company_id AND d.id = s.document_id
          WHERE s.company_id = $1 AND s.document_id = $2 AND d.deleted_at IS NULL
          FOR UPDATE OF s`,
        [companyId, documentId],
      );
      return rows[0] ?? null;
    },
  };
}

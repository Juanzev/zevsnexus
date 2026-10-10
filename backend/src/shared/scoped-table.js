// Repository escopado (pág. 03, camada 2): `company_id` imposto em todo INSERT/UPDATE/DELETE,
// colunas só da allowlist (campo extra é ignorado) e UUIDs conferidos antes de tocar no banco.
// Tabela e colunas são identificadores fixos do código — nunca vêm do usuário.
import { isUuid } from './db.js';

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function assertIdentifier(name) {
  if (!IDENTIFIER.test(name)) throw new Error(`scopedTable: identificador inválido "${name}"`);
}

function assertUuid(value, label) {
  if (!isUuid(value)) throw new Error(`scopedTable: ${label} precisa ser UUID`);
}

/**
 * @param {string} table  tabela com `company_id`, `id`, `created_by`, `updated_by`, `deleted_at`
 * @param {{ columns: string[], returning: string[] }} options  colunas graváveis e projeção de retorno
 */
export function scopedTable(table, { columns, returning }) {
  assertIdentifier(table);
  columns.forEach(assertIdentifier);
  returning.forEach(assertIdentifier);
  const allowed = new Set(columns);
  const projection = returning.join(', ');

  function pick(values) {
    return Object.entries(values).filter(([column, value]) => allowed.has(column) && value !== undefined);
  }

  return {
    async insert(db, companyId, values, { userId }) {
      assertUuid(companyId, 'companyId');
      const entries = pick(values);
      const names = ['company_id', 'created_by', ...entries.map(([column]) => column)];
      const params = [companyId, userId, ...entries.map(([, value]) => value)];
      const placeholders = params.map((_, index) => `$${index + 1}`).join(', ');
      const { rows } = await db.query(
        `INSERT INTO ${table} (${names.join(', ')}) VALUES (${placeholders}) RETURNING ${projection}`,
        params,
      );
      return rows[0];
    },

    /** Atualiza só linhas ativas da empresa. Devolve null se nada mudou (inexistente ou de outro tenant). */
    async update(db, companyId, id, values, { userId }) {
      assertUuid(companyId, 'companyId');
      assertUuid(id, 'id');
      const entries = pick(values);
      const params = [companyId, id, userId, ...entries.map(([, value]) => value)];
      const assignments = ['updated_by = $3', ...entries.map(([column], index) => `${column} = $${index + 4}`)];
      const { rows } = await db.query(
        `UPDATE ${table} SET ${assignments.join(', ')}
          WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
          RETURNING ${projection}`,
        params,
      );
      return rows[0] ?? null;
    },

    async softDelete(db, companyId, id, { userId }) {
      assertUuid(companyId, 'companyId');
      assertUuid(id, 'id');
      const { rowCount } = await db.query(
        `UPDATE ${table} SET deleted_at = now(), updated_by = $3
          WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [companyId, id, userId],
      );
      return rowCount > 0;
    },

    /** Busca ativa por id; com `forUpdate`, trava a linha (mutação só depois disso — pág. 03). */
    async findById(db, companyId, id, { forUpdate = false } = {}) {
      assertUuid(companyId, 'companyId');
      if (!isUuid(id)) return null;
      const { rows } = await db.query(
        `SELECT ${projection} FROM ${table}
          WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL${forUpdate ? ' FOR UPDATE' : ''}`,
        [companyId, id],
      );
      return rows[0] ?? null;
    },
  };
}

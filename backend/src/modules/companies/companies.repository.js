// SQL da empresa (tabela raiz do tenant) e dos contatos. Toda função de dados de empresa recebe
// companyId como 1º argumento (pág. 03); contatos usam o scopedTable.
import { pool } from '../../shared/db.js';
import { scopedTable } from '../../shared/scoped-table.js';

const PROFILE_COLUMNS = `id, legal_name, trade_name, cnpj, status, timezone, state_registration, municipal_registration,
  tax_regime, email, phone, address_cep, address_street, address_number, address_complement, address_district,
  address_city, address_state, version, created_at, updated_at`;

/** Colunas da empresa que a própria empresa pode editar (allowlist). */
export const EDITABLE_PROFILE_COLUMNS = Object.freeze([
  'legal_name',
  'trade_name',
  'cnpj',
  'state_registration',
  'municipal_registration',
  'tax_regime',
  'email',
  'phone',
  'address_cep',
  'address_street',
  'address_number',
  'address_complement',
  'address_district',
  'address_city',
  'address_state',
]);

const contacts = scopedTable('company_contacts', {
  columns: ['name', 'role_title', 'email', 'phone', 'is_responsible', 'notes'],
  returning: ['id', 'name', 'role_title', 'email', 'phone', 'is_responsible', 'notes', 'created_at', 'updated_at'],
});

export function companiesRepository(db = pool) {
  return {
    // ---------- onboarding ----------
    async insertCompany({ legalName, tradeName, cnpj, timezone, createdBy }) {
      const { rows } = await db.query(
        `INSERT INTO companies (legal_name, trade_name, cnpj, timezone, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${PROFILE_COLUMNS}`,
        [legalName, tradeName, cnpj, timezone, createdBy],
      );
      return rows[0];
    },

    async insertBranding(companyId) {
      await db.query('INSERT INTO company_branding (company_id) VALUES ($1)', [companyId]);
    },

    async insertUsage(companyId) {
      await db.query('INSERT INTO company_usage (company_id) VALUES ($1)', [companyId]);
    },

    /** Trava por usuário para o onboarding: dois pedidos simultâneos não criam duas empresas pendentes. */
    async lockOnboarding(userId) {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('onboarding:' || $1::text, 0))", [userId]);
    },

    async countPendingCreatedBy(userId) {
      const { rows } = await db.query(
        `SELECT count(*) AS total FROM companies
          WHERE created_by = $1 AND status = 'pending' AND deleted_at IS NULL`,
        [userId],
      );
      return rows[0].total;
    },

    // ---------- perfil ----------
    async findProfile(companyId, { forUpdate = false } = {}) {
      const { rows } = await db.query(
        `SELECT ${PROFILE_COLUMNS} FROM companies
          WHERE id = $1 AND deleted_at IS NULL${forUpdate ? ' FOR UPDATE' : ''}`,
        [companyId],
      );
      return rows[0] ?? null;
    },

    /** Atualiza só colunas da allowlist e incrementa a versão (concorrência otimista). */
    async updateProfile(companyId, values, { userId }) {
      const entries = Object.entries(values).filter(
        ([column, value]) => EDITABLE_PROFILE_COLUMNS.includes(column) && value !== undefined,
      );
      const params = [companyId, userId, ...entries.map(([, value]) => value)];
      const assignments = [
        'version = version + 1',
        'updated_by = $2',
        ...entries.map(([column], index) => `${column} = $${index + 3}`),
      ];
      const { rows } = await db.query(
        `UPDATE companies SET ${assignments.join(', ')}
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING ${PROFILE_COLUMNS}`,
        params,
      );
      return rows[0];
    },

    async updateTimezone(companyId, timezone, { userId }) {
      await db.query(
        'UPDATE companies SET timezone = $2, version = version + 1, updated_by = $3 WHERE id = $1',
        [companyId, timezone, userId],
      );
    },

    async findBranding(companyId) {
      const { rows } = await db.query('SELECT primary_color FROM company_branding WHERE company_id = $1', [
        companyId,
      ]);
      return rows[0] ?? null;
    },

    async updateBranding(companyId, primaryColor, { userId }) {
      await db.query('UPDATE company_branding SET primary_color = $2, updated_by = $3 WHERE company_id = $1', [
        companyId,
        primaryColor,
        userId,
      ]);
    },

    // ---------- contatos ----------
    async listContacts(companyId) {
      const { rows } = await db.query(
        `SELECT id, name, role_title, email, phone, is_responsible, notes, created_at, updated_at
           FROM company_contacts
          WHERE company_id = $1 AND deleted_at IS NULL
          ORDER BY is_responsible DESC, name`,
        [companyId],
      );
      return rows;
    },

    findContact(companyId, id, options) {
      return contacts.findById(db, companyId, id, options);
    },

    insertContact(companyId, values, options) {
      return contacts.insert(db, companyId, values, options);
    },

    updateContact(companyId, id, values, options) {
      return contacts.update(db, companyId, id, values, options);
    },

    deleteContact(companyId, id, options) {
      return contacts.softDelete(db, companyId, id, options);
    },
  };
}

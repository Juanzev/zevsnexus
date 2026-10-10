import { pool } from '../../shared/db.js';

export function plansRepository(db = pool) {
  return {
    async findPlan(code) {
      const { rows } = await db.query(
        'SELECT code, name, max_users, storage_quota_bytes, max_file_size_bytes FROM plans WHERE code = $1',
        [code],
      );
      return rows[0] ?? null;
    },

    async findDefaultPlan() {
      const { rows } = await db.query(
        'SELECT code, name, max_users, storage_quota_bytes, max_file_size_bytes FROM plans WHERE is_default',
      );
      return rows[0] ?? null;
    },

    async insertSubscription(companyId, { planCode, status, trialDays }) {
      const { rows } = await db.query(
        `INSERT INTO subscriptions (company_id, plan_code, status, trial_ends_at)
         VALUES ($1, $2, $3, CASE WHEN $4 > 0 THEN now() + make_interval(days => $4) END)
         RETURNING id, plan_code, status, trial_ends_at`,
        [companyId, planCode, status, trialDays],
      );
      return rows[0];
    },
  };
}

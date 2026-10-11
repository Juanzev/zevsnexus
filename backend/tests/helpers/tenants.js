// Factories de tenant (pág. 17): createTenant({ roles }) cria a empresa e uma pessoa por papel,
// direto no banco, com access token pronto. Cada chamada usa nomes únicos.
import { randomUUID } from 'node:crypto';
import { pool } from '../../src/shared/db.js';
import { signAccessToken } from '../../src/shared/security/tokens.js';
import { createUser, uniqueEmail } from './users.js';

export async function addMember(company, role, { status = 'active', verified = true } = {}) {
  const user = await createUser({ email: uniqueEmail(role), name: `Pessoa ${role}`, verified });
  const { rows } = await pool.query(
    'INSERT INTO memberships (company_id, user_id, status) VALUES ($1, $2, $3) RETURNING id',
    [company.id, user.id, status],
  );
  await pool.query('INSERT INTO membership_roles (company_id, membership_id, role_code) VALUES ($1, $2, $3)', [
    company.id,
    rows[0].id,
    role,
  ]);
  return { user, membershipId: rows[0].id, token: signAccessToken(user.id) };
}

/**
 * @returns {{ company, members: Record<string, {user, membershipId, token}>, headers(role) }}
 */
export async function createTenant({ roles = ['owner'], status = 'active', legalName, plan = 'standard' } = {}) {
  const creator = await createUser({ email: uniqueEmail('criador') });
  const { rows } = await pool.query(
    `INSERT INTO companies (legal_name, status, created_by, approved_at)
     VALUES ($1, $2, $3, CASE WHEN $2 = 'active' THEN now() END)
     RETURNING id, legal_name, status, version`,
    [legalName ?? `Empresa ${randomUUID().slice(0, 8)}`, status, creator.id],
  );
  const company = rows[0];
  await pool.query('INSERT INTO company_branding (company_id) VALUES ($1)', [company.id]);
  await pool.query('INSERT INTO company_usage (company_id) VALUES ($1)', [company.id]);
  await pool.query(
    "INSERT INTO subscriptions (company_id, plan_code, status) VALUES ($1, $2, 'active')",
    [company.id, plan],
  );
  await pool.query('INSERT INTO company_settings (company_id) VALUES ($1)', [company.id]);

  const members = {};
  for (const role of roles) members[role] = await addMember(company, role);

  return {
    company,
    members,
    headers(role) {
      return { Authorization: `Bearer ${members[role].token}`, 'X-Company-Id': company.id };
    },
  };
}

export function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

export async function auditEvents({ companyId = null, action, entityId }) {
  const { rows } = await pool.query(
    `SELECT company_id, actor_type, actor_user_id, action, entity_type, entity_id, request_id, ip, user_agent, metadata
       FROM audit_logs
      WHERE action = $1 AND ($2::uuid IS NULL OR company_id = $2) AND ($3::uuid IS NULL OR entity_id = $3)
      ORDER BY created_at`,
    [action, companyId, entityId ?? null],
  );
  return rows;
}

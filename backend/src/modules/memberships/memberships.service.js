// Vínculos e contexto do tenant. Outros módulos falam com memberships só por aqui (pág. 01).
import { pool } from '../../shared/db.js';
import { membershipsRepository } from './memberships.repository.js';

/** Contexto do tenant para o par (usuário, empresa), ou null se não houver vínculo. */
export async function resolveTenantContext(userId, companyId) {
  const row = await membershipsRepository(pool).findTenantContext(userId, companyId);
  if (!row) return null;
  return {
    companyId: row.company_id,
    companyStatus: row.company_status,
    membershipId: row.membership_id,
    membershipStatus: row.membership_status,
    timezone: row.timezone,
    roles: row.roles,
    permissions: new Set(row.permissions),
    features: new Set(row.features),
  };
}

export async function listCompaniesForUser(userId) {
  const rows = await membershipsRepository(pool).listForUser(userId);
  return rows.map((row) => ({
    id: row.id,
    name: row.trade_name ?? row.legal_name,
    legal_name: row.legal_name,
    status: row.status,
    membership_status: row.membership_status,
    roles: row.roles,
  }));
}

/** Cria o vínculo de proprietário dentro da transação de onboarding. */
export async function createOwnerMembership(client, companyId, userId) {
  const repo = membershipsRepository(client);
  const membership = await repo.insert(companyId, { userId, createdBy: userId });
  await repo.addRole(companyId, membership.id, 'owner', { createdBy: userId });
  return membership;
}

export function listActiveOwners(db, companyId) {
  return membershipsRepository(db).listActiveOwners(companyId);
}

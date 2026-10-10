// Painel ZEVS (pág. 05 e 13): eixo separado do tenant. Opera em withSystem() e audita cada ação
// NA EMPRESA AFETADA, com actor_type = platform_admin.
import { env } from '../../config/env.js';
import { pool, withSystem } from '../../shared/db.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import { sendEmailLater } from '../email/email.service.js';
import { listActiveOwners } from '../memberships/memberships.service.js';
import { companyApprovedMessage } from './platform.emails.js';
import { platformRepository } from './platform.repository.js';

/**
 * Platform Admin = registro em platform_admins OU e-mail em PLATFORM_ADMIN_EMAILS **verificado**
 * (senão qualquer um cadastraria aquele e-mail e viraria admin — pág. 05).
 */
export async function isPlatformAdmin(user) {
  if (!user) return false;
  if (user.email_verified_at && env.PLATFORM_ADMIN_EMAILS.includes(String(user.email).toLowerCase())) return true;
  return platformRepository(pool).isAdmin(user.id);
}

function toCompany(row) {
  return {
    id: row.id,
    name: row.trade_name ?? row.legal_name,
    legal_name: row.legal_name,
    trade_name: row.trade_name,
    cnpj: row.cnpj,
    status: row.status,
    created_at: row.created_at,
    approved_at: row.approved_at,
    suspended_at: row.suspended_at,
    suspended_reason: row.suspended_reason,
  };
}

export function listCompanies(filters) {
  return withSystem(async (client) => {
    const { rows, total } = await platformRepository(client).listCompanies(filters);
    return {
      companies: rows.map((row) => ({
        ...toCompany(row),
        members: row.members,
        owner: row.owner_email
          ? { name: row.owner_name, email: row.owner_email, email_verified: row.owner_email_verified }
          : null,
      })),
      meta: { page: filters.page, limit: filters.limit, total },
    };
  });
}

/** Trava a empresa, confere o status de origem, aplica a mudança e audita — na transação dada. */
async function changeStatus(client, ctx, companyId, { allowedFrom, apply, action, conflictMessage }) {
  const repo = platformRepository(client);
  const company = await repo.findCompanyForUpdate(companyId);
  if (!company) throw new NotFoundError('COMPANY_NOT_FOUND', 'Empresa não encontrada.');
  if (!allowedFrom.includes(company.status)) throw new ConflictError('INVALID_COMPANY_STATUS', conflictMessage);
  const updated = await apply(repo);
  await recordAudit(client, ctx, {
    companyId,
    actorType: 'platform_admin',
    action,
    entityType: 'company',
    entityId: companyId,
    metadata: { from: company.status, to: updated.status },
  });
  return updated;
}

export async function approveCompany(ctx, companyId) {
  const { company, owners } = await withSystem(async (client) => {
    const approved = await changeStatus(client, ctx, companyId, {
      allowedFrom: ['pending'],
      apply: (repo) => repo.approve(companyId, { adminId: ctx.userId }),
      action: 'platform.company_approved',
      conflictMessage: 'Só empresas em análise podem ser aprovadas.',
    });
    return { company: approved, owners: await listActiveOwners(client, companyId) };
  });
  // E-mail só depois do commit.
  for (const owner of owners) sendEmailLater(companyApprovedMessage(owner, company));
  return toCompany(company);
}

export async function suspendCompany(ctx, companyId, { reason }) {
  const company = await withSystem((client) =>
    changeStatus(client, ctx, companyId, {
      allowedFrom: ['pending', 'active'],
      apply: (repo) => repo.suspend(companyId, { reason }),
      action: 'platform.company_suspended',
      conflictMessage: 'A empresa já está suspensa.',
    }),
  );
  return toCompany(company);
}

export async function reactivateCompany(ctx, companyId) {
  const company = await withSystem((client) =>
    changeStatus(client, ctx, companyId, {
      allowedFrom: ['suspended'],
      apply: (repo) => repo.approve(companyId, { adminId: ctx.userId }),
      action: 'platform.company_reactivated',
      conflictMessage: 'Só empresas suspensas podem ser reativadas.',
    }),
  );
  return toCompany(company);
}

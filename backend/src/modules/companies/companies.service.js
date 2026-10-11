// Regras da empresa: onboarding, perfil (concorrência otimista), configurações e contatos.
// Toda leitura e escrita de dados da empresa roda em withTenant (base do RLS — D2) e toda
// mudança grava auditoria na mesma transação.
import { setTenant, withTenant, withTransaction } from '../../shared/db.js';
import { AuthorizationError, ConflictError, NotFoundError } from '../../shared/errors.js';
import { auditChanges, recordAudit } from '../audit/audit.service.js';
import { createDefaults as createDocumentDefaults } from '../documents/documents.service.js';
import { createDefaultCategories } from '../finance/categories.service.js';
import { createOwnerMembership } from '../memberships/memberships.service.js';
import { startSubscription } from '../plans/plans.service.js';
import { companiesRepository, EDITABLE_PROFILE_COLUMNS } from './companies.repository.js';

const ADDRESS_FIELDS = ['cep', 'street', 'number', 'complement', 'district', 'city', 'state'];
const CONTACT_FIELDS = ['name', 'role_title', 'email', 'phone', 'is_responsible', 'notes'];
// Dado pessoal: a auditoria registra que mudou, nunca o valor (pág. 06 §12).
const PROFILE_PERSONAL = ['email', 'phone'];
const CONTACT_PERSONAL = ['name', 'email', 'phone', 'notes'];

export function toProfile(row) {
  return {
    id: row.id,
    name: row.trade_name ?? row.legal_name,
    legal_name: row.legal_name,
    trade_name: row.trade_name,
    cnpj: row.cnpj,
    status: row.status,
    timezone: row.timezone,
    state_registration: row.state_registration,
    municipal_registration: row.municipal_registration,
    tax_regime: row.tax_regime,
    email: row.email,
    phone: row.phone,
    address: Object.fromEntries(ADDRESS_FIELDS.map((field) => [field, row[`address_${field}`]])),
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function versionConflict(currentVersion) {
  return new ConflictError(
    'VERSION_CONFLICT',
    'Estes dados foram alterados em outro lugar. Recarregue a tela para ver a versão mais recente.',
    { current_version: currentVersion },
  );
}

/**
 * Onboarding (pág. 03): empresa `pending` + marca + uso + vínculo de proprietário + assinatura +
 * pastas, tipos de documento e configurações sugeridos (F3) + categorias financeiras (F4),
 * numa transação. Exige e-mail verificado e no máximo uma empresa pendente por pessoa.
 */
export async function createCompany(ctx, input) {
  if (!ctx.user.email_verified_at) {
    throw new AuthorizationError('EMAIL_NOT_VERIFIED', 'Confirme seu e-mail antes de cadastrar a empresa.');
  }
  return withTransaction(async (client) => {
    const repo = companiesRepository(client);
    await repo.lockOnboarding(ctx.userId);
    if ((await repo.countPendingCreatedBy(ctx.userId)) > 0) {
      throw new ConflictError(
        'PENDING_COMPANY_EXISTS',
        'Você já tem uma empresa em análise. Aguarde a aprovação antes de cadastrar outra.',
      );
    }
    const company = await repo.insertCompany({
      legalName: input.legal_name,
      tradeName: input.trade_name ?? null,
      cnpj: input.cnpj ?? null,
      timezone: input.timezone,
      createdBy: ctx.userId,
    });
    await setTenant(client, company.id);
    await repo.insertBranding(company.id);
    await repo.insertUsage(company.id);
    const membership = await createOwnerMembership(client, company.id, ctx.userId);
    const subscription = await startSubscription(client, company.id);
    await createDocumentDefaults(client, company.id, ctx.userId);
    await createDefaultCategories(client, company.id, ctx.userId);
    await recordAudit(client, ctx, {
      companyId: company.id,
      action: 'company.created',
      entityType: 'company',
      entityId: company.id,
      metadata: { status: company.status, plan: subscription.plan_code, membership_id: membership.id },
    });
    return toProfile(company);
  });
}

/** O que a SPA precisa da empresa atual para montar a tela (qualquer membro ativo). */
export function getContext(ctx, tenant) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = companiesRepository(client);
    const company = await repo.findProfile(ctx.companyId);
    const branding = await repo.findBranding(ctx.companyId);
    const folders = await repo.findDefaultFolders(ctx.companyId);
    return {
      company: {
        id: company.id,
        name: company.trade_name ?? company.legal_name,
        legal_name: company.legal_name,
        status: company.status,
        timezone: company.timezone,
      },
      membership: { id: tenant.membershipId, roles: tenant.roles },
      permissions: [...tenant.permissions].sort(),
      features: [...tenant.features].sort(),
      branding: { primary_color: branding?.primary_color ?? null },
      // Atalhos para as pastas padrão (null = raiz). Só ids: o conteúdo continua exigindo documents.view.
      document_folders: {
        company: folders?.company_folder_id ?? null,
        receipts: folders?.receipts_folder_id ?? null,
        invoices: folders?.invoices_folder_id ?? null,
        spreadsheets: folders?.spreadsheets_folder_id ?? null,
      },
    };
  });
}

export function getProfile(ctx) {
  return withTenant(ctx.companyId, async (client) => toProfile(await companiesRepository(client).findProfile(ctx.companyId)));
}

/** Corpo da API ({ address: {...} }) → colunas da tabela (address_*). */
function profileColumns(input) {
  const values = {};
  for (const column of EDITABLE_PROFILE_COLUMNS) {
    if (!column.startsWith('address_') && input[column] !== undefined) values[column] = input[column];
  }
  for (const field of ADDRESS_FIELDS) {
    if (input.address?.[field] !== undefined) values[`address_${field}`] = input.address[field];
  }
  return values;
}

export function updateProfile(ctx, input) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = companiesRepository(client);
    const current = await repo.findProfile(ctx.companyId, { forUpdate: true });
    if (current.version !== input.version) throw versionConflict(current.version);

    const values = profileColumns(input);
    if (Object.keys(values).length === 0) return toProfile(current);

    const updated = await repo.updateProfile(ctx.companyId, values, { userId: ctx.userId });
    const changes = auditChanges(current, updated, { fields: EDITABLE_PROFILE_COLUMNS, personal: PROFILE_PERSONAL });
    if (changes) {
      await recordAudit(client, ctx, { action: 'company.updated', entityType: 'company', entityId: ctx.companyId, metadata: { changes } });
    }
    return toProfile(updated);
  });
}

export function getSettings(ctx) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = companiesRepository(client);
    const company = await repo.findProfile(ctx.companyId);
    const branding = await repo.findBranding(ctx.companyId);
    return {
      timezone: company.timezone,
      primary_color: branding.primary_color,
      upcoming_window_days: await repo.findUpcomingWindow(ctx.companyId),
    };
  });
}

export function updateSettings(ctx, input) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = companiesRepository(client);
    const company = await repo.findProfile(ctx.companyId, { forUpdate: true });
    const branding = await repo.findBranding(ctx.companyId);
    const before = {
      timezone: company.timezone,
      primary_color: branding.primary_color,
      upcoming_window_days: await repo.findUpcomingWindow(ctx.companyId),
    };
    const after = { ...before, ...input };

    if (after.timezone !== before.timezone) await repo.updateTimezone(ctx.companyId, after.timezone, { userId: ctx.userId });
    if (after.primary_color !== before.primary_color) {
      await repo.updateBranding(ctx.companyId, after.primary_color, { userId: ctx.userId });
    }
    if (after.upcoming_window_days !== before.upcoming_window_days) {
      await repo.updateUpcomingWindow(ctx.companyId, after.upcoming_window_days);
    }
    const changes = auditChanges(before, after, { fields: ['timezone', 'primary_color', 'upcoming_window_days'] });
    if (changes) {
      await recordAudit(client, ctx, { action: 'settings.updated', entityType: 'company', entityId: ctx.companyId, metadata: { changes } });
    }
    return after;
  });
}

// ---------- contatos e responsáveis ----------

function contactNotFound() {
  return new NotFoundError('CONTACT_NOT_FOUND', 'Contato não encontrado.');
}

export function listContacts(ctx) {
  return withTenant(ctx.companyId, (client) => companiesRepository(client).listContacts(ctx.companyId));
}

export function createContact(ctx, input) {
  return withTenant(ctx.companyId, async (client) => {
    const contact = await companiesRepository(client).insertContact(ctx.companyId, input, { userId: ctx.userId });
    await recordAudit(client, ctx, {
      action: 'company_contact.created',
      entityType: 'company_contact',
      entityId: contact.id,
      metadata: { is_responsible: contact.is_responsible },
    });
    return contact;
  });
}

export function updateContact(ctx, id, input) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = companiesRepository(client);
    const current = await repo.findContact(ctx.companyId, id, { forUpdate: true });
    if (!current) throw contactNotFound();
    const updated = await repo.updateContact(ctx.companyId, id, input, { userId: ctx.userId });
    const changes = auditChanges(current, updated, { fields: CONTACT_FIELDS, personal: CONTACT_PERSONAL });
    if (changes) {
      await recordAudit(client, ctx, { action: 'company_contact.updated', entityType: 'company_contact', entityId: id, metadata: { changes } });
    }
    return updated;
  });
}

export function deleteContact(ctx, id) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = companiesRepository(client);
    if (!(await repo.findContact(ctx.companyId, id, { forUpdate: true }))) throw contactNotFound();
    await repo.deleteContact(ctx.companyId, id, { userId: ctx.userId });
    await recordAudit(client, ctx, { action: 'company_contact.deleted', entityType: 'company_contact', entityId: id });
  });
}

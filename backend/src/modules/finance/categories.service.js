// Categorias financeiras (ARCHITECTURE §12): lista genérica e editável, criada no onboarding.
// `kind` já separa despesa de receita; receitas entram quando houver contas a receber.
import { UNIQUE_VIOLATION, withTenant } from '../../shared/db.js';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import { categoriesRepository } from './categories.repository.js';

export const DEFAULT_EXPENSE_CATEGORIES = Object.freeze([
  'Mão de obra',
  'Materiais',
  'Serviços de terceiros',
  'Impostos e taxas',
  'Aluguel',
  'Contas de consumo',
  'Folha e pró-labore',
  'Equipamentos e ferramentas',
  'Transporte e combustível',
  'Tarifas bancárias',
  'Outros',
]);

function categoryNotFound() {
  return new NotFoundError('CATEGORY_NOT_FOUND', 'Categoria não encontrada.');
}

async function guardName(operation) {
  try {
    return await operation();
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION && err.constraint === 'finance_categories_name_key') {
      throw new ConflictError('CATEGORY_NAME_TAKEN', 'Já existe uma categoria com este nome.', [
        { field: 'name', code: 'CATEGORY_NAME_TAKEN', message: 'Já existe uma categoria com este nome.' },
      ]);
    }
    throw err;
  }
}

function toCategory(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    sort_order: row.sort_order,
    archived_at: row.archived_at,
    expense_count: row.expense_count ?? 0,
  };
}

/** Referência do body: categoria de despesa ativa da mesma empresa, senão 422. */
export async function assertExpenseCategory(client, companyId, categoryId) {
  if (categoryId === null || categoryId === undefined) return null;
  const category = await categoriesRepository(client).find(companyId, categoryId, { activeOnly: true, kind: 'expense' });
  if (!category) {
    throw new ValidationError(
      [{ field: 'category_id', code: 'CATEGORY_NOT_FOUND', message: 'Categoria não encontrada.' }],
      'CATEGORY_NOT_FOUND',
      'Categoria não encontrada.',
    );
  }
  return category;
}

export function listCategories(ctx, { kind, include_archived: includeArchived = false }) {
  return withTenant(ctx.companyId, async (client) =>
    (await categoriesRepository(client).list(ctx.companyId, { kind, includeArchived })).map(toCategory),
  );
}

export function createCategory(ctx, input) {
  return withTenant(ctx.companyId, async (client) => {
    const row = await guardName(() =>
      categoriesRepository(client).insert(ctx.companyId, {
        kind: input.kind,
        name: input.name,
        sortOrder: input.sort_order,
        userId: ctx.userId,
      }),
    );
    await recordAudit(client, ctx, {
      action: 'finance_category.created',
      entityType: 'finance_category',
      entityId: row.id,
      metadata: { kind: row.kind, name: row.name },
    });
    return toCategory(row);
  });
}

export function updateCategory(ctx, id, input) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = categoriesRepository(client);
    const current = await repo.find(ctx.companyId, id, { forUpdate: true });
    if (!current) throw categoryNotFound();
    const row = await guardName(() => repo.update(ctx.companyId, id, { name: input.name, sortOrder: input.sort_order }));
    const changes = {};
    if (row.name !== current.name) changes.name = { from: current.name, to: row.name };
    if (row.sort_order !== current.sort_order) changes.sort_order = { from: current.sort_order, to: row.sort_order };
    if (Object.keys(changes).length > 0) {
      await recordAudit(client, ctx, {
        action: 'finance_category.updated',
        entityType: 'finance_category',
        entityId: id,
        metadata: { changes },
      });
    }
    return toCategory(row);
  });
}

export function archiveCategory(ctx, id) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = categoriesRepository(client);
    const current = await repo.find(ctx.companyId, id, { forUpdate: true });
    if (!current) throw categoryNotFound();
    if (current.archived_at) return toCategory(current);
    const row = await repo.archive(ctx.companyId, id);
    await recordAudit(client, ctx, { action: 'finance_category.archived', entityType: 'finance_category', entityId: id });
    return toCategory(row);
  });
}

/** Onboarding: categorias de despesa sugeridas (na transação de criação da empresa). */
export function createDefaultCategories(client, companyId, userId) {
  return categoriesRepository(client).insertMany(companyId, 'expense', [...DEFAULT_EXPENSE_CATEGORIES], userId);
}

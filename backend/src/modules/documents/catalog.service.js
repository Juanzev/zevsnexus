// Tipos de documento (a "categoria", lista editável) e tags (criadas ao marcar um documento).
// Tipo é arquivado, nunca apagado: documentos antigos continuam mostrando o nome.
import { UNIQUE_VIOLATION, withTenant } from '../../shared/db.js';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import { documentTypesRepository, tagsRepository } from './catalog.repository.js';

export const DEFAULT_DOCUMENT_TYPES = Object.freeze([
  'Contrato',
  'Comprovante',
  'Nota fiscal',
  'Boleto',
  'Certidão',
  'Documento da empresa',
  'Planilha',
  'Outro',
]);
export const MAX_TAGS_PER_DOCUMENT = 10;

function typeNotFound() {
  return new NotFoundError('DOCUMENT_TYPE_NOT_FOUND', 'Tipo de documento não encontrado.');
}

async function guardName(operation) {
  try {
    return await operation();
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION && err.constraint === 'document_types_name_key') {
      throw new ConflictError('DOCUMENT_TYPE_NAME_TAKEN', 'Já existe um tipo de documento com este nome.', [
        { field: 'name', code: 'DOCUMENT_TYPE_NAME_TAKEN', message: 'Já existe um tipo com este nome.' },
      ]);
    }
    throw err;
  }
}

function toType(row) {
  return {
    id: row.id,
    name: row.name,
    archived_at: row.archived_at,
    document_count: row.document_count ?? 0,
  };
}

/** Referência do body: tipo ativo da mesma empresa, senão 422. */
export async function assertActiveType(client, companyId, typeId) {
  if (typeId === null || typeId === undefined) return null;
  const type = await documentTypesRepository(client).find(companyId, typeId, { activeOnly: true });
  if (!type) {
    throw new ValidationError(
      [{ field: 'document_type_id', code: 'DOCUMENT_TYPE_NOT_FOUND', message: 'Tipo de documento não encontrado.' }],
      'DOCUMENT_TYPE_NOT_FOUND',
      'Tipo de documento não encontrado.',
    );
  }
  return type;
}

export function listTypes(ctx, { include_archived: includeArchived = false } = {}) {
  return withTenant(ctx.companyId, async (client) =>
    (await documentTypesRepository(client).list(ctx.companyId, { includeArchived })).map(toType),
  );
}

export function createType(ctx, input) {
  return withTenant(ctx.companyId, async (client) => {
    const type = await guardName(() => documentTypesRepository(client).insert(ctx.companyId, { name: input.name, userId: ctx.userId }));
    await recordAudit(client, ctx, {
      action: 'document_type.created',
      entityType: 'document_type',
      entityId: type.id,
      metadata: { name: type.name },
    });
    return toType(type);
  });
}

export function renameType(ctx, id, input) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = documentTypesRepository(client);
    const current = await repo.find(ctx.companyId, id, { forUpdate: true });
    if (!current) throw typeNotFound();
    if (current.name === input.name) return toType(current);
    const type = await guardName(() => repo.rename(ctx.companyId, id, input.name));
    await recordAudit(client, ctx, {
      action: 'document_type.renamed',
      entityType: 'document_type',
      entityId: id,
      metadata: { changes: { name: { from: current.name, to: type.name } } },
    });
    return toType(type);
  });
}

export function archiveType(ctx, id) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = documentTypesRepository(client);
    const current = await repo.find(ctx.companyId, id, { forUpdate: true });
    if (!current) throw typeNotFound();
    if (current.archived_at) return toType(current);
    const type = await repo.archive(ctx.companyId, id);
    await recordAudit(client, ctx, { action: 'document_type.archived', entityType: 'document_type', entityId: id });
    return toType(type);
  });
}

export function searchTags(ctx, { q, limit }) {
  return withTenant(ctx.companyId, (client) => tagsRepository(client).search(ctx.companyId, q ?? null, limit));
}

/** Nomes de tag sem repetição (sem diferenciar maiúsculas), na ordem em que vieram. */
export function normalizeTagNames(names = []) {
  const seen = new Set();
  const result = [];
  for (const raw of names) {
    const name = raw.replace(/\s+/g, ' ').trim();
    const key = name.toLocaleLowerCase('pt-BR');
    if (!name || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

/** Substitui as tags do documento (criando as que faltam). */
export async function setDocumentTags(client, companyId, documentId, names) {
  const repo = tagsRepository(client);
  const ids = await repo.ensure(companyId, normalizeTagNames(names));
  await repo.replaceDocumentTags(companyId, documentId, ids);
}

export async function createDefaultTypes(client, companyId, userId) {
  await documentTypesRepository(client).insertMany(companyId, [...DEFAULT_DOCUMENT_TYPES], userId);
}

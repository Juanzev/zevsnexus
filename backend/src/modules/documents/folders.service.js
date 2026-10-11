// Pastas (ARCHITECTURE §11 e §11.1): árvore por empresa, até 8 níveis, nome único entre irmãs,
// mover sem ciclo (trava por empresa) e excluir só pasta vazia. Toda mudança é auditada.
import { UNIQUE_VIOLATION, withTenant } from '../../shared/db.js';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import { foldersRepository } from './folders.repository.js';

export const MAX_FOLDER_DEPTH = 8;
/** Teto da lista plana de pastas (a SPA monta a árvore a partir dela). */
const MAX_FOLDERS_LISTED = 2000;

function folderNotFound() {
  return new NotFoundError('FOLDER_NOT_FOUND', 'Pasta não encontrada.');
}

function nameTaken() {
  return new ConflictError('FOLDER_NAME_TAKEN', 'Já existe uma pasta com este nome aqui.', [
    { field: 'name', code: 'FOLDER_NAME_TAKEN', message: 'Já existe uma pasta com este nome aqui.' },
  ]);
}

function invalidParent(code, message) {
  return new ValidationError([{ field: 'parent_id', code, message }], code, message);
}

function toFolder(row) {
  return {
    id: row.id,
    parent_id: row.parent_id,
    name: row.name,
    document_count: row.document_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Converte a violação do índice único de nome entre irmãs em 409. */
async function guardName(operation) {
  try {
    return await operation();
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION && err.constraint === 'folders_sibling_name_key') throw nameTaken();
    throw err;
  }
}

/**
 * Pasta de destino de um documento ou subpasta (referência do body → 422 se não for da empresa).
 * FOR SHARE: impede que a pasta seja excluída enquanto algo entra nela.
 */
export async function assertTargetFolder(client, companyId, folderId, field = 'folder_id') {
  if (folderId === null || folderId === undefined) return null;
  const folder = await foldersRepository(client).find(companyId, folderId, { lock: 'share' });
  if (!folder) {
    throw new ValidationError([{ field, code: 'FOLDER_NOT_FOUND', message: 'Pasta não encontrada.' }], 'FOLDER_NOT_FOUND', 'Pasta não encontrada.');
  }
  return folder;
}

export function listFolders(ctx) {
  return withTenant(ctx.companyId, async (client) => {
    const rows = await foldersRepository(client).listActive(ctx.companyId, MAX_FOLDERS_LISTED);
    return rows.map(toFolder);
  });
}

export function getFolder(ctx, id) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = foldersRepository(client);
    const folder = await repo.find(ctx.companyId, id);
    if (!folder) throw folderNotFound();
    return { ...toFolder(folder), path: await repo.path(ctx.companyId, id) };
  });
}

export function createFolder(ctx, input) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = foldersRepository(client);
    await repo.lockTree(ctx.companyId);
    const parentId = input.parent_id ?? null;
    if (parentId) {
      await assertTargetFolder(client, ctx.companyId, parentId, 'parent_id');
      const depth = (await repo.path(ctx.companyId, parentId)).length;
      if (depth + 1 > MAX_FOLDER_DEPTH) {
        throw invalidParent('FOLDER_TOO_DEEP', `As pastas podem ter no máximo ${MAX_FOLDER_DEPTH} níveis.`);
      }
    }
    const folder = await guardName(() => repo.insert(ctx.companyId, { parentId, name: input.name, userId: ctx.userId }));
    await recordAudit(client, ctx, {
      action: 'folder.created',
      entityType: 'folder',
      entityId: folder.id,
      metadata: { parent_id: parentId },
    });
    return toFolder({ ...folder, document_count: 0 });
  });
}

export function renameFolder(ctx, id, input) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = foldersRepository(client);
    const current = await repo.find(ctx.companyId, id, { lock: 'update' });
    if (!current) throw folderNotFound();
    if (current.name === input.name) return toFolder(current);
    const folder = await guardName(() =>
      repo.update(ctx.companyId, id, { name: input.name, parentId: current.parent_id, userId: ctx.userId }),
    );
    // Nome de pasta pode conter nome de pessoa (ex.: pasta de um prestador).
    await recordAudit(client, ctx, { action: 'folder.renamed', entityType: 'folder', entityId: id, metadata: {} });
    return toFolder(folder);
  });
}

export function moveFolder(ctx, id, input) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = foldersRepository(client);
    await repo.lockTree(ctx.companyId);
    const current = await repo.find(ctx.companyId, id, { lock: 'update' });
    if (!current) throw folderNotFound();
    const parentId = input.parent_id ?? null;
    if (parentId === current.parent_id) return toFolder(current);

    let parentDepth = 0;
    if (parentId) {
      if (parentId === id) throw invalidParent('FOLDER_CYCLE', 'Uma pasta não pode ficar dentro dela mesma.');
      await assertTargetFolder(client, ctx.companyId, parentId, 'parent_id');
      parentDepth = (await repo.path(ctx.companyId, parentId)).length;
    }
    const subtree = await repo.subtree(ctx.companyId, id, parentId);
    if (subtree.contains) throw invalidParent('FOLDER_CYCLE', 'Uma pasta não pode ficar dentro de uma subpasta dela.');
    if (parentDepth + subtree.height > MAX_FOLDER_DEPTH) {
      throw invalidParent('FOLDER_TOO_DEEP', `As pastas podem ter no máximo ${MAX_FOLDER_DEPTH} níveis.`);
    }

    const folder = await guardName(() =>
      repo.update(ctx.companyId, id, { name: current.name, parentId, userId: ctx.userId }),
    );
    await recordAudit(client, ctx, {
      action: 'folder.moved',
      entityType: 'folder',
      entityId: id,
      metadata: { from: current.parent_id, to: parentId },
    });
    return toFolder(folder);
  });
}

export function deleteFolder(ctx, id) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = foldersRepository(client);
    const current = await repo.find(ctx.companyId, id, { lock: 'update' });
    if (!current) throw folderNotFound();
    const counts = await repo.contentCounts(ctx.companyId, id);
    if (counts.folders > 0 || counts.documents > 0) {
      throw new ConflictError('FOLDER_NOT_EMPTY', 'Só é possível excluir uma pasta vazia. Mova ou exclua o que está dentro dela.', {
        folders: counts.folders,
        documents: counts.documents,
      });
    }
    await repo.softDelete(ctx.companyId, id, ctx.userId);
    await repo.clearDefaultFolder(ctx.companyId, id);
    await recordAudit(client, ctx, { action: 'folder.deleted', entityType: 'folder', entityId: id, metadata: {} });
  });
}

/** Pastas sugeridas da empresa nova (dados editáveis). Devolve os ids das pastas padrão. */
export async function createDefaultFolders(client, companyId, userId) {
  const repo = foldersRepository(client);
  const make = (name, parentId = null) => repo.insert(companyId, { parentId, name, userId });
  const company = await make('Empresa');
  const finance = await make('Financeiro');
  const receipts = await make('Comprovantes', finance.id);
  const invoices = await make('Notas fiscais');
  const spreadsheets = await make('Planilhas');
  for (const name of ['Contratos', 'Prestadores', 'Outros']) await make(name);
  return {
    company_folder_id: company.id,
    receipts_folder_id: receipts.id,
    invoices_folder_id: invoices.id,
    spreadsheets_folder_id: spreadsheets.id,
  };
}

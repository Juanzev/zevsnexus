// Central de Documentos (ARCHITECTURE §11 e §11.1). "Um arquivo, um lugar": todo arquivo é um
// documento com versões; os outros módulos vinculam documentos.
// Mutação por id só depois do documento travado (FOR UPDATE); auditoria na mesma transação.
import { withTenant } from '../../shared/db.js';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js';
import { isInlineAllowed, SPREADSHEET_EXTENSIONS, titleFromFilename } from '../../shared/files.js';
import { addDays, todayIn } from '../../shared/timezones.js';
import { auditChanges, PERSONAL_DATA, recordAudit } from '../audit/audit.service.js';
import * as filesService from '../files/files.service.js';
import { spreadsheetsRepository } from '../spreadsheets/spreadsheets.repository.js';
import { assertActiveType, createDefaultTypes, normalizeTagNames, setDocumentTags } from './catalog.service.js';
import { documentsRepository, EXPIRING_DAYS } from './documents.repository.js';
import { foldersRepository } from './folders.repository.js';
import { assertTargetFolder, createDefaultFolders } from './folders.service.js';

const HISTORY_LIMIT = 100;
// Título e descrição podem conter nomes de pessoas: a auditoria registra só que mudaram.
const EDITABLE_FIELDS = ['title', 'description', 'document_type_id', 'expires_on'];
const PERSONAL_FIELDS = ['title', 'description'];
// O que o histórico da tela mostra do metadata da auditoria (nada de valor pessoal).
const HISTORY_DETAILS = ['version_number', 'from_version', 'disposition', 'extension', 'size_bytes', 'reference_year'];

function documentNotFound() {
  return new NotFoundError('DOCUMENT_NOT_FOUND', 'Documento não encontrado.');
}

function versionNotFound() {
  return new NotFoundError('VERSION_NOT_FOUND', 'Versão não encontrada.');
}

function inTrash() {
  return new ConflictError('DOCUMENT_IN_TRASH', 'O documento está na lixeira. Restaure-o antes de alterar.');
}

function versionConflict(currentVersion) {
  return new ConflictError(
    'VERSION_CONFLICT',
    'Este documento foi alterado em outro lugar. Recarregue a tela para ver a versão mais recente.',
    { current_version: currentVersion },
  );
}

/** Quem não pode gerenciar documentos não enxerga a lixeira (nem por id). */
function visible(ctx, row) {
  return Boolean(row) && (!row.deleted_at || ctx.permissions.has('documents.manage'));
}

/** "Vencido" e "vencendo" são calculados no fuso da empresa, nunca gravados. */
function expiryStatus(expiresOn, today) {
  if (!expiresOn) return null;
  if (expiresOn < today) return 'expired';
  if (expiresOn <= addDays(today, EXPIRING_DAYS)) return 'expiring';
  return 'valid';
}

function today(ctx) {
  return todayIn(ctx.timezone);
}

/**
 * Planilha (xlsx, xls, csv, ods) ganha a linha em `spreadsheets` (ARCHITECTURE §13.1.1). O ano vem da
 * tela (data de modificação do arquivo) ou, sem ele, é o ano corrente no fuso da empresa.
 */
async function registerSpreadsheet(client, ctx, documentId, extension, referenceYear) {
  if (!SPREADSHEET_EXTENSIONS.includes(extension)) return;
  const year = referenceYear ?? Number(today(ctx).slice(0, 4));
  if (await spreadsheetsRepository(client).register(ctx.companyId, documentId, year)) {
    await recordAudit(client, ctx, {
      action: 'spreadsheet.registered',
      entityType: 'document',
      entityId: documentId,
      metadata: { extension, reference_year: year },
    });
  }
}

export function toDocument(row, todayDate) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    folder_id: row.folder_id,
    document_type: row.document_type_id ? { id: row.document_type_id, name: row.document_type_name } : null,
    tags: row.tags,
    expires_on: row.expires_on,
    expiry_status: expiryStatus(row.expires_on, todayDate),
    favorite: row.favorite,
    archived_at: row.archived_at,
    deleted_at: row.deleted_at,
    current_version: row.current_version,
    file: {
      original_name: row.original_name,
      extension: row.extension,
      content_type: row.content_type,
      size_bytes: row.size_bytes,
      inline: isInlineAllowed(row.extension),
    },
    created_by: { name: row.created_by_name },
    created_at: row.created_at,
    updated_at: row.updated_at,
    version: row.version,
  };
}

function toVersion(row) {
  return {
    number: row.version_number,
    comment: row.comment,
    created_at: row.created_at,
    created_by: { name: row.created_by_name },
    file: {
      original_name: row.original_name,
      extension: row.extension,
      content_type: row.content_type,
      size_bytes: row.size_bytes,
    },
  };
}

// ---------- leitura ----------

export function listDocuments(ctx, filters, { trash = false } = {}) {
  return withTenant(ctx.companyId, async (client) => {
    const { rows, total } = await documentsRepository(client).list(ctx.companyId, ctx.membershipId, {
      ...filters,
      trash,
      timezone: ctx.timezone,
    });
    const todayDate = today(ctx);
    return {
      documents: rows.map((row) => toDocument(row, todayDate)),
      meta: { page: filters.page, limit: filters.limit, total },
    };
  });
}

export function getDocument(ctx, id) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = documentsRepository(client);
    const row = await repo.find(ctx.companyId, ctx.membershipId, id);
    if (!visible(ctx, row)) throw documentNotFound();
    const versions = await repo.listVersions(ctx.companyId, id);
    const path = row.folder_id ? await foldersRepository(client).path(ctx.companyId, row.folder_id) : [];
    return { ...toDocument(row, today(ctx)), path, versions: versions.map(toVersion) };
  });
}

export function getHistory(ctx, id) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = documentsRepository(client);
    if (!visible(ctx, await repo.find(ctx.companyId, ctx.membershipId, id))) throw documentNotFound();
    const rows = await repo.history(ctx.companyId, id, HISTORY_LIMIT);
    return rows.map((row) => ({
      action: row.action,
      created_at: row.created_at,
      actor: { name: row.actor_name ?? (row.actor_type === 'platform_admin' ? 'Equipe ZEVS' : null) },
      details: Object.fromEntries(HISTORY_DETAILS.filter((key) => key in row.metadata).map((key) => [key, row.metadata[key]])),
      changed_fields: row.metadata.changes ? Object.keys(row.metadata.changes) : [],
    }));
  });
}

// ---------- envio e versões ----------

/**
 * Documento a partir de um arquivo já conferido (verifyUpload), DENTRO da transação de quem usa o
 * arquivo: Central de Documentos, comprovante de pagamento, anexo de despesa ou de prestador.
 * Valida as referências, consome a cota, marca o arquivo `ready`, cria o documento, a versão 1, as
 * tags e a auditoria. Devolve { id, file }.
 */
export async function createFromUpload(client, ctx, fileId, input = {}) {
  const folderId = input.folder_id ?? null;
  const documentTypeId = input.document_type_id ?? null;
  await assertTargetFolder(client, ctx.companyId, folderId);
  await assertActiveType(client, ctx.companyId, documentTypeId);
  const claimed = await filesService.claimFile(client, ctx, fileId);

  const repo = documentsRepository(client);
  const { id } = await repo.insert(ctx.companyId, {
    folderId,
    title: (input.title || titleFromFilename(claimed.original_name)).slice(0, 200),
    description: input.description ?? null,
    documentTypeId,
    expiresOn: input.expires_on ?? null,
    userId: ctx.userId,
  });
  await repo.insertVersion(ctx.companyId, id, { fileId: claimed.id, comment: null, userId: ctx.userId });
  if (input.tags?.length) await setDocumentTags(client, ctx.companyId, id, input.tags);
  await registerSpreadsheet(client, ctx, id, claimed.extension, input.reference_year);
  await recordAudit(client, ctx, {
    action: 'document.uploaded',
    entityType: 'document',
    entityId: id,
    metadata: {
      version_number: 1,
      file_id: claimed.id,
      extension: claimed.extension,
      size_bytes: claimed.size_bytes,
      folder_id: folderId,
      document_type_id: documentTypeId,
    },
  });
  return { id, file: claimed };
}

/** POST /documents: conferência no storage fora da transação; o resto em createFromUpload. */
export async function createDocument(ctx, input) {
  const file = await filesService.verifyUpload(ctx, input.file_id);
  return withTenant(ctx.companyId, async (client) => {
    const { id } = await createFromUpload(client, ctx, file.id, input);
    return toDocument(await documentsRepository(client).find(ctx.companyId, ctx.membershipId, id), today(ctx));
  });
}

/** Documento existente (fora da lixeira) para vincular a uma despesa ou prestador; senão 422. */
export async function assertLinkableDocument(client, ctx, documentId, field = 'document_id') {
  const row = await documentsRepository(client).find(ctx.companyId, ctx.membershipId, documentId);
  if (!row || row.deleted_at) {
    throw new ValidationError(
      [{ field, code: 'DOCUMENT_NOT_FOUND', message: 'Documento não encontrado.' }],
      'DOCUMENT_NOT_FOUND',
      'Documento não encontrado.',
    );
  }
  return row;
}

/** Pasta padrão de um uso ('receipts', 'parties'…), ou null = raiz. */
export function defaultFolder(client, companyId, use) {
  return foldersRepository(client).findDefaultFolder(companyId, use);
}

/** Trava o documento ativo (fora da lixeira) para alterar. */
async function lockActive(client, ctx, id) {
  const doc = await documentsRepository(client).lock(ctx.companyId, id);
  if (!doc) throw documentNotFound();
  if (doc.deleted_at) throw inTrash();
  return doc;
}

export async function addVersion(ctx, id, input) {
  // Documento inexistente ou de outra empresa responde 404 antes de qualquer trabalho no storage.
  await withTenant(ctx.companyId, async (client) => {
    if (!visible(ctx, await documentsRepository(client).find(ctx.companyId, ctx.membershipId, id))) throw documentNotFound();
  });
  const file = await filesService.verifyUpload(ctx, input.file_id);
  return withTenant(ctx.companyId, async (client) => {
    const repo = documentsRepository(client);
    await lockActive(client, ctx, id);
    const claimed = await filesService.claimFile(client, ctx, file.id);
    const versionNumber = await repo.insertVersion(ctx.companyId, id, {
      fileId: claimed.id,
      comment: input.comment ?? null,
      userId: ctx.userId,
    });
    await repo.update(ctx.companyId, id, {}, ctx.userId);
    await registerSpreadsheet(client, ctx, id, claimed.extension, input.reference_year);
    await recordAudit(client, ctx, {
      action: 'document.version_added',
      entityType: 'document',
      entityId: id,
      metadata: { version_number: versionNumber, file_id: claimed.id, extension: claimed.extension, size_bytes: claimed.size_bytes },
    });
    return toDocument(await repo.find(ctx.companyId, ctx.membershipId, id), today(ctx));
  });
}

/** Restaurar não reescreve o histórico: cria uma versão nova apontando para o arquivo antigo. */
export function restoreVersion(ctx, id, versionNumber) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = documentsRepository(client);
    await lockActive(client, ctx, id);
    const target = await repo.findVersion(ctx.companyId, id, versionNumber);
    if (!target) throw versionNotFound();
    const current = await repo.findVersion(ctx.companyId, id, null);
    if (current.version_number === target.version_number) {
      throw new ConflictError('VERSION_IS_CURRENT', 'Esta já é a versão atual.');
    }
    const created = await repo.insertVersion(ctx.companyId, id, {
      fileId: target.file_id,
      comment: `Restaurada da versão ${target.version_number}`,
      userId: ctx.userId,
    });
    await repo.update(ctx.companyId, id, {}, ctx.userId);
    await recordAudit(client, ctx, {
      action: 'document.version_restored',
      entityType: 'document',
      entityId: id,
      metadata: { from_version: target.version_number, version_number: created },
    });
    return toDocument(await repo.find(ctx.companyId, ctx.membershipId, id), today(ctx));
  });
}

/** URL de GET de 60 s. A auditoria do download é gravada antes de a URL sair. */
export function createDownloadUrl(ctx, id, input) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = documentsRepository(client);
    if (!visible(ctx, await repo.find(ctx.companyId, ctx.membershipId, id))) throw documentNotFound();
    const version = await repo.findVersion(ctx.companyId, id, input.version ?? null);
    if (!version) throw versionNotFound();
    const signed = await filesService.signDownload(version, { disposition: input.disposition });
    await recordAudit(client, ctx, {
      action: 'document.downloaded',
      entityType: 'document',
      entityId: id,
      metadata: { version_number: version.version_number, disposition: signed.disposition },
    });
    return signed;
  });
}

// ---------- metadados, pasta e estados ----------

export function updateDocument(ctx, id, input) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = documentsRepository(client);
    const locked = await lockActive(client, ctx, id);
    if (locked.version !== input.version) throw versionConflict(locked.version);
    const current = await repo.find(ctx.companyId, ctx.membershipId, id);

    const fields = {};
    for (const field of EDITABLE_FIELDS) {
      if (input[field] !== undefined && input[field] !== locked[field]) fields[field] = input[field];
    }
    if (fields.document_type_id) await assertActiveType(client, ctx.companyId, fields.document_type_id);

    const tagsChanged =
      input.tags !== undefined &&
      normalizeTagNames(input.tags).join('\n').toLowerCase() !== current.tags.join('\n').toLowerCase();
    if (Object.keys(fields).length === 0 && !tagsChanged) return toDocument(current, today(ctx));

    await repo.update(ctx.companyId, id, fields, ctx.userId);
    if (tagsChanged) await setDocumentTags(client, ctx.companyId, id, input.tags);
    const changes = auditChanges(locked, { ...locked, ...fields }, { fields: EDITABLE_FIELDS, personal: PERSONAL_FIELDS }) ?? {};
    if (tagsChanged) changes.tags = PERSONAL_DATA;
    await recordAudit(client, ctx, { action: 'document.updated', entityType: 'document', entityId: id, metadata: { changes } });
    return toDocument(await repo.find(ctx.companyId, ctx.membershipId, id), today(ctx));
  });
}

export function moveDocument(ctx, id, input) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = documentsRepository(client);
    const doc = await lockActive(client, ctx, id);
    const folderId = input.folder_id ?? null;
    if (folderId !== doc.folder_id) {
      await assertTargetFolder(client, ctx.companyId, folderId);
      await repo.update(ctx.companyId, id, { folder_id: folderId }, ctx.userId);
      await recordAudit(client, ctx, {
        action: 'document.moved',
        entityType: 'document',
        entityId: id,
        metadata: { from: doc.folder_id, to: folderId },
      });
    }
    return toDocument(await repo.find(ctx.companyId, ctx.membershipId, id), today(ctx));
  });
}

/** Arquiva ou desarquiva na transação dada (o documento é travado aqui). Devolve se mudou. */
export async function applyArchived(client, ctx, id, archived) {
  const doc = await lockActive(client, ctx, id);
  if (Boolean(doc.archived_at) === archived) return false;
  await documentsRepository(client).update(ctx.companyId, id, { archived_at: archived ? new Date() : null }, ctx.userId);
  await recordAudit(client, ctx, {
    action: archived ? 'document.archived' : 'document.unarchived',
    entityType: 'document',
    entityId: id,
  });
  return true;
}

function setArchived(ctx, id, archived) {
  return withTenant(ctx.companyId, async (client) => {
    await applyArchived(client, ctx, id, archived);
    return toDocument(await documentsRepository(client).find(ctx.companyId, ctx.membershipId, id), today(ctx));
  });
}

export const archiveDocument = (ctx, id) => setArchived(ctx, id, true);
export const unarchiveDocument = (ctx, id) => setArchived(ctx, id, false);

/** Lixeira: restaurável; a exclusão definitiva (e a devolução da cota) é do job da F10. */
export function trashDocument(ctx, id) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = documentsRepository(client);
    const doc = await repo.lock(ctx.companyId, id);
    if (!doc) throw documentNotFound();
    if (doc.deleted_at) return;
    await repo.update(ctx.companyId, id, { deleted_at: new Date() }, ctx.userId);
    await recordAudit(client, ctx, { action: 'document.deleted', entityType: 'document', entityId: id });
  });
}

/** Sai da lixeira. Se a pasta foi excluída nesse meio-tempo, o documento volta para a raiz. */
export function restoreDocument(ctx, id) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = documentsRepository(client);
    const doc = await repo.lock(ctx.companyId, id);
    if (!doc?.deleted_at) throw documentNotFound();
    let folderId = doc.folder_id;
    if (folderId && !(await foldersRepository(client).find(ctx.companyId, folderId, { lock: 'share' }))) folderId = null;
    await repo.update(ctx.companyId, id, { deleted_at: null, folder_id: folderId }, ctx.userId);
    await recordAudit(client, ctx, {
      action: 'document.restored',
      entityType: 'document',
      entityId: id,
      metadata: { folder_id: folderId, moved_to_root: folderId !== doc.folder_id },
    });
    return toDocument(await repo.find(ctx.companyId, ctx.membershipId, id), today(ctx));
  });
}

/** Favorito é preferência do membro: sem auditoria. */
export function setFavorite(ctx, id, favorite) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = documentsRepository(client);
    const row = await repo.find(ctx.companyId, ctx.membershipId, id);
    if (!row || row.deleted_at) throw documentNotFound();
    if (favorite) await repo.addFavorite(ctx.companyId, ctx.membershipId, id);
    else await repo.removeFavorite(ctx.companyId, ctx.membershipId, id);
  });
}

/** Bloco de documentos do dashboard (D5.3). Chamar dentro da transação do dashboard. */
export async function documentIndicators(client, ctx, todayDate) {
  const row = await documentsRepository(client).expiryCounts(ctx.companyId, todayDate, EXPIRING_DAYS);
  return { expired_count: row.expired_count, expiring_count: row.expiring_count, expiring_days: EXPIRING_DAYS };
}

// ---------- empresa nova ----------

/**
 * Onboarding (na transação de criação da empresa): pastas sugeridas, tipos de documento e a linha de
 * configurações com as pastas padrão. Tudo editável depois.
 */
export async function createDefaults(client, companyId, userId) {
  const folders = await createDefaultFolders(client, companyId, userId);
  await createDefaultTypes(client, companyId, userId);
  await foldersRepository(client).insertSettings(companyId, folders);
}

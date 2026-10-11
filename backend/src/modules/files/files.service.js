// Arquivos (ARCHITECTURE §5.2, §10.2 e §10.3): intenção de envio, conferência do que chegou ao
// storage e "posse" pelo documento na mesma transação que cria o documento ou a versão.
// Nenhuma função daqui apaga objeto a pedido de uma rota: só o job (cleanupFiles).
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { withSystem, withTenant } from '../../shared/db.js';
import { AppError, ValidationError } from '../../shared/errors.js';
import {
  isInlineAllowed,
  matchesSignature,
  resolveFileType,
  sanitizeFilename,
  SIGNATURE_BYTES,
} from '../../shared/files.js';
import { logger, securityEvent } from '../../shared/logger.js';
import { recordAudit } from '../audit/audit.service.js';
import { StoragePreconditionError, StorageUnavailableError } from '../storage/storage.errors.js';
import { fileKey, uploadKey } from '../storage/storage.keys.js';
import { storage } from '../storage/storage.service.js';
import { filesMaintenanceRepository, filesRepository } from './files.repository.js';

/** Um envio não confirmado vale por 24 h; depois o job descarta. */
const PENDING_TTL_SECONDS = 24 * 60 * 60;
const MIB = 1024 * 1024;

const REJECTIONS = {
  size_mismatch: 'O arquivo recebido tem tamanho diferente do informado. Envie de novo.',
  signature_mismatch: 'O conteúdo do arquivo não corresponde ao tipo informado.',
  changed_during_check: 'O arquivo mudou durante a conferência. Envie de novo.',
};

function fieldError(field, code, message) {
  return new ValidationError([{ field, code, message }], code, message);
}

export function quotaExceeded() {
  return new AppError(
    422,
    'STORAGE_QUOTA_EXCEEDED',
    'A empresa atingiu o limite de armazenamento do plano. Exclua arquivos ou fale com a equipe ZEVS.',
  );
}

function storageUnavailable(err) {
  logger.error({ err }, 'storage indisponível');
  return new AppError(503, 'STORAGE_UNAVAILABLE', 'O armazenamento de arquivos está indisponível. Tente de novo em instantes.');
}

export function toFile(row) {
  return {
    id: row.id,
    original_name: row.original_name,
    extension: row.extension,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    status: row.status,
    expires_at: row.expires_at,
  };
}

/**
 * POST /files/upload-intents: allowlist (extensão + MIME), tamanho por arquivo e pré-checagem da cota.
 * Grava o arquivo como `pending` e devolve a URL de PUT para a chave de envio.
 */
export async function createUploadIntent(ctx, input) {
  const type = resolveFileType(input.filename, input.content_type);
  if (type.error) throw fieldError('filename', 'FILE_TYPE_NOT_ALLOWED', type.error);

  return withTenant(ctx.companyId, async (client) => {
    const repo = filesRepository(client);
    const limits = await repo.findLimits(ctx.companyId);
    if (!limits) throw new Error(`empresa ${ctx.companyId} sem assinatura ou uso`);
    if (input.size_bytes > limits.max_file_size_bytes) {
      throw fieldError(
        'size_bytes',
        'FILE_TOO_LARGE',
        `O arquivo passa do limite de ${Math.floor(limits.max_file_size_bytes / MIB)} MB por arquivo.`,
      );
    }
    // Pré-checagem: a cota de verdade é o UPDATE atômico da confirmação.
    if (limits.storage_bytes + input.size_bytes > limits.storage_quota_bytes) throw quotaExceeded();

    const id = randomUUID();
    const file = await repo.insertPending(ctx.companyId, {
      id,
      storageKey: fileKey(ctx.companyId, id),
      originalName: sanitizeFilename(input.filename),
      extension: type.extension,
      contentType: type.contentType,
      sizeBytes: input.size_bytes,
      uploadedBy: ctx.userId,
      ttlSeconds: PENDING_TTL_SECONDS,
    });
    const upload = await storage().createUploadUrl({
      key: uploadKey(ctx.companyId, id),
      contentType: type.contentType,
      contentLength: input.size_bytes,
      expiresIn: env.UPLOAD_URL_TTL_SECONDS,
    });
    return {
      file: toFile(file),
      upload: { ...upload, expires_at: new Date(Date.now() + env.UPLOAD_URL_TTL_SECONDS * 1000).toISOString() },
    };
  });
}

/** O arquivo pode ser usado por quem o enviou, enquanto estiver pendente e válido. */
function assertUsable(ctx, file) {
  if (!file || file.uploaded_by !== ctx.userId) {
    throw fieldError('file_id', 'FILE_NOT_FOUND', 'Arquivo não encontrado. Envie de novo.');
  }
  if (file.status === 'rejected') throw fieldError('file_id', 'FILE_REJECTED', 'Este arquivo foi recusado. Envie de novo.');
  if (file.status !== 'pending') throw fieldError('file_id', 'FILE_ALREADY_USED', 'Este arquivo já foi usado.');
  if (file.expires_at.getTime() <= Date.now()) {
    throw fieldError('file_id', 'FILE_EXPIRED', 'O envio expirou. Envie o arquivo de novo.');
  }
}

/** Recusa o arquivo (status + auditoria) e lança 422 FILE_REJECTED. O objeto fica para o job. */
async function reject(ctx, file, reason) {
  await withTenant(ctx.companyId, async (client) => {
    if (await filesRepository(client).markRejected(ctx.companyId, file.id)) {
      await recordAudit(client, ctx, {
        action: 'file.rejected',
        entityType: 'file',
        entityId: file.id,
        metadata: { reason, extension: file.extension, size_bytes: file.size_bytes },
      });
    }
  });
  if (reason !== 'size_mismatch') {
    securityEvent('file_rejected', { reason, companyId: ctx.companyId, fileId: file.id, userId: ctx.userId });
  }
  throw new ValidationError([{ field: 'file_id', code: reason, message: REJECTIONS[reason] }], 'FILE_REJECTED', REJECTIONS[reason]);
}

/**
 * Conferência no storage, fora da transação (não segura conexão nem trava durante a rede):
 * tamanho (HEAD), magic bytes (primeiros 4 KB com If-Match) e cópia condicionada à mesma ETag para
 * a chave definitiva. Depois disso, claimFile() faz a parte transacional.
 */
export async function verifyUpload(ctx, fileId) {
  const file = await withTenant(ctx.companyId, (client) => filesRepository(client).find(ctx.companyId, fileId));
  assertUsable(ctx, file);

  const provider = storage();
  const source = uploadKey(ctx.companyId, file.id);
  let outcome;
  try {
    const head = await provider.head(source);
    if (!head) throw fieldError('file_id', 'FILE_NOT_UPLOADED', 'O envio do arquivo não terminou. Tente de novo.');
    if (head.size !== file.size_bytes) {
      outcome = 'size_mismatch';
    } else {
      const bytes = await provider.readRange(source, 0, SIGNATURE_BYTES - 1, { ifMatch: head.etag });
      if (!matchesSignature(file.extension, bytes)) outcome = 'signature_mismatch';
      else await provider.copy(source, file.storage_key, { ifMatch: head.etag });
    }
  } catch (err) {
    if (err instanceof StoragePreconditionError) outcome = 'changed_during_check';
    else if (err instanceof StorageUnavailableError) throw storageUnavailable(err);
    else throw err;
  }
  if (outcome) await reject(ctx, file, outcome);
  return file;
}

/**
 * Dentro da transação do documento: trava o arquivo, confere de novo (outra requisição pode ter
 * usado), consome a cota (UPDATE atômico) e marca `ready`.
 */
export async function claimFile(client, ctx, fileId) {
  const repo = filesRepository(client);
  const file = await repo.find(ctx.companyId, fileId, { forUpdate: true });
  assertUsable(ctx, file);
  if ((await repo.consumeStorage(ctx.companyId, file.size_bytes)) === null) throw quotaExceeded();
  return repo.markReady(ctx.companyId, file.id);
}

/** URL de GET curta. `inline` só para PDF e imagem; o resto sempre baixa como anexo. */
export async function signDownload(file, { disposition = 'attachment' } = {}) {
  const effective = disposition === 'inline' && isInlineAllowed(file.extension) ? 'inline' : 'attachment';
  const url = await storage().createDownloadUrl({
    key: file.storage_key,
    filename: file.original_name,
    contentType: file.content_type,
    disposition: effective,
    expiresIn: env.DOWNLOAD_URL_TTL_SECONDS,
  });
  return { url, disposition: effective, expires_at: new Date(Date.now() + env.DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString() };
}

/**
 * Job cleanup.files (de hora em hora):
 * 1. envios vencidos e recusados → apaga os objetos (envio e definitivo) e depois a linha;
 * 2. chave de envio de arquivo confirmado → apagada quando a URL de PUT já expirou.
 * Objeto antes da linha: se o DELETE do storage falhar, a próxima rodada tenta de novo.
 */
export async function cleanupFiles({ limit = 200 } = {}) {
  const provider = storage();
  let discarded = 0;
  let purged = 0;

  const discardable = await withSystem((client) => filesMaintenanceRepository(client).listDiscardable(limit));
  for (const file of discardable) {
    await provider.delete(uploadKey(file.company_id, file.id));
    await provider.delete(file.storage_key);
    if (await withSystem((client) => filesMaintenanceRepository(client).deleteDiscardable(file.id))) discarded += 1;
  }

  const grace = env.UPLOAD_URL_TTL_SECONDS + 5 * 60;
  const uploads = await withSystem((client) => filesMaintenanceRepository(client).listUploadsToPurge(grace, limit));
  for (const file of uploads) {
    await provider.delete(uploadKey(file.company_id, file.id));
    await withSystem((client) => filesMaintenanceRepository(client).markUploadPurged(file.id));
    purged += 1;
  }

  return { discarded, purged };
}

// Planilhas (FASE-0 D6, ARCHITECTURE §13.1 e §13.1.1): visões (filtros), metadados, ações em lote e
// prévia somente leitura. A planilha é um documento: arquivo, versões e lixeira continuam na Central.
import { withTenant } from '../../shared/db.js';
import { AppError, NotFoundError } from '../../shared/errors.js';
import { todayIn } from '../../shared/timezones.js';
import { auditChanges, recordAudit } from '../audit/audit.service.js';
import { applyArchived } from '../documents/documents.service.js';
import { documentsRepository } from '../documents/documents.repository.js';
import { StorageObjectTooLargeError, StorageUnavailableError } from '../storage/storage.errors.js';
import { storage } from '../storage/storage.service.js';
import { LIMITS, readSpreadsheet, SpreadsheetReadError } from './readers/index.js';
import { spreadsheetsRepository } from './spreadsheets.repository.js';

function notFound() {
  return new NotFoundError('SPREADSHEET_NOT_FOUND', 'Planilha não encontrada.');
}

function readError(err) {
  return new AppError(err.code === 'SHEET_NOT_FOUND' ? 404 : 422, err.code, err.message);
}

function currentYear(ctx) {
  return Number(todayIn(ctx.timezone).slice(0, 4));
}

export function toSpreadsheet(row) {
  return {
    id: row.id,
    title: row.title,
    folder_id: row.folder_id,
    in_use: row.in_use,
    reference_year: row.reference_year,
    archived_at: row.archived_at,
    current_version: row.current_version,
    file: {
      original_name: row.original_name,
      extension: row.extension,
      size_bytes: row.size_bytes,
      previewable: row.extension !== 'xls' && row.size_bytes <= LIMITS.maxFileBytes,
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ---------- leitura ----------

export function listSpreadsheets(ctx, filters) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = spreadsheetsRepository(client);
    const year = currentYear(ctx);
    const { rows, total } = await repo.list(ctx.companyId, { ...filters, currentYear: year });
    return {
      spreadsheets: rows.map(toSpreadsheet),
      meta: { page: filters.page, limit: filters.limit, total, current_year: year, years: await repo.years(ctx.companyId) },
    };
  });
}

export function getSpreadsheet(ctx, id) {
  return withTenant(ctx.companyId, async (client) => {
    const row = await spreadsheetsRepository(client).find(ctx.companyId, id);
    if (!row) throw notFound();
    return toSpreadsheet(row);
  });
}

/**
 * Prévia (nível 2): confere tudo no banco (empresa, lixeira, tipo, tamanho), grava a auditoria quando é
 * a abertura (primeira página sem aba escolhida), e só então baixa e lê o arquivo — fora da transação.
 */
export async function previewSpreadsheet(ctx, id, query) {
  const file = await withTenant(ctx.companyId, async (client) => {
    const row = await spreadsheetsRepository(client).find(ctx.companyId, id);
    if (!row) throw notFound();
    const version = await documentsRepository(client).findVersion(ctx.companyId, id, query.version ?? null);
    if (!version) throw new NotFoundError('VERSION_NOT_FOUND', 'Versão não encontrada.');
    if (version.extension === 'xls' || !['xlsx', 'ods', 'csv'].includes(version.extension)) {
      throw readError(new SpreadsheetReadError('PREVIEW_NOT_SUPPORTED', 'Planilhas .xls (formato antigo do Excel) não têm prévia. Baixe o arquivo para abrir no seu programa.'));
    }
    if (version.size_bytes > LIMITS.maxFileBytes) {
      throw readError(new SpreadsheetReadError('SPREADSHEET_TOO_LARGE', 'Planilha grande demais para visualizar aqui (mais de 10 MB). Baixe o arquivo.'));
    }
    if (query.sheet === undefined && query.page === 1) {
      await recordAudit(client, ctx, {
        action: 'document.previewed',
        entityType: 'document',
        entityId: id,
        metadata: { version_number: version.version_number },
      });
    }
    return version;
  });

  let buffer;
  try {
    buffer = await storage().readObject(file.storage_key, { maxBytes: LIMITS.maxFileBytes });
  } catch (err) {
    if (err instanceof StorageObjectTooLargeError) {
      throw readError(new SpreadsheetReadError('SPREADSHEET_TOO_LARGE', 'Planilha grande demais para visualizar aqui. Baixe o arquivo.'));
    }
    if (err instanceof StorageUnavailableError) {
      throw new AppError(503, 'STORAGE_UNAVAILABLE', 'O armazenamento de arquivos está indisponível. Tente de novo em instantes.');
    }
    throw err;
  }
  if (!buffer) throw new NotFoundError('FILE_NOT_FOUND', 'O arquivo desta versão não foi encontrado.');

  try {
    const result = readSpreadsheet(buffer, file.extension, { sheet: query.sheet ?? 0, page: query.page });
    return { version_number: file.version_number, extension: file.extension, ...result };
  } catch (err) {
    if (err instanceof SpreadsheetReadError) throw readError(err);
    throw err;
  }
}

// ---------- escrita ----------

async function applyChanges(client, ctx, id, { in_use: inUse, reference_year: referenceYear }) {
  const repo = spreadsheetsRepository(client);
  const current = await repo.lock(ctx.companyId, id);
  if (!current) return null;
  const updated = await repo.update(ctx.companyId, id, { inUse, referenceYear, userId: ctx.userId });
  const changes = auditChanges(current, updated, { fields: ['in_use', 'reference_year'] });
  if (changes) {
    await recordAudit(client, ctx, { action: 'spreadsheet.updated', entityType: 'document', entityId: id, metadata: { changes } });
  }
  return updated;
}

export function updateSpreadsheet(ctx, id, input) {
  return withTenant(ctx.companyId, async (client) => {
    if (!(await applyChanges(client, ctx, id, input))) throw notFound();
    return toSpreadsheet(await spreadsheetsRepository(client).find(ctx.companyId, id));
  });
}

/**
 * Ações em lote (até 100): cada item é travado e auditado; o que não existir na empresa (ou estiver na
 * lixeira) volta em `not_found` sem derrubar o resto. Ordem fixa de travamento (por id): sem deadlock.
 */
export function bulkUpdate(ctx, { ids, action, reference_year: referenceYear }) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = spreadsheetsRepository(client);
    const notFoundIds = [];
    let updated = 0;
    for (const id of [...new Set(ids)].sort()) {
      if (!(await repo.lock(ctx.companyId, id))) {
        notFoundIds.push(id);
        continue;
      }
      switch (action) {
        case 'mark_in_use':
          await applyChanges(client, ctx, id, { in_use: true });
          break;
        case 'unmark_in_use':
          await applyChanges(client, ctx, id, { in_use: false });
          break;
        case 'set_year':
          await applyChanges(client, ctx, id, { reference_year: referenceYear });
          break;
        case 'archive':
          await applyArchived(client, ctx, id, true);
          break;
        case 'unarchive':
          await applyArchived(client, ctx, id, false);
          break;
        default:
          throw new Error(`ação em lote desconhecida: ${action}`);
      }
      updated += 1;
    }
    return { updated, not_found: notFoundIds };
  });
}

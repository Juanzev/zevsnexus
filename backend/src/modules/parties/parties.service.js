// Prestadores e fornecedores (ARCHITECTURE §12 e §12.1). Pessoa física é titular de dados (LGPD):
// nome, documento, contato, PIX e observações nunca vão para a auditoria — só o fato de que mudaram.
import { UNIQUE_VIOLATION, withTenant } from '../../shared/db.js';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js';
import { isValidCnpj, isValidCpf, normalizeCnpj, normalizeCpf } from '../../shared/br.js';
import { todayIn } from '../../shared/timezones.js';
import { auditChanges, recordAudit } from '../audit/audit.service.js';
import * as documentsService from '../documents/documents.service.js';
import * as filesService from '../files/files.service.js';
import { EDITABLE_COLUMNS, partiesRepository } from './parties.repository.js';

const PERSONAL_FIELDS = ['name', 'trade_name', 'document_normalized', 'email', 'phone', 'pix_key', 'notes'];

function partyNotFound() {
  return new NotFoundError('PARTY_NOT_FOUND', 'Prestador ou fornecedor não encontrado.');
}

function documentError(message) {
  return new ValidationError([{ field: 'document', code: 'invalid_document', message }], 'VALIDATION_ERROR', message);
}

export function toParty(row) {
  return {
    id: row.id,
    person_type: row.person_type,
    name: row.name,
    trade_name: row.trade_name,
    document: row.document_normalized,
    roles: row.roles,
    specialty: row.specialty,
    email: row.email,
    phone: row.phone,
    pix_key: row.pix_key,
    notes: row.notes,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** CPF (pessoa física) ou CNPJ (jurídica), normalizado; lança 422 se não conferir. */
function normalizeDocument(value, personType) {
  if (value === null || value === undefined) return value;
  if (personType === 'individual') {
    if (!isValidCpf(value)) throw documentError('CPF inválido. Confira os números.');
    return normalizeCpf(value);
  }
  if (!isValidCnpj(value)) throw documentError('CNPJ inválido. Confira os números.');
  return normalizeCnpj(value);
}

async function guardDocument(operation) {
  try {
    return await operation();
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION && err.constraint === 'parties_document_key') {
      throw new ConflictError('PARTY_DOCUMENT_TAKEN', 'Já existe um cadastro com este CPF/CNPJ.', [
        { field: 'document', code: 'PARTY_DOCUMENT_TAKEN', message: 'Já existe um cadastro com este CPF/CNPJ.' },
      ]);
    }
    throw err;
  }
}

/** Para comparar na auditoria: arrays viram texto (papéis). */
function auditable(row) {
  return { ...row, roles: Array.isArray(row.roles) ? [...row.roles].sort().join(',') : row.roles };
}

function versionConflict(currentVersion) {
  return new ConflictError(
    'VERSION_CONFLICT',
    'Este cadastro foi alterado em outro lugar. Recarregue a tela para ver a versão mais recente.',
    { current_version: currentVersion },
  );
}

// ---------- leitura ----------

export function listParties(ctx, filters) {
  return withTenant(ctx.companyId, async (client) => {
    const { rows, total } = await partiesRepository(client).list(ctx.companyId, filters);
    return { parties: rows.map(toParty), meta: { page: filters.page, limit: filters.limit, total } };
  });
}

/** Ficha: dados e, para quem tem finance.view, os totais de despesas e pagamentos. */
export function getParty(ctx, id) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = partiesRepository(client);
    const row = await repo.find(ctx.companyId, id);
    if (!row) throw partyNotFound();
    const party = toParty(row);
    if (ctx.permissions.has('finance.view')) {
      party.finance = await repo.financeSummary(ctx.companyId, id, todayIn(ctx.timezone));
    }
    return party;
  });
}

/** Referência do body (despesa): prestador ativo da mesma empresa, senão 422. */
export async function assertParty(client, companyId, partyId) {
  if (partyId === null || partyId === undefined) return null;
  const party = await partiesRepository(client).find(companyId, partyId);
  if (!party) {
    throw new ValidationError(
      [{ field: 'party_id', code: 'PARTY_NOT_FOUND', message: 'Prestador ou fornecedor não encontrado.' }],
      'PARTY_NOT_FOUND',
      'Prestador ou fornecedor não encontrado.',
    );
  }
  return party;
}

/** 404 se o prestador não existe na empresa (antes de qualquer trabalho no storage). */
export function ensureParty(ctx, id) {
  return withTenant(ctx.companyId, async (client) => {
    if (!(await partiesRepository(client).find(ctx.companyId, id))) throw partyNotFound();
  });
}

// ---------- escrita ----------

export function createParty(ctx, input) {
  return withTenant(ctx.companyId, async (client) => {
    const values = { ...input, document_normalized: normalizeDocument(input.document, input.person_type) };
    const row = await guardDocument(() => partiesRepository(client).insert(ctx.companyId, values, ctx.userId));
    await recordAudit(client, ctx, {
      action: 'party.created',
      entityType: 'party',
      entityId: row.id,
      metadata: { person_type: row.person_type, roles: row.roles, has_document: Boolean(row.document_normalized) },
    });
    return toParty(row);
  });
}

export function updateParty(ctx, id, input) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = partiesRepository(client);
    const current = await repo.find(ctx.companyId, id, { forUpdate: true });
    if (!current) throw partyNotFound();
    if (current.version !== input.version) throw versionConflict(current.version);

    const personType = input.person_type ?? current.person_type;
    const values = {};
    for (const column of EDITABLE_COLUMNS) {
      if (column !== 'document_normalized' && input[column] !== undefined) values[column] = input[column];
    }
    if (input.document !== undefined) {
      values.document_normalized = normalizeDocument(input.document, personType);
    } else if (personType !== current.person_type && current.document_normalized) {
      // Trocar o tipo de pessoa exige um documento compatível (CPF ↔ CNPJ).
      throw documentError(personType === 'individual' ? 'Informe o CPF da pessoa física.' : 'Informe o CNPJ da empresa.');
    }

    const updated = await guardDocument(() => repo.update(ctx.companyId, id, values, ctx.userId));
    const changes = auditChanges(auditable(current), auditable(updated), {
      fields: EDITABLE_COLUMNS,
      personal: PERSONAL_FIELDS,
    });
    if (changes) {
      await recordAudit(client, ctx, { action: 'party.updated', entityType: 'party', entityId: id, metadata: { changes } });
    }
    return toParty(updated);
  });
}

/** Soft delete: despesas antigas continuam mostrando o nome. */
export function deleteParty(ctx, id) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = partiesRepository(client);
    if (!(await repo.find(ctx.companyId, id, { forUpdate: true }))) throw partyNotFound();
    await repo.softDelete(ctx.companyId, id, ctx.userId);
    await recordAudit(client, ctx, { action: 'party.deleted', entityType: 'party', entityId: id });
  });
}

// ---------- documentos da ficha ----------

export function listPartyDocuments(ctx, id) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = partiesRepository(client);
    if (!(await repo.find(ctx.companyId, id))) throw partyNotFound();
    return repo.listDocuments(ctx.companyId, id);
  });
}

/**
 * Anexa à ficha um arquivo novo (vira documento na pasta padrão de prestadores) ou um documento
 * que já está na Central. O documento continua sendo um só ("um arquivo, um lugar").
 */
export async function linkPartyDocument(ctx, id, input) {
  await ensureParty(ctx, id);
  const file = input.file_id ? await filesService.verifyUpload(ctx, input.file_id) : null;
  return withTenant(ctx.companyId, async (client) => {
    const repo = partiesRepository(client);
    if (!(await repo.find(ctx.companyId, id, { forUpdate: true }))) throw partyNotFound();
    let documentId = input.document_id;
    if (file) {
      const folderId = await documentsService.defaultFolder(client, ctx.companyId, 'parties');
      ({ id: documentId } = await documentsService.createFromUpload(client, ctx, file.id, { folder_id: folderId }));
    } else {
      await documentsService.assertLinkableDocument(client, ctx, documentId);
    }
    if (await repo.linkDocument(ctx.companyId, id, documentId, ctx.userId)) {
      await recordAudit(client, ctx, {
        action: 'party.document_linked',
        entityType: 'party',
        entityId: id,
        metadata: { document_id: documentId, uploaded: Boolean(file) },
      });
    }
    return repo.listDocuments(ctx.companyId, id);
  });
}

/** Desvincula (o documento continua na Central). */
export function unlinkPartyDocument(ctx, id, documentId) {
  return withTenant(ctx.companyId, async (client) => {
    const repo = partiesRepository(client);
    if (!(await repo.find(ctx.companyId, id, { forUpdate: true }))) throw partyNotFound();
    if (!(await repo.unlinkDocument(ctx.companyId, id, documentId))) {
      throw new NotFoundError('DOCUMENT_NOT_FOUND', 'Documento não vinculado a este cadastro.');
    }
    await recordAudit(client, ctx, {
      action: 'party.document_unlinked',
      entityType: 'party',
      entityId: id,
      metadata: { document_id: documentId },
    });
  });
}

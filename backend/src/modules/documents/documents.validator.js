// Schemas da Central de Documentos. Todos .strict(): company_id (ou qualquer campo extra) vira 422.
import * as z from 'zod';
import { calendarDate, optionalNullable, pagination, queryBoolean, text, uuid, version } from '../../shared/validators.js';
import { MAX_TAGS_PER_DOCUMENT } from './catalog.service.js';
import { DOCUMENT_SORTS } from './documents.repository.js';

const title = text(200, { min: 1, label: 'Título' });
const description = text(2000, { label: 'Descrição' });
const folderName = text(80, { min: 1, label: 'Nome da pasta' }).refine(
  (value) => !/[/\\]/.test(value),
  'O nome da pasta não pode ter / ou \\.',
);
const typeName = text(60, { min: 1, label: 'Nome do tipo' });
const tags = z
  .array(text(40, { min: 1, label: 'Tag' }), { error: 'Envie a lista de tags.' })
  .max(MAX_TAGS_PER_DOCUMENT, `No máximo ${MAX_TAGS_PER_DOCUMENT} tags por documento.`);

export const idParams = z.object({ id: uuid }).strict();
export const versionParams = z
  .object({ id: uuid, number: z.coerce.number().int().positive().max(1_000_000) })
  .strict();

// ---------- documentos ----------

export const documentListQuery = z
  .object({
    ...pagination,
    folder: z.union([z.literal('root'), uuid]).optional(),
    q: text(100).optional(),
    type_id: uuid.optional(),
    tag_id: uuid.optional(),
    favorites: queryBoolean.optional(),
    archived: queryBoolean.optional(),
    expiring: queryBoolean.optional(),
    sort: z.enum(DOCUMENT_SORTS).default('-updated_at'),
  })
  .strict();

export const trashListQuery = z
  .object({
    ...pagination,
    q: text(100).optional(),
    sort: z.enum(DOCUMENT_SORTS).default('-updated_at'),
  })
  .strict();

/** Ano de referência de planilha (sugerido pela data de modificação do arquivo; ignorado nos outros tipos). */
const referenceYear = z.number().int().min(1990, 'Ano inválido.').max(2100, 'Ano inválido.');

export const documentCreateBody = z
  .object({
    file_id: uuid,
    reference_year: referenceYear.optional(),
    folder_id: optionalNullable(uuid),
    title: optionalNullable(title),
    description: optionalNullable(description),
    document_type_id: optionalNullable(uuid),
    expires_on: optionalNullable(calendarDate),
    tags: tags.optional(),
  })
  .strict();

export const documentPatchBody = z
  .object({
    version,
    title: title.optional(),
    description: optionalNullable(description),
    document_type_id: optionalNullable(uuid),
    expires_on: optionalNullable(calendarDate),
    tags: tags.optional(),
  })
  .strict();

export const documentMoveBody = z.object({ folder_id: uuid.nullable() }).strict();

export const versionCreateBody = z
  .object({
    file_id: uuid,
    reference_year: referenceYear.optional(),
    comment: optionalNullable(text(500, { label: 'Comentário' })),
  })
  .strict();

export const downloadUrlBody = z
  .object({
    version: z.number().int().positive().optional(),
    disposition: z.enum(['attachment', 'inline']).default('attachment'),
  })
  .strict();

// ---------- pastas ----------

export const folderCreateBody = z.object({ name: folderName, parent_id: optionalNullable(uuid) }).strict();
export const folderRenameBody = z.object({ name: folderName }).strict();
export const folderMoveBody = z.object({ parent_id: uuid.nullable() }).strict();

// ---------- tipos e tags ----------

export const typeListQuery = z.object({ include_archived: queryBoolean.optional() }).strict();
export const typeBody = z.object({ name: typeName }).strict();
export const tagListQuery = z
  .object({
    q: text(40).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

// Schemas das planilhas. Todos .strict().
import * as z from 'zod';
import { pagination, text, uuid } from '../../shared/validators.js';
import { SPREADSHEET_SORTS, SPREADSHEET_VIEWS } from './spreadsheets.repository.js';

const year = z.number().int().min(1990, 'Ano inválido.').max(2100, 'Ano inválido.');

export const idParams = z.object({ id: uuid }).strict();

export const spreadsheetListQuery = z
  .object({
    ...pagination,
    view: z.enum(SPREADSHEET_VIEWS).default('in_use'),
    q: text(100).optional(),
    year: z.coerce.number().int().min(1990).max(2100).optional(),
    sort: z.enum(SPREADSHEET_SORTS).default('-updated_at'),
  })
  .strict();

export const spreadsheetPatchBody = z
  .object({ in_use: z.boolean().optional(), reference_year: year.optional() })
  .strict()
  .refine((input) => input.in_use !== undefined || input.reference_year !== undefined, {
    message: 'Envie "em uso" ou o ano.',
  });

export const bulkBody = z
  .object({
    ids: z.array(uuid).min(1, 'Escolha pelo menos uma planilha.').max(100, 'No máximo 100 planilhas por vez.'),
    action: z.enum(['mark_in_use', 'unmark_in_use', 'set_year', 'archive', 'unarchive']),
    reference_year: year.optional(),
  })
  .strict()
  .refine((input) => input.action !== 'set_year' || input.reference_year !== undefined, {
    message: 'Informe o ano.',
    path: ['reference_year'],
  });

export const previewQuery = z
  .object({
    sheet: z.coerce.number().int().min(0).max(99).optional(),
    page: z.coerce.number().int().min(1).max(2000).default(1),
    version: z.coerce.number().int().positive().optional(),
  })
  .strict();

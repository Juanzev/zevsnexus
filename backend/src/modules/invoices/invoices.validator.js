// Schemas das notas fiscais. Valores em centavos (inteiros); datas AAAA-MM-DD; competência AAAA-MM
// (gravada como o dia 1). Todos .strict().
import * as z from 'zod';
import { calendarDate, cents, optionalNullable, pagination, text, uuid, version } from '../../shared/validators.js';
import { INVOICE_ATTACHMENT_ROLES, INVOICE_KINDS, INVOICE_SORTS, INVOICE_TABS } from './invoices.repository.js';

/** Data de negócio: evita ano digitado errado (ex.: 0202). */
const businessDate = calendarDate.refine(
  (value) => value >= '1990-01-01' && value <= '2100-12-31',
  'Data fora do intervalo aceito (1990 a 2100).',
);
const competence = z
  .string()
  .regex(/^(199\d|20\d\d|2100)-(0[1-9]|1[0-2])$/, 'Competência inválida. Use AAAA-MM.')
  .transform((value) => `${value}-01`);
const withheld = z
  .number({ error: 'Informe as retenções em centavos.' })
  .int('Valor inválido.')
  .min(0, 'As retenções não podem ser negativas.')
  .max(99_999_999_999_999, 'Valor alto demais.');
const kind = z.enum(INVOICE_KINDS, { error: 'Escolha o tipo da nota.' });
const number = text(30, { min: 1, label: 'Número' });
const series = text(10, { min: 1, label: 'Série' });

/** Campos que a nota nova e o PATCH aceitam (no PATCH, todos opcionais). */
const optionalFields = {
  number: optionalNullable(number),
  series: optionalNullable(series),
  issue_date: optionalNullable(businessDate),
  competence: optionalNullable(competence),
  party_id: optionalNullable(uuid),
  due_date: optionalNullable(businessDate),
  verification_code: optionalNullable(text(100, { label: 'Código de verificação' })),
  notes: optionalNullable(text(2000, { label: 'Observações' })),
};
const description = text(1000, { min: 1, label: 'Descrição' });

export const idParams = z.object({ id: uuid }).strict();
export const invoiceDocumentParams = z.object({ id: uuid, documentId: uuid }).strict();

export const invoiceListQuery = z
  .object({
    ...pagination,
    tab: z.enum(INVOICE_TABS).default('pending'),
    q: text(100).optional(),
    party_id: uuid.optional(),
    kind: kind.optional(),
    issued_from: businessDate.optional(),
    issued_to: businessDate.optional(),
    sort: z.enum(INVOICE_SORTS).optional(),
  })
  .strict();

/** Nota nova (em processamento); com `issue: true`, já emitida (exige número e data). */
export const invoiceBody = z
  .object({
    ...optionalFields,
    kind: kind.default('nfse'),
    description,
    gross_amount_cents: cents,
    withheld_cents: withheld.default(0),
    issue: z.boolean().default(false),
  })
  .strict();

export const invoicePatchBody = z
  .object({
    version,
    ...optionalFields,
    kind: kind.optional(),
    description: description.optional(),
    gross_amount_cents: cents.optional(),
    withheld_cents: withheld.optional(),
  })
  .strict();

export const issueBody = z
  .object({ number: number.optional(), series: optionalNullable(series), issue_date: businessDate.optional() })
  .strict();

export const reasonBody = z.object({ reason: text(500, { min: 1, label: 'Motivo' }) }).strict();

export const markPaidBody = z.object({ received_on: businessDate, received_amount_cents: cents.optional() }).strict();

export const invoiceDocumentBody = z
  .object({
    file_id: uuid.optional(),
    document_id: uuid.optional(),
    role: z.enum(INVOICE_ATTACHMENT_ROLES).default('pdf'),
  })
  .strict()
  .refine((input) => Boolean(input.file_id) !== Boolean(input.document_id), {
    message: 'Envie o arquivo ou escolha um documento (um dos dois).',
    path: ['file_id'],
  });

// Schemas do Financeiro. Valores em centavos (inteiros); datas AAAA-MM-DD (vencimento e pagamento
// são datas de calendário no fuso da empresa). Todos .strict().
import * as z from 'zod';
import {
  calendarDate,
  cents,
  optionalNullable,
  pagination,
  queryBoolean,
  text,
  uuid,
  version,
} from '../../shared/validators.js';
import { ATTACHMENT_ROLES, EXPENSE_SORTS, EXPENSE_TABS, PAYMENT_METHODS } from './expenses.repository.js';

/** Data de negócio: evita ano digitado errado (ex.: 0202). */
const businessDate = calendarDate.refine(
  (value) => value >= '1990-01-01' && value <= '2100-12-31',
  'Data fora do intervalo aceito (1990 a 2100).',
);
const tags = z
  .array(text(40, { min: 1, label: 'Tag' }), { error: 'Envie a lista de tags.' })
  .max(10, 'No máximo 10 tags por despesa.');
const method = z.enum(PAYMENT_METHODS, { error: 'Escolha a forma de pagamento.' });

const paymentFields = {
  paid_on: businessDate,
  amount_cents: cents,
  method,
  reference: optionalNullable(text(120, { label: 'Referência' })),
  notes: optionalNullable(text(500, { label: 'Observações' })),
  // Comprovante já enviado (POST /files/upload-intents + PUT): vira documento na pasta de comprovantes.
  receipt_file_id: uuid.optional(),
};

export const idParams = z.object({ id: uuid }).strict();
export const expenseDocumentParams = z.object({ id: uuid, documentId: uuid }).strict();

export const expenseListQuery = z
  .object({
    ...pagination,
    tab: z.enum(EXPENSE_TABS).default('open'),
    q: text(100).optional(),
    party_id: uuid.optional(),
    category_id: uuid.optional(),
    tag_id: uuid.optional(),
    due_from: businessDate.optional(),
    due_to: businessDate.optional(),
    sort: z.enum(EXPENSE_SORTS).optional(),
  })
  .strict();

export const paymentBody = z.object(paymentFields).strict();

/** Despesa nova; com `payment` é o "Já paguei" (o valor pago, se omitido, é o valor da despesa). */
export const expenseBody = z
  .object({
    description: text(200, { min: 1, label: 'Descrição' }),
    amount_cents: cents,
    due_date: businessDate.optional(),
    party_id: optionalNullable(uuid),
    category_id: optionalNullable(uuid),
    scheduled_for: optionalNullable(businessDate),
    notes: optionalNullable(text(2000, { label: 'Observações' })),
    tags: tags.optional(),
    payment: z.object({ ...paymentFields, amount_cents: cents.optional() }).strict().optional(),
  })
  .strict();

export const expensePatchBody = z
  .object({
    version,
    description: text(200, { min: 1, label: 'Descrição' }).optional(),
    amount_cents: cents.optional(),
    due_date: businessDate.optional(),
    party_id: optionalNullable(uuid),
    category_id: optionalNullable(uuid),
    scheduled_for: optionalNullable(businessDate),
    notes: optionalNullable(text(2000, { label: 'Observações' })),
    tags: tags.optional(),
  })
  .strict();

export const reasonBody = z.object({ reason: text(500, { min: 1, label: 'Motivo' }) }).strict();

export const expenseDocumentBody = z
  .object({
    file_id: uuid.optional(),
    document_id: uuid.optional(),
    role: z.enum(ATTACHMENT_ROLES).default('other'),
  })
  .strict()
  .refine((input) => Boolean(input.file_id) !== Boolean(input.document_id), {
    message: 'Envie o arquivo ou escolha um documento (um dos dois).',
    path: ['file_id'],
  });

export const categoryListQuery = z
  .object({
    kind: z.enum(['expense', 'income']).optional(),
    include_archived: queryBoolean.optional(),
  })
  .strict();

export const categoryBody = z
  .object({
    kind: z.enum(['expense', 'income']).default('expense'),
    name: text(60, { min: 1, label: 'Nome' }),
    sort_order: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

export const categoryPatchBody = z
  .object({
    name: text(60, { min: 1, label: 'Nome' }).optional(),
    sort_order: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

// Schemas de prestadores e fornecedores. CPF/CNPJ validados por dígito verificador conforme o tipo de
// pessoa; texto vazio limpa o campo (null).
import * as z from 'zod';
import { isValidCnpj, isValidCpf } from '../../shared/br.js';
import { email, optionalNullable, pagination, phone, text, uuid, version } from '../../shared/validators.js';
import { PARTY_ROLES, PARTY_SORTS } from './parties.repository.js';

const personType = z.enum(['individual', 'company'], { error: 'Escolha pessoa física ou jurídica.' });
const roles = z
  .array(z.enum(PARTY_ROLES), { error: 'Escolha pelo menos um papel.' })
  .min(1, 'Escolha pelo menos um papel.')
  .max(3)
  .transform((list) => [...new Set(list)]);

const fields = {
  name: text(160, { min: 1, label: 'Nome' }),
  trade_name: optionalNullable(text(160, { label: 'Nome fantasia' })),
  document: optionalNullable(z.string().trim().max(20)),
  roles,
  specialty: optionalNullable(text(80, { label: 'Especialidade' })),
  email: optionalNullable(email),
  phone: optionalNullable(phone),
  pix_key: optionalNullable(text(140, { label: 'Chave PIX' })),
  notes: optionalNullable(text(2000, { label: 'Observações' })),
};

/** CPF para pessoa física, CNPJ para jurídica. */
function checkDocument(value, type, ctx) {
  if (value === null || value === undefined) return;
  const valid = type === 'individual' ? isValidCpf(value) : isValidCnpj(value);
  if (!valid) {
    ctx.addIssue({
      code: 'custom',
      path: ['document'],
      message: type === 'individual' ? 'CPF inválido. Confira os números.' : 'CNPJ inválido. Confira os números.',
    });
  }
}

export const partyBody = z
  .object({ person_type: personType, ...fields })
  .strict()
  .superRefine((input, ctx) => checkDocument(input.document, input.person_type, ctx));

// No PATCH, o tipo de pessoa e o documento são conferidos juntos no service (o tipo pode vir só do banco).
export const partyPatchBody = z
  .object({
    version,
    person_type: personType.optional(),
    ...Object.fromEntries(Object.entries(fields).map(([key, schema]) => [key, schema.optional()])),
  })
  .strict();

export const partyParams = z.object({ id: uuid }).strict();
export const partyDocumentParams = z.object({ id: uuid, documentId: uuid }).strict();

export const partyListQuery = z
  .object({
    ...pagination,
    q: text(100).optional(),
    role: z.enum(PARTY_ROLES).optional(),
    person_type: personType.optional(),
    sort: z.enum(PARTY_SORTS).default('name'),
  })
  .strict();

/** Anexar à ficha: arquivo novo (file_id, já enviado) ou documento que já está na Central. */
export const partyDocumentBody = z
  .object({ file_id: uuid.optional(), document_id: uuid.optional() })
  .strict()
  .refine((input) => Boolean(input.file_id) !== Boolean(input.document_id), {
    message: 'Envie o arquivo ou escolha um documento (um dos dois).',
    path: ['file_id'],
  });

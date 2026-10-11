// Peças de validação reaproveitáveis (Zod 4). Campo opcional vazio ("") vira null.
import * as z from 'zod';
import {
  isValidCnpj,
  isValidCpf,
  isValidPhone,
  normalizeCep,
  normalizeCnpj,
  normalizeCpf,
  normalizePhone,
  UFS,
} from './br.js';
import { isValidTimezone } from './timezones.js';

/** Campo opcional que aceita null e trata texto vazio como null (limpar o campo). */
export function optionalNullable(schema) {
  return z
    .preprocess((value) => (typeof value === 'string' && value.trim() === '' ? null : value), schema.nullable())
    .optional();
}

export const email = z
  .string({ error: 'Informe o e-mail.' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Informe um e-mail válido.' }).max(254, 'E-mail longo demais.'));

export const cnpj = z
  .string()
  .transform(normalizeCnpj)
  .refine(isValidCnpj, 'CNPJ inválido. Confira os números.');

export const cpf = z
  .string()
  .transform(normalizeCpf)
  .refine(isValidCpf, 'CPF inválido. Confira os números.');

export const phone = z
  .string()
  .transform(normalizePhone)
  .refine(isValidPhone, 'Telefone inválido. Informe DDD + número.');

export const cep = z
  .string()
  .transform(normalizeCep)
  .refine((value) => /^[0-9]{8}$/.test(value), 'CEP inválido. Use 8 números.');

export const uf = z.enum(UFS, { error: 'Selecione um estado (UF).' });

export const timezone = z.string().refine(isValidTimezone, 'Fuso horário inválido.');

export const hexColor = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, 'Cor inválida. Use o formato #RRGGBB.');

export const uuid = z.uuid({ error: 'Identificador inválido.' });

export function text(max, { min = 0, label } = {}) {
  let schema = z.string().trim().max(max, `${label ?? 'Texto'} longo demais (máximo de ${max} caracteres).`);
  if (min > 0) schema = schema.min(min, `${label ?? 'Campo'} obrigatório.`);
  return schema;
}

/** Paginação com teto (pág. 08): padrão 20, máximo 100. */
export const pagination = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export const version = z.number({ error: 'Envie a versão do registro.' }).int().positive();

/** Booleano de query string: só "true" ou "false". */
export const queryBoolean = z.enum(['true', 'false']).transform((value) => value === 'true');

/** Data de calendário AAAA-MM-DD (vencimento, validade): sem hora e sem fuso. */
export const calendarDate = z.iso.date({ error: 'Data inválida. Use AAAA-MM-DD.' });

/** Valor em centavos (inteiro; nunca float). Teto: R$ 999.999.999.999,99. */
export const cents = z
  .number({ error: 'Informe o valor.' })
  .int('Valor em centavos inválido.')
  .min(1, 'O valor precisa ser maior que zero.')
  .max(99_999_999_999_999, 'Valor alto demais.');

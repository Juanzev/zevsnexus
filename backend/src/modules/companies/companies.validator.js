// Entradas da empresa. Todo schema é .strict(): company_id ou campo desconhecido no corpo → 422.
import * as z from 'zod';
import {
  cep,
  cnpj,
  email,
  hexColor,
  optionalNullable,
  phone,
  text,
  timezone,
  uf,
  uuid,
  version,
} from '../../shared/validators.js';

const legalName = text(200, { min: 2, label: 'Razão social' });
const TAX_REGIMES = ['mei', 'simples', 'presumido', 'real', 'other'];

export const onboardingBody = z
  .object({
    legal_name: legalName,
    trade_name: optionalNullable(text(200)),
    cnpj: optionalNullable(cnpj),
    timezone: timezone.default('America/Sao_Paulo'),
  })
  .strict();

export const companyPatchBody = z
  .object({
    version,
    legal_name: legalName.optional(),
    trade_name: optionalNullable(text(200)),
    cnpj: optionalNullable(cnpj),
    state_registration: optionalNullable(text(30)),
    municipal_registration: optionalNullable(text(30)),
    tax_regime: optionalNullable(z.enum(TAX_REGIMES, { error: 'Regime tributário inválido.' })),
    email: optionalNullable(email),
    phone: optionalNullable(phone),
    address: z
      .object({
        cep: optionalNullable(cep),
        street: optionalNullable(text(200)),
        number: optionalNullable(text(20)),
        complement: optionalNullable(text(100)),
        district: optionalNullable(text(100)),
        city: optionalNullable(text(100)),
        state: optionalNullable(uf),
      })
      .strict()
      .optional(),
  })
  .strict();

export const settingsPatchBody = z
  .object({
    timezone: timezone.optional(),
    primary_color: hexColor.optional(),
    // Aba "Próximas" do Financeiro: de hoje até hoje + N dias.
    upcoming_window_days: z.number().int().min(1, 'Mínimo de 1 dia.').max(60, 'Máximo de 60 dias.').optional(),
  })
  .strict();

export const contactBody = z
  .object({
    name: text(120, { min: 1, label: 'Nome' }),
    role_title: optionalNullable(text(80)),
    email: optionalNullable(email),
    phone: optionalNullable(phone),
    is_responsible: z.boolean().default(false),
    notes: optionalNullable(text(1000)),
  })
  .strict();

export const contactPatchBody = z
  .object({
    name: text(120, { min: 1, label: 'Nome' }).optional(),
    role_title: optionalNullable(text(80)),
    email: optionalNullable(email),
    phone: optionalNullable(phone),
    is_responsible: z.boolean().optional(),
    notes: optionalNullable(text(1000)),
  })
  .strict();

export const contactParams = z.object({ id: uuid }).strict();

// Entradas da autenticação. Todo schema é .strict(): campo desconhecido vira 422.
import * as z from 'zod';
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH } from './password.js';

const email = z
  .string({ error: 'Informe o e-mail.' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Informe um e-mail válido.' }).max(254, 'E-mail longo demais.'));

const name = z.string({ error: 'Informe seu nome.' }).trim().min(1, 'Informe seu nome.').max(120, 'Nome longo demais.');

export const newPassword = z
  .string({ error: 'Informe a senha.' })
  .min(PASSWORD_MIN_LENGTH, `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`)
  .refine(
    (value) => Buffer.byteLength(value, 'utf8') <= PASSWORD_MAX_BYTES,
    `A senha pode ter no máximo ${PASSWORD_MAX_BYTES} bytes (cerca de ${PASSWORD_MAX_BYTES} caracteres sem acento).`,
  );

const anyPassword = z.string({ error: 'Informe a senha.' }).min(1, 'Informe a senha.').max(256, 'Senha longa demais.');

const linkToken = z.string({ error: 'Link inválido.' }).regex(/^[A-Za-z0-9_-]{20,128}$/, 'Link inválido.');

export const registerBody = z
  .object({
    name,
    email,
    password: newPassword,
    accept_terms: z.literal(true, { error: 'É preciso aceitar os termos de uso e a política de privacidade.' }),
  })
  .strict();

export const loginBody = z.object({ email, password: anyPassword }).strict();

export const forgotPasswordBody = z.object({ email }).strict();

export const resetPasswordBody = z.object({ token: linkToken, password: newPassword }).strict();

export const changePasswordBody = z
  .object({ current_password: anyPassword, new_password: newPassword })
  .strict();

export const verifyEmailBody = z.object({ token: linkToken }).strict();

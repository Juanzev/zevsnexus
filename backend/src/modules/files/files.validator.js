import * as z from 'zod';
import { optionalNullable, text } from '../../shared/validators.js';

const GIB = 1024 * 1024 * 1024;

// O limite real por arquivo vem do plano (checado no service); aqui só o teto técnico.
export const uploadIntentBody = z
  .object({
    filename: text(255, { min: 1, label: 'Nome do arquivo' }),
    size_bytes: z
      .number({ error: 'Informe o tamanho do arquivo.' })
      .int()
      .positive('O arquivo está vazio.')
      .max(5 * GIB, 'Arquivo grande demais.'),
    content_type: optionalNullable(z.string().trim().max(255)),
  })
  .strict();

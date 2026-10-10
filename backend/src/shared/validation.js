// validate({ body, query, params }) com Zod → req.valid (pág. 08).
// Todo schema precisa ser objeto .strict(): campo desconhecido (ex.: company_id) vira 422.
// A checagem acontece na montagem da rota, então um validator frouxo derruba o boot e os testes.
import * as z from 'zod';
import { ValidationError } from './errors.js';

// Mensagens de validação em PT-BR.
z.config(z.locales.pt());

const PARTS = ['params', 'query', 'body'];

export function isStrictObject(schema) {
  const def = schema?._zod?.def;
  return def?.type === 'object' && def.catchall?._zod?.def?.type === 'never';
}

function toDetails(error) {
  return error.issues.flatMap((issue) => {
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({
        field: [...issue.path, key].join('.'),
        code: 'unrecognized_key',
        message: 'Campo não permitido.',
      }));
    }
    return [{ field: issue.path.join('.'), code: issue.code, message: issue.message }];
  });
}

export function validate(schemas) {
  for (const [part, schema] of Object.entries(schemas)) {
    if (!PARTS.includes(part)) throw new Error(`validate(): parte desconhecida "${part}"`);
    if (!isStrictObject(schema)) throw new Error(`validate(): o schema de "${part}" precisa ser z.object(...).strict()`);
  }
  return function validateRequest(req, _res, next) {
    const valid = {};
    const details = [];
    for (const part of PARTS) {
      const schema = schemas[part];
      if (!schema) continue;
      const input = part === 'body' ? (req.body ?? {}) : req[part];
      const result = schema.safeParse(input);
      if (result.success) valid[part] = result.data;
      else details.push(...toDetails(result.error));
    }
    if (details.length > 0) throw new ValidationError(details);
    req.valid = valid;
    next();
  };
}

/** Schema de corpo vazio: qualquer campo enviado vira 422. */
export const emptyBody = z.object({}).strict();

import * as z from 'zod';
import { ValidationError } from '../../src/shared/errors.js';
import { isStrictObject, validate } from '../../src/shared/validation.js';

function run(middleware, req) {
  let error;
  try {
    middleware(req, {}, () => {});
  } catch (err) {
    error = err;
  }
  return error;
}

describe('validate()', () => {
  test('recusa schema que não é objeto .strict() já na montagem da rota', () => {
    expect(() => validate({ body: z.object({ a: z.string() }) })).toThrow(/strict/);
    expect(() => validate({ body: z.string() })).toThrow(/strict/);
    expect(() => validate({ cabecalho: z.object({}).strict() })).toThrow(/parte desconhecida/);
  });

  test('isStrictObject reconhece .strict() e z.strictObject', () => {
    expect(isStrictObject(z.object({}).strict())).toBe(true);
    expect(isStrictObject(z.strictObject({}))).toBe(true);
    expect(isStrictObject(z.object({}))).toBe(false);
    expect(isStrictObject(z.looseObject({}))).toBe(false);
  });

  test('campo desconhecido (ex.: company_id) vira 422 com o campo apontado', () => {
    const middleware = validate({ body: z.object({ name: z.string() }).strict() });
    const error = run(middleware, { body: { name: 'x', company_id: 'abc' } });
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.status).toBe(422);
    expect(error.details).toEqual([
      { field: 'company_id', code: 'unrecognized_key', message: 'Campo não permitido.' },
    ]);
  });

  test('dados válidos vão para req.valid já transformados', () => {
    const middleware = validate({ body: z.object({ email: z.string().trim().toLowerCase() }).strict() });
    const req = { body: { email: '  Ana@Exemplo.COM ' } };
    expect(run(middleware, req)).toBeUndefined();
    expect(req.valid.body).toEqual({ email: 'ana@exemplo.com' });
  });

  test('mensagens em português', () => {
    const middleware = validate({ body: z.object({ idade: z.number() }).strict() });
    const error = run(middleware, { body: { idade: 'dez' } });
    expect(error.details[0].message).toMatch(/esperava/i);
  });
});

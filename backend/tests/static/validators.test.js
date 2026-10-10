// Guarda estática (pág. 17): todo schema exportado por um *.validator.js é objeto .strict(),
// salvo os schemas de campo reaproveitáveis declarados em FIELD_SCHEMAS.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApp } from '../../src/app.js';
import { isStrictObject } from '../../src/shared/validation.js';

const modulesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/modules');
const FIELD_SCHEMAS = new Set(['newPassword']);

function validatorFiles() {
  return readdirSync(modulesDir, { recursive: true })
    .filter((file) => file.endsWith('.validator.js'))
    .map((file) => path.join(modulesDir, file));
}

describe('validators', () => {
  test('existe pelo menos um validator para conferir', () => {
    expect(validatorFiles().length).toBeGreaterThan(0);
  });

  test.each(validatorFiles().map((file) => [path.relative(modulesDir, file), file]))(
    '%s exporta apenas objetos .strict()',
    async (_name, file) => {
      const exported = await import(pathToFileURL(file).href);
      for (const [name, schema] of Object.entries(exported)) {
        if (FIELD_SCHEMAS.has(name)) continue;
        expect({ name, strict: isStrictObject(schema) }).toEqual({ name, strict: true });
      }
    },
  );

  test('a app inteira monta: validate() recusaria qualquer schema frouxo numa rota', () => {
    expect(() => createApp({ serveFrontend: false })).not.toThrow();
  });
});

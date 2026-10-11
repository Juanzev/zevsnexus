// Guarda estática (pág. 03, camada 1b): todo *.routes.js nasce com tenantRouter(), salvo a allowlist
// abaixo — cada exceção com o motivo. Rota nova sem tenant não passa no CI.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const modulesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/modules');

const NOT_TENANT = {
  'auth/auth.routes.js': 'público (cadastro, login) e conta do próprio usuário (/me)',
  'companies/onboarding.routes.js': 'cria a empresa: o tenant ainda não existe',
  'platform/platform.routes.js': 'Painel ZEVS: eixo de plataforma (requirePlatformAdmin + withSystem)',
  'storage/dev-storage.routes.js': 'storage de dev/teste: autorizado pelo token assinado, como uma URL do R2',
};

// Como cada exceção se autoriza (nunca rota aberta onde há dado de conta, plataforma ou arquivo).
const AUTHORIZED_BY = {
  'auth/auth.routes.js': null,
  'storage/dev-storage.routes.js': /verifyDevToken/,
};

const routeFiles = readdirSync(modulesDir, { recursive: true })
  .filter((file) => file.endsWith('.routes.js'))
  .map((file) => file.split(path.sep).join('/'));

describe('guarda estática de rotas', () => {
  test('a allowlist só cita arquivos que existem', () => {
    for (const file of Object.keys(NOT_TENANT)) expect(routeFiles).toContain(file);
  });

  test.each(routeFiles)('%s', (file) => {
    const source = readFileSync(path.join(modulesDir, file), 'utf8');
    if (NOT_TENANT[file]) {
      // Fora do tenant, mas nunca sem autenticação onde há dado de conta, de plataforma ou arquivo.
      const guard = file in AUTHORIZED_BY ? AUTHORIZED_BY[file] : /authenticate/;
      if (guard) expect(source).toMatch(guard);
      return;
    }
    expect(source).toMatch(/tenantRouter\(\)/);
    // Um Router() cru no mesmo arquivo seria um atalho para fugir do tenant.
    expect(source).not.toMatch(/\bRouter\(\)/);
  });
});

// Servidor do E2E (Playwright): banco *_e2e_test recriado do zero, migrations e a app servindo a SPA.
// E-mails em modo log, gravados em e2e/.outbox para o teste ler os links.
// Rate limits desligados: a suíte faz muitos cadastros do mesmo IP; os limites têm testes próprios
// (backend/tests/security/rate-limit.test.js).
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { assertSafeTestDatabase } from '../tests/setup/test-database.js';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outboxDir = path.resolve(backendDir, '../e2e/.outbox');
const databaseUrl = process.env.E2E_DATABASE_URL ?? 'postgres://postgres@localhost:5434/zevs_nexus_e2e_test';
const port = process.env.E2E_PORT ?? '3100';

assertSafeTestDatabase(databaseUrl);

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? 'warn',
  PORT: port,
  APP_URL: `http://localhost:${port}`,
  CORS_ORIGIN: '',
  DATABASE_URL: databaseUrl,
  JWT_SECRET: 'segredo-do-e2e-com-mais-de-32-caracteres-0123456789',
  BCRYPT_ROUNDS: '4',
  SERVE_FRONTEND: 'true',
  EMAIL_PROVIDER: 'log',
  EMAIL_OUTBOX_DIR: outboxDir,
  JOBS_ENABLED: 'false',
  PLATFORM_ADMIN_EMAILS: 'admin-zevs@exemplo.local',
});

rmSync(outboxDir, { recursive: true, force: true });
mkdirSync(outboxDir, { recursive: true });

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
const { runMigrations } = await import('../src/shared/migrations.js');
await runMigrations({ databaseUrl, direction: 'up' });
const { seedCatalog } = await import('../seeds/catalog.js');
await seedCatalog(client);
await client.end();

const { createApp } = await import('../src/app.js');
createApp({ rateLimits: false }).listen(Number(port), () => {
  console.log(`ZEVS Nexus (E2E) em http://localhost:${port}`);
});

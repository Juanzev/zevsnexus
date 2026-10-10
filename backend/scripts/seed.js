// npm run seed — catálogo (permissões, papéis, features, planos), idempotente, numa transação.
// Roda no deploy depois das migrations. Dados de demonstração ficam fora daqui.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { seedCatalog } from '../seeds/catalog.js';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.env.NODE_ENV !== 'production') {
  const envFile = path.join(backendDir, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL não definida.');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
});
await client.connect();
try {
  await client.query('BEGIN');
  await seedCatalog(client);
  await client.query('COMMIT');
  console.log('Seed do catálogo aplicado.');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  await client.end();
}

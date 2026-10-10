// Antes da suíte: confere a trava anti-produção, recria o schema e aplica as migrations do zero.
import pg from 'pg';
import { runMigrations } from '../../src/shared/migrations.js';
import { assertSafeTestDatabase, TEST_DATABASE_URL } from './test-database.js';

export default async function globalSetup() {
  assertSafeTestDatabase(TEST_DATABASE_URL);
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } finally {
    await client.end();
  }
  await runMigrations({ databaseUrl: TEST_DATABASE_URL, direction: 'up' });
}

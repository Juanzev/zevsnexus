// Execução e conferência das migrations (node-pg-migrate, estado em `pgmigrations`).
// Usado pelo script de migrate, pelo /ready, pelo setup dos testes e pelo servidor de E2E.
// Não importa config/env.js: rodar migrations não deve exigir JWT_SECRET e afins.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');
export const MIGRATIONS_TABLE = 'pgmigrations';

/** Nomes (sem extensão) das migrations no disco, em ordem. */
export function listMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d{4}_[a-z0-9_]+\.js$/.test(file))
    .map((file) => file.replace(/\.js$/, ''))
    .sort();
}

export async function runMigrations({ databaseUrl, direction = 'up', count = Infinity, log = () => {} }) {
  return runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    migrationsTable: MIGRATIONS_TABLE,
    direction,
    count,
    checkOrder: true,
    singleTransaction: true,
    log,
  });
}

/** Migrations do disco ainda não aplicadas no banco (tabela ausente = todas pendentes). */
export async function pendingMigrations(db) {
  const files = listMigrationFiles();
  const { rows: exists } = await db.query('SELECT to_regclass($1) AS table_name', [`public.${MIGRATIONS_TABLE}`]);
  if (!exists[0].table_name) return files;
  const { rows } = await db.query(`SELECT name FROM ${MIGRATIONS_TABLE}`);
  const applied = new Set(rows.map((row) => row.name));
  return files.filter((name) => !applied.has(name));
}

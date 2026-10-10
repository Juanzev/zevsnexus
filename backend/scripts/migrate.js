// Migrations (pág. 07): npm run migrate | migrate:down [n|all] | migrate:redo | migrate:status
// Produção nunca roda down/redo: só `up`, pelo preDeployCommand do Render.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.env.NODE_ENV !== 'production') {
  const envFile = path.join(backendDir, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

// Importado depois do .env: listMigrationFiles/runMigrations não dependem do restante da configuração.
const { runMigrations, pendingMigrations, listMigrationFiles } = await import('../src/shared/migrations.js');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL não definida.');
  process.exit(1);
}

const [command = 'up', arg] = process.argv.slice(2);
const isProduction = process.env.NODE_ENV === 'production';

function refuseInProduction() {
  if (isProduction) {
    console.error(`"${command}" é bloqueado em produção. Rollback de schema é decisão manual (pág. 19).`);
    process.exit(1);
  }
}

const log = (message) => console.log(message);

switch (command) {
  case 'up':
    await runMigrations({ databaseUrl, direction: 'up', log });
    break;
  case 'down': {
    refuseInProduction();
    const count = arg === 'all' ? Infinity : Number(arg ?? 1);
    if (!Number.isInteger(count) && count !== Infinity) {
      console.error('Uso: migrate:down [n|all]');
      process.exit(1);
    }
    await runMigrations({ databaseUrl, direction: 'down', count, log });
    break;
  }
  case 'redo':
    refuseInProduction();
    await runMigrations({ databaseUrl, direction: 'down', count: 1, log });
    await runMigrations({ databaseUrl, direction: 'up', count: 1, log });
    break;
  case 'status': {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const pending = await pendingMigrations(client);
      const all = listMigrationFiles();
      for (const name of all) console.log(`${pending.includes(name) ? '[ ]' : '[x]'} ${name}`);
      console.log(pending.length === 0 ? '\nTudo aplicado.' : `\n${pending.length} pendente(s).`);
    } finally {
      await client.end();
    }
    break;
  }
  default:
    console.error(`Comando desconhecido: ${command}. Use: up | down [n|all] | redo | status`);
    process.exit(1);
}

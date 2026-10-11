// npm run db:restore-check -- <arquivo.dump> [--keep]
// Restore testado (STRUCTURE pág. 19, D12b): restaura um dump (pg_dump -Fc, ex.: artefato do
// workflow "Backup do banco") num banco TEMPORÁRIO do cluster local e confere:
//   1. pg_restore sem erro;  2. nenhuma migration pendente (ou quais faltam);
//   3. integridade (pago = soma dos pagamentos ativos; status coerente; uso de armazenamento);
//   4. a API sobe apontando para ele e responde /ready.
// Imprime a linha para a tabela de restores de docs/PRODUCTION.md. Com --keep, o banco fica para
// conferir login e telas: DATABASE_URL=<url> npm run dev. Nunca toca no banco de origem.
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { pendingMigrations } from '../src/shared/migrations.js';
import { dropDatabase, localUrl, pgBin, recreateDatabase, startServer } from './lib/local-tools.js';

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const dumpArg = args.find((arg) => !arg.startsWith('--'));
if (!dumpArg || !existsSync(dumpArg)) {
  console.error('Uso: npm run db:restore-check -- <arquivo.dump> [--keep]');
  process.exit(1);
}
const dump = path.resolve(dumpArg);
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const database = `zevs_nexus_restore_${stamp}`;
const url = localUrl(database);
const results = [];
const started = Date.now();

function report(ok, label, detail = '') {
  results.push({ ok, label });
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}

console.log(`Restore de ${path.basename(dump)} (${(statSync(dump).size / 1024 / 1024).toFixed(1)} MB) em ${database}\n`);
await recreateDatabase(database);

let server;
try {
  const restore = spawnSync(pgBin('pg_restore'), ['--no-owner', '--no-privileges', '--exit-on-error', '--dbname', url, dump], {
    encoding: 'utf8',
  });
  if (restore.error) throw restore.error;
  report(restore.status === 0, 'pg_restore', restore.status === 0 ? '' : restore.stderr.trim().split('\n').slice(-3).join(' | '));
  if (restore.status !== 0) throw new Error('restore falhou');

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const pending = await pendingMigrations(client);
    report(
      pending.length === 0,
      'migrations em dia',
      pending.length === 0 ? 'nada a aplicar' : `o código tem ${pending.length} migration(s) a mais: ${pending.join(', ')}`,
    );

    const { rows: counts } = await client.query(`
      SELECT (SELECT count(*) FROM companies) AS companies, (SELECT count(*) FROM users) AS users,
             (SELECT count(*) FROM documents) AS documents, (SELECT count(*) FROM files WHERE status = 'ready') AS files,
             (SELECT count(*) FROM expenses) AS expenses, (SELECT count(*) FROM expense_payments) AS payments,
             (SELECT count(*) FROM audit_logs) AS audit_logs`);
    console.log('  contagens:', Object.entries(counts[0]).map(([table, total]) => `${table}=${total}`).join(' '));

    const { rows: paid } = await client.query(`
      SELECT count(*) AS mismatches FROM expenses e
       WHERE e.paid_amount_cents <> (SELECT COALESCE(sum(p.amount_cents), 0) FROM expense_payments p
                                      WHERE p.company_id = e.company_id AND p.expense_id = e.id AND p.voided_at IS NULL)`);
    report(Number(paid[0].mismatches) === 0, 'pago de cada despesa = soma dos pagamentos ativos', `${paid[0].mismatches} divergência(s)`);

    const { rows: usage } = await client.query(`
      SELECT count(*) AS mismatches FROM company_usage u
       WHERE u.storage_bytes <> (SELECT COALESCE(sum(f.size_bytes), 0) FROM files f
                                  WHERE f.company_id = u.company_id AND f.status = 'ready')`);
    report(Number(usage[0].mismatches) === 0, 'uso de armazenamento = soma dos arquivos confirmados', `${usage[0].mismatches} divergência(s)`);
  } finally {
    await client.end();
  }

  server = await startServer({ DATABASE_URL: url, DATABASE_SSL: 'false', JOBS_ENABLED: 'false', LOG_LEVEL: 'warn' });
  const ready = await fetch(`${server.url}/ready`);
  report(ready.ok, 'API sobe apontando para o banco restaurado (/ready)');
} catch (err) {
  if (!results.some((result) => !result.ok)) report(false, 'erro inesperado', err.message);
} finally {
  await server?.stop();
  if (!keep) await dropDatabase(database);
}

const ok = results.every((result) => result.ok);
const minutes = ((Date.now() - started) / 60_000).toFixed(1);
console.log(`\n${ok ? 'RESTORE OK' : 'RESTORE COM PROBLEMAS'} em ${minutes} min.`);
console.log('Linha para docs/PRODUCTION.md (complete o responsável):');
console.log(`| ${new Date().toISOString().slice(0, 10)} | <responsável> | ${path.basename(dump)} | ${ok ? 'OK' : 'FALHOU'} (${minutes} min) | |`);
if (keep) console.log(`\nBanco mantido: DATABASE_URL=${url}`);
process.exit(ok ? 0 : 1);

// Cluster PostgreSQL local e dedicado do projeto (porta 5434, só localhost).
// Padrão da ZEVS STRUCTURE pág. 17: banco de teste local, nunca o remoto.
// A 5433 fica livre para o cluster de teste de outros projetos ZEVS.
//
// Uso: npm run db:local -- <setup|init|start|stop|status|createdb>
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const localDir = path.join(root, '.local');
const dataDir = path.join(localDir, 'pg-data');
const logFile = path.join(localDir, 'pg.log');
const port = process.env.LOCAL_PG_PORT ?? '5434';
const databases = ['zevs_nexus_dev', 'zevs_nexus_test', 'zevs_nexus_e2e_test'];

function findWindowsPgBin() {
  const base = 'C:\\Program Files\\PostgreSQL';
  if (!existsSync(base)) return null;
  const versions = readdirSync(base)
    .filter((name) => /^\d+$/.test(name))
    .sort((a, b) => Number(b) - Number(a));
  for (const version of versions) {
    const dir = path.join(base, version, 'bin');
    if (existsSync(path.join(dir, 'initdb.exe'))) return dir;
  }
  return null;
}

function bin(name) {
  const dir = process.env.PG_BIN ?? (process.platform === 'win32' ? findWindowsPgBin() : null);
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  return dir ? path.join(dir, exe) : exe;
}

function run(name, args) {
  const result = spawnSync(bin(name), args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status;
}

function init() {
  if (existsSync(path.join(dataDir, 'PG_VERSION'))) {
    console.log(`Cluster já existe em ${dataDir}`);
    return;
  }
  mkdirSync(dataDir, { recursive: true });
  const base = ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8'];
  // Provider "builtin" (PostgreSQL 17+) dá lower()/upper() Unicode sem depender do locale do SO.
  let status = run('initdb', [...base, '--locale=C', '--locale-provider=builtin', '--builtin-locale=C.UTF-8']);
  if (status !== 0) {
    console.warn('initdb com provider builtin falhou; tentando locale C simples.');
    status = run('initdb', [...base, '--locale=C']);
  }
  if (status !== 0) throw new Error('initdb falhou');
}

async function isUp() {
  const client = new pg.Client({ host: 'localhost', port: Number(port), user: 'postgres', database: 'postgres' });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

async function start() {
  if (await isUp()) {
    console.log(`PostgreSQL local já está rodando em localhost:${port}`);
    return;
  }
  // Processo destacado: no Windows, se o console que iniciou o postmaster fechar, os novos
  // backends morrem com 0xC0000142. A saída do servidor vai para o arquivo de log.
  const child = spawn(
    bin('pg_ctl'),
    ['-D', dataDir, '-l', logFile, '-o', `-p ${port} -c listen_addresses=localhost`, 'start'],
    { detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.unref();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await isUp()) {
      console.log(`PostgreSQL local rodando em localhost:${port}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`PostgreSQL não respondeu em 30 s (veja ${logFile})`);
}

function stop() {
  run('pg_ctl', ['-D', dataDir, '-m', 'fast', 'stop']);
}

function status() {
  run('pg_ctl', ['-D', dataDir, 'status']);
}

async function createDatabases() {
  const client = new pg.Client({ host: 'localhost', port: Number(port), user: 'postgres', database: 'postgres' });
  await client.connect();
  try {
    for (const name of databases) {
      const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
      if (rowCount === 0) {
        // Nome vem da lista fixa acima, nunca de entrada externa.
        await client.query(`CREATE DATABASE "${name}"`);
        console.log(`Banco criado: ${name}`);
      } else {
        console.log(`Banco já existe: ${name}`);
      }
    }
  } finally {
    await client.end();
  }
}

const commands = {
  init,
  start,
  stop,
  status,
  createdb: createDatabases,
  async setup() {
    init();
    await start();
    await createDatabases();
    console.log(`\nPronto. DATABASE_URL=postgres://postgres@localhost:${port}/zevs_nexus_dev`);
  },
};

const command = process.argv[2] ?? 'status';
if (!commands[command]) {
  console.error(`Comando desconhecido: ${command}. Use: ${Object.keys(commands).join(' | ')}`);
  process.exit(1);
}
await commands[command]();

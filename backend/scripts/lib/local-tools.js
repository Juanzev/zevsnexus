// Ferramentas dos scripts locais (cluster próprio na porta 5434): binários do PostgreSQL, bancos
// temporários e o servidor da API num processo separado (com o ambiente que o script escolher).
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const LOCAL_PG_PORT = process.env.LOCAL_PG_PORT ?? '5434';

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

/** Caminho de um binário do PostgreSQL (PG_BIN, ou a instalação mais nova no Windows, ou o PATH). */
export function pgBin(name) {
  const dir = process.env.PG_BIN ?? (process.platform === 'win32' ? findWindowsPgBin() : null);
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  return dir ? path.join(dir, exe) : exe;
}

/** URL de um banco do cluster local. No CI, LOCAL_PG_BASE aponta para o Postgres do job. */
export function localUrl(database) {
  const base = process.env.LOCAL_PG_BASE ?? `postgres://postgres@localhost:${LOCAL_PG_PORT}`;
  return `${base.replace(/\/+$/, '')}/${database}`;
}

const SAFE_NAME = /^zevs_nexus_[a-z0-9_]+$/;

/** Recria um banco descartável no cluster local (nome sempre zevs_nexus_*; nunca o de dev). */
export async function recreateDatabase(name) {
  if (!SAFE_NAME.test(name) || name === 'zevs_nexus_dev') throw new Error(`nome de banco recusado: ${name}`);
  const admin = new pg.Client({ connectionString: localUrl('postgres') });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
}

export async function dropDatabase(name) {
  if (!SAFE_NAME.test(name) || name === 'zevs_nexus_dev') throw new Error(`nome de banco recusado: ${name}`);
  const admin = new pg.Client({ connectionString: localUrl('postgres') });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

/**
 * Sobe `node src/server.js` com o ambiente dado (só ele: o processo não herda o .env do terminal
 * para o que foi definido aqui) e espera /ready. Devolve { url, logs, stop }.
 */
export async function startServer(env, { port = 3200 + Math.floor(Math.random() * 500), timeoutMs = 30_000 } = {}) {
  const logs = [];
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: backendDir,
    env: { ...process.env, ...env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  const url = `http://localhost:${port}`;
  const stop = () =>
    new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`o servidor saiu (código ${child.exitCode}):\n${logs.join('')}`);
    try {
      const res = await fetch(`${url}/ready`);
      if (res.ok) return { url, logs, stop };
    } catch {
      // ainda subindo
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  await stop();
  throw new Error(`o servidor não ficou pronto em ${timeoutMs / 1000} s:\n${logs.join('')}`);
}

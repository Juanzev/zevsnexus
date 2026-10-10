// Pool único do PostgreSQL (pág. 07): timeouts de conexão, de statement e de transação ociosa.
// Transação sempre em client dedicado — nunca BEGIN no pool compartilhado.
import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from './logger.js';

// `date` volta como 'AAAA-MM-DD' (nunca vira Date no fuso do servidor).
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

// bigint (centavos, COUNT) volta como number; acima do inteiro seguro é erro, nunca arredondamento.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new RangeError(`bigint fora do intervalo seguro: ${value}`);
  return parsed;
});

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 15_000,
  idle_in_transaction_session_timeout: 30_000,
  application_name: 'zevs-nexus',
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
});

pool.on('error', (err) => {
  logger.error({ err }, 'erro inesperado em conexão ociosa do PostgreSQL');
});

/**
 * Executa `fn(client)` numa transação em client dedicado.
 * Qualquer erro faz ROLLBACK e é repassado.
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

/** Marca a transação corrente com a empresa (base do RLS, ligado na F10 — D2). */
export async function setTenant(client, companyId) {
  if (!isUuid(companyId)) throw new Error('setTenant: companyId inválido');
  await client.query("SELECT set_config('app.company_id', $1, true)", [companyId]);
}

/**
 * Toda operação de dados de empresa — inclusive leitura — roda aqui: transação em client dedicado
 * com `app.company_id` definido. Assim, ligar o RLS vira só criar as policies.
 */
export function withTenant(companyId, fn) {
  return withTransaction(async (client) => {
    await setTenant(client, companyId);
    return fn(client);
  });
}

/** Operações de plataforma, jobs e onboarding: cross-tenant por desenho e sempre auditadas. */
export function withSystem(fn) {
  return withTransaction(async (client) => {
    await client.query("SELECT set_config('app.system', 'on', true)");
    return fn(client);
  });
}

export async function closePool() {
  await pool.end();
}

/** Código do PostgreSQL para violação de unicidade. */
export const UNIQUE_VIOLATION = '23505';

// Endpoints de infraestrutura (pág. 08), fora de /api/v1:
// - /health: liveness, não toca no banco, fora do rate limit;
// - /ready: readiness (banco acessível e migrations em dia) — health check do staging e do E2E (na
//   produção o Render usa /health, para o Neon poder suspender);
// - /api/version: versão do deploy, base da estratégia de atualização (pág. 11).
import { env } from './config/env.js';
import { pool } from './shared/db.js';
import { logger } from './shared/logger.js';
import { pendingMigrations } from './shared/migrations.js';

export function health(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ status: 'ok' });
}

export async function ready(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const pending = await pendingMigrations(pool);
    if (pending.length > 0) {
      res.status(503).json({ status: 'not_ready', reason: 'pending_migrations', pending: pending.length });
      return;
    }
    res.json({ status: 'ready' });
  } catch (err) {
    logger.error({ err }, 'readiness: banco indisponível');
    res.status(503).json({ status: 'not_ready', reason: 'database_unavailable' });
  }
}

export function version(_req, res) {
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ data: { version: env.appVersion } });
}

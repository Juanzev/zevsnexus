// Processo HTTP: listen + graceful shutdown (pág. 19).
// No SIGTERM/SIGINT para de aceitar conexões, termina as em curso e fecha o pool.
import { createApp } from './app.js';
import { env } from './config/env.js';
import { closePool } from './shared/db.js';
import { logger } from './shared/logger.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'ZEVS Nexus no ar');
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'encerrando');
  // Se as conexões em curso não terminarem em 10 s, sai assim mesmo.
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  server.close(async () => {
    await closePool().catch((err) => logger.error({ err }, 'erro ao fechar o pool'));
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'promise rejeitada sem tratamento');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'exceção não capturada; encerrando');
  process.exit(1);
});

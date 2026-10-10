// Banco de teste: local, dedicado, e com trava anti-produção (pág. 17).
// Só aceita banco cujo nome termina em _test, num host local (no CI, o serviço do próprio job).

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5434/zevs_nexus_test';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function assertSafeTestDatabase(databaseUrl, { ci = process.env.CI === 'true' } = {}) {
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database.endsWith('_test')) {
    throw new Error(`Recusado: o banco de teste precisa terminar em "_test" (recebido "${database}").`);
  }
  if (!ci && !LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`Recusado: o banco de teste precisa ser local (recebido host "${url.hostname}").`);
  }
}

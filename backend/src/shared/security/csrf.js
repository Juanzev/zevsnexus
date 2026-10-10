// Guarda CSRF das rotas autenticadas por cookie (refresh, logout) — pág. 04.
// Além do cookie SameSite=Strict: header próprio obrigatório, Origin na allowlist
// (inclui a origem do próprio servidor, que serve a SPA) e Sec-Fetch-Site ≠ cross-site.
import { AuthorizationError } from '../errors.js';

export const CSRF_HEADER = 'x-zn-csrf';

export function createCsrfGuard(allowedOrigins) {
  const allowed = new Set(allowedOrigins);

  return function csrfGuard(req, _res, next) {
    if (req.get(CSRF_HEADER) !== '1') {
      throw new AuthorizationError('CSRF_REJECTED', 'Requisição recusada.');
    }
    const origin = req.get('origin');
    if (!origin || !allowed.has(origin)) {
      throw new AuthorizationError('CSRF_REJECTED', 'Requisição recusada.');
    }
    if (req.get('sec-fetch-site') === 'cross-site') {
      throw new AuthorizationError('CSRF_REJECTED', 'Requisição recusada.');
    }
    next();
  };
}

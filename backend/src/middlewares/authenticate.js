// Autenticação por access token (Bearer). O usuário é recarregado a cada requisição:
// conta desativada ou sessões encerradas valem na próxima chamada, sem esperar o token expirar.
import { findSessionUser } from '../modules/auth/auth.service.js';
import { AuthenticationError } from '../shared/errors.js';
import { verifyAccessToken } from '../shared/security/tokens.js';

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalidSession() {
  return new AuthenticationError('TOKEN_INVALID', 'Sessão inválida. Faça login novamente.');
}

export async function authenticate(req, _res, next) {
  const match = BEARER.exec(req.get('authorization') ?? '');
  if (!match) throw new AuthenticationError();

  let payload;
  try {
    payload = verifyAccessToken(match[1]);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AuthenticationError('TOKEN_EXPIRED', 'Sua sessão expirou.');
    }
    throw invalidSession();
  }
  if (typeof payload.sub !== 'string' || !UUID.test(payload.sub)) throw invalidSession();

  const user = await findSessionUser(payload.sub);
  if (!user) throw invalidSession();

  // Tokens emitidos antes de "sair de todos os dispositivos" ou de uma troca de senha.
  if (user.sessions_revoked_at && payload.iat < Math.floor(user.sessions_revoked_at.getTime() / 1000)) {
    throw new AuthenticationError('SESSION_REVOKED', 'Sua sessão foi encerrada. Faça login novamente.');
  }

  req.user = user;
  next();
}

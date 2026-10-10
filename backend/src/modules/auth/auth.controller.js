// HTTP da autenticação: lê req.valid / cookie, chama o service, responde. Sem regra de negócio.
import { env } from '../../config/env.js';
import { requestContext } from '../../shared/request-context.js';
import * as authService from './auth.service.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './auth.cookies.js';

function sessionPayload(session) {
  return {
    access_token: session.accessToken,
    token_type: 'Bearer',
    expires_in: env.JWT_EXPIRES_IN,
    user: session.user,
  };
}

const CHECK_EMAIL = { status: 'check_email' };

export async function register(req, res) {
  await authService.register(req.valid.body, requestContext(req));
  res.status(202).json({ data: CHECK_EMAIL });
}

export async function login(req, res) {
  const session = await authService.login(req.valid.body, requestContext(req));
  setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);
  res.json({ data: sessionPayload(session) });
}

export async function refresh(req, res) {
  try {
    const session = await authService.refresh(readRefreshCookie(req), requestContext(req));
    if (session.refreshToken) setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);
    res.json({ data: sessionPayload(session) });
  } catch (err) {
    // Sessão inválida, expirada ou reutilizada: o cookie não serve mais. Erro de infra não desloga.
    if (err.status === 401) clearRefreshCookie(res);
    throw err;
  }
}

export async function logout(req, res) {
  await authService.logout(readRefreshCookie(req), requestContext(req));
  clearRefreshCookie(res);
  res.status(204).end();
}

export async function logoutAll(req, res) {
  await authService.logoutAll(req.user, requestContext(req));
  clearRefreshCookie(res);
  res.status(204).end();
}

export async function forgotPassword(req, res) {
  await authService.requestPasswordReset(req.valid.body, requestContext(req));
  res.status(202).json({ data: CHECK_EMAIL });
}

export async function resetPassword(req, res) {
  await authService.resetPassword(req.valid.body, requestContext(req));
  clearRefreshCookie(res);
  res.json({ data: { status: 'password_reset' } });
}

export async function changePassword(req, res) {
  const { current_password: currentPassword, new_password: newPassword } = req.valid.body;
  const result = await authService.changePassword(
    req.user,
    { currentPassword, newPassword, currentRefreshToken: readRefreshCookie(req) },
    requestContext(req),
  );
  res.json({ data: { access_token: result.accessToken, token_type: 'Bearer', expires_in: env.JWT_EXPIRES_IN } });
}

export async function verifyEmail(req, res) {
  await authService.verifyEmail(req.valid.body, requestContext(req));
  res.json({ data: { status: 'email_verified' } });
}

export async function resendVerification(req, res) {
  const result = await authService.resendVerification(req.user);
  res.status(202).json({ data: { status: result.alreadyVerified ? 'already_verified' : 'check_email' } });
}

export async function me(req, res) {
  res.json({ data: await authService.getMe(req.user) });
}

// Cookie do refresh token (pág. 04): HttpOnly, SameSite=Strict, restrito a /api/v1/auth.
// Com HTTPS usa o prefixo __Secure- (exige Secure); em http://localhost, nome simples.
import { env } from '../../config/env.js';

export const REFRESH_COOKIE = env.secureCookies ? '__Secure-zn_rt' : 'zn_rt';

const baseOptions = {
  httpOnly: true,
  secure: env.secureCookies,
  sameSite: 'strict',
  path: '/api/v1/auth',
};

export function readRefreshCookie(req) {
  const value = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function setRefreshCookie(res, token, expiresAt) {
  res.cookie(REFRESH_COOKIE, token, { ...baseOptions, expires: expiresAt });
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, baseOptions);
}

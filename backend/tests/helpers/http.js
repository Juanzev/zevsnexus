import request from 'supertest';
import { createApp } from '../../src/app.js';
import { REFRESH_COOKIE } from '../../src/modules/auth/auth.cookies.js';

export const ORIGIN = 'http://localhost:3000';
export const CSRF_HEADERS = { Origin: ORIGIN, 'X-ZN-CSRF': '1' };

export function makeApp(options) {
  return createApp(options);
}

export function api(app) {
  return request(app);
}

/** Valor "nome=valor" do cookie de refresh numa resposta (ou null). */
export function refreshCookieFrom(res) {
  const cookies = res.headers['set-cookie'] ?? [];
  const cookie = cookies.find((item) => item.startsWith(`${REFRESH_COOKIE}=`));
  if (!cookie) return null;
  const pair = cookie.split(';')[0];
  return pair.endsWith('=') ? null : pair;
}

export function rawRefreshToken(cookiePair) {
  return decodeURIComponent(cookiePair.split('=')[1]);
}

/** Cabeçalho Set-Cookie completo do refresh (para conferir atributos). */
export function refreshSetCookieHeader(res) {
  return (res.headers['set-cookie'] ?? []).find((item) => item.startsWith(`${REFRESH_COOKIE}=`)) ?? null;
}

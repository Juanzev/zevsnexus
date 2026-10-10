// Cliente da API /api/v1: JSON, Bearer em memória, renovação automática da sessão.
// Erros sempre como ApiError, com a mensagem do servidor (em PT-BR).
import { ApiError, readJson } from './api-error.js';
import { clearLocalSession, expiresWithin, getAccessToken, isAuthenticated, refresh } from './session.js';

const RENEW_BEFORE_MS = 30_000;

export async function api(path, { method = 'GET', body, auth = true, retry = true } = {}) {
  // Renova antes de expirar: evita a ida e volta de um 401 na maioria das chamadas.
  if (auth && isAuthenticated() && expiresWithin(RENEW_BEFORE_MS)) await refresh();

  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getAccessToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw ApiError.network();
  }

  const payload = await readJson(response);
  if (response.ok) return payload;

  const error = ApiError.from(response.status, payload);
  if (response.status === 401 && auth) {
    if (retry && error.code === 'TOKEN_EXPIRED' && (await refresh())) {
      return api(path, { method, body, auth, retry: false });
    }
    clearLocalSession();
  }
  throw error;
}

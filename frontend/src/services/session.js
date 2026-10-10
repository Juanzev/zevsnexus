// Sessão no navegador (pág. 04 e 09):
// - access token SÓ em memória (nunca localStorage);
// - refresh pelo cookie HttpOnly, serializado entre abas com Web Locks;
// - login/logout propagados entre abas por BroadcastChannel.
import { ApiError, readJson } from './api-error.js';

const LOCK_NAME = 'zevs-nexus-refresh';
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('zevs-nexus-session') : null;
const listeners = new Set();

let state = { accessToken: null, expiresAt: 0, user: null };
let refreshing = null;

function notify() {
  for (const listener of listeners) listener(state);
}

function setSession(data) {
  state = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    user: data.user ?? state.user,
  };
  notify();
}

/** Apaga a sessão só nesta aba (o servidor já a encerrou ou vai encerrar). */
export function clearLocalSession() {
  if (!state.accessToken && !state.user) return;
  state = { accessToken: null, expiresAt: 0, user: null };
  notify();
}

export function onSessionChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isAuthenticated() {
  return Boolean(state.accessToken);
}

export function getUser() {
  return state.user;
}

export function getAccessToken() {
  return state.accessToken;
}

export function expiresWithin(ms) {
  return Boolean(state.accessToken) && state.expiresAt - Date.now() < ms;
}

export function updateUser(patch) {
  if (!state.user) return;
  state = { ...state, user: { ...state.user, ...patch } };
  notify();
}

/** Chamada às rotas de auth que dependem do cookie: header CSRF + mesma origem. */
async function authRequest(path, body, { bearer = false } = {}) {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json', 'X-ZN-CSRF': '1' };
  if (bearer && state.accessToken) headers.Authorization = `Bearer ${state.accessToken}`;
  let response;
  try {
    response = await fetch(`/api/v1/auth${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw ApiError.network();
  }
  const payload = await readJson(response);
  if (!response.ok) throw ApiError.from(response.status, payload);
  return payload?.data ?? null;
}

function withLock(task) {
  return navigator.locks?.request ? navigator.locks.request(LOCK_NAME, task) : task();
}

/**
 * Renova o access token pelo cookie. Chamadas simultâneas na mesma aba compartilham a mesma
 * promessa; entre abas, o lock garante uma renovação por vez. Devolve false se não há sessão.
 */
export function refresh() {
  refreshing ??= withLock(async () => {
    try {
      setSession(await authRequest('/refresh'));
      return true;
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        clearLocalSession();
        return false;
      }
      throw err;
    }
  }).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** No boot: tenta recuperar a sessão pelo cookie. Sem rede, segue deslogado. */
export async function restore() {
  try {
    return await refresh();
  } catch {
    return false;
  }
}

export async function login(email, password) {
  setSession(await authRequest('/login', { email, password }));
  channel?.postMessage({ type: 'login' });
  return state.user;
}

export async function logout() {
  try {
    await authRequest('/logout');
  } catch {
    // Mesmo sem resposta do servidor, a sessão local acaba aqui.
  }
  clearLocalSession();
  channel?.postMessage({ type: 'logout' });
}

export async function logoutEverywhere() {
  await authRequest('/logout-all', {}, { bearer: true });
  clearLocalSession();
  channel?.postMessage({ type: 'logout' });
}

/** Troca de senha logado: o servidor devolve um access token novo (os antigos caem). */
export async function changePassword(currentPassword, newPassword) {
  const data = await authRequest(
    '/password/change',
    { current_password: currentPassword, new_password: newPassword },
    { bearer: true },
  );
  setSession(data);
}

channel?.addEventListener('message', (event) => {
  if (event.data?.type === 'logout') clearLocalSession();
  if (event.data?.type === 'login' && !state.accessToken) restore();
});

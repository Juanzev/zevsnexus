// Empresa atual no navegador (pág. 03 e 09): lista de empresas (/me), escolha da empresa
// (preferência em localStorage, com tratamento de falha) e contexto — permissões, features e marca.
// Tudo aqui só ESCONDE coisas na tela; quem autoriza é o backend.
import { api, setCompanyProvider } from './api.js';
import { getUser, onSessionChange, updateUser } from './session.js';

const STORAGE_KEY = 'zn.company';
const DEFAULT_COLOR = '#1d4ed8';
const listeners = new Set();

let me = null;
let currentId = null;
let context = null;

setCompanyProvider(() => currentId);

function notify() {
  for (const listener of listeners) listener();
}

export function onTenantChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writePreference(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Sem armazenamento (aba privada): só não lembra a escolha.
  }
}

/** Cor da marca da empresa como CSS variable (pág. 10); só #RRGGBB chega aqui. */
function applyBranding(color) {
  const safe = /^#[0-9a-f]{6}$/i.test(color ?? '') ? color : DEFAULT_COLOR;
  document.documentElement.style.setProperty('--color-primary', safe);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', safe);
}

function isUsable(company) {
  return company.status === 'active' && company.membership_status === 'active';
}

export async function loadMe() {
  const { data } = await api('/me');
  me = data;
  if (getUser()?.email_verified !== data.user.email_verified) updateUser({ email_verified: data.user.email_verified });

  const preferred = readPreference();
  const chosen =
    data.companies.find((company) => company.id === preferred) ??
    data.companies.find(isUsable) ??
    data.companies[0] ??
    null;
  currentId = chosen?.id ?? null;
  context = null;
  if (chosen && isUsable(chosen)) await loadContext();
  else applyBranding(DEFAULT_COLOR);
  notify();
  return data;
}

export async function loadContext() {
  const { data } = await api('/company/context');
  context = data;
  applyBranding(data.branding.primary_color);
}

export async function selectCompany(id) {
  writePreference(id);
  currentId = id;
  context = null;
  const company = currentCompany();
  if (company && isUsable(company)) await loadContext();
  notify();
}

export function clearTenant() {
  me = null;
  currentId = null;
  context = null;
  applyBranding(DEFAULT_COLOR);
  notify();
}

export function isLoaded() {
  return me !== null;
}

export function companies() {
  return me?.companies ?? [];
}

export function currentCompany() {
  return companies().find((company) => company.id === currentId) ?? null;
}

export function currentContext() {
  return context;
}

export function isPlatformAdmin() {
  return Boolean(me?.platform_admin);
}

export function can(permission) {
  return Boolean(context?.permissions.includes(permission));
}

export function hasFeature(code) {
  return Boolean(context?.features.includes(code));
}

/** Atualiza a marca/fuso no contexto depois de salvar as configurações. */
export function patchContext({ branding, company }) {
  if (!context) return;
  if (branding) {
    context = { ...context, branding: { ...context.branding, ...branding } };
    applyBranding(context.branding.primary_color);
  }
  if (company) context = { ...context, company: { ...context.company, ...company } };
  notify();
}

onSessionChange((session) => {
  if (!session.accessToken && me) clearTenant();
});

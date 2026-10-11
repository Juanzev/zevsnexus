// Preparação rápida pela API (sem clicar): contas verificadas, empresa aprovada.
// Os fluxos que importam para o usuário continuam sendo testados pela tela nos *.spec.js.
import { randomUUID } from 'node:crypto';
import { request as playwrightRequest } from '@playwright/test';
import { PASSWORD, readEmail, uniqueEmail } from './helpers.js';

export const ADMIN_EMAIL = 'admin-zevs@exemplo.local';
const BASE_URL = `http://localhost:${process.env.E2E_PORT ?? '3100'}`;

async function client() {
  return playwrightRequest.newContext({ baseURL: BASE_URL });
}

/** Cria (se preciso) e confirma uma conta; devolve o access token. */
export async function verifiedAccount({ name, email }) {
  const api = await client();
  await api.post('/api/v1/auth/register', { data: { name, email, password: PASSWORD, accept_terms: true } });
  const login = async () => (await api.post('/api/v1/auth/login', { data: { email, password: PASSWORD } })).json();
  let session = await login();
  if (!session.data.user.email_verified) {
    const message = await readEmail(email, 'auth.verify_email');
    const token = /token=([A-Za-z0-9_-]+)/.exec(message.text)[1];
    await api.post('/api/v1/auth/email/verify', { data: { token } });
    session = await login();
  }
  await api.dispose();
  return session.data.access_token;
}

/** Conta nova, verificada, dona de uma empresa já aprovada. Devolve { email, companyName }. */
export async function approvedCompany({ name = 'Lucas Andrade', companyName = `Empresa ${randomUUID().slice(0, 6)}` } = {}) {
  const email = uniqueEmail('dono');
  const ownerToken = await verifiedAccount({ name, email });
  const adminToken = await verifiedAccount({ name: 'Equipe ZEVS', email: ADMIN_EMAIL });
  const api = await client();
  const created = await api.post('/api/v1/companies', {
    headers: { Authorization: `Bearer ${ownerToken}`, 'Idempotency-Key': randomUUID() },
    data: { legal_name: `${companyName} Ltda`, trade_name: companyName, timezone: 'America/Manaus' },
  });
  const { company } = (await created.json()).data;
  await api.post(`/api/v1/admin/companies/${company.id}/approve`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: {},
  });
  await api.dispose();
  return { email, companyName };
}

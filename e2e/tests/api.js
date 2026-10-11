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
  return { email, companyName, token: ownerToken, companyId: company.id };
}

/**
 * Dados de exemplo pela API (para auditar telas de detalhe): prestador, despesa paga em parte e um
 * documento PDF (intenção → PUT no /dev-storage → POST /documents). Devolve os ids.
 */
export async function seedCompanyData({ token, companyId }) {
  const api = await client();
  const headers = { Authorization: `Bearer ${token}`, 'X-Company-Id': companyId };
  const post = async (path, data) => {
    const res = await api.post(`/api/v1${path}`, { headers: { ...headers, 'Idempotency-Key': randomUUID() }, data });
    if (!res.ok()) throw new Error(`${path} ${res.status()}: ${await res.text()}`);
    return (await res.json()).data;
  };
  const { party } = await post('/parties', {
    person_type: 'company',
    name: 'Comercial de Materiais de Construção Vasconcellos e Filhos Ltda',
    document: '11.222.333/0001-81',
    roles: ['supplier', 'service_provider'],
    specialty: 'Materiais elétricos e hidráulicos',
    phone: '(92) 99876-5432',
    email: 'contato.vendas.corporativas@materiais-vasconcellos.exemplo.local',
    pix_key: 'financeiro.pagamentos.corporativos@materiais-vasconcellos.exemplo.local',
  });
  const { expense } = await post('/expenses', {
    description: 'Fornecimento de cabos, disjuntores e quadro de distribuição da obra residencial',
    amount_cents: 1_234_567_89,
    due_date: '2026-10-01',
    party_id: party.id,
    tags: ['Obra Residencial Vasconcellos', 'Elétrica'],
    notes: 'Entrega parcial combinada com o mestre de obras; o restante na próxima semana.',
  });
  await post(`/expenses/${expense.id}/payments`, { paid_on: '2026-10-01', amount_cents: 500_000_00, method: 'transfer', reference: 'TED 000123' });

  const pdf = Buffer.from(['%PDF-1.4', '1 0 obj << /Type /Catalog >> endobj', 'trailer << /Root 1 0 R >>', '%%EOF', ''].join('\n'));
  const intent = await post('/files/upload-intents', {
    filename: 'Contrato de fornecimento de materiais elétricos — obra residencial Vasconcellos.pdf',
    size_bytes: pdf.length,
  });
  const put = await api.put(new URL(intent.upload.url).pathname, { headers: intent.upload.headers, data: pdf });
  if (!put.ok()) throw new Error(`PUT ${put.status()}`);
  const { document } = await post('/documents', { file_id: intent.file.id, tags: ['Contratos'], expires_on: '2026-10-20' });
  await api.dispose();
  return { partyId: party.id, expenseId: expense.id, documentId: document.id };
}

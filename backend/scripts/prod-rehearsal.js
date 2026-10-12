// npm run prod:rehearsal [-- --keep]
// Ensaio de produção local (ARCHITECTURE §23 e §24.1): banco NOVO no cluster local, migrations e seed
// DUAS vezes (a segunda não muda nada), a API com NODE_ENV=production (a validação de ambiente de
// produção vale: https, R2, bcrypt 12) e um fluxo ponta a ponta pela API:
// cadastro → e-mail → aprovação no Painel ZEVS → empresa → prestador → despesa → pagamento parcial →
// estorno → "Já paguei" → lista → dashboard → URL de envio do R2 (só a assinatura; nada vai à rede) →
// renovação de sessão por cookie __Secure- → cabeçalhos de produção, PWA e kill switch desligado.
// Não toca em produção nem no banco de desenvolvimento. Sai com código 1 se algo falhar.
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { backendDir, dropDatabase, localUrl, recreateDatabase, startServer } from './lib/local-tools.js';

const keep = process.argv.includes('--keep');
const DATABASE = 'zevs_nexus_rehearsal';
const APP_URL = 'https://nexus.ensaio.local';
const ADMIN_EMAIL = 'equipe@ensaio.local';
const OWNER_EMAIL = 'dona@ensaio.local';
const PASSWORD = `ensaio-${randomBytes(9).toString('base64url')}`;
const outbox = mkdtempSync(path.join(os.tmpdir(), 'nexus-ensaio-'));
const version = `ensaio-${Date.now()}`;
const results = [];

function check(ok, label, detail = '') {
  results.push({ ok: Boolean(ok), label });
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(label);
}

function runScript(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: backendDir,
    // NODE_ENV=production: os scripts não leem o .env de desenvolvimento.
    env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: localUrl(DATABASE), DATABASE_SSL: 'false' },
    encoding: 'utf8',
  });
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}` };
}

async function catalogCounts() {
  const client = new pg.Client({ connectionString: localUrl(DATABASE) });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT (SELECT count(*) FROM permissions) AS permissions, (SELECT count(*) FROM roles) AS roles,
             (SELECT count(*) FROM role_permissions) AS role_permissions, (SELECT count(*) FROM plans) AS plans,
             (SELECT count(*) FROM pgmigrations) AS migrations`);
    return rows[0];
  } finally {
    await client.end();
  }
}

/** Cliente HTTP mínimo: JSON, Bearer, empresa e cookie de refresh. */
function http(base) {
  const state = { token: null, companyId: null, cookie: null };
  async function request(method, pathname, { body, headers = {}, idempotent = false } = {}) {
    const res = await fetch(`${base}${pathname}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
        ...(state.companyId ? { 'X-Company-Id': state.companyId } : {}),
        ...(idempotent ? { 'Idempotency-Key': randomUUID() } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    const refresh = setCookie.find((cookie) => cookie.startsWith('__Secure-zn_rt='));
    if (refresh) state.cookie = refresh.split(';')[0];
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, json, text, setCookie };
  }
  return { state, request };
}

/** Token do e-mail de confirmação. O e-mail sai depois da resposta (fora da requisição): espera até 5 s. */
async function verificationToken(email) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const messages = readdirSync(outbox)
      .filter((file) => file.endsWith('.json'))
      .map((file) => JSON.parse(readFileSync(path.join(outbox, file), 'utf8')))
      .filter((message) => message.to === email && message.template === 'auth.verify_email');
    const match = /token=([A-Za-z0-9_-]+)/.exec(messages.at(-1)?.text ?? '');
    if (match) return match[1];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return undefined;
}

async function account(base, name, email) {
  const client = http(base);
  const registered = await client.request('POST', '/api/v1/auth/register', {
    body: { name, email, password: PASSWORD, accept_terms: true },
  });
  check(registered.status === 202, `cadastro de ${name}`);
  const token = await verificationToken(email);
  check(token, `e-mail de confirmação de ${name} gerado (modo log)`);
  const verified = await client.request('POST', '/api/v1/auth/email/verify', { body: { token } });
  check(verified.status === 200, `confirmação de e-mail de ${name}`, verified.status === 200 ? '' : `${verified.status} ${verified.json?.error?.code}`);
  const login = await client.request('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD } });
  check(login.status === 200 && login.json?.data?.access_token, `login de ${name}`);
  client.state.token = login.json.data.access_token;
  return client;
}

let server;
const started = Date.now();
console.log(`Ensaio de produção local — banco ${DATABASE}, APP_URL ${APP_URL}\n`);
try {
  await recreateDatabase(DATABASE);

  // ---------- migrations e seed, duas vezes ----------
  check(runScript('scripts/migrate.js', ['up']).ok, 'migrations (1ª vez)');
  const second = runScript('scripts/migrate.js', ['up']);
  check(second.ok && /No migrations to run/i.test(second.output), 'migrations (2ª vez): nada a fazer');
  check(runScript('scripts/seed.js').ok, 'seed (1ª vez)');
  const afterFirstSeed = await catalogCounts();
  check(runScript('scripts/seed.js').ok, 'seed (2ª vez)');
  const afterSecondSeed = await catalogCounts();
  check(JSON.stringify(afterFirstSeed) === JSON.stringify(afterSecondSeed), 'seed idempotente', JSON.stringify(afterSecondSeed));

  // ---------- API em modo produção ----------
  server = await startServer({
    NODE_ENV: 'production',
    APP_URL,
    DATABASE_URL: localUrl(DATABASE),
    DATABASE_SSL: 'false',
    JWT_SECRET: randomBytes(48).toString('base64url'),
    BCRYPT_ROUNDS: '12',
    SERVE_FRONTEND: 'true',
    TRUST_PROXY: '1',
    CF_ORIGIN_SECRET: '',
    EMAIL_PROVIDER: 'log',
    EMAIL_OUTBOX_DIR: outbox,
    EMAIL_FROM: 'ZEVS Nexus <no-reply@ensaio.local>',
    PLATFORM_ADMIN_EMAILS: ADMIN_EMAIL,
    JOBS_ENABLED: 'false',
    LOG_LEVEL: 'warn',
    SW_KILL_SWITCH: 'false',
    RENDER_GIT_COMMIT: version,
    // Credenciais fictícias no formato certo: o ensaio só assina URLs; nada vai ao R2.
    STORAGE_PROVIDER: 'r2',
    R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    R2_ACCESS_KEY_ID: 'ensaio-chave-ficticia',
    R2_SECRET_ACCESS_KEY: 'ensaio-segredo-ficticio-com-mais-de-32-caracteres',
    R2_BUCKET: 'nexus-ensaio',
  });
  check(true, 'API no ar com NODE_ENV=production', server.url);

  const anonymous = http(server.url);
  const health = await anonymous.request('GET', '/health');
  const versionRes = await anonymous.request('GET', '/api/version');
  check(health.status === 200 && versionRes.json?.data?.version === version, '/health e /api/version (versão do deploy)');
  const page = await anonymous.request('GET', '/app');
  check(page.text.includes(`<meta name="app-version" content="${version}">`), 'index.html com a versão carimbada');
  check(page.headers.get('strict-transport-security')?.includes('max-age=31536000'), 'HSTS em produção');
  check(page.headers.get('content-security-policy')?.includes('r2.cloudflarestorage.com'), 'CSP libera o endpoint do R2');
  const sw = await anonymous.request('GET', '/sw.js');
  check(sw.headers.get('cache-control') === 'no-store' && sw.text.includes('networkFirst'), '/sw.js rede primeiro, no-store, kill switch desligado');
  const manifest = await anonymous.request('GET', '/manifest.webmanifest');
  check(manifest.status === 200 && JSON.parse(manifest.text).start_url === '/app', 'manifest da PWA');

  // ---------- fluxo ponta a ponta ----------
  const admin = await account(server.url, 'Equipe ZEVS', ADMIN_EMAIL);
  const owner = await account(server.url, 'Dona da Empresa', OWNER_EMAIL);

  const created = await owner.request('POST', '/api/v1/companies', {
    body: { legal_name: 'Empresa do Ensaio Ltda', timezone: 'America/Manaus' },
    idempotent: true,
  });
  check(created.status === 201 && created.json.data.company.status === 'pending', 'cadastro da empresa (em análise)');
  const companyId = created.json.data.company.id;
  const approved = await admin.request('POST', `/api/v1/admin/companies/${companyId}/approve`, { body: {} });
  check(approved.status === 200, 'aprovação pelo Painel ZEVS');
  owner.state.companyId = companyId;

  const context = await owner.request('GET', '/api/v1/company/context');
  check(context.status === 200 && context.json.data.document_folders.receipts, 'contexto da empresa com as pastas padrão');

  const party = await owner.request('POST', '/api/v1/parties', {
    body: { person_type: 'individual', name: 'Prestador do Ensaio', document: '529.982.247-25', roles: ['service_provider'] },
  });
  check(party.status === 201, 'prestador com CPF');

  const expense = await owner.request('POST', '/api/v1/expenses', {
    body: { description: 'Serviço do ensaio', amount_cents: 100_000, due_date: '2026-01-15', party_id: party.json.data.party.id },
    idempotent: true,
  });
  check(expense.status === 201, 'despesa lançada');
  const expenseId = expense.json.data.expense.id;

  const partial = await owner.request('POST', `/api/v1/expenses/${expenseId}/payments`, {
    body: { paid_on: '2026-01-15', amount_cents: 40_000, method: 'pix' },
    idempotent: true,
  });
  check(partial.status === 201 && partial.json.data.expense.status === 'partially_paid', 'pagamento parcial');
  const voided = await owner.request('POST', `/api/v1/expense-payments/${partial.json.data.expense.payments[0].id}/void`, {
    body: { reason: 'Ensaio de estorno' },
  });
  check(voided.status === 200 && voided.json.data.expense.paid_amount_cents === 0, 'estorno volta o saldo');

  const quick = await owner.request('POST', '/api/v1/expenses', {
    body: { description: 'Já paguei do ensaio', amount_cents: 2_500, payment: { paid_on: '2026-01-10', method: 'cash' } },
    idempotent: true,
  });
  check(quick.status === 201 && quick.json.data.expense.status === 'paid', '"Já paguei"');

  const list = await owner.request('GET', '/api/v1/expenses?tab=all');
  check(list.json?.meta?.totals?.amount_cents === 102_500, 'lista com totais', JSON.stringify(list.json?.meta?.totals));
  const dashboard = await owner.request('GET', '/api/v1/dashboard?period=this_year');
  check(dashboard.status === 200 && dashboard.json.data.finance, 'dashboard com o bloco financeiro');
  const sheets = await owner.request('GET', '/api/v1/spreadsheets?view=all');
  check(sheets.status === 200 && Number.isInteger(sheets.json.meta?.current_year), 'planilhas: lista e visões (0012)');

  const intent = await owner.request('POST', '/api/v1/files/upload-intents', {
    body: { filename: 'comprovante.pdf', size_bytes: 1234, content_type: 'application/pdf' },
  });
  const uploadUrl = new URL(intent.json?.data?.upload?.url ?? 'http://invalido');
  check(
    uploadUrl.hostname.endsWith('.r2.cloudflarestorage.com') &&
      uploadUrl.searchParams.get('X-Amz-SignedHeaders') === 'content-length;content-type;host',
    'URL de envio assinada para o R2 (tipo e tamanho assinados)',
  );

  const refreshed = await owner.request('POST', '/api/v1/auth/refresh', {
    body: {},
    headers: { Cookie: owner.state.cookie, Origin: APP_URL, 'X-ZN-CSRF': '1' },
  });
  check(refreshed.status === 200 && refreshed.json.data.access_token, 'renovação de sessão (cookie __Secure-zn_rt + CSRF)');
  const csrf = await owner.request('POST', '/api/v1/auth/refresh', { body: {}, headers: { Cookie: owner.state.cookie } });
  check(csrf.status === 403, 'renovação sem cabeçalho CSRF é recusada');
} catch (err) {
  if (!results.some((result) => !result.ok)) {
    results.push({ ok: false, label: err.message });
    console.log(`✗ erro inesperado — ${err.message}`);
  }
} finally {
  await server?.stop();
  rmSync(outbox, { recursive: true, force: true });
  if (!keep) await dropDatabase(DATABASE).catch(() => {});
}

const ok = results.length > 0 && results.every((result) => result.ok);
console.log(`\n${ok ? 'ENSAIO OK' : 'ENSAIO FALHOU'}: ${results.filter((r) => r.ok).length}/${results.length} verificações em ${((Date.now() - started) / 1000).toFixed(0)} s.`);
process.exit(ok ? 0 : 1);

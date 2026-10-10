import { pool } from '../../src/shared/db.js';
import { emailsTo, flushEmails } from '../helpers/email.js';
import { api, CSRF_HEADERS, makeApp } from '../helpers/http.js';
import { auditEvents, createTenant } from '../helpers/tenants.js';
import { createUser, loginAs } from '../helpers/users.js';

const app = makeApp({ serveFrontend: false });

describe('auditoria append-only', () => {
  test('UPDATE, DELETE e TRUNCATE são bloqueados pelo banco', async () => {
    const tenant = await createTenant();
    await api(app).patch('/api/v1/company/settings').set(tenant.headers('owner')).send({ timezone: 'America/Manaus' });
    const [event] = await pool.query("SELECT id FROM audit_logs WHERE action = 'settings.updated' LIMIT 1").then((r) => r.rows);
    await expect(pool.query("UPDATE audit_logs SET action = 'x.y' WHERE id = $1", [event.id])).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM audit_logs WHERE id = $1', [event.id])).rejects.toThrow(/append-only/);
    await expect(pool.query('TRUNCATE audit_logs')).rejects.toThrow(/append-only/);
  });
});

describe('eventos de conta vão para a auditoria', () => {
  test('login, falha de login e saída, com IP, user-agent e request id', async () => {
    const user = await createUser();
    await api(app).post('/api/v1/auth/login').set('User-Agent', 'teste-auditoria').send({ email: user.email, password: 'errada-123' });
    const { cookie } = await loginAs(api(app), user);
    await api(app).post('/api/v1/auth/logout').set(CSRF_HEADERS).set('Cookie', cookie);

    const [failed] = await auditEvents({ action: 'auth.login_failed', entityId: user.id });
    expect(failed).toMatchObject({ company_id: null, actor_user_id: null, user_agent: 'teste-auditoria' });
    expect(failed.ip).toBeTruthy();
    expect(failed.request_id).toBeTruthy();

    const [login] = await auditEvents({ action: 'auth.login', entityId: user.id });
    expect(login).toMatchObject({ company_id: null, actor_user_id: user.id, entity_type: 'user' });
    expect(await auditEvents({ action: 'auth.logout', entityId: user.id })).toHaveLength(1);
  });

  test('nenhum evento de conta guarda e-mail ou senha', async () => {
    const user = await createUser();
    await loginAs(api(app), user);
    const { rows } = await pool.query("SELECT metadata::text AS m FROM audit_logs WHERE entity_id = $1", [user.id]);
    for (const row of rows) {
      expect(row.m).not.toContain(user.email);
      expect(row.m).not.toContain(user.password);
    }
  });
});

describe('teto de e-mails por destinatário (3 por hora)', () => {
  test('aviso de tentativa de cadastro: a partir do 4º, a resposta é a mesma mas nada é enviado', async () => {
    const user = await createUser();
    const body = { name: 'Alguém', email: user.email, password: 'senha-forte-123', accept_terms: true };
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await api(app).post('/api/v1/auth/register').send(body)).status).toBe(202);
    }
    await flushEmails();
    expect(emailsTo(user.email, 'auth.account_exists')).toHaveLength(3);
  });

  test('recuperação de senha: idem', async () => {
    const user = await createUser();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await api(app).post('/api/v1/auth/password/forgot').send({ email: user.email })).status).toBe(202);
    }
    await flushEmails();
    expect(emailsTo(user.email, 'auth.password_reset')).toHaveLength(3);
  });
});

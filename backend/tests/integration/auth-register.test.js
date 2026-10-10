import { pool } from '../../src/shared/db.js';
import { emailsTo, flushEmails, waitForEmail } from '../helpers/email.js';
import { api, makeApp } from '../helpers/http.js';
import { createUser, uniqueEmail } from '../helpers/users.js';

const app = makeApp({ serveFrontend: false });

function register(body) {
  return api(app).post('/api/v1/auth/register').send(body);
}

const validBody = () => ({
  name: 'Ana Souza',
  email: uniqueEmail('cadastro'),
  password: 'senha-forte-123',
  accept_terms: true,
});

describe('POST /api/v1/auth/register', () => {
  test('cria a conta não verificada, registra o aceite dos termos e envia o link de confirmação', async () => {
    const body = validBody();
    const res = await register(body);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ data: { status: 'check_email' } });

    const { rows } = await pool.query(
      'SELECT name, email_verified_at, terms_accepted_at, password_hash FROM users WHERE email = $1',
      [body.email],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Ana Souza');
    expect(rows[0].email_verified_at).toBeNull();
    expect(rows[0].terms_accepted_at).toBeInstanceOf(Date);
    expect(rows[0].password_hash).not.toContain('senha-forte-123');

    const message = await waitForEmail(body.email, 'auth.verify_email');
    expect(message.text).toContain('http://localhost:3000/verificar-email?token=');
  });

  test('normaliza o e-mail (espaços e maiúsculas)', async () => {
    const body = validBody();
    const res = await register({ ...body, email: `  ${body.email.toUpperCase()}  ` });
    expect(res.status).toBe(202);
    const { rowCount } = await pool.query('SELECT 1 FROM users WHERE email = $1', [body.email]);
    expect(rowCount).toBe(1);
  });

  test('e-mail já cadastrado: mesma resposta, nada muda e o dono recebe um aviso', async () => {
    const existing = await createUser();
    const res = await register({ ...validBody(), email: existing.email, password: 'outra-senha-456' });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ data: { status: 'check_email' } });

    const notice = await waitForEmail(existing.email, 'auth.account_exists');
    expect(notice.subject).toMatch(/Tentativa de cadastro/);
    await flushEmails();
    expect(emailsTo(existing.email, 'auth.verify_email')).toHaveLength(0);

    // A senha original continua valendo.
    const login = await api(app).post('/api/v1/auth/login').send({ email: existing.email, password: existing.password });
    expect(login.status).toBe(200);
  });

  test.each([
    ['sem aceite dos termos', { accept_terms: false }, 'accept_terms'],
    ['senha curta', { password: '1234567' }, 'password'],
    ['senha acima de 72 bytes', { password: 'ç'.repeat(37) }, 'password'],
    ['e-mail inválido', { email: 'nao-e-email' }, 'email'],
    ['nome vazio', { name: '   ' }, 'name'],
  ])('recusa %s com 422 e o campo apontado', async (_caso, override, field) => {
    const res = await register({ ...validBody(), ...override });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((detail) => detail.field)).toContain(field);
  });

  test('campo extra (ex.: company_id) é recusado', async () => {
    const res = await register({ ...validBody(), company_id: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(422);
    expect(res.body.error.details).toContainEqual(expect.objectContaining({ field: 'company_id' }));
  });
});

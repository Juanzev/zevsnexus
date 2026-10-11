// Fluxos de conta: cadastro, sessão e recuperação de senha, como o cliente usaria.
// Sem empresa, quem entra cai no cadastro da empresa (onboarding).
import { expect, test } from '@playwright/test';
import { linkFrom, login, readEmail, register, uniqueEmail } from './helpers.js';

test('cadastro → confirmação de e-mail → login → cadastro da empresa → sair', async ({ page }) => {
  const email = uniqueEmail('cadastro');
  await register(page, { name: 'Marina Costa', email });

  const verification = await readEmail(email, 'auth.verify_email');
  await page.goto(linkFrom(verification));
  await expect(page.getByRole('heading', { name: 'E-mail confirmado' })).toBeVisible();
  // O token sai da barra de endereço.
  await expect(page).not.toHaveURL(/token=/);

  await page.getByRole('link', { name: 'Entrar' }).click();
  await login(page, { email });
  await expect(page).toHaveURL(/\/app\/onboarding$/);
  await expect(page.getByRole('heading', { name: 'Cadastre sua empresa' })).toBeVisible();

  // A sessão sobrevive ao recarregamento (refresh pelo cookie HttpOnly).
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Cadastre sua empresa' })).toBeVisible();

  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login\?next=%2Fapp$/);
});

test('sem e-mail confirmado não dá para cadastrar a empresa; dá para reenviar o link', async ({ page }) => {
  const email = uniqueEmail('sem-confirmar');
  await register(page, { name: 'Otávio Reis', email });
  await page.getByRole('link', { name: 'Ir para o login' }).click();
  await login(page, { email });

  await expect(page.getByRole('heading', { name: 'Confirme seu e-mail' })).toBeVisible();
  await page.getByRole('button', { name: 'Reenviar e-mail' }).click();
  await expect(page.getByText('Enviamos um novo link para o seu e-mail.')).toBeVisible();

  // Confirmando em outra aba, "Já confirmei" libera o formulário.
  const verification = await readEmail(email, 'auth.verify_email');
  const other = await page.context().newPage();
  await other.goto(linkFrom(verification));
  await expect(other.getByRole('heading', { name: 'E-mail confirmado' })).toBeVisible();
  await other.close();
  await page.getByRole('button', { name: 'Já confirmei' }).click();
  await expect(page.getByRole('heading', { name: 'Cadastre sua empresa' })).toBeVisible();
});

test('rota protegida manda para o login e segue depois de entrar', async ({ page }) => {
  const email = uniqueEmail('next');
  await register(page, { name: 'Paula Nunes', email });
  await page.goto('/app/empresa');
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fempresa$/);
  await login(page, { email });
  // Sem empresa ativa, a rota de empresa leva ao cadastro da empresa.
  await expect(page).toHaveURL(/\/app\/onboarding$/);
});

test('senha errada mostra erro sem revelar se o e-mail existe', async ({ page }) => {
  await page.goto('/login');
  await login(page, { email: uniqueEmail('ninguem'), password: 'qualquer-senha-1' });
  await expect(page.getByRole('alert')).toHaveText('E-mail ou senha incorretos.');
});

test('recuperar senha → redefinir → entrar com a nova senha; a antiga deixa de valer', async ({ page }) => {
  const email = uniqueEmail('recuperar');
  await register(page, { name: 'Rafael Prado', email });

  await page.goto('/login');
  await page.getByRole('link', { name: 'Esqueci minha senha' }).click();
  await page.getByLabel('E-mail').fill(email);
  await page.getByRole('button', { name: 'Enviar link' }).click();
  await expect(page.getByRole('heading', { name: 'Confira seu e-mail' })).toBeVisible();

  const reset = await readEmail(email, 'auth.password_reset');
  await page.goto(linkFrom(reset));
  await expect(page.getByRole('heading', { name: 'Criar nova senha' })).toBeVisible();
  await expect(page).not.toHaveURL(/token=/);
  await page.getByLabel('Nova senha', { exact: true }).fill('nova-senha-e2e-456');
  await page.getByLabel('Repita a nova senha').fill('nova-senha-e2e-456');
  await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  await expect(page.getByRole('heading', { name: 'Senha redefinida' })).toBeVisible();

  await page.getByRole('link', { name: 'Entrar' }).click();
  await login(page, { email });
  await expect(page.getByRole('alert')).toHaveText('E-mail ou senha incorretos.');
  await login(page, { email, password: 'nova-senha-e2e-456' });
  // A redefinição prova o controle do e-mail: a conta já pode cadastrar a empresa.
  await expect(page.getByRole('heading', { name: 'Cadastre sua empresa' })).toBeVisible();
});

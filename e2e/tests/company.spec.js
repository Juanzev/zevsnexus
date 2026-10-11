// Fluxos da F2: cadastro da empresa, aprovação pela equipe ZEVS, dados, contatos e configurações.
import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, approvedCompany, verifiedAccount } from './api.js';
import { PASSWORD, login, uniqueEmail } from './helpers.js';

test('cadastro da empresa → em análise → Painel ZEVS aprova → a dona entra no Início', async ({ browser }) => {
  const ownerEmail = uniqueEmail('onboarding');
  await verifiedAccount({ name: 'Beatriz Moura', email: ownerEmail });
  await verifiedAccount({ name: 'Equipe ZEVS', email: ADMIN_EMAIL });

  // Dona: cadastra a empresa.
  const owner = await (await browser.newContext()).newPage();
  await owner.goto('/login');
  await login(owner, { email: ownerEmail });
  await expect(owner.getByRole('heading', { name: 'Cadastre sua empresa' })).toBeVisible();
  await owner.getByLabel('Razão social').fill('Moura Projetos e Obras Ltda');
  await owner.getByLabel('Nome fantasia').fill('Moura Projetos');
  await owner.getByLabel('CNPJ').fill('12abc34501de35');
  await owner.getByLabel('CNPJ').blur();
  await expect(owner.getByLabel('CNPJ')).toHaveValue('12.ABC.345/01DE-35');
  await owner.getByRole('button', { name: 'Cadastrar empresa' }).click();
  await expect(owner.getByRole('heading', { name: 'Empresa em análise' })).toBeVisible();
  await expect(owner.getByText('Moura Projetos')).toBeVisible();

  // Equipe ZEVS: aprova no Painel (outra sessão).
  const admin = await (await browser.newContext()).newPage();
  await admin.goto('/login');
  await login(admin, { email: ADMIN_EMAIL });
  await expect(admin).toHaveURL(/\/admin\/empresas/);
  const card = admin.getByRole('listitem').filter({ hasText: 'Moura Projetos' });
  await expect(card.getByText('12.ABC.345/01DE-35')).toBeVisible();
  await card.getByRole('button', { name: 'Aprovar' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Aprovar' }).click();
  await expect(admin.getByText('Moura Projetos aprovada.')).toBeVisible();

  // Dona: confere e entra.
  await owner.getByRole('button', { name: 'Verificar agora' }).click();
  await expect(owner).toHaveURL(/\/app$/);
  await expect(owner.getByRole('heading', { name: 'Olá, Beatriz!' })).toBeVisible();
  await expect(owner.getByText('Primeiros passos')).toBeVisible();
});

test('dados da empresa, contato responsável e cor da marca', async ({ page }) => {
  const { email, companyName } = await approvedCompany({ name: 'Carlos Teixeira' });
  await page.goto('/login');
  await login(page, { email });
  await expect(page.getByRole('heading', { name: 'Olá, Carlos!' })).toBeVisible();

  // Dados e endereço.
  await page.getByRole('link', { name: 'Completar os dados' }).click();
  await expect(page.getByRole('heading', { name: 'Empresa', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Editar' }).click();
  await page.getByLabel('CNPJ').fill('11.222.333/0001-81');
  await page.getByLabel('Telefone').fill('(92) 3234-5678');
  await page.getByLabel('CEP').fill('69050-010');
  await page.getByLabel('Logradouro').fill('Av. Djalma Batista');
  await page.getByLabel('Número').fill('1000');
  await page.getByLabel('Cidade').fill('Manaus');
  await page.getByLabel('UF').selectOption('AM');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Dados da empresa salvos.')).toBeVisible();
  await expect(page.getByText('Av. Djalma Batista, 1000 · Manaus/AM · CEP 69050-010')).toBeVisible();
  await expect(page.getByText('11.222.333/0001-81')).toBeVisible();

  // CNPJ inválido mostra o erro no campo.
  await page.getByRole('button', { name: 'Editar' }).click();
  await page.getByLabel('CNPJ').fill('11.222.333/0001-00');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('CNPJ inválido. Confira os números.')).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).click();

  // Contato responsável.
  await page.getByRole('button', { name: 'Adicionar' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nome').fill('Rita Lopes');
  await dialog.getByLabel('Cargo ou função').fill('Sócia');
  await dialog.getByLabel('Telefone').fill('92987654321');
  await dialog.getByLabel(/É responsável/).check();
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Contato adicionado.')).toBeVisible();
  const contact = page.getByRole('listitem').filter({ hasText: 'Rita Lopes' });
  await expect(contact.getByText('Responsável')).toBeVisible();
  await expect(contact.getByText('(92) 98765-4321')).toBeVisible();

  // Com tudo preenchido, o Início mostra o cadastro completo.
  await page.getByRole('link', { name: 'Início' }).first().click();
  await expect(page.getByText('Cadastro completo.')).toBeVisible();

  // Cor da marca: vale na hora para o app inteiro.
  await page.getByRole('link', { name: 'Configurações' }).first().click();
  await page.locator('input[type="color"]').fill('#0f766e');
  await page.getByRole('button', { name: 'Salvar configurações' }).click();
  await expect(page.getByText('Configurações salvas.')).toBeVisible();
  const primary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim());
  expect(primary).toBe('#0f766e');

  // E continua depois de recarregar (vem do servidor).
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
  const reloaded = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim());
  expect(reloaded).toBe('#0f766e');
  await expect(page.getByText(companyName).first()).toBeVisible();
});

test('troca de senha e "sair de todos" encerram a sessão das outras abas', async ({ browser }) => {
  const { email } = await approvedCompany({ name: 'Sara Melo' });
  const context = await browser.newContext();
  const first = await context.newPage();
  await first.goto('/login');
  await login(first, { email });
  await expect(first.getByRole('heading', { name: 'Olá, Sara!' })).toBeVisible();

  const second = await context.newPage();
  await second.goto('/app');
  await expect(second.getByRole('heading', { name: 'Olá, Sara!' })).toBeVisible();

  await first.getByRole('link', { name: 'Configurações' }).first().click();
  await first.getByLabel('Senha atual').fill(PASSWORD);
  await first.getByLabel('Nova senha', { exact: true }).fill('senha-nova-e2e-789');
  await first.getByLabel('Repita a nova senha').fill('senha-nova-e2e-789');
  await first.getByRole('button', { name: 'Trocar senha' }).click();
  await expect(first.getByText('Senha trocada. As outras sessões foram encerradas.')).toBeVisible();

  await first.getByRole('button', { name: 'Sair de todos os dispositivos' }).click();
  await first.getByRole('dialog').getByRole('button', { name: 'Sair de todos', exact: true }).click();
  await expect(first).toHaveURL(/\/login$/);
  // A outra aba recebe o aviso pelo BroadcastChannel e volta para o login.
  await expect(second).toHaveURL(/\/login/);

  await login(first, { email, password: 'senha-nova-e2e-789' });
  await expect(first.getByRole('heading', { name: 'Olá, Sara!' })).toBeVisible();
  await context.close();
});

test('quem não é da equipe ZEVS não abre o Painel', async ({ page }) => {
  const { email } = await approvedCompany({ name: 'Diego Ramos' });
  await page.goto('/login');
  await login(page, { email });
  await page.goto('/admin/empresas');
  await expect(page.getByRole('heading', { name: 'Você não tem acesso a esta área' })).toBeVisible();
});

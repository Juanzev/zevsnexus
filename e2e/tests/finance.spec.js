// Financeiro e Prestadores pela tela: cadastro de prestador, despesa com prestador, pagamento parcial,
// comprovante, estorno, "Já paguei", abas, Início, categorias e celular.
import { expect, test } from '@playwright/test';
import { approvedCompany } from './api.js';
import { expectNoHorizontalScroll, login } from './helpers.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Hoje e ontem em Manaus (fuso da empresa criada pelo approvedCompany). */
function manausDate(offsetDays = 0) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Manaus' }).format(new Date());
  const [year, month, day] = today.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + offsetDays)).toISOString().slice(0, 10);
}

async function start(page) {
  const { email } = await approvedCompany({ name: 'Renata Lima' });
  await page.goto('/login');
  await login(page, { email });
  await expect(page.getByRole('heading', { name: 'Olá, Renata!' })).toBeVisible();
}

async function goTo(page, path) {
  await page.locator(`a[href="${path}"]:visible`).first().click();
}

test('prestador → despesa vencida → pagamento parcial → resto com comprovante → estorno → "Já paguei"', async ({ page }) => {
  await start(page);

  // Prestador (pessoa física, CPF fictício válido).
  await goTo(page, '/app/prestadores');
  await page.getByRole('button', { name: 'Novo cadastro' }).click();
  let dialog = page.locator('dialog[open]');
  await dialog.getByLabel('Nome', { exact: true }).fill('Marcos Pedreiro');
  await dialog.getByLabel('CPF ou CNPJ (opcional)').fill('529.982.247-25');
  await dialog.getByLabel('Especialidade (opcional)').fill('Pedreiro');
  await dialog.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(page.getByRole('heading', { name: 'Marcos Pedreiro' })).toBeVisible();
  await expect(page.getByText('529.982.247-25')).toBeVisible();

  // Despesa vencida (ontem) com o prestador.
  await goTo(page, '/app/financeiro');
  await page.getByRole('button', { name: 'Nova despesa' }).click();
  dialog = page.locator('dialog[open]');
  await dialog.getByLabel('Descrição').fill('Reboco da fachada');
  await dialog.getByLabel('Valor').fill('1.500,00');
  await dialog.getByLabel('Vencimento').fill(manausDate(-1));
  await dialog.getByLabel('Prestador ou fornecedor').fill('Marcos Pedreiro — Pedreiro');
  await dialog.getByLabel('Categoria').selectOption({ label: 'Mão de obra' });
  await dialog.getByLabel('Tags').fill('Obra Sul');
  await dialog.getByRole('button', { name: 'Lançar despesa' }).click();
  await expect(page.getByRole('heading', { name: 'Reboco da fachada' })).toBeVisible();
  await expect(page.getByText('Vencida', { exact: true })).toBeVisible();

  // Pagamento parcial em dinheiro.
  await page.getByRole('button', { name: 'Registrar pagamento' }).click();
  dialog = page.locator('dialog[open]');
  await dialog.getByLabel('Valor').fill('500');
  await dialog.getByLabel('Forma de pagamento').selectOption({ label: 'Dinheiro' });
  await dialog.getByRole('button', { name: 'Registrar' }).click();
  await expect(page.getByText('Pagamento registrado.', { exact: true })).toBeVisible();
  await expect(page.getByText('Parcial', { exact: true })).toBeVisible();

  // O resto por PIX, com comprovante (foto).
  await page.getByRole('button', { name: 'Registrar pagamento' }).click();
  dialog = page.locator('dialog[open]');
  await expect(dialog.getByLabel('Valor')).toHaveValue('1.000,00');
  await dialog.getByLabel('Comprovante').setInputFiles({ name: 'pix.png', mimeType: 'image/png', buffer: PNG });
  await dialog.getByRole('button', { name: 'Registrar' }).click();
  await expect(page.getByText('Pagamento registrado. Despesa quitada.')).toBeVisible();
  await expect(page.getByText('Paga', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Comprovante', exact: true })).toBeVisible();

  // Estorno do primeiro pagamento: volta a ficar parcial.
  await page.getByRole('button', { name: 'Estornar' }).first().click();
  dialog = page.locator('dialog[open]');
  await dialog.getByLabel('Motivo').fill('Lançado em dobro');
  await dialog.getByRole('button', { name: 'Estornar' }).click();
  await expect(page.getByText('Pagamento estornado.')).toBeVisible();
  await expect(page.getByText('Estornado', { exact: true })).toBeVisible();
  await expect(page.getByText('Parcial', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Ver histórico' }).click();
  await expect(page.getByText('Estornou pagamento de R$ 500,00')).toBeVisible();

  // "Já paguei": despesa + pagamento + comprovante de uma vez.
  await goTo(page, '/app/financeiro');
  await page.getByRole('button', { name: 'Já paguei' }).click();
  dialog = page.locator('dialog[open]');
  await dialog.getByLabel('Descrição').fill('Areia e cimento');
  await dialog.getByLabel('Valor').fill('489,90');
  await dialog.getByLabel('Comprovante').setInputFiles({ name: 'nota.png', mimeType: 'image/png', buffer: PNG });
  await dialog.getByRole('button', { name: 'Registrar pagamento' }).click();
  await expect(page.getByRole('heading', { name: 'Areia e cimento' })).toBeVisible();
  await expect(page.getByText('Paga', { exact: true })).toBeVisible();

  // Abas e totais.
  await goTo(page, '/app/financeiro');
  await page.getByRole('tab', { name: 'Vencidas' }).click();
  await expect(page.getByRole('link', { name: /Reboco da fachada/ })).toBeVisible();
  await expect(page.getByText('R$ 500,00').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Pagas' }).click();
  await expect(page.getByRole('link', { name: /Areia e cimento/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Reboco/ })).toHaveCount(0);

  // Ficha do prestador com totais e histórico.
  await goTo(page, '/app/prestadores');
  await page.getByRole('link', { name: /Marcos Pedreiro/ }).click();
  await expect(page.getByText('Em aberto')).toBeVisible();
  await expect(page.getByRole('link', { name: /Reboco da fachada/ })).toBeVisible();

  // Início com o bloco financeiro do mês.
  await goTo(page, '/app');
  await expect(page.getByText('Financeiro do mês')).toBeVisible();
  await expect(page.getByText('A pagar vencido')).toBeVisible();
});

test('categorias em Configurações e janela de "Próximas"', async ({ page }) => {
  await start(page);
  await goTo(page, '/app/configuracoes');
  await expect(page.getByRole('heading', { name: 'Categorias de despesa' })).toBeVisible();
  await page.getByRole('button', { name: 'Nova categoria' }).click();
  await page.locator('dialog[open]').getByLabel('Nome').fill('Combustível');
  await page.locator('dialog[open]').getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByText('Categoria criada.')).toBeVisible();
  await expect(page.locator('[data-categories]').getByText('Combustível', { exact: true })).toBeVisible();

  await page.getByLabel(/Próximas/).fill('15');
  await page.getByRole('button', { name: 'Salvar configurações' }).click();
  await expect(page.getByText('Configurações salvas.')).toBeVisible();
  await page.goto('/app/financeiro?aba=upcoming');
  await expect(page.getByText(/\(15 dias\)/)).toBeVisible();
});

for (const width of [320, 375]) {
  test(`Financeiro no celular (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await start(page);
    await expect(page.locator('.bottom-bar').getByText('Financeiro')).toBeVisible();
    await goTo(page, '/app/financeiro');
    await page.getByRole('button', { name: 'Nova despesa' }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByLabel('Descrição').fill('Conta de luz do escritório com descrição bem longa para testar quebra');
    await dialog.getByLabel('Valor').fill('312,47');
    await dialog.getByRole('button', { name: 'Lançar despesa' }).click();
    await expect(page.getByRole('heading', { name: /Conta de luz/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await goTo(page, '/app/financeiro');
    await expect(page.getByRole('link', { name: /Conta de luz/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.goto('/app/prestadores');
    await expect(page.getByRole('heading', { name: 'Prestadores e fornecedores' })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
}

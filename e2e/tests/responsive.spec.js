// Auditoria de responsividade (pág. 10 e 17): toda tela sem rolagem lateral em 320, 375 e 1280 px.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, approvedCompany, seedCompanyData, verifiedAccount } from './api.js';
import { expectNoHorizontalScroll, login, uniqueEmail } from './helpers.js';

const WIDTHS = [320, 375, 1280];
const PUBLIC_ROUTES = ['/login', '/cadastro', '/recuperar-senha', '/redefinir-senha', '/verificar-email', '/rota-inexistente'];
const APP_ROUTES = [
  '/app',
  '/app/empresa',
  '/app/configuracoes',
  '/app/documentos',
  '/app/documentos?aba=lixeira',
  '/app/financeiro',
  '/app/financeiro?aba=paid',
  '/app/prestadores',
  '/app/planilhas?aba=todas',
];

/** Controles clicáveis visíveis com menos de 44 px de altura (pág. 10: alvo de toque mínimo). */
function smallTargets(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.btn, .tab, .nav-link, .bottom-bar-item, .input')]
      .filter((element) => element.offsetParent !== null && !element.closest('[hidden]'))
      .map((element) => ({ text: (element.textContent || element.getAttribute('aria-label') || element.name || '').trim().slice(0, 40), height: element.getBoundingClientRect().height }))
      .filter((target) => target.height < 44),
  );
}

async function visitAll(page, routes, { checkTargets = false } = {}) {
  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator('h1')).toBeVisible();
    // Espera os dados da tela carregarem antes de medir.
    await expect(page.locator('[role="status"]')).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    if (checkTargets) expect({ route, small: await smallTargets(page) }).toEqual({ route, small: [] });
  }
}

for (const width of WIDTHS) {
  test(`telas públicas em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await visitAll(page, PUBLIC_ROUTES);
  });

  test(`cadastro da empresa e "em análise" em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const email = uniqueEmail(`onb-${width}`);
    await verifiedAccount({ name: 'Teodoro Albuquerque de Vasconcellos', email });
    await page.goto('/login');
    await login(page, { email });
    await expect(page.getByRole('heading', { name: 'Cadastre sua empresa' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.getByLabel('Razão social').fill(`Albuquerque de Vasconcellos Engenharia e Construções ${randomUUID().slice(0, 4)} Ltda`);
    await page.getByRole('button', { name: 'Cadastrar empresa' }).click();
    await expect(page.getByRole('heading', { name: 'Empresa em análise' })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test(`painel da empresa em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const company = await approvedCompany({
      name: 'Teodoro Albuquerque de Vasconcellos',
      companyName: `Vasconcellos Engenharia, Arquitetura e Gestão de Obras ${randomUUID().slice(0, 4)}`,
    });
    // Dados com textos longos: as telas de detalhe também não podem rolar para o lado.
    const ids = await seedCompanyData(company);
    await page.goto('/login');
    await login(page, { email: company.email });
    await expect(page.locator('h1')).toBeVisible();
    await visitAll(
      page,
      [
        ...APP_ROUTES,
        `/app/financeiro/${ids.expenseId}`,
        `/app/prestadores/${ids.partyId}`,
        `/app/documentos/${ids.documentId}`,
        `/app/planilhas/${ids.spreadsheetId}`,
      ],
      { checkTargets: width < 1024 },
    );
    // Barra inferior só no celular; sidebar só no desktop.
    await expect(page.locator('.bottom-bar')).toBeVisible({ visible: width < 1024 });
    await expect(page.locator('.sidebar')).toBeVisible({ visible: width >= 1024 });
  });

  test(`Painel ZEVS em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await verifiedAccount({ name: 'Equipe ZEVS', email: ADMIN_EMAIL });
    await page.goto('/login');
    await login(page, { email: ADMIN_EMAIL });
    await visitAll(page, ['/admin/empresas?status=all']);
  });
}

test('alvos de toque dos botões principais têm pelo menos 44 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/login');
  for (const name of ['Entrar', 'Mostrar senha']) {
    const box = await page.getByRole('button', { name }).boundingBox();
    expect(box.height, name).toBeGreaterThanOrEqual(44);
  }
  const { email } = await approvedCompany();
  await login(page, { email });
  await expect(page.locator('.bottom-bar')).toBeVisible();
  for (const item of await page.locator('.bottom-bar-item').all()) {
    expect((await item.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
});

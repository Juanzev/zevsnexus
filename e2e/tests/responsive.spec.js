// Auditoria de responsividade (pág. 10 e 17): toda tela sem rolagem lateral em 320, 375 e 1280 px.
import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, login, register, uniqueEmail } from './helpers.js';

const WIDTHS = [320, 375, 1280];
const PUBLIC_ROUTES = ['/login', '/cadastro', '/recuperar-senha', '/redefinir-senha', '/verificar-email', '/rota-inexistente'];

for (const width of WIDTHS) {
  test(`telas públicas em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    for (const route of PUBLIC_ROUTES) {
      await page.goto(route);
      await expect(page.locator('h1')).toBeVisible();
      await expectNoHorizontalScroll(page);
    }
  });

  test(`início logado em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const email = uniqueEmail(`responsivo-${width}`);
    await register(page, { name: 'Teodoro Albuquerque de Vasconcellos', email });
    await expectNoHorizontalScroll(page);
    await page.goto('/login');
    await login(page, { email });
    await expect(page.locator('h1')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
}

test('alvos de toque dos botões principais têm pelo menos 44 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/login');
  for (const name of ['Entrar', 'Mostrar senha']) {
    const box = await page.getByRole('button', { name }).boundingBox();
    expect(box.height, name).toBeGreaterThanOrEqual(44);
  }
});

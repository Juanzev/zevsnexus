// PWA (ARCHITECTURE §19.1): service worker rede primeiro controlando a página, "Sem conexão" sem rede,
// nada de /api nem de arquivo no cache, e a ajuda "Instalar no celular".
import { expect, test } from '@playwright/test';
import { approvedCompany } from './api.js';
import { login } from './helpers.js';

async function waitForController(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // A primeira visita registra; a partir da segunda navegação o worker controla a página.
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

test('service worker controla a página; sem rede mostra "Sem conexão"; com rede volta ao app', async ({ page, context }) => {
  await page.goto('/login');
  await waitForController(page);

  const registration = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return { scope: reg.scope, updateViaCache: reg.updateViaCache };
  });
  expect(registration.updateViaCache).toBe('none');
  expect(new URL(registration.scope).pathname).toBe('/');

  await context.setOffline(true);
  await page.goto('/app/financeiro');
  await expect(page.getByRole('heading', { name: 'Sem conexão' })).toBeVisible();

  await context.setOffline(false);
  await page.getByRole('link', { name: 'Tentar de novo' }).click();
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
});

test('o cache do service worker nunca guarda /api nem arquivos de documento', async ({ page }) => {
  const { email } = await approvedCompany({ name: 'Sofia Prado' });
  await page.goto('/login');
  await waitForController(page);
  await login(page, { email });
  await expect(page.getByRole('heading', { name: 'Olá, Sofia!' })).toBeVisible();
  await page.goto('/app/documentos');
  await expect(page.getByRole('heading', { name: 'Documentos' })).toBeVisible();

  const cached = await page.evaluate(async () => {
    const urls = [];
    for (const key of await caches.keys()) {
      const cache = await caches.open(key);
      for (const request of await cache.keys()) urls.push(new URL(request.url).pathname);
    }
    return urls;
  });
  expect(cached).toContain('/offline.html');
  expect(cached.filter((url) => url.startsWith('/api/') || url.startsWith('/dev-storage/') || url === '/sw.js')).toEqual([]);
});

test('Configurações mostra como instalar no celular', async ({ page }) => {
  const { email } = await approvedCompany({ name: 'Otávio Reis' });
  await page.goto('/login');
  await login(page, { email });
  await expect(page.getByRole('heading', { name: 'Olá, Otávio!' })).toBeVisible();
  await page.goto('/app/configuracoes');
  await expect(page.getByRole('heading', { name: 'Instalar no celular' })).toBeVisible();
  await page.getByText('Outros aparelhos').click();
  await expect(page.getByText('Adicionar à Tela de Início', { exact: false }).first()).toBeVisible();
});

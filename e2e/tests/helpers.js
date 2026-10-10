import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';

const outboxDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.outbox');

export function uniqueEmail(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8)}@exemplo.local`;
}

export const PASSWORD = 'senha-do-e2e-123';

/** Último e-mail de `template` para `to`, gravado pelo provider de log (espera até aparecer). */
export async function readEmail(to, template) {
  let found = null;
  await expect
    .poll(
      () => {
        const files = readdirSync(outboxDir).filter((file) => file.endsWith('.json')).sort();
        const messages = files.map((file) => JSON.parse(readFileSync(path.join(outboxDir, file), 'utf8')));
        found = messages.filter((message) => message.to === to && message.template === template).at(-1) ?? null;
        return found !== null;
      },
      { message: `e-mail ${template} para ${to}`, timeout: 5_000 },
    )
    .toBe(true);
  return found;
}

export function linkFrom(message) {
  const match = /https?:\/\/\S+token=[A-Za-z0-9_-]+/.exec(message.text);
  if (!match) throw new Error('e-mail sem link');
  const url = new URL(match[0]);
  return `${url.pathname}${url.search}`;
}

export async function register(page, { name, email, password = PASSWORD }) {
  await page.goto('/cadastro');
  await page.getByLabel('Seu nome').fill(name);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByLabel(/Li e aceito/).check();
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('heading', { name: 'Confira seu e-mail' })).toBeVisible();
}

export async function login(page, { email, password = PASSWORD }) {
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

/** Sem rolagem lateral (ZEVS STRUCTURE pág. 10). */
export async function expectNoHorizontalScroll(page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, `rolagem lateral em ${page.url()}`).toBeLessThanOrEqual(innerWidth);
}

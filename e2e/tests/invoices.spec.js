// Notas fiscais pela tela: registrar já emitida (com tomador), PDF e XML, recebimento e desfazer,
// nota em processamento → emitida → cancelada, número repetido, abas e o celular.
import { expect, test } from '@playwright/test';
import { approvedCompany, createCustomer } from './api.js';
import { expectNoHorizontalScroll, login } from './helpers.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const XML = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><CompNfse><Numero>2026001</Numero></CompNfse>');
const CUSTOMER = 'Condomínio Residencial Aurora';

async function signIn(page) {
  const company = await approvedCompany({ name: 'Enoque Souza' });
  await createCustomer(company, CUSTOMER);
  await page.goto('/login');
  await login(page, { email: company.email });
  await expect(page.getByRole('heading', { name: 'Olá, Enoque!' })).toBeVisible();
  await page.locator('a[href="/app/notas"]:visible').first().click();
  await expect(page.getByRole('heading', { name: 'Notas fiscais', exact: true })).toBeVisible();
}

async function fillInvoice(dialog, { number, issued = true, customer = false, gross, withheld }) {
  if (number) await dialog.getByLabel('Número', { exact: true }).fill(number);
  if (!issued) await dialog.getByLabel(/A nota já foi emitida/).uncheck();
  if (customer) {
    await expect(dialog.locator(`datalist option[value="${CUSTOMER}"]`)).toHaveCount(1);
    await dialog.getByLabel('Tomador (cliente)').fill(CUSTOMER);
  }
  await dialog.getByLabel('Descrição do serviço ou produto').fill('Acompanhamento técnico da obra — outubro');
  await dialog.getByLabel('Valor bruto').fill(gross);
  if (withheld) await dialog.getByLabel('Retenções (total)').fill(withheld);
}

test('registrar emitida, anexar PDF e XML, receber, desfazer; processamento → emitida → cancelada', async ({ page }) => {
  await signIn(page);
  await expect(page.getByText('Nada a receber')).toBeVisible();

  // Nota que já saiu na prefeitura: registrada direto como emitida, com tomador e retenções.
  await page.getByRole('button', { name: 'Registrar nota' }).click();
  let dialog = page.locator('dialog[open]');
  await expect(dialog.getByLabel('Tipo')).toHaveValue('nfse');
  await fillInvoice(dialog, { number: '2026001', customer: true, gross: '10.000,00', withheld: '1.100,00' });
  await dialog.getByRole('button', { name: 'Registrar nota' }).click();
  await expect(page.getByText('Nota registrada como emitida.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'NFS-e nº 2026001' })).toBeVisible();
  const main = page.getByRole('main');
  await expect(main.getByText('Emitida', { exact: true })).toBeVisible();
  await expect(main.getByText('R$ 8.900,00')).toBeVisible();
  await expect(main.getByRole('link', { name: CUSTOMER })).toBeVisible();

  // PDF e XML (vão para a pasta "Notas fiscais" da Central).
  await page.getByRole('button', { name: 'Anexar' }).click();
  dialog = page.locator('dialog[open]');
  await expect(dialog.getByLabel('O que é')).toHaveValue('pdf');
  await dialog.getByLabel('Arquivo').setInputFiles({ name: 'NFS-e 2026001.pdf', mimeType: 'application/pdf', buffer: PDF });
  await dialog.getByRole('button', { name: 'Anexar' }).click();
  await expect(page.getByText('Arquivo anexado.')).toBeVisible();
  await page.getByRole('button', { name: 'Anexar' }).click();
  dialog = page.locator('dialog[open]');
  await expect(dialog.getByLabel('O que é')).toHaveValue('xml');
  await dialog.getByLabel('Arquivo').setInputFiles({ name: 'NFS-e 2026001.xml', mimeType: 'application/xml', buffer: XML });
  await dialog.getByRole('button', { name: 'Anexar' }).click();
  await expect(main.getByText('XML da nota ·')).toBeVisible();
  await expect(main.getByText('PDF da nota ·')).toBeVisible();

  // Recebimento (valor sugerido = líquido) e desfazer com motivo.
  await page.getByRole('button', { name: 'Registrar recebimento' }).click();
  dialog = page.locator('dialog[open]');
  await expect(dialog.getByLabel('Valor recebido')).toHaveValue('8.900,00');
  await dialog.getByRole('button', { name: 'Marcar como paga' }).click();
  await expect(page.getByText('Recebimento registrado. Nota finalizada.')).toBeVisible();
  await expect(main.getByText('Finalizada', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Desfazer recebimento' }).click();
  dialog = page.locator('dialog[open]');
  await dialog.getByLabel('Motivo').fill('Depósito devolvido pelo banco');
  await dialog.getByRole('button', { name: 'Desfazer recebimento' }).click();
  await expect(page.getByText('Recebimento desfeito.')).toBeVisible();
  await expect(main.getByText(/Depósito devolvido pelo banco/)).toBeVisible();

  // Histórico.
  await page.getByRole('button', { name: 'Ver histórico' }).click();
  await expect(main.getByText('Desfez o recebimento de R$ 8.900,00')).toBeVisible();
  await expect(main.getByText('Anexou xml da nota')).toBeVisible();

  // Pendentes: a nota de volta, com os totais.
  await main.getByRole('link', { name: 'Notas fiscais' }).click();
  await expect(main.locator('[data-invoice]')).toHaveCount(1);
  await expect(main.getByText('R$ 1.100,00')).toBeVisible();

  // Em processamento → emitida → cancelada.
  await page.getByRole('button', { name: 'Registrar nota' }).click();
  dialog = page.locator('dialog[open]');
  await fillInvoice(dialog, { issued: false, gross: '2.500,00' });
  await dialog.getByRole('button', { name: 'Registrar nota' }).click();
  await expect(page.getByText('Nota registrada em processamento.')).toBeVisible();
  await expect(main.getByText('Em processamento', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Marcar emitida' }).click();
  dialog = page.locator('dialog[open]');
  // Número repetido (mesmo tipo e série) aparece no campo.
  await dialog.getByLabel('Número', { exact: true }).fill('2026001');
  await dialog.getByRole('button', { name: 'Marcar emitida' }).click();
  await expect(dialog.getByText('Já existe uma nota deste tipo e série com este número.')).toBeVisible();
  await dialog.getByLabel('Número', { exact: true }).fill('2026002');
  await dialog.getByRole('button', { name: 'Marcar emitida' }).click();
  await expect(page.getByText('Nota marcada como emitida.')).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar nota' }).click();
  dialog = page.locator('dialog[open]');
  await dialog.getByLabel('Motivo').fill('Cancelada na prefeitura: valor errado');
  await dialog.getByRole('button', { name: 'Cancelar nota' }).click();
  await expect(page.getByText('Nota cancelada.')).toBeVisible();
  await expect(main.getByText('Cancelada', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrar recebimento' })).toHaveCount(0);

  await main.getByRole('link', { name: 'Notas fiscais' }).click();
  await page.getByRole('tab', { name: 'Canceladas' }).click();
  await expect(main.getByRole('link', { name: /NFS-e nº 2026002/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Todas' }).click();
  await expect(main.locator('[data-invoice]')).toHaveCount(2);
});

test('celular: Notas na barra inferior, Prestadores no "Mais"', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signIn(page);
  const bar = page.getByRole('navigation', { name: 'Atalhos' });
  await expect(bar.getByRole('link')).toHaveText(['Início', 'Financeiro', 'Documentos', 'Notas']);
  await bar.getByRole('button', { name: 'Mais' }).click();
  await expect(page.locator('dialog[open]').getByRole('link', { name: 'Prestadores' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expectNoHorizontalScroll(page);
});

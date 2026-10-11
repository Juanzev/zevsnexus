// Central de Documentos pela tela: pastas sugeridas, envio (vários arquivos), recusa por conteúdo,
// detalhe, edição, versões, download, favorito, mover, lixeira e celular.
import { expect, test } from '@playwright/test';
import { approvedCompany } from './api.js';
import { expectNoHorizontalScroll, login } from './helpers.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function openDocuments(page) {
  const { email } = await approvedCompany({ name: 'Paula Ribeiro' });
  await page.goto('/login');
  await login(page, { email });
  await expect(page.getByRole('heading', { name: 'Olá, Paula!' })).toBeVisible();
  // Sidebar (desktop) ou barra inferior (celular): o link visível.
  await page.locator('a[href="/app/documentos"]:visible').first().click();
  await expect(page.getByRole('heading', { name: 'Documentos' })).toBeVisible();
}

test('envio, detalhe, edição, versões, download, favorito, mover e lixeira', async ({ page }) => {
  await openDocuments(page);

  // Empresa nova já nasce com as pastas sugeridas.
  const main = page.getByRole('main');
  for (const name of ['Empresa', 'Financeiro', 'Contratos', 'Notas fiscais']) {
    await expect(main.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  await main.getByRole('link', { name: /^Contratos/ }).click();
  await expect(page.getByRole('navigation', { name: 'Caminho da pasta' })).toContainText('Contratos');

  // Vários arquivos de uma vez; o que não bate com a extensão é recusado pelo servidor.
  await page.locator('[data-input="files"]').setInputFiles([
    { name: 'Contrato Obra Norte.pdf', mimeType: 'application/pdf', buffer: PDF },
    { name: 'foto-canteiro.png', mimeType: 'image/png', buffer: PNG },
    { name: 'boleto.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<html><script>alert(1)</script></html>') },
  ]);
  await expect(page.getByText('2 de 3 enviados. Confira os erros.')).toBeVisible();
  await expect(page.locator('[data-upload="2"]')).toContainText('não corresponde ao tipo');
  await expect(page.getByRole('link', { name: /Contrato Obra Norte/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /foto-canteiro/ })).toBeVisible();

  // Detalhe e edição.
  await page.getByRole('link', { name: /Contrato Obra Norte/ }).click();
  await expect(page.getByRole('heading', { name: 'Contrato Obra Norte' })).toBeVisible();
  await page.getByRole('button', { name: 'Editar' }).click();
  const edit = page.locator('dialog[open]');
  await edit.getByLabel('Título').fill('Contrato de empreitada — Obra Norte');
  await edit.getByLabel('Tipo').selectOption({ label: 'Contrato' });
  await edit.getByLabel('Validade').fill('2030-12-31');
  await edit.getByLabel('Tags').fill('Obra Norte, Jurídico');
  await edit.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Documento salvo.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Contrato de empreitada — Obra Norte' })).toBeVisible();
  await expect(page.getByText('31/12/2030')).toBeVisible();

  // Nova versão e restaurar a anterior (vira a versão 3; o histórico não se reescreve).
  await page.getByRole('button', { name: 'Nova versão' }).click();
  const versionDialog = page.locator('dialog[open]');
  await versionDialog.getByLabel('Arquivo').setInputFiles({ name: 'Contrato revisado.pdf', mimeType: 'application/pdf', buffer: PDF });
  await versionDialog.getByLabel(/O que mudou/).fill('Aditivo de prazo');
  await versionDialog.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByText('Versão 2 enviada.')).toBeVisible();
  await expect(page.getByText('Aditivo de prazo')).toBeVisible();

  await page.getByRole('button', { name: 'Restaurar' }).first().click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.getByText('Versão 1 restaurada.')).toBeVisible();
  await expect(page.getByText('Restaurada da versão 1')).toBeVisible();

  // Download: URL curta, nome original do arquivo.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar' }).first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Contrato Obra Norte.pdf');

  // Histórico mostra quem fez o quê.
  await page.getByRole('button', { name: 'Ver histórico' }).click();
  await expect(page.getByText('Restaurou a versão 1 (virou a versão 3)')).toBeVisible();
  await expect(page.getByText('Baixou a versão 3')).toBeVisible();

  // Favorito aparece na aba Favoritos.
  await page.getByRole('button', { name: 'Favoritar' }).click();
  await expect(page.getByRole('button', { name: 'Favorito' })).toHaveAttribute('aria-pressed', 'true');

  // Mover para a pasta Empresa.
  await page.getByRole('button', { name: 'Mover' }).click();
  await page.locator('dialog[open]').getByLabel('Pasta').selectOption({ label: '   Empresa' });
  await page.locator('dialog[open]').getByRole('button', { name: 'Mover' }).click();
  await expect(page.getByText('Documento movido.')).toBeVisible();
  await expect(main.getByRole('link', { name: 'Empresa' })).toBeVisible();

  await page.goto('/app/documentos?aba=favoritos');
  await expect(page.getByRole('link', { name: /Contrato de empreitada/ })).toBeVisible();

  // Lixeira e restauração.
  await page.getByRole('link', { name: /Contrato de empreitada/ }).click();
  await page.getByRole('button', { name: 'Excluir' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Mover para a lixeira' }).click();
  await expect(page.getByText('Documento movido para a lixeira.')).toBeVisible();
  await page.getByRole('tab', { name: 'Lixeira' }).click();
  await expect(page.getByRole('link', { name: /Contrato de empreitada/ })).toBeVisible();
  await page.getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.getByText('Documento restaurado.')).toBeVisible();
  await expect(page.getByText('Lixeira vazia')).toBeVisible();

  // Busca sem acento encontra pelo título.
  await page.getByRole('tab', { name: 'Recentes' }).click();
  await page.getByLabel('Buscar documentos').fill('empreitada');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page.getByText('1 resultado para “empreitada”')).toBeVisible();
});

test('pastas: criar, renomear, não excluir com conteúdo, excluir vazia', async ({ page }) => {
  await openDocuments(page);
  await page.getByRole('button', { name: 'Nova pasta' }).click();
  await page.locator('dialog[open]').getByLabel('Nome da pasta').fill('Obra Sul');
  await page.locator('dialog[open]').getByRole('button', { name: 'Criar pasta' }).click();
  await expect(page.getByText('Pasta “Obra Sul” criada.')).toBeVisible();

  await page.getByRole('link', { name: /^Obra Sul/ }).click();
  await page.getByRole('button', { name: 'Nova pasta' }).click();
  await page.locator('dialog[open]').getByLabel('Nome da pasta').fill('Medições');
  await page.locator('dialog[open]').getByRole('button', { name: 'Criar pasta' }).click();
  await expect(page.getByRole('link', { name: /^Medições/ })).toBeVisible();

  await page.getByRole('button', { name: 'Excluir pasta' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Excluir pasta' }).click();
  await expect(page.getByText(/Só é possível excluir uma pasta vazia/)).toBeVisible();

  await page.getByRole('link', { name: /^Medições/ }).click();
  await page.getByRole('button', { name: 'Renomear' }).click();
  await page.locator('dialog[open]').getByLabel('Nome da pasta').fill('Medições 2026');
  await page.locator('dialog[open]').getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Pasta renomeada.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Caminho da pasta' })).toContainText('Obra Sul');
  await expect(page.getByRole('navigation', { name: 'Caminho da pasta' })).toContainText('Medições 2026');

  await page.getByRole('button', { name: 'Excluir pasta' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Excluir pasta' }).click();
  await expect(page.getByText('Pasta excluída.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Caminho da pasta' })).toContainText('Obra Sul');
});

for (const width of [320, 375]) {
  test(`documentos no celular (${width}px): lista, detalhe e "Tirar foto"`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openDocuments(page);
    await expect(page.getByRole('button', { name: 'Tirar foto' })).toBeVisible();
    await expect(page.locator('[data-input="camera"]')).toHaveAttribute('capture', 'environment');
    await page.locator('[data-input="camera"]').setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByText('Arquivo enviado.')).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.getByRole('tab', { name: 'Recentes' }).click();
    await page.getByRole('link', { name: /^image/ }).click();
    await expect(page.getByRole('heading', { name: 'image' })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
}

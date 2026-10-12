// Planilhas pela tela, com as planilhas fantasma (fixtures/planilhas): envio, "em uso", visões, ações
// em lote, prévia com abas e páginas, XLS só para baixar, CSV antigo (Windows-1252) e o celular.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { approvedCompany, fixturesDir } from './api.js';
import { expectNoHorizontalScroll, login } from './helpers.js';

const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
};

/** Conteúdo em memória: a data de modificação vira "agora" (o checkout do git não preserva a do arquivo). */
function ghost(name) {
  const extension = name.split('.').pop();
  return { name, mimeType: MIME[extension], buffer: readFileSync(path.join(fixturesDir, name)) };
}

async function signIn(page) {
  const { email } = await approvedCompany({ name: 'Renata Moura' });
  await page.goto('/login');
  await login(page, { email });
  await expect(page.getByRole('heading', { name: 'Olá, Renata!' })).toBeVisible();
}

test('envio, em uso, visões, lote, prévia com abas e páginas, XLS e CSV antigo', async ({ page }) => {
  await signIn(page);
  await page.locator('a[href="/app/planilhas"]:visible').first().click();
  await expect(page.getByRole('heading', { name: 'Planilhas' })).toBeVisible();
  await expect(page.getByText('Nenhuma planilha em uso')).toBeVisible();

  // Vários arquivos; o que não é planilha é recusado antes de enviar.
  await page.locator('[data-input="files"]').setInputFiles([
    ghost('Controle de pagamentos 2026.xlsx'),
    ghost('Controle de pagamentos 2019.xls'),
    ghost('Extrato conta corrente - setembro 2026.csv'),
    { name: 'Contrato.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') },
  ]);
  await expect(page.getByText('3 de 4 enviadas. Confira os erros.')).toBeVisible();
  await expect(page.locator('[data-upload="3"]')).toContainText('Não é planilha');

  // Direto do envio para "Em uso".
  await page.locator('[data-upload="0"]').getByRole('button', { name: /Marcar em uso/ }).click();
  const main = page.getByRole('main');
  await expect(main.locator('[data-spreadsheet]')).toHaveCount(1);
  await expect(main.getByRole('link', { name: /Controle de pagamentos 2026/ })).toBeVisible();

  // Todas: as três, com o selo de "em uso" só na primeira.
  await page.getByRole('tab', { name: 'Todas' }).click();
  await expect(main.locator('[data-spreadsheet]')).toHaveCount(3);

  // Lote: duas planilhas para 2019 → saem de "Deste ano" e vão para "Antigas".
  await page.getByLabel('Selecionar Controle de pagamentos 2019').check();
  await page.getByLabel('Selecionar Extrato conta corrente - setembro 2026').check();
  const bulk = page.getByRole('region', { name: 'Ações em lote' });
  await expect(bulk).toContainText('2 selecionadas');
  await bulk.getByRole('button', { name: 'Mudar o ano' }).click();
  const yearDialog = page.locator('dialog[open]');
  await yearDialog.getByLabel('Ano de referência').fill('2019');
  await yearDialog.getByRole('button', { name: 'Salvar ano' }).click();
  await expect(page.getByText('Ano alterado em 2 planilhas.')).toBeVisible();
  await expect(bulk).toBeHidden();

  await page.getByRole('tab', { name: 'Antigas' }).click();
  await expect(main.locator('[data-spreadsheet]')).toHaveCount(2);
  await page.getByRole('tab', { name: 'Deste ano' }).click();
  await expect(main.locator('[data-spreadsheet]')).toHaveCount(1);

  // Filtro por ano (anos que existem na empresa) e arquivar em lote.
  await page.getByRole('tab', { name: 'Todas' }).click();
  await page.getByLabel('Ano de referência').selectOption('2019');
  await expect(page.getByText('2 planilhas encontradas')).toBeVisible();
  await page.getByLabel('Selecionar Extrato conta corrente - setembro 2026').check();
  await bulk.getByRole('button', { name: 'Arquivar' }).click();
  await expect(page.getByText('Planilha arquivada.')).toBeVisible();
  await page.getByRole('tab', { name: 'Arquivadas' }).click();
  await expect(main.getByRole('link', { name: /Extrato conta corrente/ })).toBeVisible();

  // CSV salvo pelo Excel antigo: Windows-1252, acentos certos.
  await main.getByRole('link', { name: /Extrato conta corrente/ }).click();
  await expect(page.getByRole('heading', { name: 'Extrato conta corrente - setembro 2026' })).toBeVisible();
  await expect(page.getByText('Windows-1252 (ANSI)')).toBeVisible();
  await expect(page.getByRole('region', { name: /Prévia da aba/ })).toContainText('Histórico');
  await page.getByRole('button', { name: 'Desarquivar' }).click();
  await expect(page.getByText('Planilha desarquivada.')).toBeVisible();

  // XLSX: abas, título, páginas de 50 linhas e valores formatados.
  await main.getByRole('link', { name: 'Planilhas', exact: true }).click();
  await page.getByRole('tab', { name: 'Todas' }).click();
  await main.getByRole('link', { name: /Controle de pagamentos 2026/ }).click();
  await expect(page.getByRole('heading', { name: 'Controle de pagamentos 2026' })).toBeVisible();
  const table = page.getByRole('region', { name: 'Prévia da aba Pagamentos' });
  await expect(table).toContainText('CONTROLE DE PAGAMENTOS 2026');
  await expect(table).toContainText('Prestador / fornecedor');
  await expect(table).toContainText(/R\$ \d/);
  await expect(page.getByText('Linhas 1–50 de 125')).toBeVisible();
  await page.getByRole('button', { name: /Próxima/ }).click();
  await expect(page.getByText('Linhas 51–100 de 125')).toBeVisible();
  await page.getByRole('tab', { name: 'Prestadores' }).click();
  await expect(page.getByRole('region', { name: 'Prévia da aba Prestadores' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Prestadores' })).toHaveAttribute('aria-selected', 'true');

  // Tirar de uso pelo detalhe.
  await page.getByRole('button', { name: 'Em uso', exact: true }).click();
  await expect(page.getByText('Planilha tirada de uso.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Marcar em uso' })).toBeVisible();

  // XLS: sem prévia, só baixar (com o nome original).
  await main.getByRole('link', { name: 'Planilhas', exact: true }).click();
  await page.getByRole('tab', { name: 'Antigas' }).click();
  await main.getByRole('link', { name: /Controle de pagamentos 2019/ }).click();
  await expect(page.getByText(/não têm prévia/)).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar planilha' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('Controle de pagamentos 2019.xls');

  // O histórico do documento conta a história da planilha.
  await page.getByRole('link', { name: 'Ver na Central de Documentos' }).click();
  await page.getByRole('button', { name: 'Ver histórico' }).click();
  await expect(page.getByText('Alterou ano de referência da planilha')).toBeVisible();
  await expect(page.getByText(/Entrou em Planilhas \(ano 2026\)/)).toBeVisible();
});

test('celular: Planilhas pelo "Mais", prévia rola só dentro da tabela', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signIn(page);
  await page.getByRole('button', { name: 'Mais' }).click();
  await page.locator('dialog[open]').getByRole('link', { name: 'Planilhas' }).click();
  await expect(page.getByRole('heading', { name: 'Planilhas' })).toBeVisible();

  await page.locator('[data-input="files"]').setInputFiles([ghost('Medições obra Residencial Aurora 2025.xlsx')]);
  await expect(page.getByText('Planilha enviada.')).toBeVisible();
  await page.getByRole('tab', { name: 'Todas' }).click();
  await page.getByRole('main').getByRole('link', { name: /Medições obra Residencial Aurora/ }).click();
  const preview = page.getByRole('region', { name: /Prévia da aba/ });
  await expect(preview).toBeVisible();
  await expectNoHorizontalScroll(page);
  // A tabela é mais larga que a tela, mas a rolagem fica no contêiner dela.
  const { scrollWidth, clientWidth } = await preview.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
  expect(scrollWidth).toBeGreaterThan(clientWidth);
});

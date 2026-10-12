// Peças puras das Planilhas: ano sugerido no envio, letras de coluna, escape das células e a divisão
// da navegação (Planilhas fica no "Mais" do celular).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

// session.js abre um BroadcastChannel (login entre abas); no Node ele manteria o processo vivo.
delete globalThis.BroadcastChannel;
const { NAV_ITEMS, splitNavItems } = await import('../src/components/nav.js');
const { columnLetter, previewTable } = await import('../src/components/spreadsheets.js');
const { referenceYearOf } = await import('../src/services/uploads.js');

describe('referenceYearOf', () => {
  test('planilha: o ano da última modificação do arquivo', () => {
    const lastModified = new Date(2019, 5, 30).getTime();
    assert.equal(referenceYearOf({ name: 'Controle 2019.XLS', lastModified }), 2019);
    assert.equal(referenceYearOf({ name: 'extrato.csv', lastModified }), 2019);
  });

  test('outro tipo, sem data ou fora de 1990..2100: nada (o backend usa o ano corrente)', () => {
    assert.equal(referenceYearOf({ name: 'contrato.pdf', lastModified: Date.now() }), undefined);
    assert.equal(referenceYearOf({ name: 'a.xlsx', lastModified: 0 }), undefined);
    assert.equal(referenceYearOf({ name: 'a.ods', lastModified: new Date(1985, 0, 1).getTime() }), undefined);
  });
});

describe('prévia', () => {
  test('letras de coluna como no Excel', () => {
    assert.deepEqual([0, 25, 26, 27, 51, 52, 199, 701, 702].map(columnLetter), ['A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'GR', 'ZZ', 'AAA']);
  });

  test('célula com HTML, script ou fórmula sai como texto escapado', () => {
    const out = previewTable(
      { columns: 2, rows: [{ number: 1, cells: ['<img src=x onerror=alert(1)>', '=HYPERLINK("http://x")'] }] },
      { label: 'Aba "1"' },
    ).toString();
    assert.ok(!out.includes('<img'));
    assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(out.includes('=HYPERLINK(&quot;http://x&quot;)'));
    assert.ok(out.includes('aria-label="Aba &quot;1&quot;"'));
  });
});

describe('navegação', () => {
  test('barra inferior Início · Financeiro · Documentos · Notas; Planilhas e Prestadores no "Mais"', () => {
    const paths = NAV_ITEMS.map((item) => item.path);
    assert.equal(paths.indexOf('/app/notas'), paths.indexOf('/app/documentos') + 1);
    assert.equal(paths.indexOf('/app/planilhas'), paths.indexOf('/app/notas') + 1);
    const { shortcuts, more } = splitNavItems(NAV_ITEMS);
    assert.deepEqual(
      shortcuts.map((item) => item.path),
      ['/app', '/app/financeiro', '/app/documentos', '/app/notas'],
    );
    assert.deepEqual(
      more.map((item) => item.path),
      ['/app/planilhas', '/app/prestadores', '/app/empresa', '/app/configuracoes'],
    );
  });

  test('sem permissão de algum atalho, o próximo item da barra sobe; nada se repete', () => {
    const items = NAV_ITEMS.filter((item) => item.path !== '/app/financeiro');
    const { shortcuts, more } = splitNavItems(items);
    assert.deepEqual(
      shortcuts.map((item) => item.path),
      ['/app', '/app/documentos', '/app/notas', '/app/prestadores'],
    );
    assert.deepEqual(
      more.map((item) => item.path),
      ['/app/planilhas', '/app/empresa', '/app/configuracoes'],
    );
  });
});

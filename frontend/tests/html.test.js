// Testes das funções puras de segurança do frontend (node:test, sem navegador).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { escapeHtml, html, isSafeHtml } from '../src/lib/html.js';
import { passwordProblem } from '../src/lib/text.js';
import { safeNext } from '../src/lib/url.js';

describe('html``', () => {
  test('escapa valores interpolados', () => {
    const name = '<img src=x onerror=alert(1)>';
    assert.equal(String(html`<p>${name}</p>`), '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  });

  test('escapa aspas: valor não fecha o atributo', () => {
    const value = '" autofocus onfocus="alert(1)';
    assert.equal(String(html`<input value="${value}">`), '<input value="&quot; autofocus onfocus=&quot;alert(1)">');
  });

  test('aninha html`` sem escapar de novo e junta listas', () => {
    const items = ['a', '<b>'].map((item) => html`<li>${item}</li>`);
    assert.equal(String(html`<ul>${items}</ul>`), '<ul><li>a</li><li>&lt;b&gt;</li></ul>');
  });

  test('null, undefined e false não viram texto', () => {
    assert.equal(String(html`${null}${undefined}${false}${0}`), '0');
  });

  test('string comum nunca é tratada como HTML seguro', () => {
    assert.equal(isSafeHtml('<b>x</b>'), false);
    assert.equal(isSafeHtml(html`<b>x</b>`), true);
    assert.equal(escapeHtml("`'"), '&#96;&#39;');
  });
});

describe('safeNext', () => {
  test('aceita caminho interno', () => {
    assert.equal(safeNext('/app?x=1'), '/app?x=1');
  });

  test('recusa open redirect e lixo', () => {
    for (const value of ['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', '', null, '/a\nb']) {
      assert.equal(safeNext(value), null, String(value));
    }
  });
});

describe('passwordProblem', () => {
  test('mesma regra do backend', () => {
    assert.match(passwordProblem('1234567'), /8 caracteres/);
    assert.equal(passwordProblem('12345678'), null);
    assert.match(passwordProblem('ç'.repeat(37)), /72 bytes/);
  });
});

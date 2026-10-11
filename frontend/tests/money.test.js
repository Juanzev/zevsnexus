// Dinheiro sem float: leitura do texto pt-BR em centavos e formatação (node:test, sem navegador).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { centsToInput, formatCents, parseMoney } from '../src/lib/money.js';

describe('parseMoney', () => {
  test('aceita os formatos comuns e devolve centavos inteiros', () => {
    assert.equal(parseMoney('1.234,56'), 123456);
    assert.equal(parseMoney('1234,56'), 123456);
    assert.equal(parseMoney('1234'), 123400);
    assert.equal(parseMoney('R$ 10,5'), 1050);
    assert.equal(parseMoney('0,01'), 1);
    assert.equal(parseMoney('1234.56'), 123456);
    assert.equal(parseMoney('0,1 '), 10);
  });

  test('sem arredondamento de float', () => {
    assert.equal(parseMoney('0,29'), 29);
    assert.equal(parseMoney('1.005,35'), 100535);
  });

  test('recusa o que não é valor', () => {
    for (const text of ['', 'abc', '1,234', '12,345', '1.23,45', '-10', '10,', '1..000', null]) {
      assert.equal(parseMoney(text), null, String(text));
    }
  });
});

describe('formatCents', () => {
  test('formata em reais (pt-BR)', () => {
    // O Intl separa "R$" do número com espaço inseparável: \s cobre os dois.
    assert.equal(formatCents(123456).replace(/\s/g, ' '), 'R$ 1.234,56');
    assert.equal(formatCents(5).replace(/\s/g, ' '), 'R$ 0,05');
    assert.equal(centsToInput(123456), '1.234,56');
    assert.equal(formatCents('x'), '');
  });
});

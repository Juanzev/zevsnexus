// Casamento de rotas com parâmetro (:id) — funções puras, sem navegador.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { matchRoute } from '../src/routes.js';

describe('matchRoute', () => {
  test('rota fixa vence a rota com parâmetro', () => {
    assert.equal(matchRoute('/app/documentos').path, '/app/documentos');
    assert.deepEqual(matchRoute('/app/documentos/').params, {});
  });

  test('captura parâmetros do caminho', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    assert.deepEqual(matchRoute(`/app/documentos/${id}`).params, { id });
    const folder = matchRoute(`/app/documentos/pasta/${id}`);
    assert.equal(folder.path, '/app/documentos/pasta/:folderId');
    assert.deepEqual(folder.params, { folderId: id });
  });

  test('segmentos a mais ou codificação inválida não casam', () => {
    assert.equal(matchRoute('/app/documentos/a/b/c'), null);
    assert.equal(matchRoute('/app/documentos/%E0%A4%A'), null);
    assert.equal(matchRoute('/nao-existe'), null);
  });
});

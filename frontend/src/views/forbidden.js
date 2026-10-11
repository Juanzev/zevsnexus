// Tela sem permissão: a guarda só esconde; o backend recusaria a ação de qualquer forma (403).
import { html } from '../lib/html.js';
import { icon } from '../lib/icons.js';

export default {
  title: 'Sem acesso',

  render: () => html`<div class="state">
    ${icon('circle-alert', 'size-8 text-amber-600')}
    <h1 class="text-lg font-semibold text-slate-900">Você não tem acesso a esta área</h1>
    <p>Se precisar, peça a um administrador da empresa para liberar.</p>
    <a href="/app" class="btn btn-primary mt-2">Voltar ao início</a>
  </div>`,
};

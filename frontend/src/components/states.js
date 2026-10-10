// Estados de tela (pág. 10): carregando, vazio e erro em toda tela.
import { html } from '../lib/html.js';
import { icon } from '../lib/icons.js';

export function loadingState(label = 'Carregando…') {
  return html`<div class="state" role="status">
    ${icon('loader-circle', 'size-6 animate-spin text-primary')}
    <p>${label}</p>
  </div>`;
}

export function errorState({ title = 'Não foi possível carregar', message, action }) {
  return html`<div class="state" role="alert">
    ${icon('circle-alert', 'size-8 text-red-600')}
    <p class="font-semibold text-slate-900">${title}</p>
    ${message ? html`<p>${message}</p>` : ''}
    ${action ?? ''}
  </div>`;
}

export function emptyState({ title, message, action }) {
  return html`<div class="state">
    ${icon('info', 'size-8 text-slate-400')}
    <p class="font-semibold text-slate-900">${title}</p>
    ${message ? html`<p>${message}</p>` : ''}
    ${action ?? ''}
  </div>`;
}

import { html } from '../lib/html.js';
import { isAuthenticated } from '../services/session.js';

export default {
  title: 'Página não encontrada',

  render: () => html`<div class="text-center">
    <p class="text-sm font-semibold text-primary">404</p>
    <h1 class="title">Página não encontrada</h1>
    <p class="subtitle">O endereço pode estar errado ou a página mudou de lugar.</p>
    <a href="${isAuthenticated() ? '/app' : '/login'}" class="btn btn-primary mt-6 w-full">Voltar ao início</a>
  </div>`,
};

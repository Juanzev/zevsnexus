// Confirmação de e-mail pelo link. O token sai da barra de endereço antes de ser enviado.
import { loadingState } from '../components/states.js';
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { stripQueryParams } from '../lib/url.js';
import { api } from '../services/api.js';
import { isAuthenticated, updateUser } from '../services/session.js';

const nextAction = () =>
  isAuthenticated()
    ? html`<a href="/app" class="btn btn-primary mt-6 w-full">Ir para o início</a>`
    : html`<a href="/login" class="btn btn-primary mt-6 w-full">Entrar</a>`;

const successPanel = () => html`<div class="text-center">
  <span class="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-green-50 text-green-700">${icon('circle-check', 'size-6')}</span>
  <h1 class="title">E-mail confirmado</h1>
  <p class="subtitle">Tudo certo com o seu e-mail.</p>
  ${nextAction()}
</div>`;

const failurePanel = () => html`<div class="text-center">
  <span class="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-red-50 text-red-600">${icon('circle-alert', 'size-6')}</span>
  <h1 class="title">Não foi possível confirmar</h1>
  <p class="subtitle">O link é inválido, expirou ou já foi usado. Se você já confirmou o e-mail, é só entrar.
    Para receber um link novo, entre e use "Reenviar e-mail" no início.</p>
  ${nextAction()}
</div>`;

export default {
  title: 'Confirmar e-mail',

  render: () => html`<h1 class="sr-only">Confirmando e-mail</h1>${loadingState('Confirmando seu e-mail…')}`,

  mount(root, { query }) {
    const token = query.get('token');
    stripQueryParams('token');
    if (!token) {
      setContent(root, failurePanel());
      return;
    }
    api('/auth/email/verify', { method: 'POST', auth: false, body: { token } })
      .then(() => {
        updateUser({ email_verified: true });
        setContent(root, successPanel());
      })
      .catch(() => setContent(root, failurePanel()))
      .finally(() => root.querySelector('h1')?.focus());
  },
};

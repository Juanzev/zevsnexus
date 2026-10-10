// O token chega pelo link do e-mail e sai da barra de endereço assim que a tela abre (pág. 04).
import {
  bindPasswordToggles,
  bindSubmitShortcut,
  clearErrors,
  formAlert,
  formValues,
  passwordField,
  setBusy,
  showErrors,
} from '../components/form.js';
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { PASSWORD_MIN_LENGTH, passwordProblem } from '../lib/text.js';
import { stripQueryParams } from '../lib/url.js';
import { api } from '../services/api.js';
import { clearLocalSession } from '../services/session.js';

const invalidLinkPanel = () => html`<div class="text-center">
  <span class="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-red-50 text-red-600">${icon('circle-alert', 'size-6')}</span>
  <h1 class="title">Link inválido ou expirado</h1>
  <p class="subtitle">Os links de redefinição valem por 1 hora e só podem ser usados uma vez.</p>
  <a href="/recuperar-senha" class="btn btn-primary mt-6 w-full">Pedir um novo link</a>
</div>`;

const donePanel = () => html`<div class="text-center">
  <span class="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-green-50 text-green-700">${icon('circle-check', 'size-6')}</span>
  <h1 class="title">Senha redefinida</h1>
  <p class="subtitle">Por segurança, todas as sessões abertas foram encerradas. Entre com a nova senha.</p>
  <a href="/login" class="btn btn-primary mt-6 w-full">Entrar</a>
</div>`;

export default {
  title: 'Nova senha',

  render: () => html`
    <h1 class="title">Criar nova senha</h1>
    <p class="subtitle">Escolha uma senha que você não usa em outros sites.</p>
    <form class="mt-6 space-y-4" novalidate>
      ${formAlert()}
      ${passwordField({
        name: 'password',
        label: 'Nova senha',
        autocomplete: 'new-password',
        hint: `Mínimo de ${PASSWORD_MIN_LENGTH} caracteres.`,
      })}
      ${passwordField({ name: 'password_confirmation', label: 'Repita a nova senha', autocomplete: 'new-password' })}
      <button type="submit" class="btn btn-primary w-full">Salvar nova senha</button>
    </form>`,

  mount(root, { query }) {
    const token = query.get('token');
    stripQueryParams('token');
    if (!token) {
      setContent(root, invalidLinkPanel());
      return;
    }

    const form = root.querySelector('form');
    bindPasswordToggles(root);
    bindSubmitShortcut(form);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearErrors(form);
      const { password, password_confirmation: confirmation } = formValues(form);
      const problem = passwordProblem(password);
      if (problem) {
        showErrors(form, { details: [{ field: 'password', message: problem }] });
        return;
      }
      if (password !== confirmation) {
        showErrors(form, { details: [{ field: 'password_confirmation', message: 'As senhas não são iguais.' }] });
        return;
      }

      const done = setBusy(form.querySelector('[type="submit"]'), 'Salvando…');
      try {
        await api('/auth/password/reset', { method: 'POST', auth: false, body: { token, password } });
        // O servidor encerrou todas as sessões, inclusive uma que estivesse aberta nesta aba.
        clearLocalSession();
        setContent(root, donePanel());
        root.querySelector('h1').focus();
      } catch (err) {
        if (err.code === 'RESET_TOKEN_INVALID') {
          setContent(root, invalidLinkPanel());
          return;
        }
        showErrors(form, err);
        done();
      }
    });
  },
};

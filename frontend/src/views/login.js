import {
  bindPasswordToggles,
  bindSubmitShortcut,
  clearErrors,
  field,
  formAlert,
  formValues,
  passwordField,
  setBusy,
  showErrors,
} from '../components/form.js';
import { html } from '../lib/html.js';
import { safeNext } from '../lib/url.js';
import { login } from '../services/session.js';

export default {
  title: 'Entrar',

  render: () => html`
    <h1 class="title">Entrar</h1>
    <p class="subtitle">Acesse a central da sua empresa.</p>
    <form class="mt-6 space-y-4" novalidate>
      ${formAlert()}
      ${field({ name: 'email', label: 'E-mail', type: 'email', autocomplete: 'username', inputmode: 'email' })}
      ${passwordField({ name: 'password', label: 'Senha', autocomplete: 'current-password' })}
      <div class="flex justify-end">
        <a href="/recuperar-senha" class="link text-sm">Esqueci minha senha</a>
      </div>
      <button type="submit" class="btn btn-primary w-full">Entrar</button>
    </form>
    <p class="mt-6 text-center text-sm text-slate-600">
      Ainda não tem conta? <a href="/cadastro" class="link">Criar conta</a>
    </p>`,

  mount(root, { query, navigate }) {
    const form = root.querySelector('form');
    bindPasswordToggles(root);
    bindSubmitShortcut(form);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearErrors(form);
      const { email, password } = formValues(form);
      const missing = [];
      if (!email.trim()) missing.push({ field: 'email', message: 'Informe o e-mail.' });
      if (!password) missing.push({ field: 'password', message: 'Informe a senha.' });
      if (missing.length > 0) {
        showErrors(form, { details: missing });
        return;
      }

      const done = setBusy(form.querySelector('[type="submit"]'), 'Entrando…');
      try {
        await login(email, password);
        await navigate(safeNext(query.get('next')) ?? '/app', { replace: true });
      } catch (err) {
        showErrors(form, err);
        done();
      }
    });
  },
};

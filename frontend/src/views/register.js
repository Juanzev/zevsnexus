import {
  bindPasswordToggles,
  bindSubmitShortcut,
  checkboxField,
  clearErrors,
  field,
  formAlert,
  formValues,
  passwordField,
  setBusy,
  showErrors,
} from '../components/form.js';
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { PASSWORD_MIN_LENGTH, passwordProblem } from '../lib/text.js';
import { api } from '../services/api.js';

function checkEmailPanel(email) {
  return html`<div class="text-center" data-step="check-email">
    <span class="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-primary/10 text-primary">${icon('mail', 'size-6')}</span>
    <h1 class="title">Confira seu e-mail</h1>
    <p class="subtitle">Enviamos uma mensagem para <strong class="break-all text-slate-900">${email}</strong>.
      Abra o link para confirmar sua conta e depois é só entrar.</p>
    <p class="mt-4 text-sm text-slate-500">Não chegou em alguns minutos? Confira a caixa de spam.</p>
    <a href="/login" class="btn btn-primary mt-6 w-full">Ir para o login</a>
  </div>`;
}

export default {
  title: 'Criar conta',

  render: () => html`
    <h1 class="title">Criar conta</h1>
    <p class="subtitle">Comece a organizar a sua empresa em um só lugar.</p>
    <form class="mt-6 space-y-4" novalidate>
      ${formAlert()}
      ${field({ name: 'name', label: 'Seu nome', autocomplete: 'name' })}
      ${field({ name: 'email', label: 'E-mail', type: 'email', autocomplete: 'email', inputmode: 'email' })}
      ${passwordField({
        name: 'password',
        label: 'Senha',
        autocomplete: 'new-password',
        hint: `Mínimo de ${PASSWORD_MIN_LENGTH} caracteres.`,
      })}
      ${checkboxField({ name: 'accept_terms', label: 'Li e aceito os termos de uso e a política de privacidade.' })}
      <button type="submit" class="btn btn-primary w-full">Criar conta</button>
    </form>
    <p class="mt-6 text-center text-sm text-slate-600">Já tem conta? <a href="/login" class="link">Entrar</a></p>`,

  mount(root) {
    const form = root.querySelector('form');
    bindPasswordToggles(root);
    bindSubmitShortcut(form);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearErrors(form);
      const values = formValues(form);
      const problems = [];
      if (!values.name.trim()) problems.push({ field: 'name', message: 'Informe seu nome.' });
      if (!values.email.trim()) problems.push({ field: 'email', message: 'Informe o e-mail.' });
      const passwordError = passwordProblem(values.password);
      if (passwordError) problems.push({ field: 'password', message: passwordError });
      if (!values.accept_terms) {
        problems.push({ field: 'accept_terms', message: 'É preciso aceitar os termos para criar a conta.' });
      }
      if (problems.length > 0) {
        showErrors(form, { details: problems });
        return;
      }

      const done = setBusy(form.querySelector('[type="submit"]'), 'Criando conta…');
      try {
        await api('/auth/register', {
          method: 'POST',
          auth: false,
          body: { name: values.name, email: values.email, password: values.password, accept_terms: true },
        });
        setContent(root, checkEmailPanel(values.email.trim()));
        root.querySelector('h1').focus();
      } catch (err) {
        showErrors(form, err);
        done();
      }
    });
  },
};

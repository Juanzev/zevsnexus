import { bindSubmitShortcut, clearErrors, field, formAlert, formValues, setBusy, showErrors } from '../components/form.js';
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { api } from '../services/api.js';

const sentPanel = () => html`<div class="text-center">
  <span class="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-primary/10 text-primary">${icon('mail', 'size-6')}</span>
  <h1 class="title">Confira seu e-mail</h1>
  <p class="subtitle">Se houver uma conta com esse e-mail, enviamos um link para criar uma nova senha.
    O link vale por 1 hora.</p>
  <a href="/login" class="btn btn-primary mt-6 w-full">Voltar para o login</a>
</div>`;

export default {
  title: 'Recuperar senha',

  render: () => html`
    <a href="/login" class="link mb-4 inline-flex items-center gap-1 text-sm">${icon('arrow-left', 'size-4')} Voltar</a>
    <h1 class="title">Recuperar senha</h1>
    <p class="subtitle">Informe o e-mail da sua conta. Vamos enviar um link para você criar uma nova senha.</p>
    <form class="mt-6 space-y-4" novalidate>
      ${formAlert()}
      ${field({ name: 'email', label: 'E-mail', type: 'email', autocomplete: 'email', inputmode: 'email' })}
      <button type="submit" class="btn btn-primary w-full">Enviar link</button>
    </form>`,

  mount(root) {
    const form = root.querySelector('form');
    bindSubmitShortcut(form);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearErrors(form);
      const { email } = formValues(form);
      if (!email.trim()) {
        showErrors(form, { details: [{ field: 'email', message: 'Informe o e-mail.' }] });
        return;
      }
      const done = setBusy(form.querySelector('[type="submit"]'), 'Enviando…');
      try {
        await api('/auth/password/forgot', { method: 'POST', auth: false, body: { email } });
        setContent(root, sentPanel());
        root.querySelector('h1').focus();
      } catch (err) {
        showErrors(form, err);
        done();
      }
    });
  },
};

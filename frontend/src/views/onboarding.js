// Cadastro da empresa (onboarding). Exige e-mail confirmado; a empresa nasce "em análise" e a
// equipe ZEVS aprova (D3). A Idempotency-Key evita empresa duplicada em duplo clique ou queda de rede.
import { toast } from '../components/toast.js';
import {
  bindSubmitShortcut,
  clearErrors,
  field,
  formAlert,
  formValues,
  selectField,
  setBusy,
  showErrors,
} from '../components/form.js';
import { formatCnpj, formatOnBlur } from '../lib/format.js';
import { html } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { firstName } from '../lib/text.js';
import { BRAZIL_TIMEZONES, guessTimezone } from '../lib/timezones.js';
import { api, newIdempotencyKey } from '../services/api.js';
import { getUser, logout } from '../services/session.js';
import { loadMe } from '../services/tenant.js';

function verifyEmailFirst() {
  return html`<div class="text-center">
    <span class="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-primary/10 text-primary">${icon('mail', 'size-6')}</span>
    <h1 class="title">Confirme seu e-mail</h1>
    <p class="subtitle">Para cadastrar a empresa, abra o link de confirmação que enviamos para:</p>
    <p class="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold break-all text-slate-900" data-email>${getUser().email}</p>
    <div class="mt-6 grid gap-2">
      <button type="button" class="btn btn-primary" data-action="checked">Já confirmei</button>
      <button type="button" class="btn btn-secondary" data-action="resend">Reenviar e-mail</button>
      <button type="button" class="btn btn-ghost" data-action="logout">Sair</button>
    </div>
  </div>`;
}

function companyForm() {
  return html`
    <h1 class="title">Cadastre sua empresa</h1>
    <p class="subtitle">Olá, ${firstName(getUser().name)}! Estes dados podem ser completados depois.</p>
    <form class="mt-6 space-y-4" novalidate>
      ${formAlert()}
      ${field({ name: 'legal_name', label: 'Razão social', autocomplete: 'organization' })}
      ${field({ name: 'trade_name', label: 'Nome fantasia', required: false, hint: 'É o nome que aparece no sistema. Opcional.' })}
      ${field({ name: 'cnpj', label: 'CNPJ', required: false, inputmode: 'text', hint: 'Opcional. Aceita o CNPJ com letras (novo formato).' })}
      ${selectField({
        name: 'timezone',
        label: 'Fuso horário',
        options: BRAZIL_TIMEZONES,
        value: guessTimezone(),
        hint: 'Vencimentos e datas seguem este fuso.',
      })}
      <button type="submit" class="btn btn-primary w-full">Cadastrar empresa</button>
    </form>
    <button type="button" class="btn btn-ghost mt-3 w-full" data-action="logout">Sair</button>`;
}

export default {
  title: 'Cadastrar empresa',

  render: () => (getUser().email_verified ? companyForm() : verifyEmailFirst()),

  mount(root, { navigate }) {
    root.querySelector('[data-action="logout"]')?.addEventListener('click', async () => {
      await logout();
      navigate('/login', { replace: true });
    });

    if (!getUser().email_verified) {
      root.querySelector('[data-action="checked"]').addEventListener('click', async () => {
        await loadMe();
        if (getUser().email_verified) navigate('/app/onboarding', { replace: true });
        else toast('Ainda não recebemos a confirmação. Abra o link do e-mail e tente de novo.', { type: 'info' });
      });
      root.querySelector('[data-action="resend"]').addEventListener('click', async (event) => {
        event.currentTarget.disabled = true;
        try {
          await api('/auth/email/resend', { method: 'POST', body: {} });
          toast('Enviamos um novo link para o seu e-mail.', { type: 'success' });
        } catch (err) {
          toast(err.message, { type: 'error' });
        }
      });
      return;
    }

    const form = root.querySelector('form');
    bindSubmitShortcut(form);
    formatOnBlur(form.elements.namedItem('cnpj'), formatCnpj);
    // Uma chave por tela: um retry da mesma tentativa não cria outra empresa.
    const idempotencyKey = newIdempotencyKey();

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearErrors(form);
      const values = formValues(form);
      if (values.legal_name.trim().length < 2) {
        showErrors(form, { details: [{ field: 'legal_name', message: 'Informe a razão social.' }] });
        return;
      }
      const done = setBusy(form.querySelector('[type="submit"]'), 'Cadastrando…');
      try {
        await api('/companies', { method: 'POST', body: values, idempotencyKey });
        await loadMe();
        navigate('/app/aguardando-aprovacao', { replace: true });
      } catch (err) {
        showErrors(form, err);
        done();
      }
    });
  },
};

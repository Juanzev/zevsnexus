// Configurações: da empresa (fuso e cor da marca — settings.manage) e da própria conta
// (troca de senha, sair de todos os dispositivos).
import { ConfirmDialog } from '../components/confirm-dialog.js';
import {
  bindPasswordToggles,
  bindSubmitShortcut,
  clearErrors,
  formAlert,
  formValues,
  passwordField,
  selectField,
  setBusy,
  showErrors,
} from '../components/form.js';
import { errorState, loadingState } from '../components/states.js';
import { toast } from '../components/toast.js';
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { PASSWORD_MIN_LENGTH, passwordProblem } from '../lib/text.js';
import { BRAZIL_TIMEZONES } from '../lib/timezones.js';
import { api } from '../services/api.js';
import { changePassword, getUser, logoutEverywhere } from '../services/session.js';
import { can, patchContext } from '../services/tenant.js';

/** Contraste de texto branco sobre a cor (WCAG). Abaixo de 4,5:1 o texto dos botões fica difícil de ler. */
function contrastWithWhite(hex) {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (luminance + 0.05);
}

function timezoneOptions(current) {
  const known = BRAZIL_TIMEZONES.some((zone) => zone.value === current);
  return known ? BRAZIL_TIMEZONES : [{ value: current, label: current }, ...BRAZIL_TIMEZONES];
}

function companySettingsForm(settings) {
  return html`<form class="space-y-4" novalidate data-form="company">
    ${formAlert()}
    ${selectField({
      name: 'timezone',
      label: 'Fuso horário',
      options: timezoneOptions(settings.timezone),
      value: settings.timezone,
      hint: 'Vencimentos, períodos e alertas seguem este fuso.',
    })}
    <div class="field">
      <label for="f-primary_color" class="label">Cor da marca</label>
      <div class="flex items-center gap-3">
        <input id="f-primary_color" name="primary_color" type="color" value="${settings.primary_color}"
          class="h-12 w-16 cursor-pointer rounded-xl border border-slate-300 bg-white p-1" aria-describedby="f-primary_color-hint f-primary_color-error">
        <span class="font-mono text-sm text-slate-600" data-color-value>${settings.primary_color}</span>
        <span class="btn btn-primary btn-sm pointer-events-none" aria-hidden="true">Exemplo</span>
      </div>
      <p id="f-primary_color-hint" class="hint" data-contrast>Usada nos botões e destaques do sistema.</p>
      <p id="f-primary_color-error" class="field-error" hidden></p>
    </div>
    <button type="submit" class="btn btn-primary">Salvar configurações</button>
  </form>`;
}

function accountSection(user) {
  return html`<section class="card">
    <h2 class="text-base font-semibold text-slate-900">Minha conta</h2>
    <dl class="mt-3 grid gap-3 text-sm sm:grid-cols-2">
      <div class="min-w-0"><dt class="text-slate-500">Nome</dt><dd class="truncate font-medium">${user.name}</dd></div>
      <div class="min-w-0"><dt class="text-slate-500">E-mail</dt><dd class="truncate font-medium">${user.email}</dd></div>
    </dl>
    <h3 class="mt-6 text-sm font-semibold text-slate-900">Trocar senha</h3>
    <form class="mt-3 max-w-md space-y-4" novalidate data-form="password">
      ${formAlert()}
      ${passwordField({ name: 'current_password', label: 'Senha atual', autocomplete: 'current-password' })}
      ${passwordField({ name: 'new_password', label: 'Nova senha', autocomplete: 'new-password', hint: `Mínimo de ${PASSWORD_MIN_LENGTH} caracteres.` })}
      ${passwordField({ name: 'new_password_confirmation', label: 'Repita a nova senha', autocomplete: 'new-password' })}
      <button type="submit" class="btn btn-primary">Trocar senha</button>
    </form>
    <h3 class="mt-8 text-sm font-semibold text-slate-900">Sessões</h3>
    <p class="mt-1 text-sm text-slate-600">Perdeu um aparelho ou entrou num computador que não é seu? Encerre todas as sessões abertas.</p>
    <button type="button" class="btn btn-secondary btn-sm mt-3 w-full sm:w-auto" data-action="logout-all">${icon('monitor-smartphone', 'size-4')} Sair de todos os dispositivos</button>
  </section>`;
}

function bindCompanyForm(root) {
  const form = root.querySelector('[data-form="company"]');
  const colorInput = form.elements.namedItem('primary_color');
  const colorValue = form.querySelector('[data-color-value]');
  const contrastHint = form.querySelector('[data-contrast]');
  bindSubmitShortcut(form);

  function updateColor() {
    const color = colorInput.value.toLowerCase();
    colorValue.textContent = color;
    form.style.setProperty('--color-primary', color);
    const lowContrast = contrastWithWhite(color) < 4.5;
    contrastHint.textContent = lowContrast
      ? 'Atenção: cor clara demais. O texto branco dos botões fica difícil de ler.'
      : 'Usada nos botões e destaques do sistema.';
    contrastHint.classList.toggle('text-amber-700', lowContrast);
  }
  colorInput.addEventListener('input', updateColor);
  updateColor();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);
    const done = setBusy(form.querySelector('[type="submit"]'), 'Salvando…');
    try {
      const { data } = await api('/company/settings', { method: 'PATCH', body: formValues(form) });
      patchContext({ branding: { primary_color: data.settings.primary_color }, company: { timezone: data.settings.timezone } });
      toast('Configurações salvas.', { type: 'success' });
    } catch (err) {
      showErrors(form, err);
    } finally {
      done();
    }
  });
}

function bindAccount(root, navigate) {
  const form = root.querySelector('[data-form="password"]');
  bindPasswordToggles(form);
  bindSubmitShortcut(form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);
    const values = formValues(form);
    const problem = passwordProblem(values.new_password);
    if (!values.current_password) {
      showErrors(form, { details: [{ field: 'current_password', message: 'Informe a senha atual.' }] });
      return;
    }
    if (problem) {
      showErrors(form, { details: [{ field: 'new_password', message: problem }] });
      return;
    }
    if (values.new_password !== values.new_password_confirmation) {
      showErrors(form, { details: [{ field: 'new_password_confirmation', message: 'As senhas não são iguais.' }] });
      return;
    }
    const done = setBusy(form.querySelector('[type="submit"]'), 'Trocando…');
    try {
      await changePassword(values.current_password, values.new_password);
      form.reset();
      toast('Senha trocada. As outras sessões foram encerradas.', { type: 'success' });
    } catch (err) {
      showErrors(form, err);
    } finally {
      done();
    }
  });

  root.querySelector('[data-action="logout-all"]').addEventListener('click', async () => {
    const confirmed = await ConfirmDialog.ask({
      title: 'Sair de todos os dispositivos?',
      message: 'Todas as sessões abertas, inclusive esta, serão encerradas. Você vai precisar entrar de novo.',
      confirmLabel: 'Sair de todos',
    });
    if (!confirmed) return;
    try {
      await logoutEverywhere();
      toast('Todas as sessões foram encerradas.', { type: 'success' });
      navigate('/login', { replace: true });
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  });
}

export default {
  title: 'Configurações',

  render: () => html`
    <h1 class="text-2xl font-bold tracking-tight text-slate-900">Configurações</h1>
    <div class="mt-6 space-y-4">
      ${
        can('settings.manage')
          ? html`<section class="card"><h2 class="text-base font-semibold text-slate-900">Empresa</h2>
              <div class="mt-4" data-company-settings>${loadingState()}</div></section>`
          : ''
      }
      ${accountSection(getUser())}
    </div>`,

  mount(root, { navigate }) {
    bindAccount(root, navigate);
    const slot = root.querySelector('[data-company-settings]');
    if (!slot) return;
    api('/company/settings')
      .then(({ data }) => {
        if (!slot.isConnected) return;
        setContent(slot, companySettingsForm(data.settings));
        bindCompanyForm(slot);
      })
      .catch((err) => {
        if (slot.isConnected) setContent(slot, errorState({ message: err.message }));
      });
  },
};

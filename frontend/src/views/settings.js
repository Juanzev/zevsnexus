// Configurações: da empresa (fuso e cor da marca — settings.manage), tipos de documento
// (documents.manage) e da própria conta (troca de senha, sair de todos os dispositivos).
import { ConfirmDialog } from '../components/confirm-dialog.js';
import {
  bindPasswordToggles,
  bindSubmitShortcut,
  clearErrors,
  field,
  formAlert,
  formValues,
  passwordField,
  selectField,
  setBusy,
  showErrors,
} from '../components/form.js';
import { openFormModal } from '../components/modal.js';
import { emptyState, errorState, loadingState } from '../components/states.js';
import { toast } from '../components/toast.js';
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { PASSWORD_MIN_LENGTH, passwordProblem } from '../lib/text.js';
import { BRAZIL_TIMEZONES } from '../lib/timezones.js';
import { api } from '../services/api.js';
import { installPlatform, isInstalled } from '../services/pwa.js';
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
    ${field({
      name: 'upcoming_window_days',
      label: 'Financeiro: a aba "Próximas" mostra quantos dias à frente?',
      type: 'number',
      inputmode: 'numeric',
      value: String(settings.upcoming_window_days ?? 7),
      hint: 'De 1 a 60 dias a partir de hoje.',
    })}
    <button type="submit" class="btn btn-primary">Salvar configurações</button>
  </form>`;
}

// ---------- instalar no celular (D9: só ajuda, sem banner de instalação) ----------

const INSTALL_STEPS = {
  android: {
    title: 'Android (Chrome)',
    steps: ['Abra o ZEVS Nexus no Chrome.', 'Toque no menu ⋮ (canto superior direito).', 'Toque em “Instalar app” ou “Adicionar à tela inicial” e confirme.'],
  },
  ios: {
    title: 'iPhone e iPad (Safari)',
    steps: [
      'Abra o ZEVS Nexus no Safari (no iPhone, só o Safari instala).',
      'Toque em Compartilhar (o quadrado com a seta para cima).',
      'Toque em “Adicionar à Tela de Início” e depois em “Adicionar”.',
    ],
  },
  desktop: {
    title: 'Computador (Chrome ou Edge)',
    steps: ['Clique no ícone de instalar na barra de endereço (ou no menu ⋮ → “Instalar ZEVS Nexus”).', 'Confirme em “Instalar”.'],
  },
};

function installSteps({ title, steps }) {
  return html`<div>
    <h3 class="text-sm font-semibold text-slate-900">${title}</h3>
    <ol class="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-600">${steps.map((step) => html`<li>${step}</li>`)}</ol>
  </div>`;
}

function installSection() {
  if (isInstalled()) {
    return html`<section class="card flex items-center gap-3">
      ${icon('circle-check', 'size-6 shrink-0 text-green-600')}
      <p class="text-sm text-slate-700"><strong>App instalado.</strong> O ZEVS Nexus abre direto no Início e se atualiza sozinho.</p>
    </section>`;
  }
  const current = installPlatform();
  const others = Object.keys(INSTALL_STEPS).filter((platform) => platform !== current);
  return html`<section class="card" data-install>
    <h2 class="flex items-center gap-2 text-base font-semibold text-slate-900">${icon('smartphone', 'size-5 text-primary')} Instalar no celular</h2>
    <p class="mt-1 text-sm text-slate-600">Com o app instalado, o Nexus abre em tela cheia, direto no Início — sem procurar no navegador.</p>
    <div class="mt-4">${installSteps(INSTALL_STEPS[current])}</div>
    <details class="mt-4">
      <summary class="cursor-pointer text-sm font-medium text-primary">Outros aparelhos</summary>
      <div class="mt-3 space-y-4">${others.map((platform) => installSteps(INSTALL_STEPS[platform]))}</div>
    </details>
  </section>`;
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
      const values = formValues(form);
      const body = { ...values, upcoming_window_days: Number.parseInt(values.upcoming_window_days, 10) };
      const { data } = await api('/company/settings', { method: 'PATCH', body });
      patchContext({ branding: { primary_color: data.settings.primary_color }, company: { timezone: data.settings.timezone } });
      toast('Configurações salvas.', { type: 'success' });
    } catch (err) {
      showErrors(form, err);
    } finally {
      done();
    }
  });
}

// ---------- tipos de documento ----------

function typesList(types) {
  if (types.length === 0) return emptyState({ title: 'Nenhum tipo cadastrado', message: 'Crie tipos para classificar os documentos.' });
  return html`<ul class="divide-y divide-slate-100">
    ${types.map(
      (type) => html`<li class="flex items-center justify-between gap-3 py-2">
        <span class="min-w-0"><span class="block truncate text-sm font-medium text-slate-900">${type.name}</span>
          <span class="block text-xs text-slate-500">${type.document_count === 1 ? '1 documento' : `${type.document_count} documentos`}</span></span>
        <span class="flex shrink-0 gap-1">
          <button type="button" class="btn btn-ghost btn-sm" data-action="rename-type" data-id="${type.id}" aria-label="Renomear ${type.name}">${icon('pencil', 'size-4')}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="archive-type" data-id="${type.id}" aria-label="Arquivar ${type.name}">${icon('archive', 'size-4')}</button>
        </span>
      </li>`,
    )}
  </ul>`;
}

function mountDocumentTypes(slot) {
  async function load() {
    try {
      const { data } = await api('/document-types');
      if (!slot.isConnected) return;
      setContent(slot, typesList(data.document_types));
      bind(data.document_types);
    } catch (err) {
      if (slot.isConnected) setContent(slot, errorState({ message: err.message }));
    }
  }

  function bind(types) {
    for (const button of slot.querySelectorAll('[data-action="rename-type"]')) {
      button.addEventListener('click', async () => {
        const type = types.find((item) => item.id === button.dataset.id);
        const saved = await openFormModal({
          title: 'Renomear tipo',
          body: field({ name: 'name', label: 'Nome', value: type.name }),
          onSubmit: (form) => api(`/document-types/${type.id}`, { method: 'PATCH', body: { name: form.elements.name.value } }),
        });
        if (saved) {
          toast('Tipo renomeado.', { type: 'success' });
          load();
        }
      });
    }
    for (const button of slot.querySelectorAll('[data-action="archive-type"]')) {
      button.addEventListener('click', async () => {
        const type = types.find((item) => item.id === button.dataset.id);
        const confirmed = await ConfirmDialog.ask({
          title: `Arquivar o tipo “${type.name}”?`,
          message: 'Ele deixa de aparecer para novos documentos. Os documentos que já usam o tipo continuam com ele.',
          confirmLabel: 'Arquivar',
          danger: false,
        });
        if (!confirmed) return;
        try {
          await api(`/document-types/${type.id}/archive`, { method: 'POST', body: {} });
          toast('Tipo arquivado.', { type: 'success' });
          load();
        } catch (err) {
          toast(err.message, { type: 'error' });
        }
      });
    }
  }

  slot.closest('section').querySelector('[data-action="add-type"]').addEventListener('click', async () => {
    const saved = await openFormModal({
      title: 'Novo tipo de documento',
      body: field({ name: 'name', label: 'Nome', hint: 'Ex.: Alvará, Certidão negativa, Contrato de obra.' }),
      submitLabel: 'Criar',
      onSubmit: (form) => api('/document-types', { method: 'POST', body: { name: form.elements.name.value } }),
    });
    if (saved) {
      toast('Tipo criado.', { type: 'success' });
      load();
    }
  });

  load();
}

// ---------- categorias financeiras ----------

function categoriesList(categories) {
  if (categories.length === 0) return emptyState({ title: 'Nenhuma categoria', message: 'Crie categorias para organizar as despesas.' });
  return html`<ul class="divide-y divide-slate-100">
    ${categories.map(
      (category) => html`<li class="flex items-center justify-between gap-3 py-2">
        <span class="min-w-0"><span class="block truncate text-sm font-medium text-slate-900">${category.name}</span>
          <span class="block text-xs text-slate-500">${category.expense_count === 1 ? '1 despesa' : `${category.expense_count} despesas`}</span></span>
        <span class="flex shrink-0 gap-1">
          <button type="button" class="btn btn-ghost btn-sm" data-action="rename-category" data-id="${category.id}" aria-label="Renomear ${category.name}">${icon('pencil', 'size-4')}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="archive-category" data-id="${category.id}" aria-label="Arquivar ${category.name}">${icon('archive', 'size-4')}</button>
        </span>
      </li>`,
    )}
  </ul>`;
}

function mountCategories(slot) {
  async function load() {
    try {
      const { data } = await api('/finance-categories?kind=expense');
      if (!slot.isConnected) return;
      setContent(slot, categoriesList(data.categories));
      bind(data.categories);
    } catch (err) {
      if (slot.isConnected) setContent(slot, errorState({ message: err.message }));
    }
  }

  function bind(categories) {
    for (const button of slot.querySelectorAll('[data-action="rename-category"]')) {
      button.addEventListener('click', async () => {
        const category = categories.find((item) => item.id === button.dataset.id);
        const saved = await openFormModal({
          title: 'Renomear categoria',
          body: field({ name: 'name', label: 'Nome', value: category.name }),
          onSubmit: (form) => api(`/finance-categories/${category.id}`, { method: 'PATCH', body: { name: form.elements.name.value } }),
        });
        if (saved) {
          toast('Categoria renomeada.', { type: 'success' });
          load();
        }
      });
    }
    for (const button of slot.querySelectorAll('[data-action="archive-category"]')) {
      button.addEventListener('click', async () => {
        const category = categories.find((item) => item.id === button.dataset.id);
        const confirmed = await ConfirmDialog.ask({
          title: `Arquivar a categoria “${category.name}”?`,
          message: 'Ela deixa de aparecer para despesas novas. As despesas que já usam a categoria continuam com ela.',
          confirmLabel: 'Arquivar',
          danger: false,
        });
        if (!confirmed) return;
        try {
          await api(`/finance-categories/${category.id}/archive`, { method: 'POST', body: {} });
          toast('Categoria arquivada.', { type: 'success' });
          load();
        } catch (err) {
          toast(err.message, { type: 'error' });
        }
      });
    }
  }

  slot.closest('section').querySelector('[data-action="add-category"]').addEventListener('click', async () => {
    const saved = await openFormModal({
      title: 'Nova categoria de despesa',
      body: field({ name: 'name', label: 'Nome', hint: 'Ex.: Mão de obra, Materiais, Combustível.' }),
      submitLabel: 'Criar',
      onSubmit: (form) => api('/finance-categories', { method: 'POST', body: { kind: 'expense', name: form.elements.name.value } }),
    });
    if (saved) {
      toast('Categoria criada.', { type: 'success' });
      load();
    }
  });

  load();
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
      ${
        can('finance.manage')
          ? html`<section class="card">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <h2 class="text-base font-semibold text-slate-900">Categorias de despesa</h2>
                <button type="button" class="btn btn-secondary btn-sm" data-action="add-category">${icon('plus', 'size-4')} Nova categoria</button>
              </div>
              <p class="mt-1 text-sm text-slate-600">Usadas para organizar e somar as despesas no Financeiro.</p>
              <div class="mt-3" data-categories>${loadingState()}</div>
            </section>`
          : ''
      }
      ${
        can('documents.manage')
          ? html`<section class="card">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <h2 class="text-base font-semibold text-slate-900">Tipos de documento</h2>
                <button type="button" class="btn btn-secondary btn-sm" data-action="add-type">${icon('plus', 'size-4')} Novo tipo</button>
              </div>
              <p class="mt-1 text-sm text-slate-600">A classificação usada na Central de Documentos.</p>
              <div class="mt-3" data-document-types>${loadingState()}</div>
            </section>`
          : ''
      }
      ${installSection()}
      ${accountSection(getUser())}
    </div>`,

  mount(root, { navigate }) {
    bindAccount(root, navigate);
    const categoriesSlot = root.querySelector('[data-categories]');
    if (categoriesSlot) mountCategories(categoriesSlot);
    const typesSlot = root.querySelector('[data-document-types]');
    if (typesSlot) mountDocumentTypes(typesSlot);
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

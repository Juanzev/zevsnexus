// Painel ZEVS › Empresas: aprovar cadastros novos, suspender e reativar (pág. 13).
// Filtros, busca e paginação no servidor; o estado fica na URL (?status=&q=&page=).
import { badge, companyStatusBadge } from '../components/badge.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { textareaField } from '../components/form.js';
import { openFormModal } from '../components/modal.js';
import { emptyState, errorState, loadingState } from '../components/states.js';
import { toast } from '../components/toast.js';
import { formatCnpj, formatDate } from '../lib/format.js';
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { api } from '../services/api.js';

const TABS = [
  { value: 'pending', label: 'Em análise' },
  { value: 'active', label: 'Ativas' },
  { value: 'suspended', label: 'Suspensas' },
  { value: 'all', label: 'Todas' },
];
const EMPTY = {
  pending: 'Nenhuma empresa aguardando aprovação.',
  active: 'Nenhuma empresa ativa encontrada.',
  suspended: 'Nenhuma empresa suspensa.',
  all: 'Nenhuma empresa encontrada.',
};
const LIMIT = 20;

function readFilters(query) {
  const status = TABS.some((tab) => tab.value === query.get('status')) ? query.get('status') : 'pending';
  const page = Math.max(1, Number.parseInt(query.get('page') ?? '1', 10) || 1);
  return { status, q: query.get('q') ?? '', page };
}

function filtersUrl({ status, q, page }) {
  const params = new URLSearchParams({ status });
  if (q) params.set('q', q);
  if (page > 1) params.set('page', String(page));
  return `/admin/empresas?${params}`;
}

function companyCard(company) {
  const actions = {
    pending: html`<button type="button" class="btn btn-primary btn-sm" data-action="approve" data-id="${company.id}">${icon('check', 'size-4')} Aprovar</button>
      <button type="button" class="btn btn-secondary btn-sm" data-action="suspend" data-id="${company.id}">Suspender</button>`,
    active: html`<button type="button" class="btn btn-secondary btn-sm" data-action="suspend" data-id="${company.id}">Suspender</button>`,
    suspended: html`<button type="button" class="btn btn-primary btn-sm" data-action="reactivate" data-id="${company.id}">Reativar</button>`,
  };
  return html`<li class="card">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div class="min-w-0 space-y-1">
        <p class="flex flex-wrap items-center gap-2 font-semibold text-slate-900">${company.name} ${companyStatusBadge(company.status)}</p>
        ${company.name !== company.legal_name ? html`<p class="text-sm text-slate-600">${company.legal_name}</p>` : ''}
        <p class="text-sm text-slate-600">${company.cnpj ? `CNPJ ${formatCnpj(company.cnpj)}` : 'Sem CNPJ informado'}</p>
        ${
          company.owner
            ? html`<p class="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <span class="break-all">${company.owner.name} · ${company.owner.email}</span>
                ${company.owner.email_verified ? badge('e-mail confirmado', 'green') : badge('e-mail não confirmado', 'amber')}
              </p>`
            : ''
        }
        <p class="text-xs text-slate-500">Cadastro em ${formatDate(company.created_at)} · ${company.members} ${company.members === 1 ? 'pessoa' : 'pessoas'}</p>
        ${company.suspended_reason ? html`<p class="text-sm text-red-700">Motivo da suspensão: ${company.suspended_reason}</p>` : ''}
      </div>
      <div class="flex shrink-0 flex-wrap gap-2">${actions[company.status] ?? ''}</div>
    </div>
  </li>`;
}

function pager({ page }, total) {
  const pages = Math.max(1, Math.ceil(total / LIMIT));
  if (pages === 1) return '';
  return html`<nav class="flex items-center justify-between gap-3" aria-label="Paginação">
    <button type="button" class="btn btn-secondary btn-sm" data-page="${page - 1}" ${page <= 1 ? html`disabled` : ''}>${icon('chevron-left', 'size-4')} Anterior</button>
    <span class="text-sm text-slate-600">Página ${page} de ${pages}</span>
    <button type="button" class="btn btn-secondary btn-sm" data-page="${page + 1}" ${page >= pages ? html`disabled` : ''}>Próxima ${icon('chevron-right', 'size-4')}</button>
  </nav>`;
}

export default {
  title: 'Empresas · Painel ZEVS',

  render({ query }) {
    const filters = readFilters(query);
    return html`
      <h1 class="text-2xl font-bold tracking-tight text-slate-900">Empresas</h1>
      <p class="mt-1 text-slate-600">Aprove cadastros novos e gerencie o acesso das empresas.</p>
      <div class="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div class="tabs" role="tablist" aria-label="Status">
          ${TABS.map(
            (tab) => html`<a role="tab" class="tab" href="${filtersUrl({ status: tab.value, q: filters.q, page: 1 })}" ${tab.value === filters.status ? html`aria-selected="true"` : html`aria-selected="false"`}>${tab.label}</a>`,
          )}
        </div>
        <form class="flex gap-2" role="search" data-form="search">
          <label for="busca" class="sr-only">Buscar por nome ou CNPJ</label>
          <input id="busca" name="q" type="search" class="input h-11 md:w-64" placeholder="Nome ou CNPJ" value="${filters.q}" maxlength="100">
          <button type="submit" class="btn btn-secondary btn-sm" aria-label="Buscar">${icon('search', 'size-4')}</button>
        </form>
      </div>
      <div class="mt-4 space-y-4" data-list>${loadingState()}</div>`;
  },

  mount(root, { query, navigate }) {
    const filters = readFilters(query);
    const list = root.querySelector('[data-list]');

    root.querySelector('[data-form="search"]').addEventListener('submit', (event) => {
      event.preventDefault();
      navigate(filtersUrl({ ...filters, q: event.target.elements.q.value.trim(), page: 1 }));
    });

    async function load() {
      const params = new URLSearchParams({ page: String(filters.page), limit: String(LIMIT) });
      if (filters.status !== 'all') params.set('status', filters.status);
      if (filters.q) params.set('q', filters.q);
      try {
        const { data, meta } = await api(`/admin/companies?${params}`);
        if (!list.isConnected) return;
        if (data.companies.length === 0) {
          setContent(list, emptyState({ title: EMPTY[filters.status], message: filters.q ? 'Tente outra busca.' : undefined }));
          return;
        }
        setContent(list, html`<ul class="space-y-3">${data.companies.map(companyCard)}</ul>${pager(filters, meta.total)}`);
        bind(data.companies);
      } catch (err) {
        if (list.isConnected) setContent(list, errorState({ message: err.message }));
      }
    }

    async function act(company, path, body, message) {
      try {
        await api(`/admin/companies/${company.id}/${path}`, { method: 'POST', body: body ?? {} });
        toast(message, { type: 'success' });
        await load();
      } catch (err) {
        toast(err.message, { type: 'error' });
      }
    }

    function bind(companies) {
      const byId = (id) => companies.find((company) => company.id === id);
      for (const button of list.querySelectorAll('[data-page]')) {
        button.addEventListener('click', () => navigate(filtersUrl({ ...filters, page: Number(button.dataset.page) })));
      }
      for (const button of list.querySelectorAll('[data-action="approve"]')) {
        button.addEventListener('click', async () => {
          const company = byId(button.dataset.id);
          const ok = await ConfirmDialog.ask({
            title: `Aprovar ${company.name}?`,
            message: 'A empresa passa a usar o ZEVS Nexus e o responsável recebe um e-mail.',
            confirmLabel: 'Aprovar',
            danger: false,
          });
          if (ok) await act(company, 'approve', null, `${company.name} aprovada.`);
        });
      }
      for (const button of list.querySelectorAll('[data-action="reactivate"]')) {
        button.addEventListener('click', async () => {
          const company = byId(button.dataset.id);
          const ok = await ConfirmDialog.ask({
            title: `Reativar ${company.name}?`,
            message: 'O acesso da empresa volta a funcionar.',
            confirmLabel: 'Reativar',
            danger: false,
          });
          if (ok) await act(company, 'reactivate', null, `${company.name} reativada.`);
        });
      }
      for (const button of list.querySelectorAll('[data-action="suspend"]')) {
        button.addEventListener('click', async () => {
          const company = byId(button.dataset.id);
          const done = await openFormModal({
            title: `Suspender ${company.name}`,
            body: html`<p class="text-sm text-slate-600">Ninguém da empresa consegue entrar enquanto ela estiver suspensa.</p>
              ${textareaField({ name: 'reason', label: 'Motivo', maxlength: 500, hint: 'Fica registrado e aparece aqui no painel.' })}`,
            submitLabel: 'Suspender',
            busyLabel: 'Suspendendo…',
            onSubmit: async (form) => {
              await api(`/admin/companies/${company.id}/suspend`, { method: 'POST', body: { reason: form.elements.reason.value } });
              return true;
            },
          });
          if (done) {
            toast(`${company.name} suspensa.`, { type: 'success' });
            await load();
          }
        });
      }
    }

    load();
  },
};

// Financeiro (ARCHITECTURE §12): abas Pendentes · Vencidas · Próximas · Pagas · Canceladas, totais do
// filtro, busca, categoria, tag e período — tudo no servidor e na URL. "Vencida" vem calculada da API.
// "Nova despesa" (finance.manage) e "Já paguei" (finance.pay); o backend confere de novo.
import { expenseList, openExpenseForm } from '../components/finance.js';
import { emptyState, errorState, loadingState } from '../components/states.js';
import { toast } from '../components/toast.js';
import { addDays } from '../lib/dates.js';
import { formatCalendarDate } from '../lib/format.js';
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { formatCents } from '../lib/money.js';
import { api } from '../services/api.js';
import { can } from '../services/tenant.js';

const LIMIT = 20;

const TABS = [
  { value: 'open', label: 'Pendentes' },
  { value: 'overdue', label: 'Vencidas' },
  { value: 'upcoming', label: 'Próximas' },
  { value: 'paid', label: 'Pagas' },
  { value: 'cancelled', label: 'Canceladas' },
  { value: 'all', label: 'Todas' },
];

const SORTS = [
  { value: '', label: 'Padrão da aba' },
  { value: 'due_date', label: 'Vencimento (mais antigo)' },
  { value: '-due_date', label: 'Vencimento (mais recente)' },
  { value: '-amount', label: 'Maior valor' },
  { value: 'description', label: 'Descrição (A–Z)' },
];

const EMPTY = {
  open: { title: 'Nada pendente', message: 'Despesas em aberto aparecem aqui, das que vencem primeiro às últimas.' },
  overdue: { title: 'Nenhuma despesa vencida', message: 'Tudo em dia.' },
  upcoming: { title: 'Nada vencendo nos próximos dias', message: 'A janela de "Próximas" pode ser ajustada em Configurações.' },
  paid: { title: 'Nenhuma despesa paga', message: 'Despesas quitadas aparecem aqui.' },
  cancelled: { title: 'Nenhuma despesa cancelada', message: '' },
  all: { title: 'Nenhuma despesa lançada', message: 'Lance a primeira despesa ou registre um pagamento já feito.' },
};

function readState(query) {
  const tab = TABS.some((item) => item.value === query.get('aba')) ? query.get('aba') : 'open';
  return {
    tab,
    q: (query.get('q') ?? '').trim().slice(0, 100),
    category: query.get('categoria') ?? '',
    tag: query.get('tag') ?? '',
    from: query.get('de') ?? '',
    to: query.get('ate') ?? '',
    sort: SORTS.some((item) => item.value === query.get('ordem')) ? query.get('ordem') : '',
    page: Math.max(1, Number.parseInt(query.get('pagina') ?? '1', 10) || 1),
  };
}

function listUrl(state, changes = {}) {
  const next = { ...state, ...changes };
  const params = new URLSearchParams();
  if (next.tab !== 'open') params.set('aba', next.tab);
  if (next.q) params.set('q', next.q);
  if (next.category) params.set('categoria', next.category);
  if (next.tag) params.set('tag', next.tag);
  if (next.from) params.set('de', next.from);
  if (next.to) params.set('ate', next.to);
  if (next.sort) params.set('ordem', next.sort);
  if (next.page > 1) params.set('pagina', String(next.page));
  const search = params.toString();
  return `/app/financeiro${search ? `?${search}` : ''}`;
}

function apiQuery(state) {
  const params = new URLSearchParams({ tab: state.tab, page: String(state.page), limit: String(LIMIT) });
  if (state.q) params.set('q', state.q);
  if (state.category) params.set('category_id', state.category);
  if (state.tag) params.set('tag_id', state.tag);
  if (state.from) params.set('due_from', state.from);
  if (state.to) params.set('due_to', state.to);
  if (state.sort) params.set('sort', state.sort);
  return `/expenses?${params}`;
}

function totalsBar(meta) {
  const { totals } = meta;
  return html`<dl class="grid grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-center shadow-xs sm:p-4">
    <div class="min-w-0"><dt class="text-xs text-slate-500">${meta.total === 1 ? '1 despesa' : `${meta.total} despesas`}</dt>
      <dd class="truncate font-semibold tabular-nums">${formatCents(totals.amount_cents)}</dd></div>
    <div class="min-w-0"><dt class="text-xs text-slate-500">Pago</dt>
      <dd class="truncate font-semibold text-green-700 tabular-nums">${formatCents(totals.paid_cents)}</dd></div>
    <div class="min-w-0"><dt class="text-xs text-slate-500">Em aberto</dt>
      <dd class="truncate font-semibold text-amber-700 tabular-nums">${formatCents(totals.open_cents)}</dd></div>
  </dl>`;
}

function pager(state, total) {
  const pages = Math.max(1, Math.ceil(total / LIMIT));
  if (pages === 1) return '';
  return html`<nav class="mt-4 flex items-center justify-between gap-3" aria-label="Paginação">
    <a class="btn btn-secondary btn-sm ${state.page <= 1 ? 'pointer-events-none opacity-50' : ''}" href="${listUrl(state, { page: state.page - 1 })}"
      ${state.page <= 1 ? html`aria-disabled="true" tabindex="-1"` : ''}>${icon('chevron-left', 'size-4')} Anterior</a>
    <span class="text-sm text-slate-600">Página ${state.page} de ${pages}</span>
    <a class="btn btn-secondary btn-sm ${state.page >= pages ? 'pointer-events-none opacity-50' : ''}" href="${listUrl(state, { page: state.page + 1 })}"
      ${state.page >= pages ? html`aria-disabled="true" tabindex="-1"` : ''}>Próxima ${icon('chevron-right', 'size-4')}</a>
  </nav>`;
}

export default {
  title: 'Financeiro',

  render({ query }) {
    const state = readState(query);
    const filtersOpen = Boolean(state.category || state.tag || state.from || state.to || state.sort);
    return html`
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-2xl font-bold tracking-tight text-slate-900">Financeiro</h1>
        <div class="flex flex-wrap gap-2">
          ${can('finance.pay') ? html`<button type="button" class="btn btn-primary btn-sm" data-action="quick-pay">${icon('circle-check', 'size-4')} Já paguei</button>` : ''}
          ${can('finance.manage') ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="new-expense">${icon('plus', 'size-4')} Nova despesa</button>` : ''}
        </div>
      </div>
      <div class="mt-4 tabs" role="tablist" aria-label="Situação">
        ${TABS.map(
          (tab) => html`<a role="tab" class="tab" href="${listUrl({ ...state, tab: tab.value, page: 1 })}"
            aria-selected="${tab.value === state.tab ? 'true' : 'false'}">${tab.label}</a>`,
        )}
      </div>
      <form class="mt-3 space-y-2" role="search" data-form="filters">
        <div class="flex gap-2">
          <label for="busca-despesas" class="sr-only">Buscar despesas</label>
          <input id="busca-despesas" name="q" type="search" class="input h-11" placeholder="Buscar por descrição, prestador ou tag" value="${state.q}" maxlength="100">
          <button type="submit" class="btn btn-secondary btn-sm shrink-0" aria-label="Buscar">${icon('search', 'size-4')}</button>
        </div>
        <details class="rounded-xl border border-slate-200 bg-white" ${filtersOpen ? html`open` : ''}>
          <summary class="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm font-medium text-slate-700">${icon('list-filter', 'size-4')} Filtros</summary>
          <div class="grid gap-3 border-t border-slate-100 p-3 sm:grid-cols-2 lg:grid-cols-5">
            <label class="block text-sm"><span class="label">Categoria</span>
              <select name="categoria" class="input h-11"><option value="">Todas</option></select></label>
            <label class="block text-sm"><span class="label">Tag</span>
              <select name="tag" class="input h-11"><option value="">Todas</option></select></label>
            <label class="block text-sm"><span class="label">Vencimento de</span>
              <input name="de" type="date" class="input h-11" value="${state.from}"></label>
            <label class="block text-sm"><span class="label">até</span>
              <input name="ate" type="date" class="input h-11" value="${state.to}"></label>
            <label class="block text-sm"><span class="label">Ordenar</span>
              <select name="ordem" class="input h-11">
                ${SORTS.map((sort) => html`<option value="${sort.value}" ${sort.value === state.sort ? html`selected` : ''}>${sort.label}</option>`)}
              </select></label>
            <div class="flex gap-2 sm:col-span-2 lg:col-span-5">
              <button type="submit" class="btn btn-primary btn-sm">Aplicar</button>
              <a href="${listUrl({ tab: state.tab, q: '', category: '', tag: '', from: '', to: '', sort: '', page: 1 })}" class="btn btn-ghost btn-sm">Limpar</a>
            </div>
          </div>
        </details>
      </form>
      <div class="mt-4 space-y-3" data-content>${loadingState()}</div>`;
  },

  mount(root, { query, navigate }) {
    const state = readState(query);
    const content = root.querySelector('[data-content]');
    const form = root.querySelector('[data-form="filters"]');
    let active = true;

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const values = form.elements;
      navigate(
        listUrl(state, {
          q: values.q.value.trim(),
          category: values.categoria.value,
          tag: values.tag.value,
          from: values.de.value,
          to: values.ate.value,
          sort: values.ordem.value,
          page: 1,
        }),
      );
    });

    function fillSelect(select, items, selected) {
      for (const item of items) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.name;
        option.selected = item.id === selected;
        select.append(option);
      }
    }

    // Categorias: filtro da lista e opções do formulário (o formulário espera a lista chegar).
    const categoriesReady = api('/finance-categories?kind=expense')
      .then(({ data }) => {
        if (active) fillSelect(form.elements.categoria, data.categories, state.category);
        return data.categories;
      })
      .catch(() => []);
    api('/tags?limit=50')
      .then(({ data }) => {
        if (active) fillSelect(form.elements.tag, data.tags.filter((tag) => tag.expense_count > 0 || tag.id === state.tag), state.tag);
      })
      .catch(() => {});

    async function load() {
      try {
        const { data, meta } = await api(apiQuery(state));
        if (!active) return;
        const empty = state.q || state.category || state.tag || state.from || state.to
          ? { title: 'Nada encontrado', message: 'Tente outra busca ou limpe os filtros.' }
          : EMPTY[state.tab];
        setContent(
          content,
          html`${state.tab === 'upcoming' ? html`<p class="text-sm text-slate-600">Vencendo de hoje até ${formatCalendarDate(addDays(meta.today, meta.upcoming_window_days))} (${meta.upcoming_window_days} dias).</p>` : ''}
            ${meta.total > 0 ? totalsBar(meta) : ''}
            ${data.expenses.length > 0 ? html`${expenseList(data.expenses)}${pager(state, meta.total)}` : emptyState(empty)}`,
        );
      } catch (err) {
        if (active) setContent(content, errorState({ message: err.message }));
      }
    }

    async function openForm(quickPay) {
      const saved = await openExpenseForm({ quickPay, categories: await categoriesReady });
      if (!saved) return;
      toast(quickPay ? 'Pagamento registrado.' : 'Despesa lançada.', { type: 'success' });
      navigate(`/app/financeiro/${saved.id}`);
    }

    root.querySelector('[data-action="new-expense"]')?.addEventListener('click', () => openForm(false));
    root.querySelector('[data-action="quick-pay"]')?.addEventListener('click', () => openForm(true));

    load();
    return () => {
      active = false;
    };
  },
};

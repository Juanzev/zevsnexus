// Notas fiscais (ARCHITECTURE §14): abas Pendentes · Em processamento · Pagas · Emitidas · Canceladas ·
// Arquivadas · Todas, totais do filtro (bruto, retenções, líquido), busca e período — tudo no servidor e
// na URL. "Vencida" vem calculada da API. O Nexus registra notas emitidas em outro sistema.
import { invoiceList, openInvoiceForm } from '../components/invoices.js';
import { emptyState, errorState, loadingState } from '../components/states.js';
import { toast } from '../components/toast.js';
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { formatCents } from '../lib/money.js';
import { api } from '../services/api.js';
import { can } from '../services/tenant.js';

const LIMIT = 20;

const TABS = [
  { value: 'pending', label: 'Pendentes' },
  { value: 'processing', label: 'Em processamento' },
  { value: 'paid', label: 'Pagas' },
  { value: 'issued', label: 'Emitidas' },
  { value: 'cancelled', label: 'Canceladas' },
  { value: 'archived', label: 'Arquivadas' },
  { value: 'all', label: 'Todas' },
];

const SORTS = [
  { value: '', label: 'Padrão da aba' },
  { value: '-issue_date', label: 'Emissão (mais recente)' },
  { value: 'issue_date', label: 'Emissão (mais antiga)' },
  { value: 'due_date', label: 'Vencimento' },
  { value: '-net_amount', label: 'Maior valor' },
  { value: '-number', label: 'Número (maior)' },
];

const EMPTY = {
  pending: { title: 'Nada a receber', message: 'Notas emitidas que ainda não foram pagas aparecem aqui, das que vencem primeiro.' },
  processing: { title: 'Nenhuma nota em processamento', message: 'Registre aqui a nota que ainda vai ser emitida e marque como emitida depois.' },
  paid: { title: 'Nenhuma nota paga', message: 'Notas com recebimento registrado (finalizadas) aparecem aqui.' },
  issued: { title: 'Nenhuma nota emitida', message: 'Registre as notas emitidas pela empresa, com o PDF e o XML.' },
  cancelled: { title: 'Nenhuma nota cancelada', message: '' },
  archived: { title: 'Nenhuma nota arquivada', message: 'Arquive o que não precisa mais ver: sai das listas, mas continua guardado.' },
  all: { title: 'Nenhuma nota registrada', message: 'Registre a primeira nota emitida pela empresa.' },
};

function readState(query) {
  return {
    tab: TABS.some((item) => item.value === query.get('aba')) ? query.get('aba') : 'pending',
    q: (query.get('q') ?? '').trim().slice(0, 100),
    from: query.get('de') ?? '',
    to: query.get('ate') ?? '',
    sort: SORTS.some((item) => item.value === query.get('ordem')) ? query.get('ordem') : '',
    page: Math.max(1, Number.parseInt(query.get('pagina') ?? '1', 10) || 1),
  };
}

function listUrl(state, changes = {}) {
  const next = { ...state, ...changes };
  const params = new URLSearchParams();
  if (next.tab !== 'pending') params.set('aba', next.tab);
  if (next.q) params.set('q', next.q);
  if (next.from) params.set('de', next.from);
  if (next.to) params.set('ate', next.to);
  if (next.sort) params.set('ordem', next.sort);
  if (next.page > 1) params.set('pagina', String(next.page));
  const search = params.toString();
  return `/app/notas${search ? `?${search}` : ''}`;
}

function apiQuery(state) {
  const params = new URLSearchParams({ tab: state.tab, page: String(state.page), limit: String(LIMIT) });
  if (state.q) params.set('q', state.q);
  if (state.from) params.set('issued_from', state.from);
  if (state.to) params.set('issued_to', state.to);
  if (state.sort) params.set('sort', state.sort);
  return `/invoices?${params}`;
}

function totalsBar(meta) {
  const { totals } = meta;
  return html`<dl class="grid grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-center shadow-xs sm:p-4">
    <div class="min-w-0"><dt class="text-xs text-slate-500">${meta.total === 1 ? '1 nota · bruto' : `${meta.total} notas · bruto`}</dt>
      <dd class="truncate text-sm font-semibold tabular-nums sm:text-base">${formatCents(totals.gross_cents)}</dd></div>
    <div class="min-w-0"><dt class="text-xs text-slate-500">Retenções</dt>
      <dd class="truncate text-sm font-semibold text-slate-700 tabular-nums sm:text-base">${formatCents(totals.withheld_cents)}</dd></div>
    <div class="min-w-0"><dt class="text-xs text-slate-500">Líquido</dt>
      <dd class="truncate text-sm font-semibold text-primary tabular-nums sm:text-base">${formatCents(totals.net_cents)}</dd></div>
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
  title: 'Notas fiscais',

  render({ query }) {
    const state = readState(query);
    const filtersOpen = Boolean(state.from || state.to || state.sort);
    return html`
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-2xl font-bold tracking-tight text-slate-900">Notas fiscais</h1>
        ${can('invoices.manage') ? html`<button type="button" class="btn btn-primary btn-sm" data-action="new-invoice">${icon('plus', 'size-4')} Registrar nota</button>` : ''}
      </div>
      <div class="mt-4 tabs" role="tablist" aria-label="Vistas">
        ${TABS.map(
          (tab) => html`<a role="tab" class="tab" href="${listUrl({ tab: tab.value, q: '', from: '', to: '', sort: '', page: 1 })}"
            aria-selected="${tab.value === state.tab ? 'true' : 'false'}">${tab.label}</a>`,
        )}
      </div>
      <form class="mt-3 space-y-2" role="search" data-form="filters">
        <div class="flex gap-2">
          <label for="busca-notas" class="sr-only">Buscar notas</label>
          <input id="busca-notas" name="q" type="search" class="input h-11" placeholder="Número, cliente ou descrição" value="${state.q}" maxlength="100">
          <button type="submit" class="btn btn-secondary btn-sm shrink-0" aria-label="Buscar">${icon('search', 'size-4')}</button>
        </div>
        <details class="rounded-xl border border-slate-200 bg-white px-3" ${filtersOpen ? html`open` : ''}>
          <summary class="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">${icon('list-filter', 'size-4')} Período e ordem</summary>
          <div class="grid gap-2 pb-3 sm:grid-cols-3">
            <label class="text-sm text-slate-600">Emitidas de<input name="de" type="date" class="input mt-1 h-11" value="${state.from}"></label>
            <label class="text-sm text-slate-600">até<input name="ate" type="date" class="input mt-1 h-11" value="${state.to}"></label>
            <label class="text-sm text-slate-600">Ordenar
              <select name="ordem" class="input mt-1 h-11">
                ${SORTS.map((sort) => html`<option value="${sort.value}" ${sort.value === state.sort ? html`selected` : ''}>${sort.label}</option>`)}
              </select></label>
          </div>
        </details>
      </form>
      <div class="mt-4" data-content>${loadingState()}</div>`;
  },

  mount(root, { query, navigate }) {
    const state = readState(query);
    const content = root.querySelector('[data-content]');
    const filters = root.querySelector('[data-form="filters"]');
    let active = true;

    filters.addEventListener('submit', (event) => {
      event.preventDefault();
      navigate(listUrl(state, { q: filters.elements.q.value.trim(), page: 1 }));
    });
    for (const [name, key] of [['de', 'from'], ['ate', 'to'], ['ordem', 'sort']]) {
      filters.elements[name].addEventListener('change', () => navigate(listUrl(state, { [key]: filters.elements[name].value, page: 1 })));
    }

    async function load() {
      try {
        const { data, meta } = await api(apiQuery(state));
        if (!active) return;
        const filtered = Boolean(state.q || state.from || state.to);
        const empty = filtered ? { title: 'Nada encontrado', message: 'Tente outra busca ou limpe os filtros.' } : EMPTY[state.tab];
        setContent(
          content,
          data.invoices.length === 0
            ? emptyState(empty)
            : html`${totalsBar(meta)}<div class="mt-4">${invoiceList(data.invoices)}</div>${pager(state, meta.total)}`,
        );
      } catch (err) {
        if (active) setContent(content, errorState({ message: err.message }));
      }
    }

    root.querySelector('[data-action="new-invoice"]')?.addEventListener('click', async () => {
      const saved = await openInvoiceForm();
      if (!saved) return;
      toast(saved.status === 'issued' ? 'Nota registrada como emitida.' : 'Nota registrada em processamento.', { type: 'success' });
      navigate(`/app/notas/${saved.id}`);
    });

    load();
    return () => {
      active = false;
    };
  },
};

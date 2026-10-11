// Prestadores e fornecedores: lista com busca (nome, especialidade, CPF/CNPJ, telefone) e filtro por
// papel, paginada no servidor. Cadastro com parties.manage.
import { PARTY_ROLES } from '../components/finance.js';
import { openPartyForm, partyRow } from '../components/parties.js';
import { emptyState, errorState, loadingState } from '../components/states.js';
import { toast } from '../components/toast.js';
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { api } from '../services/api.js';
import { can } from '../services/tenant.js';

const LIMIT = 30;

function readState(query) {
  return {
    q: (query.get('q') ?? '').trim().slice(0, 100),
    role: PARTY_ROLES.some((role) => role.value === query.get('papel')) ? query.get('papel') : '',
    page: Math.max(1, Number.parseInt(query.get('pagina') ?? '1', 10) || 1),
  };
}

function listUrl(state, changes = {}) {
  const next = { ...state, ...changes };
  const params = new URLSearchParams();
  if (next.q) params.set('q', next.q);
  if (next.role) params.set('papel', next.role);
  if (next.page > 1) params.set('pagina', String(next.page));
  const search = params.toString();
  return `/app/prestadores${search ? `?${search}` : ''}`;
}

export default {
  title: 'Prestadores',

  render({ query }) {
    const state = readState(query);
    return html`
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-2xl font-bold tracking-tight text-slate-900">Prestadores e fornecedores</h1>
        ${can('parties.manage') ? html`<button type="button" class="btn btn-primary btn-sm" data-action="new">${icon('plus', 'size-4')} Novo cadastro</button>` : ''}
      </div>
      <form class="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" role="search" data-form="filters">
        <div class="flex gap-2">
          <label for="busca-prestadores" class="sr-only">Buscar prestadores</label>
          <input id="busca-prestadores" name="q" type="search" class="input h-11" placeholder="Nome, especialidade, CPF/CNPJ ou telefone" value="${state.q}" maxlength="100">
          <button type="submit" class="btn btn-secondary btn-sm shrink-0" aria-label="Buscar">${icon('search', 'size-4')}</button>
        </div>
        <label class="sr-only" for="filtro-papel">Papel</label>
        <select id="filtro-papel" name="papel" class="input h-11 sm:w-56">
          <option value="">Todos os papéis</option>
          ${PARTY_ROLES.map((role) => html`<option value="${role.value}" ${role.value === state.role ? html`selected` : ''}>${role.label}</option>`)}
        </select>
      </form>
      <div class="mt-4" data-content>${loadingState()}</div>`;
  },

  mount(root, { query, navigate }) {
    const state = readState(query);
    const content = root.querySelector('[data-content]');
    const form = root.querySelector('[data-form="filters"]');
    let active = true;

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      navigate(listUrl(state, { q: form.elements.q.value.trim(), page: 1 }));
    });
    form.elements.papel.addEventListener('change', () => navigate(listUrl(state, { role: form.elements.papel.value, page: 1 })));

    root.querySelector('[data-action="new"]')?.addEventListener('click', async () => {
      const saved = await openPartyForm();
      if (!saved) return;
      toast('Cadastro criado.', { type: 'success' });
      navigate(`/app/prestadores/${saved.id}`);
    });

    async function load() {
      const params = new URLSearchParams({ page: String(state.page), limit: String(LIMIT), sort: 'name' });
      if (state.q) params.set('q', state.q);
      if (state.role) params.set('role', state.role);
      try {
        const { data, meta } = await api(`/parties?${params}`);
        if (!active) return;
        if (data.parties.length === 0) {
          setContent(
            content,
            emptyState(
              state.q || state.role
                ? { title: 'Nada encontrado', message: 'Tente outra busca ou outro papel.' }
                : { title: 'Nenhum cadastro ainda', message: 'Cadastre prestadores de serviço, fornecedores e clientes para vincular às despesas.' },
            ),
          );
          return;
        }
        const pages = Math.max(1, Math.ceil(meta.total / LIMIT));
        setContent(
          content,
          html`<ul class="space-y-2 sm:space-y-0 sm:divide-y sm:divide-slate-100 sm:overflow-hidden sm:rounded-2xl sm:border sm:border-slate-200 sm:bg-white sm:shadow-sm">
              ${data.parties.map(partyRow)}
            </ul>
            ${
              pages > 1
                ? html`<nav class="mt-4 flex items-center justify-between gap-3" aria-label="Paginação">
                    <a class="btn btn-secondary btn-sm ${state.page <= 1 ? 'pointer-events-none opacity-50' : ''}" href="${listUrl(state, { page: state.page - 1 })}">${icon('chevron-left', 'size-4')} Anterior</a>
                    <span class="text-sm text-slate-600">Página ${state.page} de ${pages}</span>
                    <a class="btn btn-secondary btn-sm ${state.page >= pages ? 'pointer-events-none opacity-50' : ''}" href="${listUrl(state, { page: state.page + 1 })}">Próxima ${icon('chevron-right', 'size-4')}</a>
                  </nav>`
                : ''
            }`,
        );
      } catch (err) {
        if (active) setContent(content, errorState({ message: err.message }));
      }
    }

    load();
    return () => {
      active = false;
    };
  },
};

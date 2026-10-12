// Planilhas (FASE-0 D6, níveis 1 e 2): visões Em uso · Deste ano · Antigas · Arquivadas · Todas, busca,
// ano e ordenação no servidor, estado na URL e ações em lote. A planilha é um documento: o envio vai
// para a pasta padrão "Planilhas" da Central, com o ano tirado da data de modificação do arquivo.
import { emptyState, errorState, loadingState } from '../components/states.js';
import { toast } from '../components/toast.js';
import { fileIcon } from '../components/documents.js';
import { askYear, spreadsheetBadges } from '../components/spreadsheets.js';
import { formatBytes, formatDate } from '../lib/format.js';
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { api } from '../services/api.js';
import { can, currentContext } from '../services/tenant.js';
import { isSpreadsheetFile, SPREADSHEET_ACCEPT, uploadDocument } from '../services/uploads.js';

const LIMIT = 20;

const TABS = [
  { value: 'em-uso', view: 'in_use', label: 'Em uso' },
  { value: 'deste-ano', view: 'this_year', label: 'Deste ano' },
  { value: 'antigas', view: 'older', label: 'Antigas' },
  { value: 'arquivadas', view: 'archived', label: 'Arquivadas' },
  { value: 'todas', view: 'all', label: 'Todas' },
];

const SORTS = [
  { value: '-updated_at', label: 'Mais recentes' },
  { value: 'title', label: 'Nome (A–Z)' },
  { value: '-reference_year', label: 'Ano (mais novo)' },
  { value: 'reference_year', label: 'Ano (mais antigo)' },
];

const EMPTY = {
  'em-uso': {
    title: 'Nenhuma planilha em uso',
    message: 'Marque como “em uso” as planilhas que a equipe abre no dia a dia: elas ficam aqui, à mão.',
  },
  'deste-ano': { title: 'Nenhuma planilha deste ano', message: 'As planilhas com ano de referência atual aparecem aqui.' },
  antigas: { title: 'Nenhuma planilha antiga', message: 'Planilhas de anos anteriores aparecem aqui, sem atrapalhar as atuais.' },
  arquivadas: { title: 'Nenhuma planilha arquivada', message: 'Arquive o que não usa mais: sai das listas, mas continua guardado.' },
  todas: { title: 'Nenhuma planilha ainda', message: 'Envie planilhas do Excel (.xlsx, .xls), CSV ou LibreOffice (.ods).' },
};

function readState(query) {
  const tab = TABS.some((item) => item.value === query.get('aba')) ? query.get('aba') : 'em-uso';
  const year = Number.parseInt(query.get('ano') ?? '', 10);
  return {
    tab,
    q: (query.get('q') ?? '').trim().slice(0, 100),
    year: year >= 1990 && year <= 2100 ? year : null,
    sort: SORTS.some((item) => item.value === query.get('ordem')) ? query.get('ordem') : '-updated_at',
    page: Math.max(1, Number.parseInt(query.get('pagina') ?? '1', 10) || 1),
  };
}

function listUrl(state, changes = {}) {
  const next = { ...state, ...changes };
  const params = new URLSearchParams();
  if (next.tab !== 'em-uso') params.set('aba', next.tab);
  if (next.q) params.set('q', next.q);
  if (next.year) params.set('ano', String(next.year));
  if (next.sort !== '-updated_at') params.set('ordem', next.sort);
  if (next.page > 1) params.set('pagina', String(next.page));
  const search = params.toString();
  return `/app/planilhas${search ? `?${search}` : ''}`;
}

function apiQuery(state) {
  const params = new URLSearchParams({
    view: TABS.find((tab) => tab.value === state.tab).view,
    page: String(state.page),
    limit: String(LIMIT),
    sort: state.sort,
  });
  if (state.q) params.set('q', state.q);
  if (state.year) params.set('year', String(state.year));
  return `/spreadsheets?${params}`;
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

function sheetRow(sheet, { selectable }) {
  return html`<li class="flex items-center gap-1 rounded-xl border border-slate-200 bg-white pl-1 shadow-xs sm:border-0 sm:bg-transparent sm:shadow-none sm:hover:bg-slate-50">
    ${
      selectable
        ? html`<label class="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg">
            <span class="sr-only">Selecionar ${sheet.title}</span>
            <input type="checkbox" class="checkbox mt-0" data-select="${sheet.id}">
          </label>`
        : ''
    }
    <a href="/app/planilhas/${sheet.id}" class="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-3 ${selectable ? 'pl-1' : ''}" data-spreadsheet="${sheet.id}">
      <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">${fileIcon(sheet.file.extension)}</span>
      <span class="min-w-0 flex-1">
        <span class="block truncate font-medium text-slate-900">${sheet.title}</span>
        <span class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          ${spreadsheetBadges(sheet)}
          <span class="uppercase">${sheet.file.extension}</span>
          <span aria-hidden="true">·</span><span>${formatBytes(sheet.file.size_bytes)}</span>
          <span aria-hidden="true">·</span><span>Alterada em ${formatDate(sheet.updated_at)}</span>
        </span>
      </span>
    </a>
  </li>`;
}

function uploadRows(items) {
  return html`<section class="card p-4 sm:p-5" aria-label="Envio de planilhas">
    <div class="flex items-center justify-between gap-3">
      <h2 class="text-sm font-semibold text-slate-900">Enviando para a pasta Planilhas</h2>
      <button type="button" class="btn btn-ghost btn-sm" data-action="close-uploads" hidden>Fechar</button>
    </div>
    <ul class="mt-3 space-y-3">
      ${items.map(
        (item, index) => html`<li class="min-w-0" data-upload="${index}">
          <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
            <span class="min-w-0 flex-1 truncate text-slate-900">${item.file.name}</span>
            <span class="shrink-0 text-slate-500" data-status>Na fila</span>
            <button type="button" class="btn btn-secondary btn-sm shrink-0" data-action="mark-uploaded" hidden>${icon('pin', 'size-4')} Marcar em uso</button>
          </div>
          <progress class="mt-1 h-1.5 w-full overflow-hidden rounded-full accent-primary" max="1" value="0"></progress>
        </li>`,
      )}
    </ul>
  </section>`;
}

const BULK_ACTIONS = {
  mark_in_use: 'Marcar em uso',
  unmark_in_use: 'Tirar de uso',
  set_year: 'Mudar o ano',
  archive: 'Arquivar',
  unarchive: 'Desarquivar',
};

function bulkMessage(action, count) {
  const one = count === 1;
  switch (action) {
    case 'mark_in_use':
      return one ? 'Planilha marcada como em uso.' : `${count} planilhas marcadas como em uso.`;
    case 'unmark_in_use':
      return one ? 'Planilha tirada de uso.' : `${count} planilhas tiradas de uso.`;
    case 'set_year':
      return one ? 'Ano alterado.' : `Ano alterado em ${count} planilhas.`;
    case 'archive':
      return one ? 'Planilha arquivada.' : `${count} planilhas arquivadas.`;
    default:
      return one ? 'Planilha desarquivada.' : `${count} planilhas desarquivadas.`;
  }
}

export default {
  title: 'Planilhas',

  render({ query }) {
    const state = readState(query);
    const upload = can('documents.manage');
    return html`
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-2xl font-bold tracking-tight text-slate-900">Planilhas</h1>
        ${
          upload
            ? html`<button type="button" class="btn btn-primary btn-sm" data-action="pick-files">${icon('upload', 'size-4')} Enviar planilhas</button>
              <input type="file" multiple accept="${SPREADSHEET_ACCEPT}" data-input="files" hidden>`
            : ''
        }
      </div>
      <div class="mt-4 tabs" role="tablist" aria-label="Vistas">
        ${TABS.map(
          (tab) => html`<a role="tab" class="tab" href="${listUrl({ tab: tab.value, q: '', year: null, sort: '-updated_at', page: 1 })}"
            aria-selected="${tab.value === state.tab ? 'true' : 'false'}">${tab.label}</a>`,
        )}
      </div>
      <form class="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]" role="search" data-form="filters">
        <div class="flex gap-2">
          <label for="busca-planilhas" class="sr-only">Buscar planilhas</label>
          <input id="busca-planilhas" name="q" type="search" class="input h-11" placeholder="Buscar por nome" value="${state.q}" maxlength="100">
          <button type="submit" class="btn btn-secondary btn-sm shrink-0" aria-label="Buscar">${icon('search', 'size-4')}</button>
        </div>
        <label class="sr-only" for="filtro-ano">Ano de referência</label>
        <select id="filtro-ano" name="ano" class="input h-11 sm:w-40">
          <option value="">Todos os anos</option>
          ${state.year ? html`<option value="${state.year}" selected>${state.year}</option>` : ''}
        </select>
        <label class="sr-only" for="ordem">Ordenar</label>
        <select id="ordem" name="ordem" class="input h-11 sm:w-48">
          ${SORTS.map((sort) => html`<option value="${sort.value}" ${sort.value === state.sort ? html`selected` : ''}>${sort.label}</option>`)}
        </select>
      </form>
      <div class="mt-4" data-uploads></div>
      <div class="sticky top-16 z-20 mt-4 lg:top-0" data-bulk hidden></div>
      <div class="mt-4 rounded-2xl transition" data-dropzone>
        <div data-content>${loadingState()}</div>
      </div>`;
  },

  mount(root, { query, navigate }) {
    const state = readState(query);
    const manage = can('spreadsheets.manage');
    const upload = can('documents.manage');
    const content = root.querySelector('[data-content]');
    const uploads = root.querySelector('[data-uploads]');
    const bulkBar = root.querySelector('[data-bulk]');
    const filters = root.querySelector('[data-form="filters"]');
    const selected = new Set();
    let sheets = [];
    let active = true;

    // ---------- filtros (estado na URL) ----------
    filters.addEventListener('submit', (event) => {
      event.preventDefault();
      navigate(listUrl(state, { q: filters.elements.q.value.trim(), page: 1 }));
    });
    filters.elements.ano.addEventListener('change', () => {
      navigate(listUrl(state, { year: Number(filters.elements.ano.value) || null, page: 1 }));
    });
    filters.elements.ordem.addEventListener('change', () => navigate(listUrl(state, { sort: filters.elements.ordem.value, page: 1 })));

    /** Anos que existem na empresa (do mais novo ao mais antigo), mais o escolhido na URL. */
    function fillYears(years) {
      const select = filters.elements.ano;
      const all = [...new Set([...years, ...(state.year ? [state.year] : [])])].sort((a, b) => b - a);
      select.length = 1;
      for (const year of all) select.append(new Option(String(year), String(year), false, year === state.year));
    }

    // ---------- lista ----------
    async function load() {
      try {
        const { data, meta } = await api(apiQuery(state));
        if (!active) return;
        sheets = data.spreadsheets;
        fillYears(meta.years);
        render(meta.total);
      } catch (err) {
        if (active) setContent(content, errorState({ message: err.message }));
      }
    }

    function render(total) {
      selected.clear();
      renderBulkBar();
      const filtered = state.q || state.year;
      const empty = filtered ? { title: 'Nada encontrado', message: 'Tente outra busca ou limpe os filtros.' } : EMPTY[state.tab];
      if (sheets.length === 0) {
        setContent(content, emptyState(empty));
        return;
      }
      setContent(
        content,
        html`
          ${filtered ? html`<p class="mb-3 text-sm text-slate-600">${total === 1 ? '1 planilha encontrada' : `${total} planilhas encontradas`}</p>` : ''}
          ${
            manage
              ? html`<label class="mb-2 inline-flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm text-slate-700">
                  <input type="checkbox" class="checkbox mt-0" data-action="select-page"> Selecionar as ${sheets.length} desta página</label>`
              : ''
          }
          <ul class="space-y-2 sm:space-y-0 sm:divide-y sm:divide-slate-100 sm:rounded-2xl sm:border sm:border-slate-200 sm:bg-white sm:p-1 sm:shadow-sm">
            ${sheets.map((sheet) => sheetRow(sheet, { selectable: manage }))}
          </ul>
          ${pager(state, total)}`,
      );
      for (const box of content.querySelectorAll('[data-select]')) {
        box.addEventListener('change', () => {
          if (box.checked) selected.add(box.dataset.select);
          else selected.delete(box.dataset.select);
          syncSelection();
        });
      }
      content.querySelector('[data-action="select-page"]')?.addEventListener('change', (event) => {
        for (const box of content.querySelectorAll('[data-select]')) {
          box.checked = event.target.checked;
          if (box.checked) selected.add(box.dataset.select);
          else selected.delete(box.dataset.select);
        }
        syncSelection();
      });
    }

    function syncSelection() {
      const pageBox = content.querySelector('[data-action="select-page"]');
      if (pageBox) {
        pageBox.checked = selected.size === sheets.length;
        pageBox.indeterminate = selected.size > 0 && selected.size < sheets.length;
      }
      renderBulkBar();
    }

    // ---------- ações em lote ----------
    function renderBulkBar() {
      if (!manage || selected.size === 0) {
        bulkBar.hidden = true;
        setContent(bulkBar, html``);
        return;
      }
      const archived = state.tab === 'arquivadas';
      const actions = archived ? ['unarchive', 'set_year'] : ['mark_in_use', 'unmark_in_use', 'set_year', 'archive'];
      bulkBar.hidden = false;
      setContent(
        bulkBar,
        html`<div class="grid grid-cols-2 items-center gap-2 rounded-2xl border border-primary/30 bg-white/95 p-2 shadow-md backdrop-blur-sm sm:flex sm:flex-wrap" role="region" aria-label="Ações em lote">
          <p class="px-2 text-sm font-medium text-slate-900 sm:order-first" aria-live="polite">${selected.size === 1 ? '1 selecionada' : `${selected.size} selecionadas`}</p>
          <button type="button" class="btn btn-ghost btn-sm justify-self-end sm:order-last sm:ml-auto" data-action="clear-selection">${icon('x', 'size-4')} Limpar</button>
          ${actions.map((action) => html`<button type="button" class="btn btn-secondary btn-sm" data-bulk-action="${action}">${BULK_ACTIONS[action]}</button>`)}
        </div>`,
      );
      for (const button of bulkBar.querySelectorAll('[data-bulk-action]')) {
        button.addEventListener('click', () => runBulk(button.dataset.bulkAction));
      }
      bulkBar.querySelector('[data-action="clear-selection"]').addEventListener('click', () => {
        selected.clear();
        for (const box of content.querySelectorAll('[data-select]')) box.checked = false;
        syncSelection();
      });
    }

    async function runBulk(action) {
      const body = { ids: [...selected], action };
      if (action === 'set_year') {
        const year = await askYear({ title: selected.size === 1 ? 'Mudar o ano da planilha' : `Mudar o ano de ${selected.size} planilhas` });
        if (!year) return;
        body.reference_year = year;
      }
      for (const button of bulkBar.querySelectorAll('button')) button.disabled = true;
      try {
        const { data } = await api('/spreadsheets/bulk', { method: 'POST', body });
        const missing = data.not_found.length;
        toast(
          missing === 0 ? bulkMessage(action, data.updated) : `${bulkMessage(action, data.updated)} ${missing === 1 ? '1 não foi encontrada' : `${missing} não foram encontradas`} (excluída ou sem acesso).`,
          { type: missing === 0 ? 'success' : 'error' },
        );
        load();
      } catch (err) {
        toast(err.message, { type: 'error' });
        renderBulkBar();
      }
    }

    // ---------- envio ----------
    async function uploadFiles(fileList) {
      const files = [...fileList];
      if (files.length === 0) return;
      const items = files.map((file) => ({ file }));
      const folderId = currentContext()?.document_folders?.spreadsheets ?? null;
      setContent(uploads, uploadRows(items));

      let sent = 0;
      for (const [index, item] of items.entries()) {
        const row = uploads.querySelector(`[data-upload="${index}"]`);
        const status = row.querySelector('[data-status]');
        const bar = row.querySelector('progress');
        if (!isSpreadsheetFile(item.file)) {
          status.textContent = 'Não é planilha (.xlsx, .xls, .csv ou .ods)';
          status.className = 'min-w-0 shrink text-right text-red-700';
          bar.hidden = true;
          continue;
        }
        status.textContent = 'Enviando…';
        try {
          const doc = await uploadDocument(item.file, {
            folderId,
            onProgress: (fraction) => {
              bar.value = fraction;
              status.textContent = fraction < 1 ? `${Math.round(fraction * 100)}%` : 'Conferindo…';
            },
          });
          bar.value = 1;
          status.textContent = 'Enviada';
          status.className = 'shrink-0 text-green-700';
          sent += 1;
          if (manage) bindMarkUploaded(row, doc);
        } catch (err) {
          status.textContent = err.message;
          status.className = 'min-w-0 shrink text-right text-red-700';
          bar.hidden = true;
        }
      }
      if (!active) return;
      const failed = items.length - sent;
      toast(
        failed === 0 ? (sent === 1 ? 'Planilha enviada.' : `${sent} planilhas enviadas.`) : `${sent} de ${items.length} enviadas. Confira os erros.`,
        { type: failed === 0 ? 'success' : 'error' },
      );
      const close = uploads.querySelector('[data-action="close-uploads"]');
      close.hidden = false;
      close.addEventListener('click', () => setContent(uploads, html``));
      load();
    }

    /** Depois de enviada, a planilha pode ir direto para "Em uso". */
    function bindMarkUploaded(row, doc) {
      const button = row.querySelector('[data-action="mark-uploaded"]');
      button.hidden = false;
      button.setAttribute('aria-label', `Marcar em uso: ${doc.title}`);
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await api(`/spreadsheets/${doc.id}`, { method: 'PATCH', body: { in_use: true } });
          button.replaceWith(Object.assign(document.createElement('span'), { className: 'shrink-0 text-sm text-green-700', textContent: 'Em uso' }));
          load();
        } catch (err) {
          toast(err.message, { type: 'error' });
          button.disabled = false;
        }
      });
    }

    if (upload) {
      const input = root.querySelector('[data-input="files"]');
      root.querySelector('[data-action="pick-files"]')?.addEventListener('click', () => input.click());
      input.addEventListener('change', () => {
        uploadFiles(input.files);
        input.value = '';
      });

      // Arrastar e soltar (desktop).
      const dropzone = root.querySelector('[data-dropzone]');
      dropzone.addEventListener('dragover', (event) => {
        if (!event.dataTransfer?.types.includes('Files')) return;
        event.preventDefault();
        dropzone.classList.add('ring-2', 'ring-primary', 'ring-offset-4');
      });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('ring-2', 'ring-primary', 'ring-offset-4'));
      dropzone.addEventListener('drop', (event) => {
        event.preventDefault();
        dropzone.classList.remove('ring-2', 'ring-primary', 'ring-offset-4');
        uploadFiles(event.dataTransfer.files);
      });
    }

    load();
    return () => {
      active = false;
    };
  },
};

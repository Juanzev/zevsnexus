// Central de Documentos (ARCHITECTURE §11): pastas, recentes, favoritos, vencendo, arquivados e
// lixeira. Busca, filtro, ordenação e paginação no servidor; estado na URL (dá para compartilhar).
// Envio: vários arquivos de uma vez, arrastar e soltar (desktop), "Tirar foto" (celular), com
// progresso por arquivo. Quem não tem documents.manage só consulta (o backend confere de novo).
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { documentList, folderCard, folderOptions, folderTree, subtreeIds } from '../components/documents.js';
import { field, selectField } from '../components/form.js';
import { openFormModal } from '../components/modal.js';
import { emptyState, errorState, loadingState } from '../components/states.js';
import { toast } from '../components/toast.js';
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { api } from '../services/api.js';
import { can } from '../services/tenant.js';
import { ACCEPT_ATTRIBUTE, isAcceptedFile, uploadDocument } from '../services/uploads.js';

const LIMIT = 20;

const TABS = [
  { value: 'pastas', label: 'Pastas' },
  { value: 'recentes', label: 'Recentes' },
  { value: 'favoritos', label: 'Favoritos' },
  { value: 'vencendo', label: 'Vencendo' },
  { value: 'arquivados', label: 'Arquivados' },
  { value: 'lixeira', label: 'Lixeira', permission: 'documents.manage' },
];

const SORTS = [
  { value: '-updated_at', label: 'Mais recentes' },
  { value: 'title', label: 'Nome (A–Z)' },
  { value: 'expires_on', label: 'Validade mais próxima' },
  { value: '-size', label: 'Maiores primeiro' },
];

const DEFAULT_SORT = { pastas: 'title', vencendo: 'expires_on' };

const EMPTY = {
  pastas: { title: 'Nada por aqui ainda', message: 'Envie arquivos ou crie pastas para organizar os documentos da empresa.' },
  folder: { title: 'Pasta vazia', message: 'Envie arquivos para esta pasta ou mova documentos para cá.' },
  recentes: { title: 'Nenhum documento ainda', message: 'Os documentos enviados aparecem aqui, dos mais recentes aos mais antigos.' },
  favoritos: { title: 'Nenhum favorito', message: 'Toque na estrela de um documento para encontrá-lo rápido aqui.' },
  vencendo: { title: 'Nada vencendo', message: 'Documentos vencidos ou com validade nos próximos 30 dias aparecem aqui.' },
  arquivados: { title: 'Nenhum documento arquivado', message: 'Arquive o que não usa mais: sai das listas, mas continua guardado.' },
  lixeira: { title: 'Lixeira vazia', message: 'Documentos excluídos ficam aqui e podem ser restaurados.' },
};

function readState(params, query) {
  const folderId = params.folderId ?? null;
  const requested = query.get('aba') ?? 'pastas';
  const tab = TABS.some((item) => item.value === requested && (!item.permission || can(item.permission))) ? requested : 'pastas';
  const sort = SORTS.some((item) => item.value === query.get('ordem')) ? query.get('ordem') : (DEFAULT_SORT[tab] ?? '-updated_at');
  return {
    folderId: tab === 'pastas' ? folderId : null,
    tab,
    q: (query.get('q') ?? '').trim().slice(0, 100),
    type: query.get('tipo') ?? '',
    sort,
    page: Math.max(1, Number.parseInt(query.get('pagina') ?? '1', 10) || 1),
  };
}

function listUrl(state, changes = {}) {
  const next = { ...state, ...changes };
  const inFolder = next.tab === 'pastas' && next.folderId && !next.q;
  const params = new URLSearchParams();
  if (next.tab !== 'pastas') params.set('aba', next.tab);
  if (next.q) params.set('q', next.q);
  if (next.type) params.set('tipo', next.type);
  if (next.sort !== (DEFAULT_SORT[next.tab] ?? '-updated_at')) params.set('ordem', next.sort);
  if (next.page > 1) params.set('pagina', String(next.page));
  const search = params.toString();
  return `${inFolder ? `/app/documentos/pasta/${next.folderId}` : '/app/documentos'}${search ? `?${search}` : ''}`;
}

/** Parâmetros da API para a aba atual. */
function apiQuery(state) {
  const params = new URLSearchParams({ page: String(state.page), limit: String(LIMIT), sort: state.sort });
  if (state.q) params.set('q', state.q);
  if (state.tab === 'lixeira') return `/trash?${params}`;
  if (state.type) params.set('type_id', state.type);
  if (state.tab === 'pastas' && !state.q) params.set('folder', state.folderId ?? 'root');
  if (state.tab === 'favoritos') params.set('favorites', 'true');
  if (state.tab === 'vencendo') params.set('expiring', 'true');
  if (state.tab === 'arquivados') params.set('archived', 'true');
  return `/documents?${params}`;
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

function breadcrumb(path) {
  return html`<nav aria-label="Caminho da pasta">
    <ol class="flex min-w-0 flex-wrap items-center gap-1 text-sm">
      <li><a href="/app/documentos" class="link">Documentos</a></li>
      ${path.map(
        (item, index) => html`<li class="flex min-w-0 items-center gap-1">${icon('chevron-right', 'size-4 shrink-0 text-slate-400')}
          ${
            index === path.length - 1
              ? html`<span class="truncate font-medium text-slate-900" aria-current="page">${item.name}</span>`
              : html`<a href="/app/documentos/pasta/${item.id}" class="link truncate">${item.name}</a>`
          }</li>`,
      )}
    </ol>
  </nav>`;
}

function uploadRows(items) {
  return html`<section class="card p-4 sm:p-5" aria-label="Envio de arquivos">
    <div class="flex items-center justify-between gap-3">
      <h2 class="text-sm font-semibold text-slate-900">Enviando para: <span data-upload-target></span></h2>
      <button type="button" class="btn btn-ghost btn-sm" data-action="close-uploads" hidden>Fechar</button>
    </div>
    <ul class="mt-3 space-y-3">
      ${items.map(
        (item, index) => html`<li class="min-w-0" data-upload="${index}">
          <div class="flex items-center justify-between gap-3 text-sm">
            <span class="min-w-0 truncate text-slate-900">${item.file.name}</span>
            <span class="shrink-0 text-slate-500" data-status>Na fila</span>
          </div>
          <progress class="mt-1 h-1.5 w-full overflow-hidden rounded-full accent-primary" max="1" value="0"></progress>
        </li>`,
      )}
    </ul>
  </section>`;
}

export default {
  title: 'Documentos',

  render({ params, query }) {
    const state = readState(params, query);
    const manage = can('documents.manage');
    return html`
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-2xl font-bold tracking-tight text-slate-900">Documentos</h1>
        ${
          manage && state.tab !== 'lixeira'
            ? html`<div class="flex flex-wrap gap-2">
                <button type="button" class="btn btn-primary btn-sm" data-action="pick-files">${icon('upload', 'size-4')} Enviar arquivos</button>
                <button type="button" class="btn btn-secondary btn-sm sm:hidden" data-action="take-photo">${icon('camera', 'size-4')} Tirar foto</button>
                ${state.tab === 'pastas' && !state.q ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="new-folder">${icon('folder-plus', 'size-4')} Nova pasta</button>` : ''}
              </div>
              <input type="file" multiple accept="${ACCEPT_ATTRIBUTE}" data-input="files" hidden>
              <input type="file" accept="image/*" capture="environment" data-input="camera" hidden>`
            : ''
        }
      </div>
      <div class="mt-4 tabs" role="tablist" aria-label="Vistas">
        ${TABS.filter((tab) => !tab.permission || can(tab.permission)).map(
          (tab) => html`<a role="tab" class="tab" href="${listUrl({ tab: tab.value, q: '', type: '', page: 1, folderId: null, sort: DEFAULT_SORT[tab.value] ?? '-updated_at' })}"
            aria-selected="${tab.value === state.tab ? 'true' : 'false'}">${tab.label}</a>`,
        )}
      </div>
      <form class="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]" role="search" data-form="filters">
        <div class="flex gap-2">
          <label for="busca-documentos" class="sr-only">Buscar documentos</label>
          <input id="busca-documentos" name="q" type="search" class="input h-11" placeholder="Buscar por título, descrição ou tag" value="${state.q}" maxlength="100">
          <button type="submit" class="btn btn-secondary btn-sm shrink-0" aria-label="Buscar">${icon('search', 'size-4')}</button>
        </div>
        <label class="sr-only" for="filtro-tipo">Tipo de documento</label>
        <select id="filtro-tipo" name="tipo" class="input h-11 sm:w-48" ${state.tab === 'lixeira' ? html`hidden` : ''}>
          <option value="">Todos os tipos</option>
        </select>
        <label class="sr-only" for="ordem">Ordenar</label>
        <select id="ordem" name="ordem" class="input h-11 sm:w-52">
          ${SORTS.map((sort) => html`<option value="${sort.value}" ${sort.value === state.sort ? html`selected` : ''}>${sort.label}</option>`)}
        </select>
      </form>
      <div class="mt-4" data-uploads></div>
      <div class="mt-4 rounded-2xl transition" data-dropzone>
        <div data-content>${loadingState()}</div>
      </div>`;
  },

  mount(root, { params, query, navigate }) {
    const state = readState(params, query);
    const manage = can('documents.manage');
    const content = root.querySelector('[data-content]');
    const uploads = root.querySelector('[data-uploads]');
    const filters = root.querySelector('[data-form="filters"]');
    let folders = [];
    let active = true;

    // ---------- filtros (estado na URL) ----------
    filters.addEventListener('submit', (event) => {
      event.preventDefault();
      navigate(listUrl(state, { q: filters.elements.q.value.trim(), page: 1 }));
    });
    filters.elements.tipo.addEventListener('change', () => navigate(listUrl(state, { type: filters.elements.tipo.value, page: 1 })));
    filters.elements.ordem.addEventListener('change', () => navigate(listUrl(state, { sort: filters.elements.ordem.value, page: 1 })));

    api('/document-types')
      .then(({ data }) => {
        if (!active) return;
        const select = filters.elements.tipo;
        for (const type of data.document_types) {
          const option = document.createElement('option');
          option.value = type.id;
          option.textContent = type.name;
          option.selected = type.id === state.type;
          select.append(option);
        }
      })
      .catch(() => {});

    // ---------- lista ----------
    function currentFolder() {
      return folders.find((folder) => folder.id === state.folderId) ?? null;
    }

    function folderPath() {
      const tree = folderTree(folders);
      const node = tree.find((folder) => folder.id === state.folderId);
      if (!node) return [];
      const path = [];
      let cursor = node;
      while (cursor) {
        path.unshift({ id: cursor.id, name: cursor.name });
        cursor = folders.find((folder) => folder.id === cursor.parent_id);
      }
      return path;
    }

    async function load() {
      try {
        const showFolders = state.tab === 'pastas' && !state.q;
        const [list, folderList] = await Promise.all([api(apiQuery(state)), showFolders ? api('/folders') : null]);
        if (!active) return;
        if (folderList) folders = folderList.data.folders;
        if (showFolders && state.folderId && !currentFolder()) {
          setContent(
            content,
            errorState({
              title: 'Pasta não encontrada',
              message: 'Ela pode ter sido excluída ou movida.',
              action: html`<a href="/app/documentos" class="btn btn-secondary btn-sm">Ir para Documentos</a>`,
            }),
          );
          return;
        }
        render(list.data.documents, list.meta.total, showFolders);
      } catch (err) {
        if (active) setContent(content, errorState({ message: err.message }));
      }
    }

    function render(documents, total, showFolders) {
      const subfolders = showFolders ? folders.filter((folder) => (folder.parent_id ?? null) === state.folderId) : [];
      const empty =
        state.q || state.type
          ? { title: 'Nada encontrado', message: 'Tente outra busca ou limpe os filtros.' }
          : EMPTY[state.folderId ? 'folder' : state.tab];
      setContent(
        content,
        html`
          ${
            state.folderId
              ? html`<div class="mb-4 flex flex-wrap items-center justify-between gap-2">
                  ${breadcrumb(folderPath())}
                  ${
                    manage
                      ? html`<div class="flex flex-wrap gap-2">
                          <button type="button" class="btn btn-ghost btn-sm" data-action="rename-folder">${icon('pencil', 'size-4')} Renomear</button>
                          <button type="button" class="btn btn-ghost btn-sm" data-action="move-folder">${icon('folder-input', 'size-4')} Mover</button>
                          <button type="button" class="btn btn-ghost btn-sm text-red-700" data-action="delete-folder">${icon('trash-2', 'size-4')} Excluir pasta</button>
                        </div>`
                      : ''
                  }
                </div>`
              : ''
          }
          ${state.q ? html`<p class="mb-3 text-sm text-slate-600">${total === 1 ? '1 resultado' : `${total} resultados`} para “${state.q}”</p>` : ''}
          ${subfolders.length > 0 ? html`<ul class="mb-4 grid gap-2 min-[480px]:grid-cols-2 lg:grid-cols-3" aria-label="Pastas">${subfolders.map(folderCard)}</ul>` : ''}
          ${
            documents.length > 0
              ? html`${documentList(documents, { trash: state.tab === 'lixeira', manage })}${pager(state, total)}`
              : subfolders.length > 0
                ? ''
                : emptyState(empty)
          }`,
      );
      bindList(documents);
    }

    function bindList(documents) {
      for (const button of content.querySelectorAll('[data-action="favorite"]')) {
        button.addEventListener('click', () => toggleFavorite(button, documents.find((doc) => doc.id === button.dataset.id)));
      }
      for (const button of content.querySelectorAll('[data-action="restore"]')) {
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            await api(`/trash/${button.dataset.id}/restore`, { method: 'POST', body: {} });
            toast('Documento restaurado.', { type: 'success' });
            load();
          } catch (err) {
            toast(err.message, { type: 'error' });
            button.disabled = false;
          }
        });
      }
      content.querySelector('[data-action="rename-folder"]')?.addEventListener('click', renameFolder);
      content.querySelector('[data-action="move-folder"]')?.addEventListener('click', moveFolder);
      content.querySelector('[data-action="delete-folder"]')?.addEventListener('click', deleteFolder);
    }

    async function toggleFavorite(button, doc) {
      const next = !doc.favorite;
      button.disabled = true;
      try {
        await api(`/documents/${doc.id}/favorite`, { method: next ? 'PUT' : 'DELETE', body: {} });
        doc.favorite = next;
        if (state.tab === 'favoritos') {
          load();
          return;
        }
        button.setAttribute('aria-pressed', String(next));
        button.setAttribute('aria-label', `${next ? 'Tirar dos favoritos' : 'Favoritar'}: ${doc.title}`);
        button.classList.toggle('text-amber-500', next);
        button.classList.toggle('text-slate-400', !next);
        button.querySelector('svg').classList.toggle('fill-current', next);
      } catch (err) {
        toast(err.message, { type: 'error' });
      } finally {
        button.disabled = false;
      }
    }

    // ---------- pastas ----------
    async function newFolder() {
      const created = await openFormModal({
        title: 'Nova pasta',
        body: field({ name: 'name', label: 'Nome da pasta' }),
        submitLabel: 'Criar pasta',
        busyLabel: 'Criando…',
        onMount: (dialog) => dialog.querySelector('[name="name"]').focus(),
        onSubmit: async (form) => {
          const { data } = await api('/folders', { method: 'POST', body: { name: form.elements.name.value, parent_id: state.folderId } });
          return data.folder;
        },
      });
      if (created) {
        toast(`Pasta “${created.name}” criada.`, { type: 'success' });
        load();
      }
    }

    async function renameFolder() {
      const folder = currentFolder();
      const renamed = await openFormModal({
        title: 'Renomear pasta',
        body: field({ name: 'name', label: 'Nome da pasta', value: folder.name }),
        onMount: (dialog) => dialog.querySelector('[name="name"]').select(),
        onSubmit: async (form) => {
          const { data } = await api(`/folders/${folder.id}`, { method: 'PATCH', body: { name: form.elements.name.value } });
          return data.folder;
        },
      });
      if (renamed) {
        toast('Pasta renomeada.', { type: 'success' });
        load();
      }
    }

    async function moveFolder() {
      const folder = currentFolder();
      const moved = await openFormModal({
        title: `Mover “${folder.name}”`,
        body: selectField({
          name: 'parent_id',
          label: 'Para dentro de',
          options: folderOptions(folders, { exclude: subtreeIds(folders, folder.id) }),
          value: folder.parent_id ?? '',
          required: false,
        }),
        submitLabel: 'Mover',
        busyLabel: 'Movendo…',
        onSubmit: async (form) => {
          await api(`/folders/${folder.id}/move`, { method: 'POST', body: { parent_id: form.elements.parent_id.value || null } });
          return true;
        },
      });
      if (moved) {
        toast('Pasta movida.', { type: 'success' });
        load();
      }
    }

    async function deleteFolder() {
      const folder = currentFolder();
      const confirmed = await ConfirmDialog.ask({
        title: `Excluir a pasta “${folder.name}”?`,
        message: 'Só pastas vazias podem ser excluídas. Os documentos da lixeira que estavam nela voltam para a raiz se forem restaurados.',
        confirmLabel: 'Excluir pasta',
      });
      if (!confirmed) return;
      try {
        await api(`/folders/${folder.id}`, { method: 'DELETE', body: {} });
        toast('Pasta excluída.', { type: 'success' });
        navigate(folder.parent_id ? `/app/documentos/pasta/${folder.parent_id}` : '/app/documentos', { replace: true });
      } catch (err) {
        toast(err.message, { type: 'error' });
      }
    }

    // ---------- envio ----------
    async function uploadFiles(fileList) {
      const files = [...fileList];
      if (files.length === 0) return;
      const items = files.map((file) => ({ file }));
      const targetFolderId = state.tab === 'pastas' && !state.q ? state.folderId : null;
      setContent(uploads, uploadRows(items));
      uploads.querySelector('[data-upload-target]').textContent = targetFolderId ? (currentFolder()?.name ?? 'pasta atual') : 'Documentos (raiz)';

      let sent = 0;
      for (const [index, item] of items.entries()) {
        const row = uploads.querySelector(`[data-upload="${index}"]`);
        const status = row.querySelector('[data-status]');
        const bar = row.querySelector('progress');
        if (!isAcceptedFile(item.file)) {
          status.textContent = 'Tipo não aceito';
          status.className = 'shrink-0 text-red-700';
          bar.hidden = true;
          continue;
        }
        status.textContent = 'Enviando…';
        try {
          await uploadDocument(item.file, {
            folderId: targetFolderId,
            onProgress: (fraction) => {
              bar.value = fraction;
              status.textContent = fraction < 1 ? `${Math.round(fraction * 100)}%` : 'Conferindo…';
            },
          });
          bar.value = 1;
          status.textContent = 'Enviado';
          status.className = 'shrink-0 text-green-700';
          sent += 1;
        } catch (err) {
          status.textContent = err.message;
          status.className = 'min-w-0 shrink text-right text-red-700';
          bar.hidden = true;
        }
      }
      if (!active) return;
      const failed = items.length - sent;
      toast(
        failed === 0 ? (sent === 1 ? 'Arquivo enviado.' : `${sent} arquivos enviados.`) : `${sent} de ${items.length} enviados. Confira os erros.`,
        { type: failed === 0 ? 'success' : 'error' },
      );
      const close = uploads.querySelector('[data-action="close-uploads"]');
      close.hidden = false;
      close.addEventListener('click', () => setContent(uploads, html``));
      if (failed === 0) setTimeout(() => active && setContent(uploads, html``), 4000);
      load();
    }

    if (manage) {
      const filesInput = root.querySelector('[data-input="files"]');
      const cameraInput = root.querySelector('[data-input="camera"]');
      root.querySelector('[data-action="pick-files"]')?.addEventListener('click', () => filesInput.click());
      root.querySelector('[data-action="take-photo"]')?.addEventListener('click', () => cameraInput.click());
      root.querySelector('[data-action="new-folder"]')?.addEventListener('click', newFolder);
      for (const input of [filesInput, cameraInput].filter(Boolean)) {
        input.addEventListener('change', () => {
          uploadFiles(input.files);
          input.value = '';
        });
      }

      // Arrastar e soltar (desktop): a área da lista inteira recebe os arquivos.
      const dropzone = root.querySelector('[data-dropzone]');
      if (state.tab !== 'lixeira') {
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
    }

    load();
    return () => {
      active = false;
    };
  },
};

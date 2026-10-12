// Detalhe do documento: dados, versões, histórico e ações (abrir, baixar, favoritar, editar,
// nova versão, mover, arquivar, lixeira). Edição com versão do registro: alteração concorrente → 409.
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { expiryBadge, fileIcon, folderOptions, stateBadges } from '../components/documents.js';
import { badge } from '../components/badge.js';
import { field, selectField, textareaField } from '../components/form.js';
import { openFormModal } from '../components/modal.js';
import { errorState, loadingState } from '../components/states.js';
import { toast } from '../components/toast.js';
import { formatBytes, formatCalendarDate, formatDateTime } from '../lib/format.js';
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { api } from '../services/api.js';
import { can } from '../services/tenant.js';
import { ACCEPT_ATTRIBUTE, isAcceptedFile, openDocument, uploadVersion } from '../services/uploads.js';

const FIELD_LABELS = {
  title: 'título',
  description: 'descrição',
  document_type_id: 'tipo',
  expires_on: 'validade',
  tags: 'tags',
  in_use: 'em uso',
  reference_year: 'ano de referência',
};

/** Frase do histórico a partir da ação auditada (sem dado pessoal: só o que mudou). */
function historyText(event) {
  const { details } = event;
  switch (event.action) {
    case 'document.uploaded':
      return 'Enviou o documento';
    case 'document.version_added':
      return `Enviou a versão ${details.version_number}`;
    case 'document.version_restored':
      return `Restaurou a versão ${details.from_version} (virou a versão ${details.version_number})`;
    case 'document.downloaded':
      return `${details.disposition === 'inline' ? 'Abriu' : 'Baixou'} a versão ${details.version_number}`;
    case 'document.updated': {
      const fields = event.changed_fields.map((name) => FIELD_LABELS[name] ?? name);
      return fields.length > 0 ? `Alterou ${fields.join(', ')}` : 'Alterou o documento';
    }
    case 'document.moved':
      return 'Moveu de pasta';
    case 'document.archived':
      return 'Arquivou';
    case 'document.unarchived':
      return 'Desarquivou';
    case 'document.deleted':
      return 'Moveu para a lixeira';
    case 'document.restored':
      return 'Restaurou da lixeira';
    case 'document.previewed':
      return `Viu a prévia da versão ${details.version_number}`;
    case 'spreadsheet.registered':
      return `Entrou em Planilhas (ano ${details.reference_year})`;
    case 'spreadsheet.updated': {
      const fields = event.changed_fields.map((name) => FIELD_LABELS[name] ?? name);
      return `Alterou ${fields.join(', ')} da planilha`;
    }
    default:
      return event.action;
  }
}

function row(label, value) {
  return html`<div class="min-w-0"><dt class="text-sm text-slate-500">${label}</dt>
    <dd class="mt-0.5 break-words text-sm font-medium text-slate-900">${value || html`<span class="text-slate-400">—</span>`}</dd></div>`;
}

function actions(doc, manage) {
  if (doc.deleted_at) {
    return manage
      ? html`<button type="button" class="btn btn-primary btn-sm" data-action="restore">${icon('undo-2', 'size-4')} Restaurar da lixeira</button>`
      : '';
  }
  return html`
    ${doc.file.inline ? html`<button type="button" class="btn btn-primary btn-sm" data-action="open">${icon('external-link', 'size-4')} Abrir</button>` : ''}
    <button type="button" class="btn ${doc.file.inline ? 'btn-secondary' : 'btn-primary'} btn-sm" data-action="download">${icon('download', 'size-4')} Baixar</button>
    <button type="button" class="btn btn-secondary btn-sm" data-action="favorite" aria-pressed="${doc.favorite ? 'true' : 'false'}">
      ${icon('star', doc.favorite ? 'size-4 fill-current text-amber-500' : 'size-4')} ${doc.favorite ? 'Favorito' : 'Favoritar'}</button>
    ${
      manage
        ? html`
          <button type="button" class="btn btn-secondary btn-sm" data-action="edit">${icon('pencil', 'size-4')} Editar</button>
          <button type="button" class="btn btn-secondary btn-sm" data-action="new-version">${icon('upload', 'size-4')} Nova versão</button>
          <button type="button" class="btn btn-secondary btn-sm" data-action="move">${icon('folder-input', 'size-4')} Mover</button>
          <button type="button" class="btn btn-secondary btn-sm" data-action="${doc.archived_at ? 'unarchive' : 'archive'}">
            ${doc.archived_at ? icon('archive-restore', 'size-4') : icon('archive', 'size-4')} ${doc.archived_at ? 'Desarquivar' : 'Arquivar'}</button>
          <button type="button" class="btn btn-ghost btn-sm text-red-700" data-action="trash">${icon('trash-2', 'size-4')} Excluir</button>`
        : ''
    }`;
}

function detailsCard(doc) {
  const folderName = doc.path.length > 0 ? doc.path.map((item) => item.name).join(' › ') : 'Documentos (raiz)';
  return html`<section class="card">
    <h2 class="text-base font-semibold text-slate-900">Detalhes</h2>
    <dl class="mt-4 grid gap-4 sm:grid-cols-2">
      ${row('Pasta', folderName)}
      ${row('Tipo', doc.document_type?.name)}
      ${row('Validade', doc.expires_on ? html`${formatCalendarDate(doc.expires_on)} ${expiryBadge(doc, { short: true })}` : '')}
      ${row('Tags', doc.tags.length > 0 ? html`<span class="flex flex-wrap gap-1">${doc.tags.map((tag) => badge(tag, 'slate'))}</span>` : '')}
      ${row('Arquivo', `${doc.file.original_name} · ${formatBytes(doc.file.size_bytes)}`)}
      ${row('Enviado por', doc.created_by?.name ? `${doc.created_by.name} em ${formatDateTime(doc.created_at)}` : formatDateTime(doc.created_at))}
      <div class="sm:col-span-2">${row('Descrição', doc.description)}</div>
    </dl>
  </section>`;
}

function versionsCard(doc, manage) {
  return html`<section class="card">
    <h2 class="text-base font-semibold text-slate-900">Versões</h2>
    <ol class="mt-4 divide-y divide-slate-100">
      ${doc.versions.map(
        (version) => html`<li class="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0">
            <p class="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">Versão ${version.number}
              ${version.number === doc.current_version ? badge('Atual', 'green') : ''}</p>
            <p class="truncate text-sm text-slate-600">${version.file.original_name} · ${formatBytes(version.file.size_bytes)}</p>
            <p class="text-xs text-slate-500">${version.created_by?.name ?? ''} · ${formatDateTime(version.created_at)}</p>
            ${version.comment ? html`<p class="mt-1 text-sm text-slate-600">${version.comment}</p>` : ''}
          </div>
          ${
            doc.deleted_at
              ? ''
              : html`<div class="flex shrink-0 gap-2">
                  <button type="button" class="btn btn-ghost btn-sm" data-action="download-version" data-version="${version.number}">${icon('download', 'size-4')} Baixar</button>
                  ${
                    manage && version.number !== doc.current_version
                      ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="restore-version" data-version="${version.number}">${icon('rotate-ccw', 'size-4')} Restaurar</button>`
                      : ''
                  }
                </div>`
          }
        </li>`,
      )}
    </ol>
  </section>`;
}

function historyCard() {
  return html`<section class="card">
    <div class="flex items-center justify-between gap-3">
      <h2 class="text-base font-semibold text-slate-900">Histórico</h2>
      <button type="button" class="btn btn-secondary btn-sm" data-action="history">${icon('history', 'size-4')} Ver histórico</button>
    </div>
    <div data-history></div>
  </section>`;
}

/** Erro de campo no formato da API, para o modal mostrar junto do campo. */
function fieldError(name, message) {
  const err = new Error(message);
  err.details = [{ field: name, message }];
  return err;
}

function parseTags(text) {
  return text
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export default {
  title: 'Documento',

  render: () => html`<div data-content>${loadingState()}</div>`,

  mount(root, { params, navigate }) {
    const content = root.querySelector('[data-content]');
    const manage = can('documents.manage');
    let doc;
    let active = true;

    async function load() {
      const first = !doc;
      try {
        const { data } = await api(`/documents/${params.id}`);
        if (!active) return;
        doc = data.document;
        render();
        // O título chega depois do router focar a tela: o leitor de tela anuncia o documento aberto.
        if (first) {
          const heading = content.querySelector('h1');
          heading.setAttribute('tabindex', '-1');
          heading.focus({ preventScroll: true });
        }
      } catch (err) {
        if (!active) return;
        setContent(
          content,
          errorState({
            title: err.status === 404 || err.status === 422 ? 'Documento não encontrado' : 'Não foi possível carregar',
            message: err.status === 404 || err.status === 422 ? 'Ele pode ter sido excluído ou você não tem acesso.' : err.message,
            action: html`<a href="/app/documentos" class="btn btn-secondary btn-sm">Ir para Documentos</a>`,
          }),
        );
      }
    }

    function render() {
      document.title = `${doc.title} · ZEVS Nexus`;
      const parent = doc.path.at(-1);
      setContent(
        content,
        html`
          <a href="${parent ? `/app/documentos/pasta/${parent.id}` : '/app/documentos'}" class="link inline-flex items-center gap-1 text-sm">
            ${icon('chevron-left', 'size-4')} ${parent?.name ?? 'Documentos'}</a>
          <div class="mt-3 flex min-w-0 items-start gap-3">
            <span class="grid size-12 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">${fileIcon(doc.file.extension)}</span>
            <div class="min-w-0">
              <h1 class="text-xl font-bold tracking-tight break-words text-slate-900 sm:text-2xl">${doc.title}</h1>
              <p class="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                <span class="uppercase">${doc.file.extension}</span><span aria-hidden="true">·</span>
                <span>Versão ${doc.current_version}</span>
                ${doc.document_type ? badge(doc.document_type.name, 'primary') : ''}${expiryBadge(doc)}${stateBadges(doc)}
              </p>
            </div>
          </div>
          ${doc.deleted_at ? html`<div class="alert alert-warning mt-4">Este documento está na lixeira.</div>` : ''}
          <div class="mt-4 flex flex-wrap gap-2">${actions(doc, manage)}</div>
          <div class="mt-6 space-y-4">${detailsCard(doc)}${versionsCard(doc, manage)}${historyCard()}</div>`,
      );
      bind();
    }

    function on(action, handler) {
      for (const element of content.querySelectorAll(`[data-action="${action}"]`)) {
        element.addEventListener('click', async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          try {
            await handler(button);
          } catch (err) {
            toast(err.message, { type: 'error' });
          } finally {
            if (button.isConnected) button.disabled = false;
          }
        });
      }
    }

    async function post(path, message) {
      await api(`/documents/${doc.id}${path}`, { method: 'POST', body: {} });
      toast(message, { type: 'success' });
      await load();
    }

    function bind() {
      on('open', () => openDocument(doc.id, { inline: true }));
      on('download', () => openDocument(doc.id));
      on('download-version', (button) => openDocument(doc.id, { version: Number(button.dataset.version) }));
      on('favorite', async () => {
        await api(`/documents/${doc.id}/favorite`, { method: doc.favorite ? 'DELETE' : 'PUT', body: {} });
        doc.favorite = !doc.favorite;
        render();
      });
      on('archive', () => post('/archive', 'Documento arquivado. Ele sai das listas, mas continua guardado.'));
      on('unarchive', () => post('/unarchive', 'Documento desarquivado.'));
      on('restore', async () => {
        await api(`/trash/${doc.id}/restore`, { method: 'POST', body: {} });
        toast('Documento restaurado.', { type: 'success' });
        await load();
      });
      on('trash', async () => {
        const confirmed = await ConfirmDialog.ask({
          title: 'Mover para a lixeira?',
          message: 'O documento sai das listas e pode ser restaurado pela Lixeira.',
          confirmLabel: 'Mover para a lixeira',
        });
        if (!confirmed) return;
        await api(`/documents/${doc.id}`, { method: 'DELETE', body: {} });
        toast('Documento movido para a lixeira.', { type: 'success' });
        const parent = doc.path.at(-1);
        navigate(parent ? `/app/documentos/pasta/${parent.id}` : '/app/documentos', { replace: true });
      });
      on('restore-version', async (button) => {
        const number = Number(button.dataset.version);
        const confirmed = await ConfirmDialog.ask({
          title: `Restaurar a versão ${number}?`,
          message: 'Ela vira a versão atual. As outras continuam no histórico.',
          confirmLabel: 'Restaurar',
          danger: false,
        });
        if (confirmed) await post(`/versions/${number}/restore`, `Versão ${number} restaurada.`);
      });
      on('edit', editDocument);
      on('move', moveDocument);
      on('new-version', newVersion);
      on('history', loadHistory);
    }

    async function editDocument() {
      const { data } = await api('/document-types');
      const types = data.document_types.map((type) => ({ value: type.id, label: type.name }));
      if (doc.document_type && !types.some((type) => type.value === doc.document_type.id)) {
        types.unshift({ value: doc.document_type.id, label: `${doc.document_type.name} (arquivado)` });
      }
      const saved = await openFormModal({
        title: 'Editar documento',
        body: html`
          ${field({ name: 'title', label: 'Título', value: doc.title })}
          ${selectField({ name: 'document_type_id', label: 'Tipo', required: false, placeholder: 'Sem tipo', options: types, value: doc.document_type?.id ?? '' })}
          ${field({ name: 'expires_on', label: 'Validade', type: 'date', required: false, value: doc.expires_on ?? '', hint: 'Para certidões, alvarás e contratos: aparece em “Vencendo”.' })}
          ${field({ name: 'tags', label: 'Tags', required: false, value: doc.tags.join(', '), hint: 'Separe por vírgula. Até 10.' })}
          ${textareaField({ name: 'description', label: 'Descrição', value: doc.description ?? '', maxlength: 2000 })}`,
        onSubmit: async (form) => {
          const values = form.elements;
          const { data: result } = await api(`/documents/${doc.id}`, {
            method: 'PATCH',
            body: {
              version: doc.version,
              title: values.title.value,
              description: values.description.value,
              document_type_id: values.document_type_id.value || null,
              expires_on: values.expires_on.value || null,
              tags: parseTags(values.tags.value),
            },
          });
          return result.document;
        },
      });
      if (saved) {
        toast('Documento salvo.', { type: 'success' });
        await load();
      }
    }

    async function moveDocument() {
      const { data } = await api('/folders');
      const moved = await openFormModal({
        title: 'Mover documento',
        body: selectField({ name: 'folder_id', label: 'Pasta', required: false, options: folderOptions(data.folders), value: doc.folder_id ?? '' }),
        submitLabel: 'Mover',
        busyLabel: 'Movendo…',
        onSubmit: async (form) => {
          await api(`/documents/${doc.id}/move`, { method: 'POST', body: { folder_id: form.elements.folder_id.value || null } });
          return true;
        },
      });
      if (moved) {
        toast('Documento movido.', { type: 'success' });
        await load();
      }
    }

    async function newVersion() {
      const saved = await openFormModal({
        title: 'Enviar nova versão',
        submitLabel: 'Enviar',
        busyLabel: 'Enviando…',
        body: html`
          <div class="field">
            <label for="f-file" class="label">Arquivo</label>
            <input id="f-file" name="file" type="file" class="input h-auto py-2" accept="${ACCEPT_ATTRIBUTE}" required aria-describedby="f-file-error">
            <p id="f-file-error" class="field-error" hidden></p>
          </div>
          ${textareaField({ name: 'comment', label: 'O que mudou? (opcional)', maxlength: 500 })}
          <progress class="h-1.5 w-full overflow-hidden rounded-full accent-primary" max="1" value="0" hidden data-progress></progress>`,
        onSubmit: async (form) => {
          const file = form.elements.file.files[0];
          if (!file) throw fieldError('file', 'Escolha o arquivo.');
          if (!isAcceptedFile(file)) throw fieldError('file', 'Tipo de arquivo não aceito.');
          const progress = form.querySelector('[data-progress]');
          progress.hidden = false;
          return uploadVersion(doc.id, file, {
            comment: form.elements.comment.value.trim() || null,
            onProgress: (fraction) => {
              progress.value = fraction;
            },
          });
        },
      });
      if (saved) {
        toast(`Versão ${saved.current_version} enviada.`, { type: 'success' });
        await load();
      }
    }

    async function loadHistory(button) {
      const slot = content.querySelector('[data-history]');
      setContent(slot, loadingState());
      const { data } = await api(`/documents/${doc.id}/history`);
      button.hidden = true;
      setContent(
        slot,
        html`<ol class="mt-4 space-y-3">
          ${data.events.map(
            (event) => html`<li class="flex items-start gap-3 text-sm">
              ${icon('clock', 'mt-0.5 size-4 shrink-0 text-slate-400')}
              <span class="min-w-0"><span class="text-slate-900">${historyText(event)}</span>
                <span class="block text-xs text-slate-500">${event.actor?.name ?? 'Sistema'} · ${formatDateTime(event.created_at)}</span></span>
            </li>`,
          )}
        </ol>`,
      );
    }

    load();
    return () => {
      active = false;
    };
  },
};

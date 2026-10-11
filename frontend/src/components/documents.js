// Peças da Central de Documentos reaproveitadas na lista, no detalhe, no Início e na Empresa.
import { html } from '../lib/html.js';
import { formatBytes, formatCalendarDate, formatDate } from '../lib/format.js';
import { icon } from '../lib/icons.js';
import { badge } from './badge.js';

const SPREADSHEETS = ['xlsx', 'xls', 'ods', 'csv'];
const IMAGES = ['jpg', 'jpeg', 'png', 'webp'];

/** Ícone pelo formato (os nomes ficam literais para o build do sprite). */
export function fileIcon(extension) {
  if (IMAGES.includes(extension)) return icon('file-image');
  if (SPREADSHEETS.includes(extension)) return icon('file-spreadsheet');
  if (extension === 'xml') return icon('file-code');
  if (['pdf', 'doc', 'docx', 'odt', 'txt'].includes(extension)) return icon('file-text');
  return icon('file');
}

/** "Vencido" e "Vence em" vêm calculados pelo backend no fuso da empresa (expiry_status). */
export function expiryBadge(doc, { short = false } = {}) {
  const date = formatCalendarDate(doc.expires_on);
  if (doc.expiry_status === 'expired') return badge(short ? 'Vencido' : `Vencido em ${date}`, 'red');
  if (doc.expiry_status === 'expiring') return badge(short ? 'Vence em breve' : `Vence em ${date}`, 'amber');
  return '';
}

export function stateBadges(doc) {
  return html`${doc.deleted_at ? badge('Na lixeira', 'red') : ''}${doc.archived_at ? badge('Arquivado', 'slate') : ''}`;
}

/** Linha da lista: cartão no celular, linha compacta no desktop. */
export function documentRow(doc, { trash = false, manage = false, actions = true } = {}) {
  return html`<li class="flex items-center gap-1 rounded-xl border border-slate-200 bg-white pr-1 shadow-xs sm:border-0 sm:bg-transparent sm:shadow-none sm:hover:bg-slate-50">
    <a href="/app/documentos/${doc.id}" class="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-3" data-document="${doc.id}">
      <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">${fileIcon(doc.file.extension)}</span>
      <span class="min-w-0 flex-1">
        <span class="block truncate font-medium text-slate-900">${doc.title}</span>
        <span class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          <span class="uppercase">${doc.file.extension}</span>
          <span aria-hidden="true">·</span><span>${formatBytes(doc.file.size_bytes)}</span>
          <span aria-hidden="true">·</span><span>${formatDate(doc.updated_at)}</span>
          ${doc.current_version > 1 ? html`<span aria-hidden="true">·</span><span>v${doc.current_version}</span>` : ''}
          ${doc.document_type ? badge(doc.document_type.name, 'primary') : ''}
          ${expiryBadge(doc)}${stateBadges(doc)}
          ${doc.tags.slice(0, 3).map((tag) => badge(tag, 'slate'))}
        </span>
      </span>
    </a>
    ${
      !actions
        ? ''
        : trash
          ? manage
            ? html`<button type="button" class="btn btn-secondary btn-sm shrink-0" data-action="restore" data-id="${doc.id}">${icon('undo-2', 'size-4')}<span class="hidden sm:inline">Restaurar</span></button>`
            : ''
          : html`<button type="button" class="btn btn-ghost btn-sm size-11 shrink-0 p-0 ${doc.favorite ? 'text-amber-500' : 'text-slate-400'}"
            data-action="favorite" data-id="${doc.id}" aria-pressed="${doc.favorite ? 'true' : 'false'}"
            aria-label="${doc.favorite ? 'Tirar dos favoritos' : 'Favoritar'}: ${doc.title}">${icon('star', doc.favorite ? 'size-5 fill-current' : 'size-5')}</button>`
    }
  </li>`;
}

export function documentList(documents, options) {
  return html`<ul class="space-y-2 sm:space-y-0 sm:divide-y sm:divide-slate-100 sm:rounded-2xl sm:border sm:border-slate-200 sm:bg-white sm:p-1 sm:shadow-sm">
    ${documents.map((doc) => documentRow(doc, options))}
  </ul>`;
}

/**
 * Árvore a partir da lista plana: [{ ...folder, depth, path }] na ordem de exibição (pai antes dos
 * filhos, irmãos por nome).
 */
export function folderTree(folders) {
  const children = new Map();
  for (const folder of folders) {
    const key = folder.parent_id ?? 'root';
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(folder);
  }
  const result = [];
  const walk = (parentKey, depth, path) => {
    for (const folder of children.get(parentKey) ?? []) {
      const itemPath = [...path, folder.name];
      result.push({ ...folder, depth, path: itemPath });
      walk(folder.id, depth + 1, itemPath);
    }
  };
  walk('root', 0, []);
  return result;
}

/** Ids da pasta e de todas as subpastas (não dá para mover uma pasta para dentro delas). */
export function subtreeIds(folders, rootId) {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parent_id && ids.has(folder.parent_id) && !ids.has(folder.id)) {
        ids.add(folder.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Recuo por nível no <select> de pasta: espaço inseparável (o <option> descarta espaço comum). */
const INDENT = String.fromCharCode(0xa0).repeat(3);

/** Opções de <select> de pasta, com recuo por nível e a raiz no topo. */
export function folderOptions(folders, { exclude = new Set() } = {}) {
  return [
    { value: '', label: 'Documentos (raiz)' },
    ...folderTree(folders)
      .filter((folder) => !exclude.has(folder.id))
      .map((folder) => ({ value: folder.id, label: `${INDENT.repeat(folder.depth + 1)}${folder.name}` })),
  ];
}

export function folderCard(folder) {
  return html`<li>
    <a href="/app/documentos/pasta/${folder.id}" class="flex min-h-14 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-xs hover:border-primary/40 hover:bg-primary/5">
      <span class="text-primary">${icon('folder', 'size-6')}</span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-medium text-slate-900">${folder.name}</span>
        <span class="block text-xs text-slate-500">${folder.document_count === 1 ? '1 documento' : `${folder.document_count} documentos`}</span>
      </span>
      ${icon('chevron-right', 'size-4 shrink-0 text-slate-400')}
    </a>
  </li>`;
}

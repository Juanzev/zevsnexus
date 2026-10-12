// Detalhe da planilha (níveis 1 e 2): em uso, ano de referência, arquivar, baixar e a prévia somente
// leitura com abas e páginas de 50 linhas. Fórmulas aparecem com o último valor salvo no arquivo.
// XLS legado e arquivo acima de 10 MB não têm prévia: só download.
import { fileIcon } from '../components/documents.js';
import { askYear, previewTable, spreadsheetBadges } from '../components/spreadsheets.js';
import { errorState, loadingState } from '../components/states.js';
import { toast } from '../components/toast.js';
import { formatBytes, formatDateTime } from '../lib/format.js';
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { api } from '../services/api.js';
import { can } from '../services/tenant.js';
import { openDocument } from '../services/uploads.js';

const ENCODINGS = { 'utf-8': 'UTF-8', 'utf-16le': 'UTF-16', 'utf-16be': 'UTF-16', 'windows-1252': 'Windows-1252 (ANSI)' };
const DELIMITERS = { ';': 'ponto e vírgula', ',': 'vírgula', tab: 'tabulação', '|': 'barra vertical' };

function noPreviewMessage(sheet) {
  return sheet.file.extension === 'xls'
    ? 'Planilhas .xls (formato antigo do Excel) não têm prévia. Baixe o arquivo para abrir no seu programa.'
    : 'Planilha grande demais para visualizar aqui (mais de 10 MB). Baixe o arquivo para abrir no seu programa.';
}

function notice(text) {
  return html`<p class="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">${icon('info', 'mt-0.5 size-4 shrink-0')}<span>${text}</span></p>`;
}

function downloadBox(message) {
  return html`<div class="state">
    ${icon('file-spreadsheet', 'size-8 text-slate-400')}
    <p class="max-w-md">${message}</p>
    <button type="button" class="btn btn-primary btn-sm" data-action="download">${icon('download', 'size-4')} Baixar planilha</button>
  </div>`;
}

function actions(sheet, { manage, documents }) {
  return html`
    <button type="button" class="btn btn-primary btn-sm" data-action="download">${icon('download', 'size-4')} Baixar</button>
    ${
      manage
        ? html`
          ${
            sheet.archived_at
              ? ''
              : html`<button type="button" class="btn btn-secondary btn-sm ${sheet.in_use ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100' : ''}"
                  data-action="toggle-in-use" aria-pressed="${sheet.in_use ? 'true' : 'false'}" title="${sheet.in_use ? 'Toque para tirar de uso' : ''}">
                  ${icon('pin', sheet.in_use ? 'size-4 fill-current text-emerald-600' : 'size-4')} ${sheet.in_use ? 'Em uso' : 'Marcar em uso'}</button>`
          }
          <button type="button" class="btn btn-secondary btn-sm" data-action="year">${icon('calendar-clock', 'size-4')} Mudar o ano</button>
          <button type="button" class="btn btn-secondary btn-sm" data-action="${sheet.archived_at ? 'unarchive' : 'archive'}">
            ${sheet.archived_at ? icon('archive-restore', 'size-4') : icon('archive', 'size-4')} ${sheet.archived_at ? 'Desarquivar' : 'Arquivar'}</button>`
        : ''
    }
    ${documents ? html`<a href="/app/documentos/${sheet.id}" class="btn btn-ghost btn-sm">${icon('folder-open', 'size-4')} Ver na Central de Documentos</a>` : ''}`;
}

function sheetTabs(sheets, current) {
  if (sheets.length < 2) return '';
  return html`<div class="tabs" role="tablist" aria-label="Abas da planilha">
    ${sheets.map(
      (item) => html`<button type="button" role="tab" class="tab" data-sheet="${item.index}" aria-selected="${item.index === current ? 'true' : 'false'}">
        ${item.name}${item.hidden ? ' (oculta)' : ''}</button>`,
    )}
  </div>`;
}

function rowsLabel(sheet) {
  if (sheet.rows.length === 0) return sheet.total_rows === 0 ? 'Aba vazia' : 'Sem linhas nesta página';
  const first = sheet.rows[0].number;
  const last = sheet.rows.at(-1).number;
  return `Linhas ${first.toLocaleString('pt-BR')}–${last.toLocaleString('pt-BR')} de ${sheet.total_rows.toLocaleString('pt-BR')}`;
}

function previewPager(sheet) {
  const pages = Math.max(1, Math.ceil(sheet.total_rows / sheet.page_size));
  return html`<div class="flex flex-wrap items-center justify-between gap-3">
    <p class="text-sm text-slate-600" aria-live="polite">${rowsLabel(sheet)}</p>
    ${
      pages > 1
        ? html`<div class="flex items-center gap-2">
            <button type="button" class="btn btn-secondary btn-sm" data-page="${sheet.page - 1}" ${sheet.page <= 1 ? html`disabled` : ''}>${icon('chevron-left', 'size-4')} Anterior</button>
            <span class="text-sm text-slate-600">${sheet.page} de ${pages}</span>
            <button type="button" class="btn btn-secondary btn-sm" data-page="${sheet.page + 1}" ${sheet.page >= pages ? html`disabled` : ''}>Próxima ${icon('chevron-right', 'size-4')}</button>
          </div>`
        : ''
    }
  </div>`;
}

function previewBody(preview) {
  const { sheet } = preview;
  return html`
    ${sheetTabs(preview.sheets, sheet.index)}
    <div class="mt-3 space-y-3">
      ${preview.csv ? html`<p class="text-xs text-slate-500">CSV · ${ENCODINGS[preview.csv.encoding] ?? preview.csv.encoding} · separado por ${DELIMITERS[preview.csv.delimiter] ?? preview.csv.delimiter}</p>` : ''}
      ${sheet.truncated_rows ? notice('A prévia lê até 100.000 linhas por aba. Baixe o arquivo para ver o restante.') : ''}
      ${sheet.truncated_columns ? notice('Só as primeiras 200 colunas aparecem aqui. Baixe o arquivo para ver todas.') : ''}
      ${previewPager(sheet)}
      ${sheet.rows.length > 0 ? previewTable(sheet, { label: `Prévia da aba ${sheet.name}` }) : ''}
    </div>`;
}

export default {
  title: 'Planilha',

  render: () => html`<div data-content>${loadingState()}</div>`,

  mount(root, { params }) {
    const content = root.querySelector('[data-content]');
    const manage = can('spreadsheets.manage');
    const documents = can('documents.view');
    let sheet;
    let preview = null;
    let active = true;

    async function load() {
      const first = !sheet;
      try {
        const { data } = await api(`/spreadsheets/${params.id}`);
        if (!active) return;
        sheet = data.spreadsheet;
        render();
        if (first) {
          const heading = content.querySelector('h1');
          heading.setAttribute('tabindex', '-1');
          heading.focus({ preventScroll: true });
          if (sheet.file.previewable) loadPreview({});
        }
      } catch (err) {
        if (!active) return;
        const missing = err.status === 404 || err.status === 422;
        setContent(
          content,
          errorState({
            title: missing ? 'Planilha não encontrada' : 'Não foi possível carregar',
            message: missing ? 'Ela pode ter sido excluída ou você não tem acesso.' : err.message,
            action: html`<a href="/app/planilhas" class="btn btn-secondary btn-sm">Ir para Planilhas</a>`,
          }),
        );
      }
    }

    function render() {
      document.title = `${sheet.title} · ZEVS Nexus`;
      setContent(
        content,
        html`
          <a href="/app/planilhas" class="link inline-flex items-center gap-1 text-sm">${icon('chevron-left', 'size-4')} Planilhas</a>
          <div class="mt-3 flex items-start gap-3">
            <span class="grid size-12 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">${fileIcon(sheet.file.extension)}</span>
            <div class="min-w-0 flex-1">
              <h1 class="text-2xl font-bold tracking-tight break-words text-slate-900">${sheet.title}</h1>
              <p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
                ${spreadsheetBadges(sheet)}
                <span class="min-w-0 break-all">${sheet.file.original_name}</span>
                <span aria-hidden="true">·</span><span>${formatBytes(sheet.file.size_bytes)}</span>
                ${sheet.current_version > 1 ? html`<span aria-hidden="true">·</span><span>versão ${sheet.current_version}</span>` : ''}
                <span aria-hidden="true">·</span><span>alterada em ${formatDateTime(sheet.updated_at)}</span>
              </p>
            </div>
          </div>
          <div class="mt-4 flex flex-wrap gap-2" data-actions>${actions(sheet, { manage, documents })}</div>
          <section class="card mt-6 min-w-0 p-4 sm:p-6" aria-labelledby="titulo-previa">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="titulo-previa" class="text-base font-semibold text-slate-900">Prévia</h2>
              <p class="text-xs text-slate-500">Somente leitura · fórmulas mostram o último valor salvo no arquivo</p>
            </div>
            <div class="mt-4 min-w-0" data-preview>
              ${sheet.file.previewable ? (preview ? previewBody(preview) : loadingState('Lendo a planilha…')) : downloadBox(noPreviewMessage(sheet))}
            </div>
          </section>`,
      );
      bindActions();
      bindPreview();
    }

    // ---------- prévia ----------
    async function loadPreview({ sheetIndex, page = 1 }) {
      const box = content.querySelector('[data-preview]');
      const search = new URLSearchParams({ page: String(page) });
      // Sem aba escolhida = abertura da prévia (é o que o backend audita).
      if (sheetIndex !== undefined) search.set('sheet', String(sheetIndex));
      if (preview) box.setAttribute('aria-busy', 'true');
      else setContent(box, loadingState('Lendo a planilha…'));
      try {
        const { data } = await api(`/spreadsheets/${params.id}/preview?${search}`);
        if (!active) return;
        preview = data;
        setContent(box, previewBody(preview));
        box.removeAttribute('aria-busy');
        bindPreview();
      } catch (err) {
        if (!active) return;
        box.removeAttribute('aria-busy');
        preview = null;
        setContent(
          box,
          ['SPREADSHEET_TOO_LARGE', 'SPREADSHEET_UNREADABLE', 'PREVIEW_NOT_SUPPORTED'].includes(err.code)
            ? downloadBox(err.message)
            : errorState({ message: err.message, action: html`<button type="button" class="btn btn-secondary btn-sm" data-action="retry-preview">Tentar de novo</button>` }),
        );
        box.querySelector('[data-action="download"]')?.addEventListener('click', download);
        box.querySelector('[data-action="retry-preview"]')?.addEventListener('click', () => loadPreview({ sheetIndex, page }));
      }
    }

    function bindPreview() {
      const box = content.querySelector('[data-preview]');
      for (const tab of box.querySelectorAll('[data-sheet]')) {
        tab.addEventListener('click', () => {
          const index = Number(tab.dataset.sheet);
          if (index !== preview.sheet.index) loadPreview({ sheetIndex: index });
        });
      }
      for (const button of box.querySelectorAll('[data-page]')) {
        button.addEventListener('click', async () => {
          await loadPreview({ sheetIndex: preview.sheet.index, page: Number(button.dataset.page) });
          content.querySelector('[data-preview-scroll]')?.scrollTo({ top: 0 });
        });
      }
      box.querySelector('[data-action="download"]')?.addEventListener('click', download);
    }

    // ---------- ações ----------
    async function download() {
      try {
        await openDocument(sheet.id);
      } catch (err) {
        toast(err.message, { type: 'error' });
      }
    }

    async function patch(body, message) {
      try {
        const { data } = await api(`/spreadsheets/${sheet.id}`, { method: 'PATCH', body });
        sheet = data.spreadsheet;
        toast(message, { type: 'success' });
        render();
      } catch (err) {
        toast(err.message, { type: 'error' });
      }
    }

    async function setArchived(action) {
      try {
        const { data } = await api('/spreadsheets/bulk', { method: 'POST', body: { ids: [sheet.id], action } });
        if (data.updated === 0) throw new Error('Planilha não encontrada. Ela pode ter sido excluída.');
        toast(action === 'archive' ? 'Planilha arquivada.' : 'Planilha desarquivada.', { type: 'success' });
        await load();
      } catch (err) {
        toast(err.message, { type: 'error' });
      }
    }

    function bindActions() {
      content.querySelector('[data-actions] [data-action="download"]').addEventListener('click', download);
      content.querySelector('[data-action="toggle-in-use"]')?.addEventListener('click', () =>
        patch({ in_use: !sheet.in_use }, sheet.in_use ? 'Planilha tirada de uso.' : 'Planilha marcada como em uso.'),
      );
      content.querySelector('[data-action="year"]')?.addEventListener('click', async () => {
        const year = await askYear({ title: 'Mudar o ano da planilha', value: sheet.reference_year });
        if (year && year !== sheet.reference_year) patch({ reference_year: year }, `Ano alterado para ${year}.`);
      });
      content.querySelector('[data-action="archive"]')?.addEventListener('click', () => setArchived('archive'));
      content.querySelector('[data-action="unarchive"]')?.addEventListener('click', () => setArchived('unarchive'));
    }

    load();
    return () => {
      active = false;
    };
  },
};

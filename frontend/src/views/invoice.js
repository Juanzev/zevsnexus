// Detalhe da nota: valores, recebimento, dados, anexos (PDF, XML, comprovante), histórico e as ações de
// cada estado (emitir, receber, desfazer recebimento, cancelar, arquivar). As regras são do backend; a
// tela só mostra o botão que faz sentido no estado atual.
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { fileIcon } from '../components/documents.js';
import { labelOf, openAttachForm, openReasonForm } from '../components/finance.js';
import {
  INVOICE_ATTACHMENT_ROLES,
  INVOICE_KINDS,
  invoiceStatusBadges,
  invoiceTitle,
  openInvoiceForm,
  openIssueForm,
  openMarkPaidForm,
} from '../components/invoices.js';
import { errorState, loadingState } from '../components/states.js';
import { toast } from '../components/toast.js';
import { formatBytes, formatCalendarDate, formatDateTime } from '../lib/format.js';
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { formatCents } from '../lib/money.js';
import { api, newIdempotencyKey } from '../services/api.js';
import { can } from '../services/tenant.js';
import { openDocument } from '../services/uploads.js';

const FIELD_LABELS = {
  kind: 'tipo',
  number: 'número',
  series: 'série',
  issue_date: 'data de emissão',
  competence: 'competência',
  party_id: 'tomador',
  description: 'descrição',
  gross_amount_cents: 'valor bruto',
  withheld_cents: 'retenções',
  due_date: 'vencimento',
  verification_code: 'código de verificação',
  notes: 'observações',
};

const HISTORY = {
  'invoice.created': () => 'Registrou a nota',
  'invoice.updated': (event) => `Alterou ${event.changed_fields.map((name) => FIELD_LABELS[name] ?? name).join(', ') || 'a nota'}`,
  'invoice.issued': (event) => `Marcou como emitida (nº ${event.details.number}, ${formatCalendarDate(event.details.issue_date)})`,
  'invoice.paid': (event) => `Registrou o recebimento de ${formatCents(event.details.received_amount_cents)} em ${formatCalendarDate(event.details.received_on)}`,
  'invoice.unpaid': (event) => `Desfez o recebimento de ${formatCents(event.details.received_amount_cents)}`,
  'invoice.cancelled': () => 'Cancelou a nota',
  'invoice.archived': () => 'Arquivou',
  'invoice.unarchived': () => 'Desarquivou',
  'invoice.document_linked': (event) => `Anexou ${labelOf(INVOICE_ATTACHMENT_ROLES, event.details.role).toLowerCase()}`,
  'invoice.document_unlinked': (event) => `Removeu ${labelOf(INVOICE_ATTACHMENT_ROLES, event.details.role).toLowerCase()}`,
};

/** "2026-09" → "09/2026". */
function formatCompetence(value) {
  return value ? `${value.slice(5, 7)}/${value.slice(0, 4)}` : '';
}

function row(label, value) {
  return html`<div class="min-w-0"><dt class="text-sm text-slate-500">${label}</dt>
    <dd class="mt-0.5 break-words text-sm font-medium text-slate-900">${value || html`<span class="text-slate-400">—</span>`}</dd></div>`;
}

function summaryCard(invoice) {
  return html`<section class="grid grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
    <div class="min-w-0"><p class="text-xs text-slate-500">Bruto</p><p class="truncate text-lg font-bold tabular-nums">${formatCents(invoice.gross_amount_cents)}</p></div>
    <div class="min-w-0"><p class="text-xs text-slate-500">Retenções</p><p class="truncate text-lg font-bold text-slate-700 tabular-nums">${formatCents(invoice.withheld_cents)}</p></div>
    <div class="min-w-0"><p class="text-xs text-slate-500">Líquido</p><p class="truncate text-lg font-bold text-primary tabular-nums">${formatCents(invoice.net_amount_cents)}</p></div>
  </section>`;
}

function receiptCard(invoice) {
  if (invoice.status !== 'issued') return '';
  return html`<section class="card">
    <h2 class="text-base font-semibold text-slate-900">Recebimento</h2>
    ${
      invoice.finalized
        ? html`<p class="mt-3 flex items-center gap-2 text-sm text-green-800">${icon('circle-check', 'size-5 text-green-600')}
            Recebido ${formatCents(invoice.received_amount_cents)} em ${formatCalendarDate(invoice.received_on)}.</p>`
        : html`<p class="mt-3 text-sm text-slate-600">${
            invoice.due_date
              ? `${invoice.overdue ? 'Venceu' : 'Vence'} em ${formatCalendarDate(invoice.due_date)}. Ainda não recebida.`
              : 'Ainda não recebida.'
          }</p>`
    }
    ${
      invoice.payment_undone_at
        ? html`<p class="mt-2 text-xs text-slate-500">Recebimento desfeito em ${formatDateTime(invoice.payment_undone_at)}: ${invoice.payment_undo_reason}</p>`
        : ''
    }
  </section>`;
}

function detailsCard(invoice) {
  return html`<section class="card">
    <h2 class="text-base font-semibold text-slate-900">Dados da nota</h2>
    <dl class="mt-4 grid gap-4 sm:grid-cols-2">
      ${row('Tipo', labelOf(INVOICE_KINDS, invoice.kind))}
      ${row('Número e série', invoice.number ? `${invoice.number}${invoice.series ? ` · série ${invoice.series}` : ''}` : '')}
      ${row('Emissão', formatCalendarDate(invoice.issue_date))}
      ${row('Competência', formatCompetence(invoice.competence))}
      ${row('Tomador', invoice.party && html`<a href="/app/prestadores/${invoice.party.id}" class="link">${invoice.party.name}</a>`)}
      ${row('Vencimento', formatCalendarDate(invoice.due_date))}
      ${row('Código de verificação ou chave', invoice.verification_code && html`<span class="break-all">${invoice.verification_code}</span>`)}
      ${invoice.cancelled_at ? row('Motivo do cancelamento', invoice.cancel_reason) : ''}
      <div class="sm:col-span-2">${row('Descrição', html`<span class="whitespace-pre-line">${invoice.description}</span>`)}</div>
      <div class="sm:col-span-2">${row('Observações', invoice.notes)}</div>
    </dl>
  </section>`;
}

function attachmentsCard(invoice, manage) {
  return html`<section class="card">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-base font-semibold text-slate-900">Arquivos</h2>
      ${manage ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="attach">${icon('paperclip', 'size-4')} Anexar</button>` : ''}
    </div>
    ${
      invoice.documents.length === 0
        ? html`<p class="mt-3 text-sm text-slate-600">Anexe o PDF e o XML da nota e, quando receber, o comprovante. Eles ficam na pasta "Notas fiscais" da Central.</p>`
        : html`<ul class="mt-4 divide-y divide-slate-100">
          ${invoice.documents.map(
            (doc) => html`<li class="flex items-center gap-3 py-2">
              <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">${fileIcon(doc.extension)}</span>
              <a href="/app/documentos/${doc.document_id}" class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium text-slate-900">${doc.title}</span>
                <span class="block text-xs text-slate-500">${labelOf(INVOICE_ATTACHMENT_ROLES, doc.role)} · ${formatBytes(doc.size_bytes)}</span>
              </a>
              <button type="button" class="btn btn-ghost btn-sm" data-action="open-document" data-id="${doc.document_id}" aria-label="Baixar ${doc.title}">${icon('download', 'size-4')}</button>
              ${manage ? html`<button type="button" class="btn btn-ghost btn-sm text-red-700" data-action="unlink" data-id="${doc.document_id}" aria-label="Desvincular ${doc.title}">${icon('x', 'size-4')}</button>` : ''}
            </li>`,
          )}
        </ul>`
    }
  </section>`;
}

function actions(invoice, manage) {
  if (!manage) return '';
  const { status } = invoice;
  const pending = invoice.payment_status === 'pending';
  return html`
    ${status === 'processing' ? html`<button type="button" class="btn btn-primary btn-sm" data-action="issue">${icon('check', 'size-4')} Marcar emitida</button>` : ''}
    ${status === 'issued' && pending ? html`<button type="button" class="btn btn-primary btn-sm" data-action="mark-paid">${icon('circle-check', 'size-4')} Registrar recebimento</button>` : ''}
    ${status !== 'cancelled' ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="edit">${icon('pencil', 'size-4')} Editar</button>` : ''}
    ${!pending ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="unmark-paid">${icon('undo-2', 'size-4')} Desfazer recebimento</button>` : ''}
    <button type="button" class="btn btn-secondary btn-sm" data-action="${invoice.archived_at ? 'unarchive' : 'archive'}">
      ${invoice.archived_at ? icon('archive-restore', 'size-4') : icon('archive', 'size-4')} ${invoice.archived_at ? 'Desarquivar' : 'Arquivar'}</button>
    ${status !== 'cancelled' && pending ? html`<button type="button" class="btn btn-ghost btn-sm text-red-700" data-action="cancel">${icon('ban', 'size-4')} Cancelar nota</button>` : ''}`;
}

export default {
  title: 'Nota fiscal',

  render: () => html`<div data-content>${loadingState()}</div>`,

  mount(root, { params }) {
    const content = root.querySelector('[data-content]');
    const canManage = can('invoices.manage');
    let invoice;
    let active = true;

    async function load(first = false) {
      try {
        const { data } = await api(`/invoices/${params.id}`);
        if (!active) return;
        invoice = data.invoice;
        render();
        if (first) {
          const heading = content.querySelector('h1');
          heading.setAttribute('tabindex', '-1');
          heading.focus({ preventScroll: true });
        }
      } catch (err) {
        if (!active) return;
        const missing = err.status === 404 || err.status === 422;
        setContent(
          content,
          errorState({
            title: missing ? 'Nota não encontrada' : 'Não foi possível carregar',
            message: missing ? 'Ela pode ter sido removida ou você não tem acesso.' : err.message,
            action: html`<a href="/app/notas" class="btn btn-secondary btn-sm">Ir para Notas fiscais</a>`,
          }),
        );
      }
    }

    function render() {
      document.title = `${invoiceTitle(invoice)} · ZEVS Nexus`;
      const manageFiles = canManage && invoice.status !== 'cancelled';
      setContent(
        content,
        html`
          <a href="/app/notas" class="link inline-flex items-center gap-1 text-sm">${icon('chevron-left', 'size-4')} Notas fiscais</a>
          <div class="mt-3 min-w-0">
            <h1 class="text-xl font-bold tracking-tight break-words text-slate-900 sm:text-2xl">${invoiceTitle(invoice)}</h1>
            <p class="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
              ${invoiceStatusBadges(invoice)}${invoice.party ? html`<span class="min-w-0 break-words">${invoice.party.name}</span>` : ''}
            </p>
          </div>
          <div class="mt-4 flex flex-wrap gap-2">${actions(invoice, canManage)}</div>
          <div class="mt-4 space-y-4">
            ${summaryCard(invoice)}${receiptCard(invoice)}${detailsCard(invoice)}${attachmentsCard(invoice, manageFiles)}
            <section class="card">
              <div class="flex items-center justify-between gap-3">
                <h2 class="text-base font-semibold text-slate-900">Histórico</h2>
                <button type="button" class="btn btn-secondary btn-sm" data-action="history">${icon('history', 'size-4')} Ver histórico</button>
              </div>
              <div data-history></div>
            </section>
          </div>`,
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

    /** Abre o modal; se salvou, avisa e recarrega. */
    async function step(open, message) {
      const saved = await open();
      if (!saved) return;
      toast(typeof message === 'function' ? message(saved) : message, { type: 'success' });
      await load();
    }

    function bind() {
      on('issue', () => step(() => openIssueForm(invoice), 'Nota marcada como emitida.'));
      on('mark-paid', () => step(() => openMarkPaidForm(invoice), 'Recebimento registrado. Nota finalizada.'));
      on('edit', () => step(() => openInvoiceForm({ invoice }), 'Nota salva.'));
      on('unmark-paid', () =>
        step(
          () =>
            openReasonForm({
              title: 'Desfazer o recebimento?',
              message: 'A nota volta para "Pendentes". O recebimento desfeito fica no histórico, com o motivo.',
              submitLabel: 'Desfazer recebimento',
              onSubmit: async (reason) => (await api(`/invoices/${invoice.id}/unmark-paid`, { method: 'POST', body: { reason } })).data.invoice,
            }),
          'Recebimento desfeito.',
        ),
      );
      on('cancel', () =>
        step(
          () =>
            openReasonForm({
              title: 'Cancelar a nota?',
              message: 'Registre aqui o cancelamento feito na prefeitura ou na Sefaz. A nota continua no histórico e o número segue ocupado. Não dá para desfazer.',
              submitLabel: 'Cancelar nota',
              onSubmit: async (reason) => (await api(`/invoices/${invoice.id}/cancel`, { method: 'POST', body: { reason } })).data.invoice,
            }),
          'Nota cancelada.',
        ),
      );
      on('archive', async () => {
        await api(`/invoices/${invoice.id}/archive`, { method: 'POST', body: {} });
        toast('Nota arquivada.', { type: 'success' });
        await load();
      });
      on('unarchive', async () => {
        await api(`/invoices/${invoice.id}/unarchive`, { method: 'POST', body: {} });
        toast('Nota desarquivada.', { type: 'success' });
        await load();
      });
      on('attach', () =>
        step(
          () =>
            openAttachForm({
              title: 'Anexar à nota',
              withRole: true,
              roles: INVOICE_ATTACHMENT_ROLES,
              role: invoice.has_pdf ? 'xml' : 'pdf',
              onSubmit: async ({ fileId, role }) =>
                (
                  await api(`/invoices/${invoice.id}/documents`, {
                    method: 'POST',
                    body: { file_id: fileId, role },
                    idempotencyKey: newIdempotencyKey(),
                  })
                ).data.invoice,
            }),
          'Arquivo anexado.',
        ),
      );
      on('unlink', async (button) => {
        const confirmed = await ConfirmDialog.ask({
          title: 'Desvincular este arquivo?',
          message: 'Ele deixa de aparecer nesta nota, mas continua na Central de Documentos.',
          confirmLabel: 'Desvincular',
        });
        if (!confirmed) return;
        await api(`/invoices/${invoice.id}/documents/${button.dataset.id}`, { method: 'DELETE', body: {} });
        toast('Arquivo desvinculado.', { type: 'success' });
        await load();
      });
      on('open-document', (button) => openDocument(button.dataset.id, { inline: true }));
      on('history', async (button) => {
        const slot = content.querySelector('[data-history]');
        setContent(slot, loadingState());
        const { data } = await api(`/invoices/${invoice.id}/history`);
        button.hidden = true;
        setContent(
          slot,
          html`<ol class="mt-4 space-y-3">
            ${data.events.map(
              (event) => html`<li class="flex items-start gap-3 text-sm">
                ${icon('clock', 'mt-0.5 size-4 shrink-0 text-slate-400')}
                <span class="min-w-0"><span class="text-slate-900">${(HISTORY[event.action] ?? (() => event.action))(event)}</span>
                  <span class="block text-xs text-slate-500">${event.actor?.name ?? 'Sistema'} · ${formatDateTime(event.created_at)}</span></span>
              </li>`,
            )}
          </ol>`,
        );
      });
    }

    load(true);
    return () => {
      active = false;
    };
  },
};

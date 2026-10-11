// Detalhe da despesa: valores, pagamentos (com estorno), comprovantes e anexos, histórico e ações.
// Pagamento não se edita: estorna (com motivo) e lança outro. Lançar ≠ pagar: botões por permissão.
import { badge } from '../components/badge.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import {
  expenseStatusBadges,
  labelOf,
  ATTACHMENT_ROLES,
  openAttachForm,
  openExpenseForm,
  openPaymentForm,
  openReasonForm,
  PAYMENT_METHODS,
} from '../components/finance.js';
import { fileIcon } from '../components/documents.js';
import { errorState, loadingState } from '../components/states.js';
import { toast } from '../components/toast.js';
import { formatBytes, formatCalendarDate, formatDateTime } from '../lib/format.js';
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { formatCents } from '../lib/money.js';
import { api, newIdempotencyKey } from '../services/api.js';
import { can } from '../services/tenant.js';
import { openDocument } from '../services/uploads.js';

const HISTORY = {
  'expense.created': () => 'Lançou a despesa',
  'expense.updated': (event) => `Alterou ${event.changed_fields.map((name) => FIELD_LABELS[name] ?? name).join(', ') || 'a despesa'}`,
  'expense.payment_registered': (event) => `Registrou pagamento de ${formatCents(event.details.amount_cents)} (${labelOf(PAYMENT_METHODS, event.details.method)})`,
  'expense.payment_voided': (event) => `Estornou pagamento de ${formatCents(event.details.amount_cents)}`,
  'expense.cancelled': () => 'Cancelou a despesa',
  'expense.document_linked': (event) => `Anexou ${labelOf(ATTACHMENT_ROLES, event.details.role).toLowerCase()}`,
  'expense.document_unlinked': (event) => `Removeu ${labelOf(ATTACHMENT_ROLES, event.details.role).toLowerCase()}`,
};

const FIELD_LABELS = {
  description: 'descrição',
  party_id: 'prestador',
  category_id: 'categoria',
  amount_cents: 'valor',
  due_date: 'vencimento',
  scheduled_for: 'agendamento',
  notes: 'observações',
  tags: 'tags',
};

function row(label, value) {
  return html`<div class="min-w-0"><dt class="text-sm text-slate-500">${label}</dt>
    <dd class="mt-0.5 break-words text-sm font-medium text-slate-900">${value || html`<span class="text-slate-400">—</span>`}</dd></div>`;
}

function summaryCard(expense) {
  return html`<section class="grid grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
    <div class="min-w-0"><p class="text-xs text-slate-500">Valor</p><p class="truncate text-lg font-bold tabular-nums">${formatCents(expense.amount_cents)}</p></div>
    <div class="min-w-0"><p class="text-xs text-slate-500">Pago</p><p class="truncate text-lg font-bold text-green-700 tabular-nums">${formatCents(expense.paid_amount_cents)}</p></div>
    <div class="min-w-0"><p class="text-xs text-slate-500">Em aberto</p><p class="truncate text-lg font-bold text-amber-700 tabular-nums">${formatCents(expense.open_amount_cents)}</p></div>
  </section>`;
}

function detailsCard(expense) {
  return html`<section class="card">
    <h2 class="text-base font-semibold text-slate-900">Detalhes</h2>
    <dl class="mt-4 grid gap-4 sm:grid-cols-2">
      ${row('Vencimento', formatCalendarDate(expense.due_date))}
      ${row('Agendada para', expense.scheduled_for && formatCalendarDate(expense.scheduled_for))}
      ${row('Prestador ou fornecedor', expense.party && html`<a href="/app/prestadores/${expense.party.id}" class="link">${expense.party.name}</a>`)}
      ${row('Categoria', expense.category?.name)}
      ${row('Tags', expense.tags.length > 0 && html`<span class="flex flex-wrap gap-1">${expense.tags.map((tag) => badge(tag, 'slate'))}</span>`)}
      ${expense.cancelled_at ? row('Motivo do cancelamento', expense.cancel_reason) : ''}
      <div class="sm:col-span-2">${row('Observações', expense.notes)}</div>
    </dl>
  </section>`;
}

function paymentsCard(expense) {
  const pay = can('finance.pay');
  return html`<section class="card">
    <h2 class="text-base font-semibold text-slate-900">Pagamentos</h2>
    ${
      expense.payments.length === 0
        ? html`<p class="mt-3 text-sm text-slate-600">Nenhum pagamento registrado.</p>`
        : html`<ol class="mt-4 divide-y divide-slate-100">
          ${expense.payments.map(
            (payment) => html`<li class="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
              <div class="min-w-0 ${payment.voided_at ? 'opacity-60' : ''}">
                <p class="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                  <span class="tabular-nums ${payment.voided_at ? 'line-through' : ''}">${formatCents(payment.amount_cents)}</span>
                  <span class="text-slate-500">${labelOf(PAYMENT_METHODS, payment.method)} · ${formatCalendarDate(payment.paid_on)}</span>
                  ${payment.voided_at ? badge('Estornado', 'red') : ''}
                </p>
                ${payment.reference ? html`<p class="text-sm text-slate-600">Ref.: ${payment.reference}</p>` : ''}
                <p class="text-xs text-slate-500">${payment.created_by?.name ?? ''} · ${formatDateTime(payment.created_at)}</p>
                ${payment.voided_at ? html`<p class="text-xs text-red-700">Estornado por ${payment.voided_by?.name ?? '—'}: ${payment.void_reason}</p>` : ''}
              </div>
              <div class="flex shrink-0 flex-wrap gap-2">
                ${
                  payment.receipt_document_id
                    ? html`<button type="button" class="btn btn-ghost btn-sm" data-action="open-document" data-id="${payment.receipt_document_id}">${icon('paperclip', 'size-4')} Comprovante</button>`
                    : ''
                }
                ${
                  pay && !payment.voided_at
                    ? html`<button type="button" class="btn btn-ghost btn-sm text-red-700" data-action="void" data-id="${payment.id}">${icon('undo-2', 'size-4')} Estornar</button>`
                    : ''
                }
              </div>
            </li>`,
          )}
        </ol>`
    }
  </section>`;
}

function attachmentsCard(expense, manage) {
  return html`<section class="card">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-base font-semibold text-slate-900">Documentos</h2>
      ${manage ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="attach">${icon('paperclip', 'size-4')} Anexar</button>` : ''}
    </div>
    ${
      expense.documents.length === 0
        ? html`<p class="mt-3 text-sm text-slate-600">Boletos, notas e contratos desta despesa aparecem aqui. Os comprovantes de pagamento também.</p>`
        : html`<ul class="mt-4 divide-y divide-slate-100">
          ${expense.documents.map(
            (doc) => html`<li class="flex items-center gap-3 py-2">
              <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">${fileIcon(doc.extension)}</span>
              <a href="/app/documentos/${doc.document_id}" class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium text-slate-900">${doc.title}</span>
                <span class="block text-xs text-slate-500">${labelOf(ATTACHMENT_ROLES, doc.role)} · ${formatBytes(doc.size_bytes)}</span>
              </a>
              <button type="button" class="btn btn-ghost btn-sm" data-action="open-document" data-id="${doc.document_id}" aria-label="Baixar ${doc.title}">${icon('download', 'size-4')}</button>
              ${manage ? html`<button type="button" class="btn btn-ghost btn-sm text-red-700" data-action="unlink" data-id="${doc.document_id}" aria-label="Desvincular ${doc.title}">${icon('x', 'size-4')}</button>` : ''}
            </li>`,
          )}
        </ul>`
    }
  </section>`;
}

export default {
  title: 'Despesa',

  render: () => html`<div data-content>${loadingState()}</div>`,

  mount(root, { params }) {
    const content = root.querySelector('[data-content]');
    let expense;
    let active = true;

    async function load(first = false) {
      try {
        const { data } = await api(`/expenses/${params.id}`);
        if (!active) return;
        expense = data.expense;
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
            title: missing ? 'Despesa não encontrada' : 'Não foi possível carregar',
            message: missing ? 'Ela pode ter sido removida ou você não tem acesso.' : err.message,
            action: html`<a href="/app/financeiro" class="btn btn-secondary btn-sm">Ir para o Financeiro</a>`,
          }),
        );
      }
    }

    function render() {
      document.title = `${expense.description} · ZEVS Nexus`;
      const open = !['paid', 'cancelled'].includes(expense.status);
      const manage = can('finance.manage') && expense.status !== 'cancelled';
      setContent(
        content,
        html`
          <a href="/app/financeiro" class="link inline-flex items-center gap-1 text-sm">${icon('chevron-left', 'size-4')} Financeiro</a>
          <div class="mt-3 min-w-0">
            <h1 class="text-xl font-bold tracking-tight break-words text-slate-900 sm:text-2xl">${expense.description}</h1>
            <p class="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">${expenseStatusBadges(expense)}</p>
          </div>
          <div class="mt-4 flex flex-wrap gap-2">
            ${open && can('finance.pay') ? html`<button type="button" class="btn btn-primary btn-sm" data-action="pay">${icon('circle-check', 'size-4')} Registrar pagamento</button>` : ''}
            ${manage ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="edit">${icon('pencil', 'size-4')} Editar</button>` : ''}
            ${manage && expense.paid_amount_cents === 0 ? html`<button type="button" class="btn btn-ghost btn-sm text-red-700" data-action="cancel">${icon('ban', 'size-4')} Cancelar despesa</button>` : ''}
          </div>
          <div class="mt-4 space-y-4">
            ${summaryCard(expense)}${paymentsCard(expense)}${detailsCard(expense)}${attachmentsCard(expense, manage)}
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

    function bind() {
      on('pay', async () => {
        const saved = await openPaymentForm(expense);
        if (!saved) return;
        toast(saved.status === 'paid' ? 'Pagamento registrado. Despesa quitada.' : 'Pagamento registrado.', { type: 'success' });
        await load();
      });
      on('edit', async () => {
        const { data } = await api('/finance-categories?kind=expense');
        const saved = await openExpenseForm({ expense, categories: data.categories });
        if (!saved) return;
        toast('Despesa salva.', { type: 'success' });
        await load();
      });
      on('cancel', async () => {
        const saved = await openReasonForm({
          title: 'Cancelar despesa',
          message: 'A despesa sai das pendências, mas continua no histórico. Não dá para desfazer.',
          submitLabel: 'Cancelar despesa',
          onSubmit: async (reason) => (await api(`/expenses/${expense.id}/cancel`, { method: 'POST', body: { reason } })).data.expense,
        });
        if (!saved) return;
        toast('Despesa cancelada.', { type: 'success' });
        await load();
      });
      on('void', async (button) => {
        const payment = expense.payments.find((item) => item.id === button.dataset.id);
        const saved = await openReasonForm({
          title: `Estornar ${formatCents(payment.amount_cents)}?`,
          message: 'O pagamento continua no histórico, marcado como estornado. Para corrigir um valor, estorne e registre outro.',
          submitLabel: 'Estornar',
          onSubmit: async (reason) => (await api(`/expense-payments/${payment.id}/void`, { method: 'POST', body: { reason } })).data.expense,
        });
        if (!saved) return;
        toast('Pagamento estornado.', { type: 'success' });
        await load();
      });
      on('attach', async () => {
        const saved = await openAttachForm({
          withRole: true,
          onSubmit: async ({ fileId, role }) =>
            (
              await api(`/expenses/${expense.id}/documents`, {
                method: 'POST',
                body: { file_id: fileId, role },
                idempotencyKey: newIdempotencyKey(),
              })
            ).data.expense,
        });
        if (!saved) return;
        toast('Documento anexado.', { type: 'success' });
        await load();
      });
      on('unlink', async (button) => {
        const confirmed = await ConfirmDialog.ask({
          title: 'Desvincular este documento?',
          message: 'Ele deixa de aparecer nesta despesa, mas continua na Central de Documentos.',
          confirmLabel: 'Desvincular',
        });
        if (!confirmed) return;
        await api(`/expenses/${expense.id}/documents/${button.dataset.id}`, { method: 'DELETE', body: {} });
        toast('Documento desvinculado.', { type: 'success' });
        await load();
      });
      on('open-document', (button) => openDocument(button.dataset.id, { inline: true }));
      on('history', async (button) => {
        const slot = content.querySelector('[data-history]');
        setContent(slot, loadingState());
        const { data } = await api(`/expenses/${expense.id}/history`);
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

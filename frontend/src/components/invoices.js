// Peças das Notas fiscais: tipos, selos (ciclo, recebimento, vencida, arquivada), linha da lista e os
// formulários (nota, emitir, receber). O líquido e "vencida" vêm calculados da API.
import { badge } from './badge.js';
import { companyToday, fieldError, moneyField, partyPickerField, bindPartyPicker } from './finance.js';
import { checkboxField, field, selectField, textareaField } from './form.js';
import { openFormModal } from './modal.js';
import { formatCalendarDate } from '../lib/format.js';
import { html } from '../lib/html.js';
import { formatCents, parseMoney } from '../lib/money.js';
import { api, newIdempotencyKey } from '../services/api.js';

export const INVOICE_KINDS = Object.freeze([
  { value: 'nfse', label: 'NFS-e' },
  { value: 'nfe', label: 'NF-e' },
  { value: 'other', label: 'Outra' },
]);

export const INVOICE_ATTACHMENT_ROLES = Object.freeze([
  { value: 'pdf', label: 'PDF da nota' },
  { value: 'xml', label: 'XML da nota' },
  { value: 'receipt', label: 'Comprovante de recebimento' },
  { value: 'other', label: 'Outro' },
]);

export function kindLabel(kind) {
  return INVOICE_KINDS.find((item) => item.value === kind)?.label ?? kind;
}

/** "NFS-e nº 123 (série A)" ou "NFS-e sem número". */
export function invoiceTitle(invoice) {
  if (!invoice.number) return `${kindLabel(invoice.kind)} sem número`;
  return `${kindLabel(invoice.kind)} nº ${invoice.number}${invoice.series ? ` (série ${invoice.series})` : ''}`;
}

export function invoiceStatusBadges(invoice) {
  const cycle =
    invoice.status === 'cancelled'
      ? badge('Cancelada', 'red')
      : invoice.status === 'processing'
        ? badge('Em processamento', 'amber')
        : invoice.finalized
          ? badge('Finalizada', 'green')
          : badge('Emitida', 'primary');
  return html`${cycle}${invoice.overdue ? badge('Vencida', 'red') : ''}${
    invoice.status === 'issued' && !invoice.finalized && !invoice.overdue ? badge('A receber', 'slate') : ''
  }${invoice.archived_at ? badge('Arquivada', 'slate') : ''}`;
}

export function invoiceRow(invoice) {
  return html`<li>
    <a href="/app/notas/${invoice.id}" class="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-xs hover:border-primary/40 sm:rounded-none sm:border-0 sm:shadow-none sm:hover:bg-slate-50" data-invoice="${invoice.id}">
      <span class="min-w-0 flex-1">
        <span class="block truncate font-medium text-slate-900">${invoiceTitle(invoice)}</span>
        ${invoice.party ? html`<span class="block truncate text-sm text-slate-700">${invoice.party.name}</span>` : ''}
        <span class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          ${invoice.issue_date ? html`<span>Emitida em ${formatCalendarDate(invoice.issue_date)}</span>` : ''}
          ${invoice.due_date && invoice.status === 'issued' && !invoice.finalized ? html`<span>Vence ${formatCalendarDate(invoice.due_date)}</span>` : ''}
          ${invoiceStatusBadges(invoice)}
        </span>
        <span class="mt-0.5 block truncate text-xs text-slate-500">${invoice.description}</span>
      </span>
      <span class="shrink-0 text-right">
        <span class="block font-semibold text-slate-900 tabular-nums">${formatCents(invoice.net_amount_cents)}</span>
        ${invoice.withheld_cents > 0 ? html`<span class="block text-xs text-slate-500 tabular-nums">bruto ${formatCents(invoice.gross_amount_cents)}</span>` : ''}
      </span>
    </a>
  </li>`;
}

export function invoiceList(invoices) {
  return html`<ul class="space-y-2 sm:space-y-0 sm:divide-y sm:divide-slate-100 sm:overflow-hidden sm:rounded-2xl sm:border sm:border-slate-200 sm:bg-white sm:shadow-sm">
    ${invoices.map(invoiceRow)}
  </ul>`;
}

function optionalMoney(form, name) {
  const text = form.elements[name].value.trim();
  if (!text) return 0;
  const cents = parseMoney(text);
  if (cents === null || cents === undefined || Number.isNaN(cents)) throw fieldError(name, 'Valor inválido (ex.: 1.234,56).');
  return cents;
}

/**
 * Registrar (nota nova) ou editar. Na nota nova, "já emitida" vem marcado: o caso comum é registrar a
 * nota que já saiu na prefeitura ou na Sefaz. Devolve a nota salva, ou null.
 */
export function openInvoiceForm({ invoice = null } = {}) {
  let picker;
  const editing = Boolean(invoice);
  return openFormModal({
    title: editing ? 'Editar nota' : 'Registrar nota fiscal',
    submitLabel: editing ? 'Salvar' : 'Registrar nota',
    body: html`
      <div class="grid gap-4 sm:grid-cols-3">
        ${selectField({ name: 'kind', label: 'Tipo', options: INVOICE_KINDS, value: invoice?.kind ?? 'nfse' })}
        ${field({ name: 'number', label: 'Número', required: false, value: invoice?.number ?? '', inputmode: 'numeric' })}
        ${field({ name: 'series', label: 'Série', required: false, value: invoice?.series ?? '' })}
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        ${field({ name: 'issue_date', label: 'Data de emissão', type: 'date', required: false, value: invoice?.issue_date ?? (editing ? '' : companyToday()) })}
        ${field({ name: 'competence', label: 'Competência', type: 'month', required: false, value: invoice?.competence ?? '', hint: 'Mês do serviço (opcional).' })}
      </div>
      ${editing ? '' : checkboxField({ name: 'issue', label: 'A nota já foi emitida (tem número e data)', checked: true })}
      ${partyPickerField({ label: 'Tomador (cliente)', party: invoice?.party, hint: 'Clientes cadastrados em Prestadores, com o papel Cliente. Opcional.' })}
      ${textareaField({ name: 'description', label: 'Descrição do serviço ou produto', value: invoice?.description ?? '', maxlength: 1000 })}
      <div class="grid gap-4 sm:grid-cols-2">
        ${moneyField({ name: 'gross_amount_cents', label: 'Valor bruto', value: invoice?.gross_amount_cents })}
        ${moneyField({ name: 'withheld_cents', label: 'Retenções (total)', value: invoice?.withheld_cents ?? 0, hint: 'ISS, INSS, IR e outras retidas. O líquido é calculado.' })}
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        ${field({ name: 'due_date', label: 'Vencimento', type: 'date', required: false, value: invoice?.due_date ?? '' })}
        ${field({ name: 'verification_code', label: 'Código de verificação ou chave', required: false, value: invoice?.verification_code ?? '' })}
      </div>
      ${textareaField({ name: 'notes', label: 'Observações', value: invoice?.notes ?? '', maxlength: 2000 })}`,
    onMount: (dialog) => {
      picker = bindPartyPicker(dialog, { party: invoice?.party, role: 'customer' });
      // O campo de retenções aceita vazio (= zero).
      dialog.querySelector('[name="withheld_cents"]').required = false;
      dialog.querySelector('[name="withheld_cents"]').removeAttribute('aria-required');
    },
    onSubmit: async (form) => {
      const values = form.elements;
      const gross = parseMoney(values.gross_amount_cents.value);
      if (!gross) throw fieldError('gross_amount_cents', 'Informe o valor bruto (ex.: 1.234,56).');
      const partyId = picker.value();
      if (partyId === undefined) throw fieldError('party_id', 'Escolha um cliente da lista ou deixe em branco.');
      const body = {
        kind: values.kind.value,
        number: values.number.value,
        series: values.series.value,
        issue_date: values.issue_date.value,
        competence: values.competence.value,
        party_id: partyId,
        description: values.description.value,
        gross_amount_cents: gross,
        withheld_cents: optionalMoney(form, 'withheld_cents'),
        due_date: values.due_date.value,
        verification_code: values.verification_code.value,
        notes: values.notes.value,
      };
      if (editing) {
        const { data } = await api(`/invoices/${invoice.id}`, { method: 'PATCH', body: { ...body, version: invoice.version } });
        return data.invoice;
      }
      const { data } = await api('/invoices', {
        method: 'POST',
        body: { ...body, issue: values.issue.checked },
        idempotencyKey: newIdempotencyKey(),
      });
      return data.invoice;
    },
  });
}

/** Marcar como emitida: número e data (vêm preenchidos se já estiverem na nota). */
export function openIssueForm(invoice) {
  return openFormModal({
    title: 'Marcar como emitida',
    submitLabel: 'Marcar emitida',
    body: html`
      <p class="text-sm text-slate-600">Informe o número e a data que aparecem na nota emitida.</p>
      <div class="grid gap-4 sm:grid-cols-2">
        ${field({ name: 'number', label: 'Número', value: invoice.number ?? '', inputmode: 'numeric' })}
        ${field({ name: 'series', label: 'Série', required: false, value: invoice.series ?? '' })}
      </div>
      ${field({ name: 'issue_date', label: 'Data de emissão', type: 'date', value: invoice.issue_date ?? companyToday() })}`,
    onSubmit: async (form) => {
      const values = form.elements;
      const { data } = await api(`/invoices/${invoice.id}/issue`, {
        method: 'POST',
        body: { number: values.number.value.trim() || undefined, series: values.series.value, issue_date: values.issue_date.value || undefined },
      });
      return data.invoice;
    },
  });
}

/** Registrar o recebimento: data (até hoje) e valor, sugerido igual ao líquido. */
export function openMarkPaidForm(invoice) {
  return openFormModal({
    title: 'Registrar recebimento',
    submitLabel: 'Marcar como paga',
    body: html`
      <p class="text-sm text-slate-600">O Nexus só registra: nenhum valor é movimentado.</p>
      <div class="grid gap-4 sm:grid-cols-2">
        ${field({ name: 'received_on', label: 'Recebido em', type: 'date', value: companyToday() })}
        ${moneyField({ name: 'received_amount_cents', label: 'Valor recebido', value: invoice.net_amount_cents, hint: 'Sugerido: o valor líquido.' })}
      </div>`,
    onSubmit: async (form) => {
      const values = form.elements;
      const amount = parseMoney(values.received_amount_cents.value);
      if (!amount) throw fieldError('received_amount_cents', 'Informe o valor recebido (ex.: 1.234,56).');
      const { data } = await api(`/invoices/${invoice.id}/mark-paid`, {
        method: 'POST',
        body: { received_on: values.received_on.value, received_amount_cents: amount },
      });
      return data.invoice;
    },
  });
}

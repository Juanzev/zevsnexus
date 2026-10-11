// Peças do Financeiro e de Prestadores: selos, linhas da lista, campo de valor, seletor de prestador e
// os formulários de despesa e de pagamento (modais de uma tela; Ctrl+Enter salva).
import { field, selectField, textareaField } from './form.js';
import { openFormModal } from './modal.js';
import { badge } from './badge.js';
import { addDays, todayIn } from '../lib/dates.js';
import { formatCalendarDate } from '../lib/format.js';
import { html } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { centsToInput, formatCents, parseMoney } from '../lib/money.js';
import { api, newIdempotencyKey } from '../services/api.js';
import { currentContext } from '../services/tenant.js';
import { ACCEPT_ATTRIBUTE, isAcceptedFile, uploadFile } from '../services/uploads.js';

export const PAYMENT_METHODS = Object.freeze([
  { value: 'pix', label: 'PIX' },
  { value: 'transfer', label: 'Transferência' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'card', label: 'Cartão' },
  { value: 'check', label: 'Cheque' },
  { value: 'other', label: 'Outro' },
]);

export const ATTACHMENT_ROLES = Object.freeze([
  { value: 'boleto', label: 'Boleto' },
  { value: 'invoice', label: 'Nota fiscal' },
  { value: 'contract', label: 'Contrato' },
  { value: 'receipt', label: 'Comprovante' },
  { value: 'other', label: 'Outro' },
]);

export const PARTY_ROLES = Object.freeze([
  { value: 'service_provider', label: 'Prestador de serviço' },
  { value: 'supplier', label: 'Fornecedor' },
  { value: 'customer', label: 'Cliente' },
]);

export function labelOf(list, value) {
  return list.find((item) => item.value === value)?.label ?? value;
}

/** Hoje no fuso da empresa (vencimento e pagamento são datas de calendário). */
export function companyToday() {
  return todayIn(currentContext()?.company.timezone ?? 'America/Sao_Paulo');
}

/** Erro de campo no formato da API, para o modal mostrar junto do campo. */
export function fieldError(name, message) {
  const err = new Error(message);
  err.details = [{ field: name, message }];
  return err;
}

export function parseTags(text) {
  return String(text ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

// ---------- selos e lista ----------

export function expenseStatusBadges(expense) {
  if (expense.status === 'cancelled') return badge('Cancelada', 'slate');
  if (expense.status === 'paid') return badge('Paga', 'green');
  return html`${expense.overdue ? badge('Vencida', 'red') : ''}${expense.status === 'partially_paid' ? badge('Parcial', 'amber') : ''}${
    expense.status === 'scheduled' ? badge(`Agendada · ${formatCalendarDate(expense.scheduled_for)}`, 'primary') : ''
  }${!expense.overdue && expense.status === 'pending' ? badge('A vencer', 'slate') : ''}`;
}

export function expenseRow(expense) {
  const showOpen = expense.status === 'partially_paid';
  return html`<li>
    <a href="/app/financeiro/${expense.id}" class="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-xs hover:border-primary/40 sm:rounded-none sm:border-0 sm:shadow-none sm:hover:bg-slate-50">
      <span class="min-w-0 flex-1">
        <span class="block truncate font-medium text-slate-900">${expense.description}</span>
        <span class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          <span>Vence ${formatCalendarDate(expense.due_date)}</span>
          ${expense.party ? html`<span aria-hidden="true">·</span><span class="truncate">${expense.party.name}</span>` : ''}
          ${expense.category ? html`<span aria-hidden="true">·</span><span>${expense.category.name}</span>` : ''}
          ${expenseStatusBadges(expense)}
          ${expense.has_receipt ? html`<span class="inline-flex items-center gap-1 text-green-700">${icon('paperclip', 'size-3.5')}Comprovante</span>` : ''}
          ${expense.tags.slice(0, 2).map((tag) => badge(tag, 'slate'))}
        </span>
      </span>
      <span class="shrink-0 text-right">
        <span class="block font-semibold text-slate-900 tabular-nums">${formatCents(expense.amount_cents)}</span>
        ${showOpen ? html`<span class="block text-xs text-amber-700 tabular-nums">falta ${formatCents(expense.open_amount_cents)}</span>` : ''}
      </span>
    </a>
  </li>`;
}

export function expenseList(expenses) {
  return html`<ul class="space-y-2 sm:space-y-0 sm:divide-y sm:divide-slate-100 sm:overflow-hidden sm:rounded-2xl sm:border sm:border-slate-200 sm:bg-white sm:shadow-sm">
    ${expenses.map(expenseRow)}
  </ul>`;
}

// ---------- campos ----------

/** Campo de valor em reais (o teclado numérico com vírgula no celular). */
export function moneyField({ name = 'amount_cents', label = 'Valor', value, hint }) {
  const id = `f-${name}`;
  return html`<div class="field">
    <label for="${id}" class="label">${label}</label>
    <div class="relative">
      <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500">R$</span>
      <input id="${id}" name="${name}" type="text" inputmode="decimal" autocomplete="off" class="input pl-10 tabular-nums"
        placeholder="0,00" value="${value === undefined || value === null ? '' : centsToInput(value)}" required aria-required="true"
        aria-describedby="${id}-hint ${id}-error">
    </div>
    ${hint ? html`<p id="${id}-hint" class="hint">${hint}</p>` : ''}
    <p id="${id}-error" class="field-error" hidden></p>
  </div>`;
}

function partyLabel(party) {
  return party.specialty ? `${party.name} — ${party.specialty}` : party.name;
}

/** Prestador por nome (autocompletar nativo do navegador, com busca no servidor). */
export function partyPickerField({ name = 'party_id', label = 'Prestador ou fornecedor', party }) {
  const id = `f-${name}`;
  return html`<div class="field">
    <label for="${id}" class="label">${label}</label>
    <input id="${id}" name="${name}" type="search" class="input" list="${id}-options" autocomplete="off"
      placeholder="Digite para buscar (opcional)" value="${party ? party.name : ''}" aria-describedby="${id}-hint ${id}-error">
    <datalist id="${id}-options"></datalist>
    <p id="${id}-hint" class="hint">Deixe em branco para despesas sem prestador (ex.: tarifa bancária).</p>
    <p id="${id}-error" class="field-error" hidden></p>
  </div>`;
}

/** Liga o seletor: devolve value() → id, null (vazio) ou undefined (texto que não é da lista). */
export function bindPartyPicker(root, { name = 'party_id', party } = {}) {
  const input = root.querySelector(`[name="${name}"]`);
  const options = root.querySelector(`#f-${name}-options`);
  const byLabel = new Map();
  if (party) byLabel.set(party.name, party.id);
  let timer;

  async function search(query) {
    try {
      const params = new URLSearchParams({ limit: '20', sort: 'name' });
      if (query) params.set('q', query);
      const { data } = await api(`/parties?${params}`);
      options.replaceChildren(
        ...data.parties.map((item) => {
          const label = partyLabel(item);
          byLabel.set(label, item.id);
          const option = document.createElement('option');
          option.value = label;
          return option;
        }),
      );
    } catch {
      // Sem sugestões: o campo continua aceitando o que já foi carregado.
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const text = input.value.trim();
    if (byLabel.has(text)) return;
    timer = setTimeout(() => search(text), 250);
  });
  search('');

  return {
    value() {
      const text = input.value.trim();
      if (!text) return null;
      return byLabel.get(text);
    },
  };
}

function fileField({ name, label, hint }) {
  const id = `f-${name}`;
  return html`<div class="field">
    <label for="${id}" class="label">${label}</label>
    <input id="${id}" name="${name}" type="file" accept="${ACCEPT_ATTRIBUTE}" class="input h-auto py-2"
      aria-describedby="${id}-hint ${id}-error">
    ${hint ? html`<p id="${id}-hint" class="hint">${hint}</p>` : ''}
    <p id="${id}-error" class="field-error" hidden></p>
  </div>`;
}

/** Envia o comprovante escolhido (se houver) e devolve o file_id. */
async function receiptFileId(form, name) {
  const file = form.elements[name]?.files?.[0];
  if (!file) return undefined;
  if (!isAcceptedFile(file)) throw fieldError(name, 'Tipo de arquivo não aceito. Use PDF ou foto (JPG, PNG).');
  return uploadFile(file);
}

// ---------- formulários ----------

/**
 * Nova despesa, "Já paguei" (quickPay) ou edição (expense). Devolve a despesa salva, ou null.
 * @param categories categorias ativas [{ id, name }]
 */
export function openExpenseForm({ expense = null, quickPay = false, categories = [] }) {
  const today = companyToday();
  const categoryOptions = categories.map((category) => ({ value: category.id, label: category.name }));
  if (expense?.category && !categoryOptions.some((option) => option.value === expense.category.id)) {
    categoryOptions.unshift({ value: expense.category.id, label: `${expense.category.name} (arquivada)` });
  }
  let picker;
  const title = expense ? 'Editar despesa' : quickPay ? 'Já paguei' : 'Nova despesa';

  return openFormModal({
    title,
    submitLabel: expense ? 'Salvar' : quickPay ? 'Registrar pagamento' : 'Lançar despesa',
    body: html`
      ${quickPay ? html`<p class="text-sm text-slate-600">Registra a despesa já paga, com o comprovante, de uma vez.</p>` : ''}
      ${field({ name: 'description', label: 'Descrição', value: expense?.description ?? '', hint: quickPay ? 'Ex.: Areia e cimento, diária do pedreiro.' : undefined })}
      <div class="grid gap-4 sm:grid-cols-2">
        ${moneyField({ value: expense?.amount_cents })}
        ${
          quickPay
            ? field({ name: 'payment_paid_on', label: 'Pago em', type: 'date', value: today })
            : field({ name: 'due_date', label: 'Vencimento', type: 'date', value: expense?.due_date ?? addDays(today, 0) })
        }
      </div>
      ${
        quickPay
          ? html`${selectField({ name: 'payment_method', label: 'Forma de pagamento', options: PAYMENT_METHODS, value: 'pix' })}
            ${fileField({ name: 'payment_receipt_file_id', label: 'Comprovante', hint: 'PDF ou foto. No celular, dá para tirar a foto na hora.' })}`
          : ''
      }
      ${partyPickerField({ party: expense?.party })}
      ${selectField({ name: 'category_id', label: 'Categoria', required: false, placeholder: 'Sem categoria', options: categoryOptions, value: expense?.category?.id ?? '' })}
      ${field({ name: 'tags', label: 'Tags', required: false, value: (expense?.tags ?? []).join(', '), hint: 'Separe por vírgula. Ex.: Obra Residencial X.' })}
      ${quickPay ? '' : field({ name: 'scheduled_for', label: 'Agendar pagamento para (opcional)', type: 'date', required: false, value: expense?.scheduled_for ?? '' })}
      ${textareaField({ name: 'notes', label: 'Observações', value: expense?.notes ?? '', maxlength: 2000 })}`,
    onMount: (dialog) => {
      picker = bindPartyPicker(dialog, { party: expense?.party });
    },
    onSubmit: async (form) => {
      const values = form.elements;
      const amount = parseMoney(values.amount_cents.value);
      if (!amount) throw fieldError('amount_cents', 'Informe o valor (ex.: 1.234,56).');
      const partyId = picker.value();
      if (partyId === undefined) throw fieldError('party_id', 'Escolha um prestador da lista ou deixe em branco.');
      const common = {
        description: values.description.value,
        amount_cents: amount,
        party_id: partyId,
        category_id: values.category_id.value || null,
        tags: parseTags(values.tags.value),
        notes: values.notes.value,
      };
      if (expense) {
        const { data } = await api(`/expenses/${expense.id}`, {
          method: 'PATCH',
          body: { ...common, version: expense.version, due_date: values.due_date.value, scheduled_for: values.scheduled_for.value || null },
        });
        return data.expense;
      }
      const body = quickPay
        ? {
            ...common,
            payment: {
              paid_on: values.payment_paid_on.value,
              method: values.payment_method.value,
              receipt_file_id: await receiptFileId(form, 'payment_receipt_file_id'),
            },
          }
        : { ...common, due_date: values.due_date.value, scheduled_for: values.scheduled_for.value || null };
      const { data } = await api('/expenses', { method: 'POST', body, idempotencyKey: newIdempotencyKey() });
      return data.expense;
    },
  });
}

/** Registrar pagamento (parcial ou total). Devolve a despesa atualizada, ou null. */
export function openPaymentForm(expense) {
  return openFormModal({
    title: 'Registrar pagamento',
    submitLabel: 'Registrar',
    busyLabel: 'Registrando…',
    body: html`
      <p class="text-sm text-slate-600">Em aberto: <strong class="tabular-nums">${formatCents(expense.open_amount_cents)}</strong></p>
      <div class="grid gap-4 sm:grid-cols-2">
        ${moneyField({ value: expense.open_amount_cents, hint: 'Pagamento parcial é permitido.' })}
        ${field({ name: 'paid_on', label: 'Pago em', type: 'date', value: companyToday() })}
      </div>
      ${selectField({ name: 'method', label: 'Forma de pagamento', options: PAYMENT_METHODS, value: 'pix' })}
      ${field({ name: 'reference', label: 'Referência (opcional)', required: false, hint: 'Ex.: número do boleto, ID da transação.' })}
      ${fileField({ name: 'receipt_file_id', label: 'Comprovante', hint: 'PDF ou foto. Fica guardado na pasta de comprovantes.' })}
      ${textareaField({ name: 'notes', label: 'Observações', maxlength: 500 })}`,
    onSubmit: async (form) => {
      const values = form.elements;
      const amount = parseMoney(values.amount_cents.value);
      if (!amount) throw fieldError('amount_cents', 'Informe o valor (ex.: 1.234,56).');
      const { data } = await api(`/expenses/${expense.id}/payments`, {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(),
        body: {
          amount_cents: amount,
          paid_on: values.paid_on.value,
          method: values.method.value,
          reference: values.reference.value,
          notes: values.notes.value,
          receipt_file_id: await receiptFileId(form, 'receipt_file_id'),
        },
      });
      return data.expense;
    },
  });
}

/** Motivo obrigatório (estornar pagamento, cancelar despesa). Devolve o resultado de onSubmit, ou null. */
export function openReasonForm({ title, message, submitLabel, onSubmit }) {
  return openFormModal({
    title,
    submitLabel,
    body: html`<p class="text-sm text-slate-600">${message}</p>${textareaField({ name: 'reason', label: 'Motivo', maxlength: 500 })}`,
    onSubmit: (form) => {
      const reason = form.elements.reason.value.trim();
      if (!reason) throw fieldError('reason', 'Informe o motivo.');
      return onSubmit(reason);
    },
  });
}

/** Anexar arquivo a uma despesa ou à ficha de um prestador. */
export function openAttachForm({ title = 'Anexar documento', withRole = false, onSubmit }) {
  return openFormModal({
    title,
    submitLabel: 'Anexar',
    busyLabel: 'Enviando…',
    body: html`
      ${withRole ? selectField({ name: 'role', label: 'O que é', options: ATTACHMENT_ROLES, value: 'boleto' }) : ''}
      ${fileField({ name: 'file_id', label: 'Arquivo', hint: 'PDF, imagem, planilha ou documento de texto.' })}`,
    onSubmit: async (form) => {
      const fileId = await receiptFileId(form, 'file_id');
      if (!fileId) throw fieldError('file_id', 'Escolha o arquivo.');
      return onSubmit({ fileId, role: form.elements.role?.value });
    },
  });
}

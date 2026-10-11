// Ficha do prestador ou fornecedor: dados, totais e histórico financeiro (só com finance.view) e
// documentos vinculados (contrato, RG, certidões), que continuam sendo documentos da Central.
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { fileIcon } from '../components/documents.js';
import { expenseList, openAttachForm } from '../components/finance.js';
import { formatPartyDocument, openPartyForm, partyRoleBadges } from '../components/parties.js';
import { emptyState, errorState, loadingState } from '../components/states.js';
import { toast } from '../components/toast.js';
import { formatBytes, formatPhone } from '../lib/format.js';
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { formatCents } from '../lib/money.js';
import { api, newIdempotencyKey } from '../services/api.js';
import { can } from '../services/tenant.js';
import { openDocument } from '../services/uploads.js';

function row(label, value) {
  return html`<div class="min-w-0"><dt class="text-sm text-slate-500">${label}</dt>
    <dd class="mt-0.5 break-words text-sm font-medium text-slate-900">${value || html`<span class="text-slate-400">—</span>`}</dd></div>`;
}

function financeSummary(finance) {
  return html`<section class="grid grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
    <div class="min-w-0"><p class="text-xs text-slate-500">Em aberto</p><p class="truncate font-bold text-amber-700 tabular-nums">${formatCents(finance.open_cents)}</p></div>
    <div class="min-w-0"><p class="text-xs text-slate-500">Vencido</p><p class="truncate font-bold text-red-700 tabular-nums">${formatCents(finance.overdue_cents)}</p></div>
    <div class="min-w-0"><p class="text-xs text-slate-500">Pago (total)</p><p class="truncate font-bold text-green-700 tabular-nums">${formatCents(finance.paid_cents)}</p></div>
  </section>`;
}

export default {
  title: 'Prestador',

  render: () => html`<div data-content>${loadingState()}</div>`,

  mount(root, { params, navigate }) {
    const content = root.querySelector('[data-content]');
    const manage = can('parties.manage');
    let party;
    let active = true;

    async function load(first = false) {
      try {
        const { data } = await api(`/parties/${params.id}`);
        if (!active) return;
        party = data.party;
        render();
        if (first) {
          const heading = content.querySelector('h1');
          heading.setAttribute('tabindex', '-1');
          heading.focus({ preventScroll: true });
        }
        loadExpenses();
        loadDocuments();
      } catch (err) {
        if (!active) return;
        const missing = err.status === 404 || err.status === 422;
        setContent(
          content,
          errorState({
            title: missing ? 'Cadastro não encontrado' : 'Não foi possível carregar',
            message: missing ? 'Ele pode ter sido excluído.' : err.message,
            action: html`<a href="/app/prestadores" class="btn btn-secondary btn-sm">Ir para Prestadores</a>`,
          }),
        );
      }
    }

    function render() {
      document.title = `${party.name} · ZEVS Nexus`;
      setContent(
        content,
        html`
          <a href="/app/prestadores" class="link inline-flex items-center gap-1 text-sm">${icon('chevron-left', 'size-4')} Prestadores</a>
          <div class="mt-3 min-w-0">
            <h1 class="text-xl font-bold tracking-tight break-words text-slate-900 sm:text-2xl">${party.name}</h1>
            <p class="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
              ${party.specialty ? html`<span>${party.specialty}</span>` : ''}${partyRoleBadges(party)}</p>
          </div>
          ${
            manage
              ? html`<div class="mt-4 flex flex-wrap gap-2">
                  <button type="button" class="btn btn-secondary btn-sm" data-action="edit">${icon('pencil', 'size-4')} Editar</button>
                  <button type="button" class="btn btn-ghost btn-sm text-red-700" data-action="delete">${icon('trash-2', 'size-4')} Excluir</button>
                </div>`
              : ''
          }
          <div class="mt-4 space-y-4">
            ${party.finance ? financeSummary(party.finance) : ''}
            <section class="card">
              <h2 class="text-base font-semibold text-slate-900">Dados</h2>
              <dl class="mt-4 grid gap-4 sm:grid-cols-2">
                ${row(party.person_type === 'individual' ? 'CPF' : 'CNPJ', formatPartyDocument(party))}
                ${party.trade_name ? row('Nome fantasia', party.trade_name) : ''}
                ${row('Telefone', party.phone && html`<a class="link" href="tel:+55${party.phone}">${formatPhone(party.phone)}</a>`)}
                ${row('E-mail', party.email && html`<a class="link break-all" href="mailto:${party.email}">${party.email}</a>`)}
                ${row('Chave PIX', party.pix_key && html`<span class="break-all">${party.pix_key}</span>`)}
                <div class="sm:col-span-2">${row('Observações', party.notes)}</div>
              </dl>
            </section>
            ${
              can('finance.view')
                ? html`<section class="card">
                    <div class="flex flex-wrap items-center justify-between gap-3">
                      <h2 class="text-base font-semibold text-slate-900">Despesas</h2>
                      <a href="/app/financeiro?aba=all&q=${encodeURIComponent(party.name)}" class="link text-sm">Ver no Financeiro</a>
                    </div>
                    <div class="mt-4" data-expenses>${loadingState()}</div>
                  </section>`
                : ''
            }
            ${
              can('documents.view')
                ? html`<section class="card">
                    <div class="flex flex-wrap items-center justify-between gap-3">
                      <h2 class="text-base font-semibold text-slate-900">Documentos</h2>
                      ${manage ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="attach">${icon('paperclip', 'size-4')} Anexar</button>` : ''}
                    </div>
                    <div class="mt-4" data-documents>${loadingState()}</div>
                  </section>`
                : ''
            }
          </div>`,
      );
      bind();
    }

    async function loadExpenses() {
      const slot = content.querySelector('[data-expenses]');
      if (!slot) return;
      try {
        const { data } = await api(`/parties/${party.id}/expenses?tab=all&sort=-due_date&limit=20`);
        if (!slot.isConnected) return;
        setContent(
          slot,
          data.expenses.length === 0
            ? emptyState({ title: 'Nenhuma despesa', message: 'As despesas lançadas para este cadastro aparecem aqui.' })
            : expenseList(data.expenses),
        );
      } catch (err) {
        if (slot.isConnected) setContent(slot, errorState({ message: err.message }));
      }
    }

    async function loadDocuments() {
      const slot = content.querySelector('[data-documents]');
      if (!slot) return;
      try {
        const { data } = await api(`/parties/${party.id}/documents`);
        if (!slot.isConnected) return;
        setContent(
          slot,
          data.documents.length === 0
            ? html`<p class="text-sm text-slate-600">Contrato, documentos pessoais, certidões e outros arquivos deste cadastro.</p>`
            : html`<ul class="divide-y divide-slate-100">
                ${data.documents.map(
                  (doc) => html`<li class="flex items-center gap-3 py-2">
                    <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">${fileIcon(doc.extension)}</span>
                    <a href="/app/documentos/${doc.id}" class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-medium text-slate-900">${doc.title}</span>
                      <span class="block text-xs text-slate-500 uppercase">${doc.extension} · ${formatBytes(doc.size_bytes)}</span>
                    </a>
                    <button type="button" class="btn btn-ghost btn-sm" data-action="download" data-id="${doc.id}" aria-label="Baixar ${doc.title}">${icon('download', 'size-4')}</button>
                    ${manage ? html`<button type="button" class="btn btn-ghost btn-sm text-red-700" data-action="unlink" data-id="${doc.id}" aria-label="Desvincular ${doc.title}">${icon('x', 'size-4')}</button>` : ''}
                  </li>`,
                )}
              </ul>`,
        );
        for (const button of slot.querySelectorAll('[data-action="download"]')) {
          button.addEventListener('click', () => openDocument(button.dataset.id).catch((err) => toast(err.message, { type: 'error' })));
        }
        for (const button of slot.querySelectorAll('[data-action="unlink"]')) {
          button.addEventListener('click', async () => {
            const confirmed = await ConfirmDialog.ask({
              title: 'Desvincular este documento?',
              message: 'Ele sai da ficha, mas continua na Central de Documentos.',
              confirmLabel: 'Desvincular',
            });
            if (!confirmed) return;
            try {
              await api(`/parties/${party.id}/documents/${button.dataset.id}`, { method: 'DELETE', body: {} });
              toast('Documento desvinculado.', { type: 'success' });
              loadDocuments();
            } catch (err) {
              toast(err.message, { type: 'error' });
            }
          });
        }
      } catch (err) {
        if (slot.isConnected) setContent(slot, errorState({ message: err.message }));
      }
    }

    function bind() {
      content.querySelector('[data-action="edit"]')?.addEventListener('click', async () => {
        const saved = await openPartyForm(party);
        if (!saved) return;
        toast('Cadastro salvo.', { type: 'success' });
        load();
      });
      content.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
        const confirmed = await ConfirmDialog.ask({
          title: `Excluir ${party.name}?`,
          message: 'O cadastro sai da lista. As despesas já lançadas continuam com o nome.',
          confirmLabel: 'Excluir',
        });
        if (!confirmed) return;
        try {
          await api(`/parties/${party.id}`, { method: 'DELETE', body: {} });
          toast('Cadastro excluído.', { type: 'success' });
          navigate('/app/prestadores', { replace: true });
        } catch (err) {
          toast(err.message, { type: 'error' });
        }
      });
      content.querySelector('[data-action="attach"]')?.addEventListener('click', async () => {
        const saved = await openAttachForm({
          onSubmit: async ({ fileId }) =>
            api(`/parties/${party.id}/documents`, { method: 'POST', body: { file_id: fileId }, idempotencyKey: newIdempotencyKey() }),
        });
        if (!saved) return;
        toast('Documento anexado.', { type: 'success' });
        loadDocuments();
      });
    }

    load(true);
    return () => {
      active = false;
    };
  },
};

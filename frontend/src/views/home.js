// Início: indicadores financeiros do mês (D4, via /dashboard), o que falta para deixar a empresa pronta,
// documentos vencendo (D5.3) e o que vem a seguir. O dashboard completo chega na F8.
import { documentList } from '../components/documents.js';
import { formatCents } from '../lib/money.js';
import { errorState, loadingState } from '../components/states.js';
import { toast } from '../components/toast.js';
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { firstName } from '../lib/text.js';
import { api } from '../services/api.js';
import { getUser } from '../services/session.js';
import { can, currentContext } from '../services/tenant.js';

function verificationBanner() {
  return html`<section class="alert alert-warning flex-col items-start gap-3 sm:flex-row sm:items-center">
    <span class="flex items-start gap-2">${icon('mail', 'mt-0.5 size-5 shrink-0')}
      <span><strong>Confirme seu e-mail.</strong> Enviamos um link quando você criou a conta.</span></span>
    <button type="button" class="btn btn-secondary btn-sm shrink-0 sm:ml-auto" data-action="resend">Reenviar e-mail</button>
  </section>`;
}

/** Passos de configuração calculados a partir dos dados reais da empresa. */
function setupSteps(company, contacts) {
  return [
    {
      done: Boolean(company.cnpj && company.address.city),
      title: 'Dados da empresa',
      text: 'CNPJ e endereço.',
    },
    {
      done: Boolean(company.email || company.phone),
      title: 'Contato da empresa',
      text: 'E-mail ou telefone para recados e documentos.',
    },
    {
      done: contacts.some((contact) => contact.is_responsible),
      title: 'Responsáveis',
      text: 'Quem responde pela empresa (sócios, administradores).',
    },
  ];
}

function setupCard(steps) {
  const pending = steps.filter((step) => !step.done).length;
  if (pending === 0) {
    return html`<section class="card flex items-center gap-3">
      ${icon('circle-check', 'size-6 shrink-0 text-green-600')}
      <p class="text-sm text-slate-700"><strong>Cadastro completo.</strong> Os dados da empresa estão em dia.</p>
    </section>`;
  }
  return html`<section class="card">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-base font-semibold text-slate-900">Primeiros passos</h2>
      <span class="text-sm text-slate-500">${steps.length - pending} de ${steps.length}</span>
    </div>
    <ul class="mt-4 space-y-3">
      ${steps.map(
        (step) => html`<li class="flex items-start gap-3">
          ${step.done ? icon('circle-check', 'mt-0.5 size-5 shrink-0 text-green-600') : icon('circle', 'mt-0.5 size-5 shrink-0 text-slate-300')}
          <span class="min-w-0"><span class="block text-sm font-medium ${step.done ? 'text-slate-500 line-through' : 'text-slate-900'}">${step.title}</span>
            <span class="block text-sm text-slate-500">${step.text}</span></span>
        </li>`,
      )}
    </ul>
    <a href="/app/empresa" class="btn btn-primary btn-sm mt-5">Completar os dados</a>
  </section>`;
}

const UPCOMING = [
  { title: 'Notas fiscais', text: 'Notas emitidas, anexos e recebimento.', icon: () => icon('receipt-text', 'size-5') },
  { title: 'Planilhas', text: 'Planilhas em uso, por ano e arquivadas.', icon: () => icon('sheet', 'size-5') },
];

function indicator({ label, value, detail, href, tone }) {
  return html`<a href="${href}" class="block min-w-0 rounded-xl border border-slate-200 bg-white p-3 hover:border-primary/40">
    <span class="block text-xs text-slate-500">${label}</span>
    <span class="mt-1 block truncate text-lg font-bold tabular-nums ${tone}">${value}</span>
    <span class="block truncate text-xs text-slate-500">${detail}</span>
  </a>`;
}

function plural(count, one, many) {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

/** Bloco financeiro (só chega da API para quem tem finance.view). Definições na FASE-0, D4. */
function financeCard(finance) {
  return html`<section class="card">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="flex items-center gap-2 text-base font-semibold text-slate-900">${icon('wallet', 'size-5 text-primary')} Financeiro do mês</h2>
      <a href="/app/financeiro" class="link text-sm">Abrir o Financeiro</a>
    </div>
    <div class="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
      ${indicator({
        label: 'A pagar vencido',
        value: formatCents(finance.overdue.open_cents),
        detail: plural(finance.overdue.count, 'despesa', 'despesas'),
        href: '/app/financeiro?aba=overdue',
        tone: finance.overdue.count > 0 ? 'text-red-700' : 'text-slate-900',
      })}
      ${indicator({
        label: `Vence em ${finance.due_soon.days} dias`,
        value: formatCents(finance.due_soon.open_cents),
        detail: plural(finance.due_soon.count, 'despesa', 'despesas'),
        href: '/app/financeiro?aba=upcoming',
        tone: 'text-amber-700',
      })}
      ${indicator({
        label: 'Pago no mês',
        value: formatCents(finance.paid_in_period.amount_cents),
        detail: plural(finance.paid_in_period.count, 'pagamento', 'pagamentos'),
        href: '/app/financeiro?aba=paid',
        tone: 'text-green-700',
      })}
      ${indicator({
        label: 'Despesas do mês',
        value: formatCents(finance.expenses_in_period.amount_cents),
        detail: plural(finance.expenses_in_period.count, 'despesa', 'despesas'),
        href: '/app/financeiro?aba=all',
        tone: 'text-slate-900',
      })}
    </div>
  </section>`;
}

/** Alerta de validade: vencidos e vencendo nos próximos 30 dias (calculado no fuso da empresa). */
function expiringCard(documents, total) {
  return html`<section class="card">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="flex items-center gap-2 text-base font-semibold text-slate-900">
        ${icon('calendar-clock', 'size-5 text-amber-600')} Documentos vencendo</h2>
      <a href="/app/documentos?aba=vencendo" class="link text-sm">Ver ${total > documents.length ? `todos (${total})` : 'na Central'}</a>
    </div>
    <div class="mt-4">${documentList(documents, { actions: false })}</div>
  </section>`;
}

function upcomingCard() {
  return html`<section class="card">
    <h2 class="text-base font-semibold text-slate-900">Em breve na sua central</h2>
    <ul class="mt-4 grid gap-3 min-[480px]:grid-cols-2">
      ${UPCOMING.map(
        (item) => html`<li class="flex min-w-0 items-start gap-3 rounded-xl bg-slate-50 p-3">
          <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-white text-primary shadow-xs">${item.icon()}</span>
          <span class="min-w-0"><span class="block text-sm font-medium text-slate-900">${item.title}</span>
            <span class="block text-sm text-slate-500">${item.text}</span></span>
        </li>`,
      )}
    </ul>
  </section>`;
}

export default {
  title: 'Início',

  render() {
    const user = getUser();
    return html`
      <h1 class="text-2xl font-bold tracking-tight text-slate-900">Olá, ${firstName(user.name)}!</h1>
      <p class="mt-1 text-slate-600">${currentContext()?.company.name}</p>
      <div class="mt-6 space-y-4">
        ${user.email_verified ? '' : verificationBanner()}
        <div data-finance>${can('finance.view') ? loadingState('Somando o mês…') : ''}</div>
        <div data-setup>${can('company.view') ? loadingState('Conferindo o cadastro…') : ''}</div>
        <div data-expiring></div>
        ${upcomingCard()}
      </div>`;
  },

  mount(root) {
    root.querySelector('[data-action="resend"]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const { data } = await api('/auth/email/resend', { method: 'POST', body: {} });
        toast(data.status === 'already_verified' ? 'Seu e-mail já está confirmado.' : 'Enviamos um novo link para o seu e-mail.', {
          type: 'success',
        });
      } catch (err) {
        toast(err.message, { type: 'error' });
      } finally {
        button.disabled = false;
      }
    });

    const finance = root.querySelector('[data-finance]');
    if (can('dashboard.view')) {
      api('/dashboard?period=this_month')
        .then(({ data }) => {
          if (finance.isConnected) setContent(finance, data.finance ? financeCard(data.finance) : html``);
        })
        .catch((err) => {
          if (finance.isConnected && can('finance.view')) setContent(finance, errorState({ message: err.message }));
        });
    }

    const expiring = root.querySelector('[data-expiring]');
    if (can('documents.view')) {
      api('/documents?expiring=true&sort=expires_on&limit=5')
        .then(({ data, meta }) => {
          if (expiring.isConnected && data.documents.length > 0) setContent(expiring, expiringCard(data.documents, meta.total));
        })
        // O alerta é complementar: sem ele, o Início continua útil.
        .catch(() => {});
    }

    const setup = root.querySelector('[data-setup]');
    if (!can('company.view')) return;
    Promise.all([api('/company'), api('/company/contacts')])
      .then(([profile, contacts]) => {
        if (!setup.isConnected) return;
        setContent(setup, setupCard(setupSteps(profile.data.company, contacts.data.contacts)));
      })
      .catch((err) => {
        if (setup.isConnected) setContent(setup, errorState({ message: err.message }));
      });
  },
};

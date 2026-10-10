// Início do painel na F1: conta, confirmação de e-mail e segurança da sessão.
// O dashboard administrativo substitui esta tela a partir da F2.
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { toast } from '../components/toast.js';
import { html } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { firstName } from '../lib/text.js';
import { api } from '../services/api.js';
import { getUser, logoutEverywhere } from '../services/session.js';

function verificationBanner() {
  return html`<section class="alert alert-warning flex-col items-start gap-3 sm:flex-row sm:items-center" data-verify-banner>
    <span class="flex items-start gap-2">${icon('mail', 'mt-0.5 size-5 shrink-0')}
      <span><strong>Confirme seu e-mail.</strong> Enviamos um link quando você criou a conta. A confirmação será
        necessária para ativar a sua empresa.</span></span>
    <button type="button" class="btn btn-secondary btn-sm shrink-0 sm:ml-auto" data-action="resend">Reenviar e-mail</button>
  </section>`;
}

export default {
  title: 'Início',

  render() {
    const user = getUser();
    return html`
      <h1 class="text-2xl font-bold tracking-tight text-slate-900">Olá, ${firstName(user.name)}!</h1>
      <p class="mt-1 text-slate-600">Bem-vindo ao ZEVS Nexus.</p>
      <div class="mt-6 space-y-4">
        ${user.email_verified ? '' : verificationBanner()}
        <section class="card">
          <h2 class="text-base font-semibold text-slate-900">Sua conta</h2>
          <dl class="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div class="min-w-0"><dt class="text-slate-500">Nome</dt><dd class="truncate font-medium">${user.name}</dd></div>
            <div class="min-w-0"><dt class="text-slate-500">E-mail</dt><dd class="truncate font-medium">${user.email}</dd></div>
          </dl>
        </section>
        <section class="card">
          <h2 class="text-base font-semibold text-slate-900">Segurança</h2>
          <p class="mt-1 text-sm text-slate-600">Perdeu um aparelho ou entrou num computador que não é seu? Encerre todas as sessões abertas.</p>
          <button type="button" class="btn btn-secondary btn-sm mt-4 w-full sm:w-auto" data-action="logout-all">${icon('monitor-smartphone', 'size-4')} Sair de todos os dispositivos</button>
        </section>
        <section class="card border-dashed bg-slate-50/60">
          <h2 class="text-base font-semibold text-slate-900">Em breve</h2>
          <p class="mt-1 text-sm text-slate-600">Empresa, documentos, financeiro, planilhas e notas fiscais em uma central única.</p>
        </section>
      </div>`;
  },

  mount(root, { navigate }) {
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

    root.querySelector('[data-action="logout-all"]').addEventListener('click', async () => {
      const confirmed = await ConfirmDialog.ask({
        title: 'Sair de todos os dispositivos?',
        message: 'Todas as sessões abertas, inclusive esta, serão encerradas. Você vai precisar entrar de novo.',
        confirmLabel: 'Sair de todos',
      });
      if (!confirmed) return;
      try {
        await logoutEverywhere();
        toast('Todas as sessões foram encerradas.', { type: 'success' });
        navigate('/login', { replace: true });
      } catch (err) {
        toast(err.message, { type: 'error' });
      }
    });
  },
};

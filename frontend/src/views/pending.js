// Empresa em análise ou suspensa: explica o que acontece e deixa conferir de novo.
import { toast } from '../components/toast.js';
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { logout } from '../services/session.js';
import { currentCompany, isPlatformAdmin, loadMe } from '../services/tenant.js';

function panel(company) {
  const suspended = company?.status === 'suspended' || company?.membership_status === 'suspended';
  return html`<div class="text-center">
    <span class="mx-auto mb-4 grid size-12 place-items-center rounded-full ${suspended ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}">
      ${suspended ? icon('circle-alert', 'size-6') : icon('clock', 'size-6')}
    </span>
    <h1 class="title">${suspended ? 'Acesso suspenso' : 'Empresa em análise'}</h1>
    ${
      suspended
        ? html`<p class="subtitle">O acesso a <strong class="text-slate-900">${company?.name}</strong> está suspenso.
            Fale com a equipe ZEVS para saber mais.</p>`
        : html`<p class="subtitle">Recebemos o cadastro de <strong class="text-slate-900">${company?.name}</strong>.
            A equipe ZEVS vai conferir e liberar o acesso. Você recebe um e-mail quando estiver pronto.</p>`
    }
    <div class="mt-6 grid gap-2">
      <button type="button" class="btn btn-primary" data-action="check">Verificar agora</button>
      ${isPlatformAdmin() ? html`<a href="/admin/empresas" class="btn btn-secondary">Painel ZEVS</a>` : ''}
      <button type="button" class="btn btn-ghost" data-action="logout">Sair</button>
    </div>
  </div>`;
}

function bind(root, navigate) {
  root.querySelector('[data-action="check"]').addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    await loadMe();
    const company = currentCompany();
    if (company?.status === 'active' && company.membership_status === 'active') {
      toast('Empresa liberada. Bem-vindo!', { type: 'success' });
      navigate('/app', { replace: true });
      return;
    }
    setContent(root, panel(company));
    toast(company?.status === 'pending' ? 'Ainda em análise.' : 'O acesso continua suspenso.', { type: 'info' });
    bind(root, navigate);
  });
  root.querySelector('[data-action="logout"]').addEventListener('click', async () => {
    await logout();
    navigate('/login', { replace: true });
  });
}

export default {
  title: 'Aguardando aprovação',

  render: () => panel(currentCompany()),

  mount(root, { navigate }) {
    if (!currentCompany()) {
      navigate('/app/onboarding', { replace: true });
      return;
    }
    if (currentCompany().status === 'active' && currentCompany().membership_status === 'active') {
      navigate('/app', { replace: true });
      return;
    }
    bind(root, navigate);
  },
};

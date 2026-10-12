// Layout do painel: sidebar no desktop, cabeçalho + barra inferior no celular (pág. 10).
// Montado uma vez por empresa; a cada navegação só o item ativo muda (update).
import { brandMark } from '../components/brand.js';
import { bottomBar, markActive, sidebarNav, splitNavItems, visibleNavItems } from '../components/nav.js';
import { toast } from '../components/toast.js';
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { firstName } from '../lib/text.js';
import { getUser, logout } from '../services/session.js';
import { companies, currentCompany, isPlatformAdmin, selectCompany } from '../services/tenant.js';

function companySwitcher(list, current) {
  if (list.length < 2) {
    return html`<p class="truncate text-sm font-medium text-slate-700" title="${current?.name ?? ''}">${current?.name ?? ''}</p>`;
  }
  return html`<label class="block">
    <span class="sr-only">Empresa</span>
    <select class="input h-11 text-sm" data-action="switch-company">
      ${list.map(
        (company) => html`<option value="${company.id}" ${company.id === current?.id ? html`selected` : ''}>${company.name}${company.status === 'active' ? '' : ' (em análise)'}</option>`,
      )}
    </select>
  </label>`;
}

function moreSheet(items, { admin, list, current }) {
  return html`<dialog class="sheet" aria-label="Mais opções">
    <div class="space-y-1">
      ${list.length > 1 ? html`<div class="px-1 pb-3">${companySwitcher(list, current)}</div>` : ''}
      ${items.map((item) => html`<a href="${item.path}" class="nav-link" data-close>${item.icon()}<span>${item.label}</span></a>`)}
      ${admin ? html`<a href="/admin/empresas" class="nav-link" data-close>${icon('shield-check')}<span>Painel ZEVS</span></a>` : ''}
      <button type="button" class="nav-link w-full" data-action="logout">${icon('log-out')}<span>Sair</span></button>
    </div>
    <button type="button" class="btn btn-secondary mt-4 w-full" data-close>Fechar</button>
  </dialog>`;
}

export function mountAppLayout(root, { navigate }) {
  const user = getUser();
  const list = companies();
  const current = currentCompany();
  const items = visibleNavItems();
  const { shortcuts, more } = splitNavItems(items);
  const pathname = window.location.pathname;
  const admin = isPlatformAdmin();

  setContent(
    root,
    html`<div class="min-h-dvh lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside class="sidebar">
        <a href="/app" class="rounded-lg" aria-label="ZEVS Nexus — início">${brandMark({ subtitle: false })}</a>
        <div class="mt-6">${companySwitcher(list, current)}</div>
        <div class="mt-6 flex-1">${sidebarNav(items, pathname)}</div>
        <div class="space-y-1 border-t border-slate-200 pt-4">
          <p class="truncate px-3 text-sm text-slate-500">${icon('user', 'mr-1 inline size-4 align-[-2px]')}${user?.name}</p>
          ${admin ? html`<a href="/admin/empresas" class="nav-link">${icon('shield-check')}<span>Painel ZEVS</span></a>` : ''}
          <button type="button" class="nav-link w-full" data-action="logout">${icon('log-out')}<span>Sair</span></button>
        </div>
      </aside>
      <div class="min-w-0">
        <header class="app-header lg:hidden">
          <div class="flex h-16 items-center justify-between gap-3 px-4">
            <a href="/app" aria-label="ZEVS Nexus — início">${brandMark({ subtitle: false })}</a>
            <span class="min-w-0 truncate text-sm font-medium text-slate-600">${current?.name ?? ''}</span>
          </div>
        </header>
        <main id="conteudo" class="app-main" data-outlet></main>
      </div>
      ${bottomBar(shortcuts, pathname)}
      ${moreSheet(more, { admin, list, current })}
    </div>`,
  );

  async function doLogout() {
    await logout();
    toast(`Até logo, ${firstName(user?.name)}!`, { type: 'success' });
    navigate('/login', { replace: true });
  }

  for (const button of root.querySelectorAll('[data-action="logout"]')) button.addEventListener('click', doLogout);

  for (const select of root.querySelectorAll('[data-action="switch-company"]')) {
    select.addEventListener('change', async (event) => {
      await selectCompany(event.target.value);
      navigate('/app', { replace: true });
    });
  }

  const sheet = root.querySelector('.sheet');
  root.querySelector('[data-action="more"]')?.addEventListener('click', () => sheet.showModal());
  for (const element of sheet.querySelectorAll('[data-close]')) element.addEventListener('click', () => sheet.close());

  return {
    outlet: root.querySelector('[data-outlet]'),
    update(path) {
      markActive(root, path);
    },
  };
}

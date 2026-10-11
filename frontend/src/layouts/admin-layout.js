// Layout do Painel ZEVS (/admin): separado do painel da empresa, sem marca de tenant.
import { brandMark } from '../components/brand.js';
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { logout } from '../services/session.js';
import { companies } from '../services/tenant.js';

export function mountAdminLayout(root, { navigate }) {
  setContent(
    root,
    html`<div class="min-h-dvh">
      <header class="app-header">
        <div class="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3 px-4">
          <div class="flex min-w-0 items-center gap-3">
            ${brandMark({ subtitle: false })}
            <span class="hidden rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white sm:inline">Painel ZEVS</span>
          </div>
          <div class="flex items-center gap-1">
            ${companies().length > 0 ? html`<a href="/app" class="btn btn-ghost btn-sm">${icon('arrow-left')}<span class="hidden sm:inline">Voltar ao app</span></a>` : ''}
            <button type="button" class="btn btn-ghost btn-sm" data-action="logout">${icon('log-out', 'size-4')} Sair</button>
          </div>
        </div>
      </header>
      <main id="conteudo" class="mx-auto w-full max-w-5xl px-4 py-6 sm:py-8" data-outlet></main>
    </div>`,
  );
  root.querySelector('[data-action="logout"]').addEventListener('click', async () => {
    await logout();
    navigate('/login', { replace: true });
  });
  return { outlet: root.querySelector('[data-outlet]'), update() {} };
}

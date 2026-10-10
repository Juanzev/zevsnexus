// Layout do painel. Na F1 é só o cabeçalho com a conta; a navegação (sidebar no desktop e
// barra inferior no celular) chega com os módulos, a partir da F2.
import { brandMark } from '../components/brand.js';
import { toast } from '../components/toast.js';
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { firstName } from '../lib/text.js';
import { getUser, logout } from '../services/session.js';

export function mountAppLayout(root, { navigate }) {
  const user = getUser();
  setContent(
    root,
    html`<div class="min-h-dvh">
      <header class="app-header">
        <div class="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-4">
          <a href="/app" class="rounded-lg focus-visible:outline-2" aria-label="ZEVS Nexus — início">${brandMark({ subtitle: false })}</a>
          <div class="flex min-w-0 items-center gap-2">
            <span class="hidden min-w-0 truncate text-sm text-slate-600 sm:block">${icon('user', 'mr-1 inline size-4 align-[-2px]')}${firstName(user?.name)}</span>
            <button type="button" class="btn btn-ghost btn-sm" data-action="logout">${icon('log-out', 'size-4')} Sair</button>
          </div>
        </div>
      </header>
      <main id="conteudo" class="mx-auto w-full max-w-5xl px-4 py-6 sm:py-8" data-outlet></main>
    </div>`,
  );

  root.querySelector('[data-action="logout"]').addEventListener('click', async () => {
    await logout();
    toast('Você saiu da sua conta.', { type: 'success' });
    navigate('/login', { replace: true });
  });

  return { outlet: root.querySelector('[data-outlet]') };
}

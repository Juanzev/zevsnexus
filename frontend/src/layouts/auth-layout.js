// Layout das telas de acesso: cartão central, marca no topo. Funciona de 320 px ao desktop.
import { brandMark } from '../components/brand.js';
import { html, setContent } from '../lib/html.js';

export function mountAuthLayout(root) {
  setContent(
    root,
    html`<div class="auth-shell">
      <header class="mx-auto w-full max-w-md px-4 pt-8 pb-6 sm:pt-16">${brandMark()}</header>
      <main id="conteudo" class="mx-auto w-full max-w-md px-4 pb-12">
        <div class="card" data-outlet></div>
      </main>
    </div>`,
  );
  return { outlet: root.querySelector('[data-outlet]') };
}

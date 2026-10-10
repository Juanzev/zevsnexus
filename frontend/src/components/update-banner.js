// Banner "Nova versão → Atualizar" (pág. 11): limpa os caches do navegador e recarrega.
import { html, setContent } from '../lib/html.js';
import { icon } from '../lib/icons.js';

async function clearCachesAndReload() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } finally {
    window.location.reload();
  }
}

export function showUpdateBanner() {
  if (document.getElementById('update-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'update-banner';
  banner.setAttribute('role', 'status');
  banner.className = 'update-banner';
  setContent(
    banner,
    html`<span class="flex items-center gap-2">${icon('sparkles', 'size-5 shrink-0')} Nova versão do ZEVS Nexus disponível.</span>
      <button type="button" class="btn btn-light btn-sm" data-action="update">${icon('refresh-cw', 'size-4')} Atualizar</button>`,
  );
  banner.querySelector('[data-action="update"]').addEventListener('click', clearCachesAndReload);
  document.body.append(banner);
}

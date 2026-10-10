import { html } from '../lib/html.js';
import { icon } from '../lib/icons.js';

export function brandMark({ subtitle = true } = {}) {
  return html`<div class="flex items-center gap-3">
    <span class="grid size-10 place-items-center rounded-xl bg-primary text-white shadow-sm">${icon('layers', 'size-6')}</span>
    <span class="leading-tight">
      <span class="block text-lg font-bold tracking-tight text-slate-900">ZEVS Nexus</span>
      ${subtitle ? html`<span class="block text-xs text-slate-500">Central de Organização Empresarial</span>` : ''}
    </span>
  </div>`;
}

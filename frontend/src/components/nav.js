// Navegação do painel (pág. 10): sidebar no desktop (≥ 1024 px) e, no celular, barra inferior "de
// vidro" com até 4 atalhos + "Mais". Os módulos entram aqui conforme as fases; cada item só aparece
// para quem tem a permissão (o backend continua sendo quem autoriza). `bar: false` deixa o item fora
// dos atalhos da barra inferior (fica no "Mais"), sem mudar a ordem da sidebar.
import { html } from '../lib/html.js';
import { icon } from '../lib/icons.js';
import { can } from '../services/tenant.js';

export const NAV_ITEMS = Object.freeze([
  { path: '/app', label: 'Início', icon: () => icon('house'), permission: 'dashboard.view' },
  { path: '/app/financeiro', label: 'Financeiro', icon: () => icon('wallet'), permission: 'finance.view' },
  { path: '/app/documentos', label: 'Documentos', icon: () => icon('folder-open'), permission: 'documents.view' },
  { path: '/app/planilhas', label: 'Planilhas', icon: () => icon('sheet'), permission: 'spreadsheets.view', bar: false },
  { path: '/app/prestadores', label: 'Prestadores', icon: () => icon('users'), permission: 'parties.view' },
  { path: '/app/empresa', label: 'Empresa', icon: () => icon('building-2'), permission: 'company.view' },
  // `short`: rótulo da barra inferior, onde cabem ~10 caracteres a 375 px.
  { path: '/app/configuracoes', label: 'Configurações', short: 'Ajustes', icon: () => icon('settings') },
]);

const BOTTOM_BAR_SLOTS = 4;

export function visibleNavItems() {
  return NAV_ITEMS.filter((item) => !item.permission || can(item.permission));
}

/** Atalhos da barra inferior e o resto (menu "Mais"). */
export function splitNavItems(items) {
  const shortcuts = items.filter((item) => item.bar !== false).slice(0, BOTTOM_BAR_SLOTS);
  return { shortcuts, more: items.filter((item) => !shortcuts.includes(item)) };
}

export function isActive(item, pathname) {
  return item.path === '/app' ? pathname === '/app' : pathname === item.path || pathname.startsWith(`${item.path}/`);
}

export function sidebarNav(items, pathname) {
  return html`<nav aria-label="Principal" class="space-y-1">
    ${items.map(
      (item) => html`<a href="${item.path}" class="nav-link" data-nav="${item.path}" ${isActive(item, pathname) ? html`aria-current="page"` : ''}>
        ${item.icon()}<span>${item.label}</span></a>`,
    )}
  </nav>`;
}

/** Barra inferior: os atalhos + "Mais" (que abre o menu com o resto). */
export function bottomBar(shortcuts, pathname) {
  return html`<div class="bottom-bar-wrapper lg:hidden">
    <nav aria-label="Atalhos" class="bottom-bar backdrop-blur-[18px] backdrop-saturate-[1.8]">
      ${shortcuts.map(
        (item) => html`<a href="${item.path}" class="bottom-bar-item" data-nav="${item.path}" ${isActive(item, pathname) ? html`aria-current="page"` : ''}>
          ${item.icon()}<span>${item.short ?? item.label}</span></a>`,
      )}
      <button type="button" class="bottom-bar-item" data-action="more" aria-haspopup="dialog">
        ${icon('ellipsis')}<span>Mais</span></button>
    </nav>
  </div>`;
}

/** Atualiza o item ativo sem remontar o layout. */
export function markActive(root, pathname) {
  for (const link of root.querySelectorAll('[data-nav]')) {
    const item = NAV_ITEMS.find((candidate) => candidate.path === link.dataset.nav);
    if (item && isActive(item, pathname)) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

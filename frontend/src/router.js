// Router com History API (pág. 09): URLs limpas, um index.html, telas carregadas sob demanda.
// Links internos (<a href="/...">) são interceptados; o backend devolve o index.html em qualquer rota.
// O layout é montado uma vez e só atualizado entre telas; remountLayout() força remontar
// (troca de empresa, marca nova, login/logout).
import { errorState, loadingState } from './components/states.js';
import { guard } from './guards.js';
import { mountAdminLayout } from './layouts/admin-layout.js';
import { mountAppLayout } from './layouts/app-layout.js';
import { mountAuthLayout } from './layouts/auth-layout.js';
import { html, setContent } from './lib/html.js';
import { forbiddenView, matchRoute, notFoundRoute } from './routes.js';

const LAYOUTS = { auth: mountAuthLayout, app: mountAppLayout, admin: mountAdminLayout };
const root = () => document.getElementById('app');

let layout = null;
let layoutName = null;
let cleanup = null;
let renderId = 0;
let currentRoute = null;

export function getCurrentRoute() {
  return currentRoute;
}

export async function navigate(to, { replace = false } = {}) {
  const url = new URL(to, window.location.origin);
  if (url.origin !== window.location.origin) {
    window.location.assign(url.href);
    return;
  }
  const target = `${url.pathname}${url.search}${url.hash}`;
  if (replace) window.history.replaceState(null, '', target);
  else window.history.pushState(null, '', target);
  await render();
}

function context() {
  return { query: new URLSearchParams(window.location.search), params: currentRoute?.params ?? {}, navigate };
}

function showLoadError(outlet) {
  setContent(
    outlet,
    errorState({
      message: 'Verifique sua conexão. Se o problema continuar, recarregue a página.',
      action: html`<button type="button" class="btn btn-primary" data-action="reload">Recarregar</button>`,
    }),
  );
  outlet.querySelector('[data-action="reload"]').addEventListener('click', () => window.location.reload());
}

async function render() {
  const id = ++renderId;
  const route = matchRoute(window.location.pathname) ?? notFoundRoute;

  if (route.redirect) {
    await navigate(route.redirect, { replace: true });
    return;
  }

  let decision;
  try {
    decision = await guard(route, window.location);
  } catch {
    decision = 'error';
  }
  if (id !== renderId) return;
  if (decision && decision !== 'forbidden' && decision !== 'error') {
    await navigate(decision, { replace: true });
    return;
  }

  cleanup?.();
  cleanup = null;
  currentRoute = route;

  if (route.layout !== layoutName || !layout) {
    layout = LAYOUTS[route.layout](root(), context());
    layoutName = route.layout;
  } else {
    layout.update(window.location.pathname);
  }
  const { outlet } = layout;

  if (decision === 'error') {
    showLoadError(outlet);
    return;
  }
  setContent(outlet, loadingState());

  let view;
  try {
    view = (await (decision === 'forbidden' ? forbiddenView() : route.view())).default;
  } catch {
    if (id === renderId) showLoadError(outlet);
    return;
  }
  // Uma navegação mais nova começou enquanto esta tela carregava.
  if (id !== renderId) return;

  const ctx = context();
  document.title = view.title ? `${view.title} · ZEVS Nexus` : 'ZEVS Nexus';
  setContent(outlet, view.render(ctx));
  cleanup = view.mount?.(outlet, ctx) ?? null;

  // Leitor de tela anuncia a tela nova: foco no título principal.
  const heading = outlet.querySelector('h1');
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
  window.scrollTo(0, 0);
}

function onLinkClick(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.target.closest('a[href]');
  if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
  const url = new URL(anchor.href);
  if (url.origin !== window.location.origin || url.pathname.startsWith('/api/')) return;
  event.preventDefault();
  navigate(`${url.pathname}${url.search}${url.hash}`);
}

export function startRouter() {
  document.addEventListener('click', onLinkClick);
  window.addEventListener('popstate', render);
  return render();
}

/** Reavalia a rota atual (ex.: a sessão caiu em outra aba). */
export function refreshRoute() {
  return render();
}

/** Remonta o layout na próxima renderização (empresa, marca ou usuário mudaram). */
export function remountLayout() {
  layout = null;
}

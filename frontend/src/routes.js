// Tabela de rotas (pág. 09). Cada tela é um arquivo carregado sob demanda.
// Campos de guarda: ver src/guards.js.
export const routes = [
  { path: '/', redirect: '/app' },
  { path: '/login', access: 'guest', layout: 'auth', view: () => import('./views/login.js') },
  { path: '/cadastro', access: 'guest', layout: 'auth', view: () => import('./views/register.js') },
  { path: '/recuperar-senha', access: 'guest', layout: 'auth', view: () => import('./views/forgot-password.js') },
  { path: '/redefinir-senha', access: 'public', layout: 'auth', view: () => import('./views/reset-password.js') },
  { path: '/verificar-email', access: 'public', layout: 'auth', view: () => import('./views/verify-email.js') },

  { path: '/app/onboarding', access: 'auth', onboarding: true, layout: 'auth', view: () => import('./views/onboarding.js') },
  { path: '/app/aguardando-aprovacao', access: 'auth', layout: 'auth', view: () => import('./views/pending.js') },
  { path: '/app', access: 'auth', tenant: true, permission: 'dashboard.view', layout: 'app', view: () => import('./views/home.js') },
  { path: '/app/empresa', access: 'auth', tenant: true, permission: 'company.view', layout: 'app', view: () => import('./views/company.js') },
  { path: '/app/configuracoes', access: 'auth', tenant: true, layout: 'app', view: () => import('./views/settings.js') },

  { path: '/admin', redirect: '/admin/empresas' },
  { path: '/admin/empresas', access: 'auth', platform: true, layout: 'admin', view: () => import('./views/admin-companies.js') },
];

export const notFoundRoute = { path: '*', access: 'public', layout: 'auth', view: () => import('./views/not-found.js') };
export const forbiddenView = () => import('./views/forbidden.js');

export function matchRoute(pathname) {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return routes.find((route) => route.path === normalized) ?? null;
}

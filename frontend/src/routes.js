// Tabela de rotas. `access`: guest (só deslogado), auth (só logado) ou public (ambos).
// Cada tela é um arquivo carregado sob demanda (pág. 09).
export const routes = [
  { path: '/', redirect: '/app' },
  { path: '/login', access: 'guest', layout: 'auth', view: () => import('./views/login.js') },
  { path: '/cadastro', access: 'guest', layout: 'auth', view: () => import('./views/register.js') },
  { path: '/recuperar-senha', access: 'guest', layout: 'auth', view: () => import('./views/forgot-password.js') },
  { path: '/redefinir-senha', access: 'public', layout: 'auth', view: () => import('./views/reset-password.js') },
  { path: '/verificar-email', access: 'public', layout: 'auth', view: () => import('./views/verify-email.js') },
  { path: '/app', access: 'auth', layout: 'app', view: () => import('./views/home.js') },
];

export const notFoundRoute = { path: '*', access: 'public', layout: 'auth', view: () => import('./views/not-found.js') };

export function matchRoute(pathname) {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return routes.find((route) => route.path === normalized) ?? null;
}

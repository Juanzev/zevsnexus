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
  { path: '/app/documentos', access: 'auth', tenant: true, permission: 'documents.view', layout: 'app', view: () => import('./views/documents.js') },
  { path: '/app/documentos/pasta/:folderId', access: 'auth', tenant: true, permission: 'documents.view', layout: 'app', view: () => import('./views/documents.js') },
  { path: '/app/documentos/:id', access: 'auth', tenant: true, permission: 'documents.view', layout: 'app', view: () => import('./views/document.js') },
  { path: '/app/empresa', access: 'auth', tenant: true, permission: 'company.view', layout: 'app', view: () => import('./views/company.js') },
  { path: '/app/configuracoes', access: 'auth', tenant: true, layout: 'app', view: () => import('./views/settings.js') },

  { path: '/admin', redirect: '/admin/empresas' },
  { path: '/admin/empresas', access: 'auth', platform: true, layout: 'admin', view: () => import('./views/admin-companies.js') },
];

export const notFoundRoute = { path: '*', access: 'public', layout: 'auth', view: () => import('./views/not-found.js') };
export const forbiddenView = () => import('./views/forbidden.js');

/** Compara segmento a segmento; ":nome" captura um segmento (sem "/"). */
function matchPath(pattern, pathname) {
  const expected = pattern.split('/');
  const actual = pathname.split('/');
  if (expected.length !== actual.length) return null;
  const params = {};
  for (let index = 0; index < expected.length; index += 1) {
    const segment = expected[index];
    if (segment.startsWith(':')) {
      if (!actual[index]) return null;
      try {
        params[segment.slice(1)] = decodeURIComponent(actual[index]);
      } catch {
        return null;
      }
    } else if (segment !== actual[index]) {
      return null;
    }
  }
  return params;
}

/** Rota da URL com os parâmetros do caminho (ex.: { params: { id } }), ou null. Rotas fixas vencem. */
export function matchRoute(pathname) {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const exact = routes.find((route) => route.path === normalized);
  if (exact) return { ...exact, params: {} };
  for (const route of routes) {
    if (!route.path.includes(':')) continue;
    const params = matchPath(route.path, normalized);
    if (params) return { ...route, params };
  }
  return null;
}

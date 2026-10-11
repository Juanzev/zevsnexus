// Guardas de rota na ordem da pág. 09: auth → tenant → permission → feature (+ plataforma).
// Só escondem e redirecionam; quem autoriza é o backend.
//   route.access    'guest' (só deslogado) | 'auth' (só logado) | 'public' (ambos)
//   route.tenant    exige empresa ATIVA selecionada
//   route.permission / route.feature   código exigido no contexto da empresa
//   route.platform  exige ser da equipe ZEVS
// Devolve: caminho para redirecionar, 'forbidden' (mostra "sem acesso") ou null (pode abrir).
import { isAuthenticated } from './services/session.js';
import {
  can,
  companies,
  currentCompany,
  currentContext,
  hasFeature,
  isLoaded,
  isPlatformAdmin,
  loadContext,
  loadMe,
} from './services/tenant.js';

export async function guard(route, location) {
  if (route.access === 'auth' && !isAuthenticated()) {
    return `/login?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`;
  }
  if (route.access === 'guest') return isAuthenticated() ? '/app' : null;
  if (!isAuthenticated()) return null;

  if (!isLoaded()) await loadMe();

  if (route.platform && !isPlatformAdmin()) return 'forbidden';

  if (route.onboarding && companies().length > 0) return '/app';

  if (route.tenant) {
    const company = currentCompany();
    if (!company) return isPlatformAdmin() ? '/admin/empresas' : '/app/onboarding';
    if (company.status !== 'active' || company.membership_status !== 'active') return '/app/aguardando-aprovacao';
    if (!currentContext()) await loadContext();
  }

  if (route.permission && !can(route.permission)) return 'forbidden';
  if (route.feature && !hasFeature(route.feature)) return 'forbidden';
  return null;
}

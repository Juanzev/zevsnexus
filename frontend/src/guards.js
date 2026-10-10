// Guardas de rota (pág. 09): auth → tenant → permission → feature. Só escondem e redirecionam;
// quem autoriza é o backend. Tenant, permissão e feature entram na F2.
import { isAuthenticated } from './services/session.js';

/** Devolve o caminho para onde redirecionar, ou null se a rota pode abrir. */
export function guard(route, location) {
  if (route.access === 'auth' && !isAuthenticated()) {
    const next = `${location.pathname}${location.search}`;
    return `/login?next=${encodeURIComponent(next)}`;
  }
  if (route.access === 'guest' && isAuthenticated()) return '/app';
  return null;
}

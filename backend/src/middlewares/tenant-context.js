// Camada 1 do isolamento (pág. 03): o tenant NUNCA vem do frontend como verdade.
// X-Company-Id é a intenção; aqui ela vira req.tenant só com membership ativa em empresa ativa.
//   ausente                                   → 400 COMPANY_REQUIRED
//   inválido, inexistente, alheio ou excluído → 404 COMPANY_NOT_FOUND (sempre igual)
//   vínculo existe, mas suspenso/pendente      → 403 com código
import { resolveTenantContext } from '../modules/memberships/memberships.service.js';
import { isUuid } from '../shared/db.js';
import { AuthorizationError, BadRequestError, NotFoundError } from '../shared/errors.js';

function notFound() {
  return new NotFoundError('COMPANY_NOT_FOUND', 'Empresa não encontrada.');
}

export async function tenantContext(req, _res, next) {
  const companyId = req.get('x-company-id');
  if (!companyId) throw new BadRequestError('COMPANY_REQUIRED', 'Selecione uma empresa.');
  if (!isUuid(companyId)) throw notFound();

  const context = await resolveTenantContext(req.user.id, companyId);
  if (!context) throw notFound();

  if (context.membershipStatus !== 'active') {
    throw new AuthorizationError('MEMBERSHIP_SUSPENDED', 'Seu acesso a esta empresa está suspenso.');
  }
  if (context.companyStatus === 'pending') {
    throw new AuthorizationError('COMPANY_PENDING', 'A empresa ainda está em análise pela equipe ZEVS.');
  }
  if (context.companyStatus !== 'active') {
    throw new AuthorizationError('COMPANY_SUSPENDED', 'O acesso a esta empresa está suspenso.');
  }

  req.tenant = Object.freeze(context);
  next();
}

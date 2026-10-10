// Autorização por permissão e por feature (pág. 05 e 13). O frontend só esconde; quem decide é aqui.
import { isPlatformAdmin } from '../modules/platform/platform.service.js';
import { AppError, AuthorizationError } from '../shared/errors.js';

/** Exige TODAS as permissões listadas no contexto do tenant. */
export function requirePermission(...codes) {
  return function checkPermission(req, _res, next) {
    const missing = codes.filter((code) => !req.tenant?.permissions.has(code));
    if (missing.length > 0) {
      throw new AppError(403, 'PERMISSION_DENIED', 'Você não tem permissão para esta ação.', { permissions: missing });
    }
    next();
  };
}

export function requireFeature(code) {
  return function checkFeature(req, _res, next) {
    if (!req.tenant?.features.has(code)) {
      throw new AppError(403, 'FEATURE_DISABLED', 'Este recurso não está disponível no plano da empresa.', {
        feature: code,
      });
    }
    next();
  };
}

/** Painel ZEVS: eixo separado do tenant. Dono de empresa recebe 403. */
export async function requirePlatformAdmin(req, _res, next) {
  if (!(await isPlatformAdmin(req.user))) {
    throw new AuthorizationError('PLATFORM_ADMIN_REQUIRED', 'Acesso restrito à equipe ZEVS.');
  }
  req.platformAdmin = true;
  next();
}

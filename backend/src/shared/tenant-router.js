// Todo router de dados de empresa nasce daqui (pág. 03, camada 1b): authenticate + tenantContext
// antes de qualquer rota. A guarda estática (tests/static/tenant-router.test.js) falha se um
// *.routes.js novo não usar tenantRouter() e não estiver na allowlist justificada.
import { Router } from 'express';
import { authenticate } from '../middlewares/authenticate.js';
import { tenantContext } from '../middlewares/tenant-context.js';

export function tenantRouter() {
  const router = Router();
  router.use(authenticate, tenantContext);
  return router;
}

// /api/v1/dashboard — Início. Os blocos dependem das permissões de quem pede (backend omite valores).
import { requirePermission } from '../../middlewares/authorization.js';
import { tenantRouter } from '../../shared/tenant-router.js';
import { validate } from '../../shared/validation.js';
import * as controller from './dashboard.controller.js';
import { dashboardQuery } from './dashboard.validator.js';

export function createDashboardRouter() {
  const router = tenantRouter();
  router.get('/', requirePermission('dashboard.view'), validate({ query: dashboardQuery }), controller.show);
  return router;
}

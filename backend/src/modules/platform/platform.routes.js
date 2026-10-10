// /api/v1/admin — Painel ZEVS. Fora do tenantRouter por desenho (eixo de plataforma, allowlist da
// guarda estática). Pipeline (pág. 08): authenticate → requirePlatformAdmin → validate → controller.
import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { requirePlatformAdmin } from '../../middlewares/authorization.js';
import { emptyBody, validate } from '../../shared/validation.js';
import * as controller from './platform.controller.js';
import { companyParams, listCompaniesQuery, suspendBody } from './platform.validator.js';

export function createPlatformRouter() {
  const router = Router();
  router.use(authenticate, requirePlatformAdmin);

  router.get('/companies', validate({ query: listCompaniesQuery }), controller.listCompanies);
  router.post('/companies/:id/approve', validate({ params: companyParams, body: emptyBody }), controller.approve);
  router.post('/companies/:id/suspend', validate({ params: companyParams, body: suspendBody }), controller.suspend);
  router.post('/companies/:id/reactivate', validate({ params: companyParams, body: emptyBody }), controller.reactivate);

  return router;
}

// POST /api/v1/companies — onboarding. Fora do tenantRouter por desenho: a empresa ainda não existe
// (allowlist da guarda estática). Pipeline: authenticate → validate → idempotency → controller.
import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate.js';
import { idempotency } from '../../middlewares/idempotency.js';
import { validate } from '../../shared/validation.js';
import * as controller from './companies.controller.js';
import { onboardingBody } from './companies.validator.js';

export function createOnboardingRouter() {
  const router = Router();
  router.post('/', authenticate, validate({ body: onboardingBody }), idempotency(), controller.create);
  return router;
}

// /api/v1/company — dados da empresa atual (X-Company-Id). Pipeline de recurso de tenant (pág. 08):
// authenticate → tenantContext (tenantRouter) → requirePermission → validate → controller.
import { requirePermission } from '../../middlewares/authorization.js';
import { tenantRouter } from '../../shared/tenant-router.js';
import { emptyBody, validate } from '../../shared/validation.js';
import * as controller from './companies.controller.js';
import { companyPatchBody, contactBody, contactParams, contactPatchBody, settingsPatchBody } from './companies.validator.js';

export function createCompanyRouter() {
  const router = tenantRouter();

  // Qualquer membro ativo: a SPA precisa saber o que mostrar.
  router.get('/context', controller.context);

  router.get('/', requirePermission('company.view'), controller.show);
  router.patch('/', requirePermission('company.manage'), validate({ body: companyPatchBody }), controller.update);

  router.get('/settings', requirePermission('settings.manage'), controller.showSettings);
  router.patch('/settings', requirePermission('settings.manage'), validate({ body: settingsPatchBody }), controller.updateSettings);

  router.get('/contacts', requirePermission('company.view'), controller.listContacts);
  router.post('/contacts', requirePermission('company.manage'), validate({ body: contactBody }), controller.createContact);
  router.patch(
    '/contacts/:id',
    requirePermission('company.manage'),
    validate({ params: contactParams, body: contactPatchBody }),
    controller.updateContact,
  );
  router.delete(
    '/contacts/:id',
    requirePermission('company.manage'),
    validate({ params: contactParams, body: emptyBody }),
    controller.deleteContact,
  );

  return router;
}

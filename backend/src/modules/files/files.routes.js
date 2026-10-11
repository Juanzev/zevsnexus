// /api/v1/files — intenção de envio. A confirmação acontece em quem usa o arquivo
// (POST /documents e POST /documents/:id/versions), nunca num "confirmar" solto.
import { requirePermission } from '../../middlewares/authorization.js';
import { tenantRouter } from '../../shared/tenant-router.js';
import { validate } from '../../shared/validation.js';
import * as controller from './files.controller.js';
import { uploadIntentBody } from './files.validator.js';

export function createFilesRouter({ limiters }) {
  const router = tenantRouter();

  router.post(
    '/upload-intents',
    requirePermission('documents.manage'),
    limiters.uploadIntents,
    validate({ body: uploadIntentBody }),
    controller.createUploadIntent,
  );

  return router;
}

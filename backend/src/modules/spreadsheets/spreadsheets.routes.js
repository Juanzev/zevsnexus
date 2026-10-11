// /api/v1/spreadsheets — Planilhas (níveis 1 e 2). Pipeline de tenant:
// tenantRouter → requirePermission → [rate limit] → validate → controller.
import { requirePermission } from '../../middlewares/authorization.js';
import { tenantRouter } from '../../shared/tenant-router.js';
import { validate } from '../../shared/validation.js';
import * as controller from './spreadsheets.controller.js';
import { bulkBody, idParams, previewQuery, spreadsheetListQuery, spreadsheetPatchBody } from './spreadsheets.validator.js';

const VIEW = requirePermission('spreadsheets.view');
const MANAGE = requirePermission('spreadsheets.manage');

export function createSpreadsheetsRouter({ limiters }) {
  const router = tenantRouter();
  router.get('/', VIEW, validate({ query: spreadsheetListQuery }), controller.list);
  router.post('/bulk', MANAGE, validate({ body: bulkBody }), controller.bulk);
  router.get('/:id', VIEW, validate({ params: idParams }), controller.show);
  router.patch('/:id', MANAGE, validate({ params: idParams, body: spreadsheetPatchBody }), controller.update);
  // A prévia baixa e lê o arquivo (CPU): limite por usuário.
  router.get('/:id/preview', VIEW, limiters.previews, validate({ params: idParams, query: previewQuery }), controller.preview);
  return router;
}

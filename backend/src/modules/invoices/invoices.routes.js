// /api/v1/invoices — Notas fiscais emitidas (ARCHITECTURE §14). Cada transição é uma rota própria.
// Pipeline: tenantRouter → requirePermission → validate → [Idempotency-Key] → controller.
import { requirePermission } from '../../middlewares/authorization.js';
import { idempotency } from '../../middlewares/idempotency.js';
import { tenantRouter } from '../../shared/tenant-router.js';
import { emptyBody, validate } from '../../shared/validation.js';
import * as controller from './invoices.controller.js';
import {
  idParams,
  invoiceBody,
  invoiceDocumentBody,
  invoiceDocumentParams,
  invoiceListQuery,
  invoicePatchBody,
  issueBody,
  markPaidBody,
  reasonBody,
} from './invoices.validator.js';

const VIEW = requirePermission('invoices.view');
const MANAGE = requirePermission('invoices.manage');

export function createInvoicesRouter() {
  const router = tenantRouter();
  router.get('/', VIEW, validate({ query: invoiceListQuery }), controller.list);
  router.post('/', MANAGE, validate({ body: invoiceBody }), idempotency(), controller.create);
  router.get('/:id', VIEW, validate({ params: idParams }), controller.show);
  router.patch('/:id', MANAGE, validate({ params: idParams, body: invoicePatchBody }), controller.update);
  router.get('/:id/history', VIEW, validate({ params: idParams }), controller.history);
  router.post('/:id/issue', MANAGE, validate({ params: idParams, body: issueBody }), controller.issue);
  router.post('/:id/cancel', MANAGE, validate({ params: idParams, body: reasonBody }), controller.cancel);
  router.post('/:id/mark-paid', MANAGE, validate({ params: idParams, body: markPaidBody }), controller.markPaid);
  router.post('/:id/unmark-paid', MANAGE, validate({ params: idParams, body: reasonBody }), controller.unmarkPaid);
  router.post('/:id/archive', MANAGE, validate({ params: idParams, body: emptyBody }), controller.archive);
  router.post('/:id/unarchive', MANAGE, validate({ params: idParams, body: emptyBody }), controller.unarchive);
  router.post(
    '/:id/documents',
    MANAGE,
    validate({ params: idParams, body: invoiceDocumentBody }),
    idempotency(),
    controller.linkDocument,
  );
  router.delete(
    '/:id/documents/:documentId',
    MANAGE,
    validate({ params: invoiceDocumentParams, body: emptyBody }),
    controller.unlinkDocument,
  );
  return router;
}

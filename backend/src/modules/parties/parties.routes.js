// /api/v1/parties — prestadores e fornecedores (menu "Prestadores"). Pipeline de tenant:
// authenticate → tenantContext (tenantRouter) → requirePermission → validate → [Idempotency-Key] → controller.
import { requirePermission } from '../../middlewares/authorization.js';
import { idempotency } from '../../middlewares/idempotency.js';
import { tenantRouter } from '../../shared/tenant-router.js';
import { emptyBody, validate } from '../../shared/validation.js';
import { expenseListQuery } from '../finance/finance.validator.js';
import * as controller from './parties.controller.js';
import {
  partyBody,
  partyDocumentBody,
  partyDocumentParams,
  partyListQuery,
  partyParams,
  partyPatchBody,
} from './parties.validator.js';

const VIEW = requirePermission('parties.view');
const MANAGE = requirePermission('parties.manage');

export function createPartiesRouter() {
  const router = tenantRouter();

  router.get('/', VIEW, validate({ query: partyListQuery }), controller.list);
  router.post('/', MANAGE, validate({ body: partyBody }), controller.create);
  router.get('/:id', VIEW, validate({ params: partyParams }), controller.show);
  router.patch('/:id', MANAGE, validate({ params: partyParams, body: partyPatchBody }), controller.update);
  router.delete('/:id', MANAGE, validate({ params: partyParams, body: emptyBody }), controller.remove);

  // Histórico de despesas e pagamentos: valores só para quem vê o financeiro.
  router.get(
    '/:id/expenses',
    VIEW,
    requirePermission('finance.view'),
    validate({ params: partyParams, query: expenseListQuery }),
    controller.expenses,
  );

  router.get('/:id/documents', VIEW, requirePermission('documents.view'), validate({ params: partyParams }), controller.documents);
  router.post(
    '/:id/documents',
    MANAGE,
    validate({ params: partyParams, body: partyDocumentBody }),
    idempotency(),
    controller.linkDocument,
  );
  router.delete(
    '/:id/documents/:documentId',
    MANAGE,
    validate({ params: partyDocumentParams, body: emptyBody }),
    controller.unlinkDocument,
  );

  return router;
}

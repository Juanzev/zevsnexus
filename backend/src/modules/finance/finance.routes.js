// Financeiro (ARCHITECTURE §17.2): /expenses, /expense-payments e /finance-categories.
// Lançar ≠ pagar (D10): finance.manage lança, edita, cancela e anexa; finance.pay registra e estorna
// pagamento. Pipeline: tenantRouter → requirePermission → validate → [Idempotency-Key] → controller.
import { requirePermission } from '../../middlewares/authorization.js';
import { idempotency } from '../../middlewares/idempotency.js';
import { tenantRouter } from '../../shared/tenant-router.js';
import { emptyBody, validate } from '../../shared/validation.js';
import * as controller from './finance.controller.js';
import {
  categoryBody,
  categoryListQuery,
  categoryPatchBody,
  expenseBody,
  expenseDocumentBody,
  expenseDocumentParams,
  expenseListQuery,
  expensePatchBody,
  idParams,
  paymentBody,
  reasonBody,
} from './finance.validator.js';

const VIEW = requirePermission('finance.view');
const MANAGE = requirePermission('finance.manage');
const PAY = requirePermission('finance.pay');

export function createExpensesRouter() {
  const router = tenantRouter();

  router.get('/', VIEW, validate({ query: expenseListQuery }), controller.list);
  // "Já paguei" (corpo com `payment`) exige também finance.pay — conferido no service.
  router.post('/', MANAGE, validate({ body: expenseBody }), idempotency(), controller.create);
  router.get('/:id', VIEW, validate({ params: idParams }), controller.show);
  router.patch('/:id', MANAGE, validate({ params: idParams, body: expensePatchBody }), controller.update);
  router.get('/:id/history', VIEW, validate({ params: idParams }), controller.history);
  router.post('/:id/cancel', MANAGE, validate({ params: idParams, body: reasonBody }), controller.cancel);
  router.post('/:id/payments', PAY, validate({ params: idParams, body: paymentBody }), idempotency(), controller.registerPayment);
  router.post(
    '/:id/documents',
    MANAGE,
    validate({ params: idParams, body: expenseDocumentBody }),
    idempotency(),
    controller.linkDocument,
  );
  router.delete(
    '/:id/documents/:documentId',
    MANAGE,
    validate({ params: expenseDocumentParams, body: emptyBody }),
    controller.unlinkDocument,
  );

  return router;
}

export function createExpensePaymentsRouter() {
  const router = tenantRouter();
  router.post('/:id/void', PAY, validate({ params: idParams, body: reasonBody }), controller.voidPayment);
  return router;
}

export function createFinanceCategoriesRouter() {
  const router = tenantRouter();
  router.get('/', VIEW, validate({ query: categoryListQuery }), controller.listCategories);
  router.post('/', MANAGE, validate({ body: categoryBody }), controller.createCategory);
  router.patch('/:id', MANAGE, validate({ params: idParams, body: categoryPatchBody }), controller.updateCategory);
  router.post('/:id/archive', MANAGE, validate({ params: idParams, body: emptyBody }), controller.archiveCategory);
  return router;
}

// HTTP do Financeiro: lê req.valid e o contexto, chama o service, responde.
import { requestContext } from '../../shared/request-context.js';
import * as categoriesService from './categories.service.js';
import * as expensesService from './expenses.service.js';

// ---------- despesas ----------

export async function list(req, res) {
  const { expenses, meta } = await expensesService.listExpenses(requestContext(req), req.valid.query);
  res.json({ data: { expenses }, meta });
}

export async function show(req, res) {
  res.json({ data: { expense: await expensesService.getExpense(requestContext(req), req.valid.params.id) } });
}

export async function create(req, res) {
  res.status(201).json({ data: { expense: await expensesService.createExpense(requestContext(req), req.valid.body) } });
}

export async function update(req, res) {
  const expense = await expensesService.updateExpense(requestContext(req), req.valid.params.id, req.valid.body);
  res.json({ data: { expense } });
}

export async function cancel(req, res) {
  const expense = await expensesService.cancelExpense(requestContext(req), req.valid.params.id, req.valid.body);
  res.json({ data: { expense } });
}

export async function history(req, res) {
  res.json({ data: { events: await expensesService.getHistory(requestContext(req), req.valid.params.id) } });
}

export async function registerPayment(req, res) {
  const expense = await expensesService.registerPayment(requestContext(req), req.valid.params.id, req.valid.body);
  res.status(201).json({ data: { expense } });
}

export async function voidPayment(req, res) {
  const expense = await expensesService.voidPayment(requestContext(req), req.valid.params.id, req.valid.body);
  res.json({ data: { expense } });
}

export async function linkDocument(req, res) {
  const expense = await expensesService.linkExpenseDocument(requestContext(req), req.valid.params.id, req.valid.body);
  res.status(201).json({ data: { expense } });
}

export async function unlinkDocument(req, res) {
  const { id, documentId } = req.valid.params;
  res.json({ data: { expense: await expensesService.unlinkExpenseDocument(requestContext(req), id, documentId) } });
}

// ---------- categorias ----------

export async function listCategories(req, res) {
  res.json({ data: { categories: await categoriesService.listCategories(requestContext(req), req.valid.query) } });
}

export async function createCategory(req, res) {
  res.status(201).json({ data: { category: await categoriesService.createCategory(requestContext(req), req.valid.body) } });
}

export async function updateCategory(req, res) {
  const category = await categoriesService.updateCategory(requestContext(req), req.valid.params.id, req.valid.body);
  res.json({ data: { category } });
}

export async function archiveCategory(req, res) {
  res.json({ data: { category: await categoriesService.archiveCategory(requestContext(req), req.valid.params.id) } });
}

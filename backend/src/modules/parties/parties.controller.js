// HTTP de prestadores e fornecedores: lê req.valid e o contexto, chama o service, responde.
import { requestContext } from '../../shared/request-context.js';
import * as expensesService from '../finance/expenses.service.js';
import * as partiesService from './parties.service.js';

export async function list(req, res) {
  const { parties, meta } = await partiesService.listParties(requestContext(req), req.valid.query);
  res.json({ data: { parties }, meta });
}

export async function show(req, res) {
  res.json({ data: { party: await partiesService.getParty(requestContext(req), req.valid.params.id) } });
}

export async function create(req, res) {
  res.status(201).json({ data: { party: await partiesService.createParty(requestContext(req), req.valid.body) } });
}

export async function update(req, res) {
  const party = await partiesService.updateParty(requestContext(req), req.valid.params.id, req.valid.body);
  res.json({ data: { party } });
}

export async function remove(req, res) {
  await partiesService.deleteParty(requestContext(req), req.valid.params.id);
  res.status(204).end();
}

/** Histórico financeiro do prestador: a mesma lista do Financeiro, filtrada pelo prestador. */
export async function expenses(req, res) {
  const ctx = requestContext(req);
  await partiesService.ensureParty(ctx, req.valid.params.id);
  const { expenses: list, meta } = await expensesService.listExpenses(ctx, { ...req.valid.query, party_id: req.valid.params.id });
  res.json({ data: { expenses: list }, meta });
}

export async function documents(req, res) {
  res.json({ data: { documents: await partiesService.listPartyDocuments(requestContext(req), req.valid.params.id) } });
}

export async function linkDocument(req, res) {
  const documents = await partiesService.linkPartyDocument(requestContext(req), req.valid.params.id, req.valid.body);
  res.status(201).json({ data: { documents } });
}

export async function unlinkDocument(req, res) {
  await partiesService.unlinkPartyDocument(requestContext(req), req.valid.params.id, req.valid.params.documentId);
  res.status(204).end();
}

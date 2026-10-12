// HTTP das notas fiscais: lê req.valid e o contexto, chama o service, responde.
import { requestContext } from '../../shared/request-context.js';
import * as invoicesService from './invoices.service.js';

export async function list(req, res) {
  const { invoices, meta } = await invoicesService.listInvoices(requestContext(req), req.valid.query);
  res.json({ data: { invoices }, meta });
}

export async function show(req, res) {
  res.json({ data: { invoice: await invoicesService.getInvoice(requestContext(req), req.valid.params.id) } });
}

export async function history(req, res) {
  res.json({ data: { events: await invoicesService.getHistory(requestContext(req), req.valid.params.id) } });
}

export async function create(req, res) {
  res.status(201).json({ data: { invoice: await invoicesService.createInvoice(requestContext(req), req.valid.body) } });
}

export async function update(req, res) {
  const invoice = await invoicesService.updateInvoice(requestContext(req), req.valid.params.id, req.valid.body);
  res.json({ data: { invoice } });
}

export async function issue(req, res) {
  const invoice = await invoicesService.issueInvoice(requestContext(req), req.valid.params.id, req.valid.body);
  res.json({ data: { invoice } });
}

export async function cancel(req, res) {
  const invoice = await invoicesService.cancelInvoice(requestContext(req), req.valid.params.id, req.valid.body);
  res.json({ data: { invoice } });
}

export async function markPaid(req, res) {
  const invoice = await invoicesService.markInvoicePaid(requestContext(req), req.valid.params.id, req.valid.body);
  res.json({ data: { invoice } });
}

export async function unmarkPaid(req, res) {
  const invoice = await invoicesService.unmarkInvoicePaid(requestContext(req), req.valid.params.id, req.valid.body);
  res.json({ data: { invoice } });
}

export async function archive(req, res) {
  res.json({ data: { invoice: await invoicesService.setInvoiceArchived(requestContext(req), req.valid.params.id, true) } });
}

export async function unarchive(req, res) {
  res.json({ data: { invoice: await invoicesService.setInvoiceArchived(requestContext(req), req.valid.params.id, false) } });
}

export async function linkDocument(req, res) {
  const invoice = await invoicesService.linkInvoiceDocument(requestContext(req), req.valid.params.id, req.valid.body);
  res.status(201).json({ data: { invoice } });
}

export async function unlinkDocument(req, res) {
  const { id, documentId } = req.valid.params;
  res.json({ data: { invoice: await invoicesService.unlinkInvoiceDocument(requestContext(req), id, documentId) } });
}

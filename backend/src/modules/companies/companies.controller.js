// HTTP da empresa: lê req.valid e o contexto, chama o service, responde.
import { requestContext } from '../../shared/request-context.js';
import * as companiesService from './companies.service.js';

export async function create(req, res) {
  const company = await companiesService.createCompany(requestContext(req), req.valid.body);
  res.status(201).json({ data: { company } });
}

export async function context(req, res) {
  res.json({ data: await companiesService.getContext(requestContext(req), req.tenant) });
}

export async function show(req, res) {
  res.json({ data: { company: await companiesService.getProfile(requestContext(req)) } });
}

export async function update(req, res) {
  res.json({ data: { company: await companiesService.updateProfile(requestContext(req), req.valid.body) } });
}

export async function showSettings(req, res) {
  res.json({ data: { settings: await companiesService.getSettings(requestContext(req)) } });
}

export async function updateSettings(req, res) {
  res.json({ data: { settings: await companiesService.updateSettings(requestContext(req), req.valid.body) } });
}

export async function listContacts(req, res) {
  res.json({ data: { contacts: await companiesService.listContacts(requestContext(req)) } });
}

export async function createContact(req, res) {
  const contact = await companiesService.createContact(requestContext(req), req.valid.body);
  res.status(201).json({ data: { contact } });
}

export async function updateContact(req, res) {
  const contact = await companiesService.updateContact(requestContext(req), req.valid.params.id, req.valid.body);
  res.json({ data: { contact } });
}

export async function deleteContact(req, res) {
  await companiesService.deleteContact(requestContext(req), req.valid.params.id);
  res.status(204).end();
}

import { requestContext } from '../../shared/request-context.js';
import * as platformService from './platform.service.js';

export async function listCompanies(req, res) {
  const { companies, meta } = await platformService.listCompanies(req.valid.query);
  res.json({ data: { companies }, meta });
}

export async function approve(req, res) {
  const company = await platformService.approveCompany(requestContext(req), req.valid.params.id);
  res.json({ data: { company } });
}

export async function suspend(req, res) {
  const company = await platformService.suspendCompany(requestContext(req), req.valid.params.id, req.valid.body);
  res.json({ data: { company } });
}

export async function reactivate(req, res) {
  const company = await platformService.reactivateCompany(requestContext(req), req.valid.params.id);
  res.json({ data: { company } });
}

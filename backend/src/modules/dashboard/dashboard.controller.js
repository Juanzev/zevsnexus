import { requestContext } from '../../shared/request-context.js';
import * as dashboardService from './dashboard.service.js';

export async function show(req, res) {
  res.json({ data: await dashboardService.getDashboard(requestContext(req), req.valid.query) });
}

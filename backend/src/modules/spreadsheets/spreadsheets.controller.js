import { requestContext } from '../../shared/request-context.js';
import * as spreadsheetsService from './spreadsheets.service.js';

export async function list(req, res) {
  const { spreadsheets, meta } = await spreadsheetsService.listSpreadsheets(requestContext(req), req.valid.query);
  res.json({ data: { spreadsheets }, meta });
}

export async function show(req, res) {
  res.json({ data: { spreadsheet: await spreadsheetsService.getSpreadsheet(requestContext(req), req.valid.params.id) } });
}

export async function update(req, res) {
  const spreadsheet = await spreadsheetsService.updateSpreadsheet(requestContext(req), req.valid.params.id, req.valid.body);
  res.json({ data: { spreadsheet } });
}

export async function bulk(req, res) {
  res.json({ data: await spreadsheetsService.bulkUpdate(requestContext(req), req.valid.body) });
}

export async function preview(req, res) {
  res.json({ data: await spreadsheetsService.previewSpreadsheet(requestContext(req), req.valid.params.id, req.valid.query) });
}

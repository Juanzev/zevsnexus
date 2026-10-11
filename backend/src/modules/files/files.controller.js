import { requestContext } from '../../shared/request-context.js';
import * as filesService from './files.service.js';

export async function createUploadIntent(req, res) {
  res.status(201).json({ data: await filesService.createUploadIntent(requestContext(req), req.valid.body) });
}

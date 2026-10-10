// X-Request-Id recebido (se válido) ou um UUID novo; ecoado na resposta e em todo log e erro.
import { randomUUID } from 'node:crypto';

const VALID_ID = /^[A-Za-z0-9._-]{8,128}$/;

export function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

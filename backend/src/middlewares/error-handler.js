// Formato único de erro: { error: { code, message, details, requestId } } (pág. 08).
// 5xx é sempre genérico para o cliente; o detalhe fica só no log.
import { AppError, NotFoundError } from '../shared/errors.js';

const BODY_PARSER_ERRORS = {
  'entity.parse.failed': { status: 400, code: 'INVALID_JSON', message: 'O corpo da requisição não é um JSON válido.' },
  'entity.too.large': { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'O corpo da requisição é grande demais.' },
  'encoding.unsupported': { status: 415, code: 'UNSUPPORTED_ENCODING', message: 'Codificação não suportada.' },
  'charset.unsupported': { status: 415, code: 'UNSUPPORTED_CHARSET', message: 'Charset não suportado.' },
};

export function apiNotFound(_req, _res, next) {
  next(new NotFoundError('ROUTE_NOT_FOUND', 'Rota não encontrada.'));
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  let status = 500;
  let body = { code: 'INTERNAL_ERROR', message: 'Erro interno. Tente novamente em instantes.' };

  if (err instanceof AppError) {
    status = err.status;
    body = { code: err.code, message: err.message, details: err.details };
  } else if (BODY_PARSER_ERRORS[err?.type]) {
    const known = BODY_PARSER_ERRORS[err.type];
    status = known.status;
    body = { code: known.code, message: known.message };
  }

  // pino-http registra o erro junto com a linha de acesso.
  if (status >= 500) res.err = err;

  res.status(status).json({ error: { ...body, requestId: req.id } });
}

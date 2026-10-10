// Log de acesso: método, rota (sem query string), status, duração, request id e usuário.
// Sem corpo, sem headers sensíveis. Arquivos estáticos da SPA e /health não poluem o log.
import { pinoHttp } from 'pino-http';
import { logger } from '../shared/logger.js';

const QUIET_PREFIXES = ['/src/', '/assets/', '/vendor/', '/health'];

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => req.id,
  quietReqLogger: true,
  autoLogging: {
    ignore: (req) => QUIET_PREFIXES.some((prefix) => req.url.startsWith(prefix)),
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customProps: (req) => ({ userId: req.user?.id, ip: req.clientIp }),
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: String(req.url ?? '').split('?')[0] }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});

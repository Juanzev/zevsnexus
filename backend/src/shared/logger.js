// Logs JSON estruturados no stdout (o Render captura), com redaction (pág. 06 §11 e pág. 18).
// Nunca registrar corpo de requisição, query string, tokens, senhas ou e-mails.
import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'zevs-nexus', version: env.appVersion },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-origin-auth"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.current_password',
      '*.new_password',
      '*.token',
      '*.access_token',
      '*.refresh_token',
    ],
    censor: '[redacted]',
  },
});

/** Evento de segurança: sempre em nível warn, com o campo `security` para filtrar. */
export function securityEvent(event, data = {}) {
  logger.warn({ security: true, event, ...data }, `security:${event}`);
}

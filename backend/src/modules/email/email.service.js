// EmailProvider (pág. 14): sem RESEND_API_KEY o sistema sobe em modo log.
import path from 'node:path';
import { backendDir, env } from '../../config/env.js';
import { logger } from '../../shared/logger.js';
import { createLogProvider } from './providers/log.provider.js';
import { createResendProvider } from './providers/resend.provider.js';

const provider =
  env.EMAIL_PROVIDER === 'resend'
    ? createResendProvider({ apiKey: env.RESEND_API_KEY })
    : createLogProvider({
        outboxDir: env.EMAIL_OUTBOX_DIR ? path.resolve(backendDir, env.EMAIL_OUTBOX_DIR) : undefined,
        keepInMemory: env.isTest,
        logger,
      });

/**
 * Envia fora da requisição: a resposta não espera o envio nem revela o resultado
 * (ex.: reset de senha não denuncia, pelo tempo, se o e-mail existe — pág. 15).
 * `message` = { to, template, subject, html, text }.
 */
export function sendEmailLater(message) {
  setImmediate(() => {
    provider.send({ from: env.EMAIL_FROM, ...message }).catch((err) => {
      logger.error({ err, template: message.template }, 'falha ao enviar e-mail');
    });
  });
}

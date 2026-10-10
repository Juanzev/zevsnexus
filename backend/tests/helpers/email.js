import { getMemoryOutbox } from '../../src/modules/email/providers/log.provider.js';

export function emailsTo(to, template) {
  return getMemoryOutbox().filter(
    (message) => message.to === to && (!template || message.template === template),
  );
}

/** Espera o e-mail sair (o envio é assíncrono, fora da requisição). */
export async function waitForEmail(to, template, { timeoutMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = emailsTo(to, template);
    if (found.length > 0) return found.at(-1);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`nenhum e-mail "${template}" para ${to}`);
}

/** Dá tempo aos envios agendados com setImmediate antes de afirmar que nada saiu. */
export function flushEmails() {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

export function tokenFromEmail(message) {
  const match = /token=([A-Za-z0-9_-]+)/.exec(message.text);
  if (!match) throw new Error('e-mail sem token');
  return match[1];
}

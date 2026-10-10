// Provider "log": nada sai do servidor (dev, CI, staging sem RESEND_API_KEY — pág. 14).
// Opcionalmente grava cada mensagem em EMAIL_OUTBOX_DIR (dev e E2E leem os links de lá)
// e, em teste, guarda em memória para as asserções.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const memoryOutbox = [];

/** Mensagens "enviadas" neste processo (só preenchido com keepInMemory). */
export function getMemoryOutbox() {
  return memoryOutbox;
}

export function createLogProvider({ outboxDir, keepInMemory, logger }) {
  return {
    name: 'log',
    async send(message) {
      const entry = { id: randomUUID(), sentAt: new Date().toISOString(), ...message };
      if (keepInMemory) memoryOutbox.push(entry);
      if (outboxDir) {
        mkdirSync(outboxDir, { recursive: true });
        writeFileSync(path.join(outboxDir, `${Date.now()}-${entry.id}.json`), JSON.stringify(entry, null, 2));
      }
      // Sem destinatário no log: e-mail é dado pessoal.
      logger.info({ template: message.template }, 'e-mail em modo log (não enviado)');
    },
  };
}

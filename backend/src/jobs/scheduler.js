// Agendador in-process (pág. 15): setInterval com unref(), sem sobreposição e falha só no log.
// Trocar por fila/worker no futuro não muda quem chama.
import { logger } from '../shared/logger.js';

export function scheduleInterval(name, intervalMs, task) {
  let running = false;

  async function run() {
    if (running) return;
    running = true;
    try {
      const result = await task();
      logger.debug({ job: name, result }, 'job concluído');
    } catch (err) {
      logger.error({ err, job: name }, 'job falhou');
    } finally {
      running = false;
    }
  }

  const timer = setInterval(run, intervalMs);
  timer.unref();
  return {
    run,
    stop: () => clearInterval(timer),
  };
}

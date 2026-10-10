// Jobs de manutenção (pág. 15). Ligados por JOBS_ENABLED; nada crítico depende deles.
// Observação: no plano gratuito do Render o processo dorme sem tráfego e os jobs param.
import { env } from '../config/env.js';
import { deleteExpiredTokens } from '../modules/auth/auth.service.js';
import { idempotencyRepository } from '../modules/idempotency/idempotency.repository.js';
import { scheduleInterval } from './scheduler.js';

const HOUR = 60 * 60 * 1000;

export const JOBS = Object.freeze([
  { name: 'cleanup.idempotency_keys', intervalMs: HOUR, task: () => idempotencyRepository().deleteExpired() },
  { name: 'cleanup.auth_tokens', intervalMs: 6 * HOUR, task: deleteExpiredTokens },
]);

/** Liga os jobs (se habilitados) e devolve a função que os desliga no graceful shutdown. */
export function startJobs() {
  if (!env.JOBS_ENABLED) return () => {};
  const scheduled = JOBS.map((job) => scheduleInterval(job.name, job.intervalMs, job.task));
  return () => scheduled.forEach((job) => job.stop());
}

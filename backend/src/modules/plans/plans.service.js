// Planos e assinatura (pág. 13). Sem billing no MVP: a empresa nova entra no plano padrão
// (DEFAULT_PLAN ou o padrão do catálogo), em período de teste de TRIAL_DAYS dias.
import { env } from '../../config/env.js';
import { plansRepository } from './plans.repository.js';

export async function startSubscription(client, companyId) {
  const repo = plansRepository(client);
  const plan = env.DEFAULT_PLAN ? await repo.findPlan(env.DEFAULT_PLAN) : await repo.findDefaultPlan();
  if (!plan) throw new Error('Nenhum plano padrão no catálogo: rode npm run seed');
  return repo.insertSubscription(companyId, {
    planCode: plan.code,
    status: env.TRIAL_DAYS > 0 ? 'trialing' : 'active',
    trialDays: env.TRIAL_DAYS,
  });
}

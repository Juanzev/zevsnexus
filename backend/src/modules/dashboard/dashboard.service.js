// Dashboard (STRUCTURE pág. 12): um endpoint, poucas agregações numa transação com teto de tempo,
// período no fuso da empresa e blocos por permissão — quem não vê o financeiro não recebe os valores.
// F4: bloco financeiro (D4) e validade de documentos. A F8 completa (comparação, atividade, notas).
import { withTenant } from '../../shared/db.js';
import { resolvePeriod } from '../../shared/periods.js';
import { documentIndicators } from '../documents/documents.service.js';
import { financeIndicators } from '../finance/expenses.service.js';

export function getDashboard(ctx, query) {
  return withTenant(ctx.companyId, async (client) => {
    await client.query("SET LOCAL statement_timeout = '10s'");
    const period = resolvePeriod(query, ctx.timezone);
    const data = { period: { key: period.key, from: period.from, to: period.to }, today: period.today };
    if (ctx.permissions.has('finance.view')) data.finance = await financeIndicators(client, ctx, period);
    if (ctx.permissions.has('documents.view')) data.documents = await documentIndicators(client, ctx, period.today);
    return data;
  });
}

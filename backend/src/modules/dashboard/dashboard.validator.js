// Período do dashboard (STRUCTURE pág. 12): predefinido ou personalizado (início ≤ fim, até 2 anos).
import * as z from 'zod';
import { daysBetween, MAX_CUSTOM_DAYS, PERIODS } from '../../shared/periods.js';
import { calendarDate } from '../../shared/validators.js';

export const dashboardQuery = z
  .object({
    period: z.enum(PERIODS).default('this_month'),
    from: calendarDate.optional(),
    to: calendarDate.optional(),
  })
  .strict()
  .superRefine((query, ctx) => {
    if (query.period !== 'custom') return;
    if (!query.from || !query.to) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'Informe o início e o fim do período.' });
      return;
    }
    if (query.from > query.to) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'O fim do período precisa ser depois do início.' });
    } else if (daysBetween(query.from, query.to) > MAX_CUSTOM_DAYS) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'O período pode ter no máximo 2 anos.' });
    }
  });

// Períodos de dashboard e relatório (STRUCTURE pág. 12): calculados no servidor, no fuso da empresa.
// Tudo em datas de calendário AAAA-MM-DD (sem hora), comparáveis como texto.
import { addDays, todayIn } from './timezones.js';

export const PERIODS = Object.freeze(['today', 'yesterday', '7d', '30d', 'this_month', 'last_month', 'this_year', 'custom']);
/** Período personalizado: até 2 anos. */
export const MAX_CUSTOM_DAYS = 731;

function pad(value) {
  return String(value).padStart(2, '0');
}

function monthRange(year, month) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(lastDay)}` };
}

/** Dias entre duas datas de calendário (inclusive). */
export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * @param query    { period, from?, to? } (custom exige from e to, já validados)
 * @param timezone fuso IANA da empresa
 * @returns { key, from, to, today }
 */
export function resolvePeriod({ period = 'this_month', from, to } = {}, timezone, now = new Date()) {
  const today = todayIn(timezone, now);
  const [year, month] = today.split('-').map(Number);
  const range = (() => {
    switch (period) {
      case 'today':
        return { from: today, to: today };
      case 'yesterday': {
        const yesterday = addDays(today, -1);
        return { from: yesterday, to: yesterday };
      }
      case '7d':
        return { from: addDays(today, -6), to: today };
      case '30d':
        return { from: addDays(today, -29), to: today };
      case 'last_month':
        return month === 1 ? monthRange(year - 1, 12) : monthRange(year, month - 1);
      case 'this_year':
        return { from: `${year}-01-01`, to: `${year}-12-31` };
      case 'custom':
        return { from, to };
      default:
        return monthRange(year, month);
    }
  })();
  return { key: period, ...range, today };
}

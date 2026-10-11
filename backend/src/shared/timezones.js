// Fuso da empresa (pág. 07): vencimentos e períodos são interpretados nele, nunca no do servidor.
const supported = new Set(Intl.supportedValuesOf('timeZone'));
supported.add('UTC');

export function isValidTimezone(value) {
  return typeof value === 'string' && supported.has(value);
}

/** Data de hoje (AAAA-MM-DD) no fuso dado — base de "vencido" e "vencendo", sempre calculados. */
export function todayIn(timezone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Soma dias a uma data de calendário AAAA-MM-DD (sem fuso). */
export function addDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

import { daysBetween, resolvePeriod } from '../../src/shared/periods.js';

// 11/10/2026 23:30 em Manaus já é 12/10 em UTC: o período segue o fuso da empresa.
const NOW = new Date('2026-10-12T03:30:00Z');
const TZ = 'America/Manaus';

describe('períodos no fuso da empresa', () => {
  test.each([
    ['today', '2026-10-11', '2026-10-11'],
    ['yesterday', '2026-10-10', '2026-10-10'],
    ['7d', '2026-10-05', '2026-10-11'],
    ['30d', '2026-09-12', '2026-10-11'],
    ['this_month', '2026-10-01', '2026-10-31'],
    ['last_month', '2026-09-01', '2026-09-30'],
    ['this_year', '2026-01-01', '2026-12-31'],
  ])('%s', (period, from, to) => {
    expect(resolvePeriod({ period }, TZ, NOW)).toEqual({ key: period, from, to, today: '2026-10-11' });
  });

  test('mês anterior em janeiro volta para dezembro do ano anterior; fevereiro bissexto', () => {
    expect(resolvePeriod({ period: 'last_month' }, 'UTC', new Date('2027-01-15T12:00:00Z'))).toMatchObject({
      from: '2026-12-01',
      to: '2026-12-31',
    });
    expect(resolvePeriod({ period: 'this_month' }, 'UTC', new Date('2028-02-10T12:00:00Z')).to).toBe('2028-02-29');
  });

  test('personalizado e contagem de dias (inclusive)', () => {
    expect(resolvePeriod({ period: 'custom', from: '2026-01-01', to: '2026-03-31' }, TZ, NOW)).toMatchObject({
      from: '2026-01-01',
      to: '2026-03-31',
    });
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(1);
    expect(daysBetween('2026-01-01', '2026-12-31')).toBe(365);
    expect(daysBetween('2028-01-01', '2028-12-31')).toBe(366);
  });
});

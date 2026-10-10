import { assertSafeTestDatabase } from '../setup/test-database.js';

describe('trava anti-produção do banco de teste', () => {
  test('aceita banco local terminado em _test', () => {
    expect(() => assertSafeTestDatabase('postgres://postgres@localhost:5434/zevs_nexus_test', { ci: false })).not.toThrow();
  });

  test('recusa banco que não termina em _test', () => {
    expect(() => assertSafeTestDatabase('postgres://postgres@localhost:5434/zevs_nexus_dev', { ci: false })).toThrow(/_test/);
  });

  test('recusa host remoto fora do CI', () => {
    expect(() => assertSafeTestDatabase('postgres://u:p@dpg-abc.virginia-postgres.render.com/nexus_test', { ci: false })).toThrow(/local/);
  });
});

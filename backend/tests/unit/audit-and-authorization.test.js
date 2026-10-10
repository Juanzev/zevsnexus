import { auditChanges, PERSONAL_DATA } from '../../src/modules/audit/audit.service.js';
import { requireFeature, requirePermission } from '../../src/middlewares/authorization.js';
import { scheduleInterval } from '../../src/jobs/scheduler.js';

describe('auditChanges', () => {
  test('registra de → para nos campos comuns e só "[dado pessoal]" nos pessoais', () => {
    const changes = auditChanges(
      { legal_name: 'A', email: 'a@x.com', phone: '92999999999', cnpj: null },
      { legal_name: 'B', email: 'b@x.com', phone: '92999999999', cnpj: '11222333000181' },
      { fields: ['legal_name', 'email', 'phone', 'cnpj'], personal: ['email', 'phone'] },
    );
    expect(changes).toEqual({
      legal_name: { from: 'A', to: 'B' },
      email: PERSONAL_DATA,
      cnpj: { from: null, to: '11222333000181' },
    });
    expect(JSON.stringify(changes)).not.toContain('b@x.com');
  });

  test('sem mudança → null', () => {
    expect(auditChanges({ a: 1 }, { a: 1 }, { fields: ['a'] })).toBeNull();
  });
});

function run(middleware, tenant) {
  try {
    middleware({ tenant }, {}, () => {});
    return 'next';
  } catch (err) {
    return err;
  }
}

describe('requirePermission / requireFeature', () => {
  const tenant = { permissions: new Set(['company.view']), features: new Set(['multiple_users']) };

  test('exige todas as permissões listadas', () => {
    expect(run(requirePermission('company.view'), tenant)).toBe('next');
    const error = run(requirePermission('company.view', 'company.manage'), tenant);
    expect(error.status).toBe(403);
    expect(error.code).toBe('PERMISSION_DENIED');
    expect(error.details).toEqual({ permissions: ['company.manage'] });
  });

  test('feature desligada → 403 FEATURE_DISABLED com o código', () => {
    expect(run(requireFeature('multiple_users'), tenant)).toBe('next');
    const error = run(requireFeature('spreadsheet_import'), tenant);
    expect(error.status).toBe(403);
    expect(error.code).toBe('FEATURE_DISABLED');
    expect(error.details).toEqual({ feature: 'spreadsheet_import' });
  });
});

describe('agendador de jobs', () => {
  test('não sobrepõe execuções e falha não derruba o job', async () => {
    let calls = 0;
    let release;
    const job = scheduleInterval('teste', 60_000, () => {
      calls += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const first = job.run();
    await job.run(); // ignorada: a primeira ainda está rodando
    expect(calls).toBe(1);
    release();
    await first;

    const failing = scheduleInterval('falha', 60_000, async () => {
      throw new Error('boom');
    });
    await expect(failing.run()).resolves.toBeUndefined();
    job.stop();
    failing.stop();
  });
});

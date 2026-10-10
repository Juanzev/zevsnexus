import { PERMISSIONS, ROLES, rolePermissions } from '../../src/modules/rbac/rbac.catalog.js';
import { assertCanChangeAccess, effectivePermissions } from '../../src/modules/rbac/rbac.policy.js';

const ALL = PERMISSIONS.map((permission) => permission.code);

describe('catálogo RBAC (matriz D10)', () => {
  test('todo papel só usa permissões do catálogo', () => {
    for (const role of ROLES) {
      for (const code of role.permissions) expect(ALL).toContain(code);
    }
  });

  test('owner e admin têm tudo', () => {
    expect([...rolePermissions(['owner'])].sort()).toEqual([...ALL].sort());
    expect([...rolePermissions(['admin'])].sort()).toEqual([...ALL].sort());
  });

  test('financeiro paga; assistente lança mas não paga; visualização só consulta', () => {
    const finance = rolePermissions(['finance']);
    const assistant = rolePermissions(['assistant']);
    const viewer = rolePermissions(['viewer']);
    expect(finance.has('finance.pay')).toBe(true);
    expect(assistant.has('finance.manage')).toBe(true);
    expect(assistant.has('finance.pay')).toBe(false);
    expect(assistant.has('spreadsheets.import')).toBe(false);
    expect([...viewer].every((code) => code.endsWith('.view'))).toBe(true);
    for (const role of ['finance', 'assistant', 'viewer']) {
      const permissions = rolePermissions([role]);
      expect(permissions.has('users.manage')).toBe(false);
      expect(permissions.has('settings.manage')).toBe(false);
    }
  });

  test('permissões efetivas = (papéis ∪ grants) − denies', () => {
    const result = effectivePermissions({ roles: ['viewer'], grants: ['finance.manage'], denies: ['finance.view'] });
    expect(result.has('finance.manage')).toBe(true);
    expect(result.has('finance.view')).toBe(false);
    expect(result.has('documents.view')).toBe(true);
  });
});

describe('anti-escalada de privilégio', () => {
  const admin = { membershipId: 'a', roles: ['admin'], permissions: rolePermissions(['admin']) };
  const owner = { membershipId: 'o', roles: ['owner'], permissions: rolePermissions(['owner']) };
  const financeActor = {
    membershipId: 'f',
    roles: ['finance'],
    permissions: new Set([...rolePermissions(['finance']), 'users.manage']),
  };
  const viewerTarget = { membershipId: 't', roles: ['viewer'], grants: [], denies: [] };

  function attempt(actor, target, next, otherActiveOwners = 1) {
    let error;
    try {
      assertCanChangeAccess({ actor, target, next: { grants: [], denies: [], ...next }, otherActiveOwners });
    } catch (err) {
      error = err;
    }
    return error?.code ?? 'OK';
  }

  test('ninguém altera o próprio acesso', () => {
    expect(attempt(admin, { ...viewerTarget, membershipId: 'a' }, { roles: ['owner'] })).toBe('CANNOT_CHANGE_SELF');
  });

  test('admin não mexe em owner; owner mexe', () => {
    const ownerTarget = { membershipId: 't', roles: ['owner'], grants: [], denies: [] };
    expect(attempt(admin, ownerTarget, { roles: ['admin'] })).toBe('OWNER_PROTECTED');
    expect(attempt(owner, ownerTarget, { roles: ['admin'] })).toBe('OK');
  });

  test('ninguém gerencia quem tem permissões que ele não tem', () => {
    const adminTarget = { membershipId: 't', roles: ['admin'], grants: [], denies: [] };
    expect(attempt(financeActor, adminTarget, { roles: ['viewer'] })).toBe('TARGET_OUTRANKS');
  });

  test('ninguém concede o que não tem, por papel ou por grant; deny é sempre permitido', () => {
    expect(attempt(financeActor, viewerTarget, { roles: ['admin'] })).toBe('PRIVILEGE_ESCALATION');
    expect(attempt(financeActor, viewerTarget, { roles: ['viewer'], grants: ['settings.manage'] })).toBe(
      'PRIVILEGE_ESCALATION',
    );
    expect(attempt(financeActor, viewerTarget, { roles: ['viewer'], denies: ['users.manage'] })).toBe('OK');
    expect(attempt(financeActor, viewerTarget, { roles: ['assistant'] })).toBe('OK');
  });

  test('a empresa nunca fica sem owner ativo', () => {
    const lastOwner = { membershipId: 't', roles: ['owner'], grants: [], denies: [] };
    expect(attempt(owner, lastOwner, { roles: ['admin'] }, 0)).toBe('LAST_OWNER');
    expect(attempt(owner, lastOwner, { roles: ['admin'] }, 1)).toBe('OK');
  });
});

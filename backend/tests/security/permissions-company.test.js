// Matriz de permissões (D10) aplicada às rotas da empresa: cada papel só faz o que deve.
import { api, makeApp } from '../helpers/http.js';
import { createTenant } from '../helpers/tenants.js';

const app = makeApp({ serveFrontend: false });
const ROLES = ['owner', 'admin', 'finance', 'assistant', 'viewer'];

let tenant;
beforeAll(async () => {
  tenant = await createTenant({ roles: ROLES });
});

const MANAGERS = ['owner', 'admin'];

const CASES = [
  { method: 'get', path: '/api/v1/company/context', allowed: ROLES },
  { method: 'get', path: '/api/v1/company', allowed: ROLES },
  { method: 'get', path: '/api/v1/company/contacts', allowed: ROLES },
  { method: 'patch', path: '/api/v1/company', body: { version: 999 }, allowed: MANAGERS, okStatus: 409 },
  { method: 'get', path: '/api/v1/company/settings', allowed: MANAGERS },
  { method: 'patch', path: '/api/v1/company/settings', body: {}, allowed: MANAGERS },
  { method: 'post', path: '/api/v1/company/contacts', body: { name: 'Teste' }, allowed: MANAGERS, okStatus: 201 },
];

describe.each(CASES)('$method $path', ({ method, path, body, allowed, okStatus = 200 }) => {
  test.each(ROLES)('%s', async (role) => {
    const res = await api(app)[method](path).set(tenant.headers(role)).send(body);
    if (allowed.includes(role)) {
      expect(res.status).toBe(okStatus);
    } else {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PERMISSION_DENIED');
    }
  });
});

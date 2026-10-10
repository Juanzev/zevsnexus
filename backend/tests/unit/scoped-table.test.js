import { randomUUID } from 'node:crypto';
import { scopedTable } from '../../src/shared/scoped-table.js';

function fakeDb() {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      return { rows: [{ id: 'x' }], rowCount: 1 };
    },
  };
}

const table = scopedTable('company_contacts', { columns: ['name', 'email'], returning: ['id', 'name'] });

describe('scopedTable', () => {
  test('recusa identificador que não é nome de coluna simples', () => {
    expect(() => scopedTable('contatos; DROP TABLE x', { columns: [], returning: ['id'] })).toThrow();
    expect(() => scopedTable('company_contacts', { columns: ['name"'], returning: ['id'] })).toThrow();
  });

  test('INSERT impõe company_id e ignora colunas fora da allowlist (inclusive company_id do corpo)', async () => {
    const db = fakeDb();
    const companyId = randomUUID();
    await table.insert(db, companyId, { name: 'Ana', company_id: randomUUID(), status: 'x' }, { userId: randomUUID() });
    const [{ text, params }] = db.calls;
    expect(text).toMatch(/^INSERT INTO company_contacts \(company_id, created_by, name\) VALUES \(\$1, \$2, \$3\)/);
    expect(params[0]).toBe(companyId);
    expect(params).toHaveLength(3);
  });

  test('UPDATE sempre filtra por company_id e por linha ativa', async () => {
    const db = fakeDb();
    await table.update(db, randomUUID(), randomUUID(), { email: null, id: 'outro' }, { userId: randomUUID() });
    expect(db.calls[0].text).toMatch(/WHERE company_id = \$1 AND id = \$2 AND deleted_at IS NULL/);
    expect(db.calls[0].text).not.toMatch(/\bid = \$4/);
  });

  test('companyId inválido é erro de programação; id inválido em busca é só "não encontrado"', async () => {
    const db = fakeDb();
    await expect(table.insert(db, 'não-é-uuid', {}, { userId: null })).rejects.toThrow(/companyId/);
    await expect(table.findById(db, randomUUID(), '1 OR 1=1')).resolves.toBeNull();
    expect(db.calls).toHaveLength(0);
  });
});

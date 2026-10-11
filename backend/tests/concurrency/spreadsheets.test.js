// Concorrência nas planilhas: o lote trava cada item em ordem fixa (por id), então lotes simultâneos em
// ordens opostas não travam um ao outro; e PATCH simultâneos de campos diferentes não se sobrescrevem.
import { randomUUID } from 'node:crypto';
import { pool } from '../../src/shared/db.js';
import { createDocument, FIXTURES } from '../helpers/documents.js';
import { api, makeApp } from '../helpers/http.js';
import { createTenant } from '../helpers/tenants.js';

const app = makeApp({ serveFrontend: false });

function send(tenant, method, path, body) {
  return api(app)[method](`/api/v1${path}`).set(tenant.headers('owner')).set('Idempotency-Key', randomUUID()).send(body);
}

test('8 lotes simultâneos sobre as mesmas 10 planilhas, em ordens opostas: todos passam, sem deadlock', async () => {
  const tenant = await createTenant();
  const ids = [];
  for (let i = 0; i < 10; i += 1) {
    ids.push((await createDocument(app, tenant.headers('owner'), { filename: `p${i}.csv`, content: FIXTURES.csv() })).id);
  }
  const reversed = [...ids].reverse();
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      send(tenant, 'post', '/spreadsheets/bulk', {
        ids: index % 2 ? ids : reversed,
        action: index % 2 ? 'mark_in_use' : 'set_year',
        reference_year: 2000 + index,
      }),
    ),
  );
  expect(results.map((res) => res.status)).toEqual(Array(8).fill(200));
  expect(results.every((res) => res.body.data.updated === 10)).toBe(true);
  const { rows } = await pool.query(
    'SELECT bool_and(in_use) AS all_in_use, count(DISTINCT reference_year)::int AS years FROM spreadsheets WHERE company_id = $1',
    [tenant.company.id],
  );
  // Lotes serializados por planilha na mesma ordem: todas terminam com o ano do último lote "set_year".
  expect(rows[0]).toEqual({ all_in_use: true, years: 1 });
});

test('PATCH simultâneos de campos diferentes não se sobrescrevem', async () => {
  const tenant = await createTenant();
  const sheet = await createDocument(app, tenant.headers('owner'), { filename: 'a.csv', content: FIXTURES.csv(), reference_year: 2020 });
  const [inUse, year] = await Promise.all([
    send(tenant, 'patch', `/spreadsheets/${sheet.id}`, { in_use: true }),
    send(tenant, 'patch', `/spreadsheets/${sheet.id}`, { reference_year: 2024 }),
  ]);
  expect([inUse.status, year.status]).toEqual([200, 200]);
  const { rows } = await pool.query('SELECT in_use, reference_year FROM spreadsheets WHERE document_id = $1', [sheet.id]);
  expect(rows[0]).toEqual({ in_use: true, reference_year: 2024 });
});

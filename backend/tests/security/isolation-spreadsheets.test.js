// Isolamento A × B das planilhas: planilha de outra empresa responde 404 e nunca muda; no lote ela
// volta em `not_found` e nada dela é tocado.
import { randomUUID } from 'node:crypto';
import { pool } from '../../src/shared/db.js';
import { createDocument } from '../helpers/documents.js';
import { api, makeApp } from '../helpers/http.js';
import { ghost, GHOSTS } from '../helpers/spreadsheets.js';
import { auditEvents, createTenant } from '../helpers/tenants.js';

const app = makeApp({ serveFrontend: false });

let a;
let b;
let sheetB;

beforeAll(async () => {
  a = await createTenant();
  b = await createTenant();
  sheetB = await createDocument(app, b.headers('owner'), {
    filename: GHOSTS.pagamentos,
    content: ghost(GHOSTS.pagamentos),
    title: 'Segredo B',
    reference_year: 2026,
  });
});

function asA(method, path, body) {
  const req = api(app)[method](`/api/v1${path}`).set(a.headers('owner')).set('Idempotency-Key', randomUUID());
  return body === undefined ? req : req.send(body);
}

async function stateB() {
  const { rows } = await pool.query(
    `SELECT s.in_use, s.reference_year, s.updated_at, d.archived_at
       FROM spreadsheets s JOIN documents d ON d.company_id = s.company_id AND d.id = s.document_id
      WHERE s.document_id = $1`,
    [sheetB.id],
  );
  return rows[0];
}

describe('planilha de outra empresa → 404 e nada muda', () => {
  test.each([
    ['get', () => `/spreadsheets/${sheetB.id}`, undefined],
    ['get', () => `/spreadsheets/${sheetB.id}/preview`, undefined],
    ['get', () => `/spreadsheets/${sheetB.id}/preview?sheet=1&page=2`, undefined],
    ['patch', () => `/spreadsheets/${sheetB.id}`, { in_use: true, reference_year: 2020 }],
  ])('%s %s', async (method, path, body) => {
    const before = await stateB();
    const res = await asA(method, path(), body);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SPREADSHEET_NOT_FOUND');
    expect(await stateB()).toEqual(before);
  });

  test.each(['mark_in_use', 'set_year', 'archive'])('lote %s com id de B → not_found, nada muda', async (action) => {
    const before = await stateB();
    const res = await asA('post', '/spreadsheets/bulk', { ids: [sheetB.id], action, reference_year: 2020 });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ updated: 0, not_found: [sheetB.id] });
    expect(await stateB()).toEqual(before);
  });

  test('a prévia negada não grava auditoria em nenhuma das empresas', async () => {
    await asA('get', `/spreadsheets/${sheetB.id}/preview`);
    expect(await auditEvents({ action: 'document.previewed', entityId: sheetB.id })).toEqual([]);
  });

  test('listas de A não mostram nada de B (nem o ano dela)', async () => {
    const res = await asA('get', '/spreadsheets?view=all&q=segredo');
    expect(res.body.data.spreadsheets).toEqual([]);
    expect((await asA('get', '/spreadsheets?view=all')).body.meta).toMatchObject({ total: 0, years: [] });
  });
});

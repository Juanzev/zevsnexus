// Planilhas (F6, níveis 1 e 2): registro automático no envio, visões, metadados, lote e prévia,
// com as planilhas fantasma de fixtures/planilhas.
import { randomUUID } from 'node:crypto';
import { pool } from '../../src/shared/db.js';
import { todayIn } from '../../src/shared/timezones.js';
import { createDocument, FIXTURES, uploadFile } from '../helpers/documents.js';
import { api, makeApp } from '../helpers/http.js';
import { ghost, GHOSTS } from '../helpers/spreadsheets.js';
import { auditEvents, createTenant } from '../helpers/tenants.js';

const app = makeApp({ serveFrontend: false });
const THIS_YEAR = Number(todayIn('America/Sao_Paulo').slice(0, 4));

function get(tenant, path, role = 'owner') {
  return api(app).get(`/api/v1${path}`).set(tenant.headers(role));
}

function send(tenant, method, path, body, role = 'owner') {
  return api(app)[method](`/api/v1${path}`).set(tenant.headers(role)).set('Idempotency-Key', randomUUID()).send(body ?? {});
}

function upload(tenant, key, fields = {}) {
  return createDocument(app, tenant.headers('owner'), { filename: GHOSTS[key], content: ghost(GHOSTS[key]), ...fields });
}

const ids = (res) => res.body.data.spreadsheets.map((sheet) => sheet.id);

describe('registro automático no envio', () => {
  test('planilha ganha "em uso = não" e o ano informado (ou o atual); outros arquivos não entram', async () => {
    const tenant = await createTenant();
    const old = await upload(tenant, 'legado', { reference_year: 2019 });
    const current = await upload(tenant, 'diaristas');
    await createDocument(app, tenant.headers('owner'), { filename: 'Contrato.pdf' });

    const all = await get(tenant, '/spreadsheets?view=all&sort=reference_year');
    expect(all.status).toBe(200);
    expect(all.body.data.spreadsheets).toEqual([
      expect.objectContaining({
        id: old.id,
        title: 'Controle de pagamentos 2019',
        in_use: false,
        reference_year: 2019,
        archived_at: null,
        current_version: 1,
        file: expect.objectContaining({ extension: 'xls', original_name: GHOSTS.legado, previewable: false }),
      }),
      expect.objectContaining({ id: current.id, reference_year: THIS_YEAR, file: expect.objectContaining({ extension: 'csv', previewable: true }) }),
    ]);
    expect(all.body.meta).toEqual({ page: 1, limit: 20, total: 2, current_year: THIS_YEAR, years: [THIS_YEAR, 2019] });

    const [event] = await auditEvents({ companyId: tenant.company.id, action: 'spreadsheet.registered', entityId: old.id });
    expect(event.metadata).toEqual({ extension: 'xls', reference_year: 2019 });
  });

  test('ano fora de 1990..2100 é recusado no envio', async () => {
    const tenant = await createTenant();
    const fileId = await uploadFile(app, tenant.headers('owner'), { filename: 'a.csv', content: FIXTURES.csv() });
    const res = await send(tenant, 'post', '/documents', { file_id: fileId, reference_year: 1989 });
    expect(res.status).toBe(422);
  });

  test('nova versão de outra planilha mantém os metadados; documento que vira planilha entra', async () => {
    const tenant = await createTenant();
    const sheet = await upload(tenant, 'diaristas', { reference_year: 2024 });
    await send(tenant, 'patch', `/spreadsheets/${sheet.id}`, { in_use: true });
    const fileId = await uploadFile(app, tenant.headers('owner'), { filename: GHOSTS.pagamentos, content: ghost(GHOSTS.pagamentos) });
    expect((await send(tenant, 'post', `/documents/${sheet.id}/versions`, { file_id: fileId, reference_year: 2026 })).status).toBe(201);
    const after = (await get(tenant, `/spreadsheets/${sheet.id}`)).body.data.spreadsheet;
    expect(after).toMatchObject({ in_use: true, reference_year: 2024, current_version: 2, file: { extension: 'xlsx' } });

    const pdf = await createDocument(app, tenant.headers('owner'), { filename: 'Relatório.pdf' });
    expect((await get(tenant, `/spreadsheets/${pdf.id}`)).status).toBe(404);
    const csvId = await uploadFile(app, tenant.headers('owner'), { filename: 'Relatório.csv', content: FIXTURES.csv() });
    await send(tenant, 'post', `/documents/${pdf.id}/versions`, { file_id: csvId, reference_year: 2025 });
    expect((await get(tenant, `/spreadsheets/${pdf.id}`)).body.data.spreadsheet).toMatchObject({ reference_year: 2025 });
  });
});

describe('visões, busca e ordenação', () => {
  let tenant;
  const docs = {};

  beforeAll(async () => {
    tenant = await createTenant();
    docs.pagamentos = await upload(tenant, 'pagamentos', { reference_year: THIS_YEAR });
    docs.medicoes = await upload(tenant, 'medicoes', { reference_year: 2025 });
    docs.legado = await upload(tenant, 'legado', { reference_year: 2019 });
    docs.orcamento = await upload(tenant, 'orcamento', { reference_year: THIS_YEAR });
    docs.extrato = await upload(tenant, 'extrato', { reference_year: THIS_YEAR });
    await send(tenant, 'patch', `/spreadsheets/${docs.pagamentos.id}`, { in_use: true });
    await send(tenant, 'patch', `/spreadsheets/${docs.medicoes.id}`, { in_use: true });
    await send(tenant, 'post', `/documents/${docs.orcamento.id}/archive`, {});
    await send(tenant, 'delete', `/documents/${docs.extrato.id}`, {}); // lixeira some de todas as visões
  });

  test.each([
    ['in_use', ['pagamentos', 'medicoes']],
    ['this_year', ['pagamentos']],
    ['older', ['medicoes', 'legado']],
    ['archived', ['orcamento']],
    ['all', ['pagamentos', 'medicoes', 'legado', 'orcamento']],
  ])('visão %s', async (view, expected) => {
    const res = await get(tenant, `/spreadsheets?view=${view}&sort=-reference_year`);
    expect(res.status).toBe(200);
    expect(ids(res).sort()).toEqual(expected.map((key) => docs[key].id).sort());
  });

  test('a visão padrão é "em uso"; busca sem acento, filtro por ano, ordenação e paginação', async () => {
    expect(ids(await get(tenant, '/spreadsheets')).sort()).toEqual([docs.pagamentos.id, docs.medicoes.id].sort());
    expect(ids(await get(tenant, '/spreadsheets?view=all&q=medicoes'))).toEqual([docs.medicoes.id]);
    expect(ids(await get(tenant, '/spreadsheets?view=all&q=%25'))).toEqual([]);
    expect(ids(await get(tenant, '/spreadsheets?view=all&year=2019'))).toEqual([docs.legado.id]);
    const byTitle = await get(tenant, '/spreadsheets?view=all&sort=title&limit=2&page=2');
    expect(byTitle.body.data.spreadsheets.map((sheet) => sheet.title)).toEqual([
      'Medições obra Residencial Aurora 2025',
      'Orçamento reforma do escritório',
    ]);
    expect(byTitle.body.meta).toMatchObject({ page: 2, limit: 2, total: 4 });
    expect((await get(tenant, '/spreadsheets?view=all&sort=-reference_year')).body.data.spreadsheets.at(-1).id).toBe(docs.legado.id);
  });

  test('parâmetros fora da allowlist são recusados', async () => {
    expect((await get(tenant, '/spreadsheets?view=importadas')).status).toBe(422);
    expect((await get(tenant, '/spreadsheets?sort=title;DROP TABLE spreadsheets')).status).toBe(422);
    expect((await get(tenant, '/spreadsheets?company_id=x')).status).toBe(422);
  });

  test('planilha na lixeira responde 404', async () => {
    expect((await get(tenant, `/spreadsheets/${docs.extrato.id}`)).status).toBe(404);
    expect((await get(tenant, `/spreadsheets/${docs.extrato.id}/preview`)).status).toBe(404);
    expect((await send(tenant, 'patch', `/spreadsheets/${docs.extrato.id}`, { in_use: true })).status).toBe(404);
  });
});

describe('metadados', () => {
  test('PATCH em uso e ano, com auditoria das mudanças', async () => {
    const tenant = await createTenant();
    const doc = await upload(tenant, 'diaristas', { reference_year: 2025 });
    const res = await send(tenant, 'patch', `/spreadsheets/${doc.id}`, { in_use: true, reference_year: 2026 });
    expect(res.status).toBe(200);
    expect(res.body.data.spreadsheet).toMatchObject({ in_use: true, reference_year: 2026 });
    const [event] = await auditEvents({ companyId: tenant.company.id, action: 'spreadsheet.updated', entityId: doc.id });
    expect(event.metadata.changes).toEqual({ in_use: { from: false, to: true }, reference_year: { from: 2025, to: 2026 } });

    // Sem mudança: sem auditoria nova.
    await send(tenant, 'patch', `/spreadsheets/${doc.id}`, { in_use: true });
    expect(await auditEvents({ companyId: tenant.company.id, action: 'spreadsheet.updated', entityId: doc.id })).toHaveLength(1);

    // O histórico do documento mostra os eventos da planilha (só campos, sem valor pessoal).
    const history = (await get(tenant, `/documents/${doc.id}/history`)).body.data.events;
    expect(history.find((event) => event.action === 'spreadsheet.updated').changed_fields).toEqual(['in_use', 'reference_year']);
    expect(history.find((event) => event.action === 'spreadsheet.registered').details).toEqual({ extension: 'csv', reference_year: 2025 });
  });

  test('corpo vazio, campo desconhecido e ano inválido → 422', async () => {
    const tenant = await createTenant();
    const doc = await upload(tenant, 'diaristas');
    expect((await send(tenant, 'patch', `/spreadsheets/${doc.id}`, {})).status).toBe(422);
    expect((await send(tenant, 'patch', `/spreadsheets/${doc.id}`, { title: 'x' })).status).toBe(422);
    expect((await send(tenant, 'patch', `/spreadsheets/${doc.id}`, { reference_year: 2101 })).status).toBe(422);
    expect((await send(tenant, 'patch', `/spreadsheets/${doc.id}`, { in_use: 'sim' })).status).toBe(422);
  });
});

describe('ações em lote', () => {
  test('marcar em uso, ano, arquivar e desarquivar; ids repetidos contam uma vez; inexistente volta em not_found', async () => {
    const tenant = await createTenant();
    const a = await upload(tenant, 'diaristas', { reference_year: 2024 });
    const b = await upload(tenant, 'extrato', { reference_year: 2024 });
    const pdf = await createDocument(app, tenant.headers('owner'), { filename: 'Contrato.pdf' });
    const ghostId = randomUUID();

    const marked = await send(tenant, 'post', '/spreadsheets/bulk', { ids: [a.id, b.id, a.id, pdf.id, ghostId], action: 'mark_in_use' });
    expect(marked.status).toBe(200);
    expect(marked.body.data.updated).toBe(2);
    expect(marked.body.data.not_found.sort()).toEqual([pdf.id, ghostId].sort());

    await send(tenant, 'post', '/spreadsheets/bulk', { ids: [a.id, b.id], action: 'set_year', reference_year: 2023 });
    await send(tenant, 'post', '/spreadsheets/bulk', { ids: [b.id], action: 'archive' });
    const state = async (doc) => {
      const sheet = (await get(tenant, `/spreadsheets/${doc.id}`)).body.data.spreadsheet;
      return [sheet.in_use, sheet.reference_year, sheet.archived_at !== null];
    };
    expect(await state(a)).toEqual([true, 2023, false]);
    expect(await state(b)).toEqual([true, 2023, true]);
    expect(ids(await get(tenant, '/spreadsheets?view=in_use'))).toEqual([a.id]); // arquivada sai de "em uso"
    expect(await auditEvents({ companyId: tenant.company.id, action: 'document.archived', entityId: b.id })).toHaveLength(1);

    await send(tenant, 'post', '/spreadsheets/bulk', { ids: [a.id, b.id], action: 'unarchive' });
    expect(ids(await get(tenant, '/spreadsheets?view=archived'))).toEqual([]);
    await send(tenant, 'post', '/spreadsheets/bulk', { ids: [a.id, b.id], action: 'unmark_in_use' });
    expect(ids(await get(tenant, '/spreadsheets?view=in_use'))).toEqual([]);
  });

  test('validação: ano obrigatório em set_year, ação desconhecida, lista vazia ou acima de 100', async () => {
    const tenant = await createTenant();
    const doc = await upload(tenant, 'diaristas');
    expect((await send(tenant, 'post', '/spreadsheets/bulk', { ids: [doc.id], action: 'set_year' })).status).toBe(422);
    expect((await send(tenant, 'post', '/spreadsheets/bulk', { ids: [doc.id], action: 'delete' })).status).toBe(422);
    expect((await send(tenant, 'post', '/spreadsheets/bulk', { ids: [], action: 'archive' })).status).toBe(422);
    const many = Array.from({ length: 101 }, () => randomUUID());
    expect((await send(tenant, 'post', '/spreadsheets/bulk', { ids: many, action: 'archive' })).status).toBe(422);
  });
});

describe('prévia', () => {
  let tenant;
  const docs = {};

  beforeAll(async () => {
    tenant = await createTenant();
    docs.pagamentos = await upload(tenant, 'pagamentos');
    docs.legado = await upload(tenant, 'legado');
    docs.extrato = await upload(tenant, 'extrato');
    docs.orcamento = await upload(tenant, 'orcamento');
  });

  test('XLSX: abas, primeira página e auditoria só na abertura', async () => {
    const opened = await get(tenant, `/spreadsheets/${docs.pagamentos.id}/preview`);
    expect(opened.status).toBe(200);
    expect(opened.body.data).toMatchObject({
      version_number: 1,
      extension: 'xlsx',
      sheets: [
        { index: 0, name: 'Pagamentos', hidden: false },
        { index: 1, name: 'Resumo por categoria', hidden: false },
        { index: 2, name: 'Prestadores', hidden: false },
      ],
      sheet: { index: 0, name: 'Pagamentos', total_rows: 125, columns: 11, page: 1, page_size: 50, truncated_rows: false },
    });
    expect(opened.body.data.sheet.rows).toHaveLength(50);
    expect(opened.body.data.sheet.rows[3].cells[0]).toBe('Lançamento');

    await get(tenant, `/spreadsheets/${docs.pagamentos.id}/preview?page=3`);
    await get(tenant, `/spreadsheets/${docs.pagamentos.id}/preview?sheet=2`);
    const events = await auditEvents({ companyId: tenant.company.id, action: 'document.previewed', entityId: docs.pagamentos.id });
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toEqual({ version_number: 1 });
  });

  test('paginação e troca de aba', async () => {
    const page3 = (await get(tenant, `/spreadsheets/${docs.pagamentos.id}/preview?page=3`)).body.data.sheet;
    expect(page3.rows.map((row) => row.number)).toEqual(Array.from({ length: 25 }, (_, index) => 101 + index));
    const beyond = (await get(tenant, `/spreadsheets/${docs.pagamentos.id}/preview?page=9`)).body.data.sheet;
    expect(beyond).toMatchObject({ total_rows: 125, rows: [] });
    const providers = (await get(tenant, `/spreadsheets/${docs.pagamentos.id}/preview?sheet=2`)).body.data.sheet;
    expect(providers.name).toBe('Prestadores');
  });

  test('aba inexistente → 404; parâmetros inválidos → 422', async () => {
    const missing = await get(tenant, `/spreadsheets/${docs.pagamentos.id}/preview?sheet=3`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('SHEET_NOT_FOUND');
    expect((await get(tenant, `/spreadsheets/${docs.extrato.id}/preview?sheet=1`)).status).toBe(404);
    expect((await get(tenant, `/spreadsheets/${docs.pagamentos.id}/preview?page=0`)).status).toBe(422);
    expect((await get(tenant, `/spreadsheets/${docs.pagamentos.id}/preview?sheet=-1`)).status).toBe(422);
    expect((await get(tenant, `/spreadsheets/${docs.pagamentos.id}/preview?raw=1`)).status).toBe(422);
  });

  test('CSV devolve a codificação e o separador; ODS lê o texto formatado', async () => {
    const csv = (await get(tenant, `/spreadsheets/${docs.extrato.id}/preview`)).body.data;
    expect(csv).toMatchObject({ extension: 'csv', csv: { encoding: 'windows-1252', delimiter: ';' } });
    expect(csv.sheet.rows[0].cells[1]).toBe('Histórico');
    const ods = (await get(tenant, `/spreadsheets/${docs.orcamento.id}/preview`)).body.data;
    expect(ods.sheets.map((sheet) => sheet.name)).toEqual(['Orçamento', 'Cronograma']);
    expect(ods.sheet.columns).toBe(6);
  });

  test('XLS legado → 422 PREVIEW_NOT_SUPPORTED, sem auditoria de abertura', async () => {
    const res = await get(tenant, `/spreadsheets/${docs.legado.id}/preview`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PREVIEW_NOT_SUPPORTED');
    expect(await auditEvents({ companyId: tenant.company.id, action: 'document.previewed', entityId: docs.legado.id })).toHaveLength(0);
  });

  test('acima de 10 MB → 422 SPREADSHEET_TOO_LARGE antes de baixar', async () => {
    const big = await upload(tenant, 'diaristas');
    await pool.query(
      `UPDATE files SET size_bytes = $2
         WHERE id = (SELECT file_id FROM document_versions WHERE document_id = $1 AND version_number = 1)`,
      [big.id, 10 * 1024 * 1024 + 1],
    );
    const res = await get(tenant, `/spreadsheets/${big.id}/preview`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SPREADSHEET_TOO_LARGE');
    expect((await get(tenant, `/spreadsheets/${big.id}`)).body.data.spreadsheet.file.previewable).toBe(false);
  });

  test('versão anterior pelo número; versão inexistente → 404', async () => {
    const doc = await upload(tenant, 'diaristas');
    const fileId = await uploadFile(app, tenant.headers('owner'), { filename: GHOSTS.extrato, content: ghost(GHOSTS.extrato) });
    await send(tenant, 'post', `/documents/${doc.id}/versions`, { file_id: fileId });
    const v1 = (await get(tenant, `/spreadsheets/${doc.id}/preview?version=1`)).body.data;
    const v2 = (await get(tenant, `/spreadsheets/${doc.id}/preview`)).body.data;
    expect([v1.version_number, v1.csv.encoding]).toEqual([1, 'utf-8']);
    expect([v2.version_number, v2.csv.encoding]).toEqual([2, 'windows-1252']);
    expect((await get(tenant, `/spreadsheets/${doc.id}/preview?version=7`)).status).toBe(404);
  });

  test('arquivo hostil (não é zip) → 422 SPREADSHEET_UNREADABLE, sem derrubar nada', async () => {
    const fake = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 7)]);
    const doc = await createDocument(app, tenant.headers('owner'), { filename: 'Falsa.xlsx', content: fake });
    const res = await get(tenant, `/spreadsheets/${doc.id}/preview`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SPREADSHEET_UNREADABLE');
  });
});

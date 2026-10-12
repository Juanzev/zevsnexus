// Notas fiscais (F7): três dimensões separadas (ciclo, recebimento, arquivamento), transições com
// regras, número único, valores, anexos (PDF/XML) e lista com abas, busca e totais.
import { PERSONAL_DATA } from '../../src/modules/audit/audit.service.js';
import { createDocument, FIXTURES, uploadFile } from '../helpers/documents.js';
import { createParty, post } from '../helpers/finance.js';
import { api, makeApp } from '../helpers/http.js';
import { createInvoice, createIssuedInvoice, invoiceRow } from '../helpers/invoices.js';
import { auditEvents, createTenant } from '../helpers/tenants.js';

const app = makeApp({ serveFrontend: false });

function get(tenant, path, role = 'owner') {
  return api(app).get(`/api/v1${path}`).set(tenant.headers(role));
}

function send(tenant, method, path, body) {
  return api(app)[method](`/api/v1${path}`).set(tenant.headers('owner')).send(body ?? {});
}

const ids = (res) => res.body.data.invoices.map((invoice) => invoice.id);

describe('ciclo da nota', () => {
  test('processamento → emitida → paga (finalizada) → desfazer → cancelar, com auditoria', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const created = await createInvoice(app, headers, { gross_amount_cents: 100_000, withheld_cents: 11_000 });
    expect(created).toMatchObject({
      kind: 'nfse',
      status: 'processing',
      payment_status: 'pending',
      finalized: false,
      net_amount_cents: 89_000,
      number: null,
    });

    // Emitir exige número e data.
    const missing = await send(tenant, 'post', `/invoices/${created.id}/issue`, {});
    expect(missing.status).toBe(422);
    expect(missing.body.error.details.map((detail) => detail.field)).toEqual(['number', 'issue_date']);
    // Receber antes de emitir: não.
    expect((await send(tenant, 'post', `/invoices/${created.id}/mark-paid`, { received_on: '2026-10-05' })).body.error.code).toBe(
      'INVOICE_NOT_ISSUED',
    );

    const issued = await send(tenant, 'post', `/invoices/${created.id}/issue`, { number: '2026/0001', issue_date: '2026-10-01' });
    expect(issued.status).toBe(200);
    expect(issued.body.data.invoice).toMatchObject({ status: 'issued', number: '2026/0001', issue_date: '2026-10-01' });
    expect((await send(tenant, 'post', `/invoices/${created.id}/issue`, {})).body.error.code).toBe('INVOICE_ALREADY_ISSUED');

    // Recebimento: valor padrão = líquido; data no futuro é recusada.
    expect((await send(tenant, 'post', `/invoices/${created.id}/mark-paid`, { received_on: '2099-01-01' })).status).toBe(422);
    const paid = await send(tenant, 'post', `/invoices/${created.id}/mark-paid`, { received_on: '2026-10-05' });
    expect(paid.body.data.invoice).toMatchObject({
      payment_status: 'paid',
      finalized: true,
      received_on: '2026-10-05',
      received_amount_cents: 89_000,
    });
    expect((await send(tenant, 'post', `/invoices/${created.id}/mark-paid`, { received_on: '2026-10-05' })).body.error.code).toBe(
      'INVOICE_ALREADY_PAID',
    );
    // Paga não se cancela.
    expect((await send(tenant, 'post', `/invoices/${created.id}/cancel`, { reason: 'Erro' })).body.error.code).toBe('INVOICE_PAID');

    // Desfazer: o motivo fica na nota; a auditoria guarda o que foi desfeito, sem o texto.
    const undone = await send(tenant, 'post', `/invoices/${created.id}/unmark-paid`, { reason: 'Depósito estornado pelo cliente' });
    expect(undone.body.data.invoice).toMatchObject({
      payment_status: 'pending',
      received_on: null,
      payment_undo_reason: 'Depósito estornado pelo cliente',
    });
    const [unpaid] = await auditEvents({ companyId: tenant.company.id, action: 'invoice.unpaid', entityId: created.id });
    expect(unpaid.metadata).toEqual({ received_on: '2026-10-05', received_amount_cents: 89_000 });

    const cancelled = await send(tenant, 'post', `/invoices/${created.id}/cancel`, { reason: 'Valor errado; reemitida' });
    expect(cancelled.body.data.invoice).toMatchObject({ status: 'cancelled', cancel_reason: 'Valor errado; reemitida' });
    expect((await send(tenant, 'post', `/invoices/${created.id}/cancel`, { reason: 'De novo' })).body.error.code).toBe('INVOICE_CANCELLED');
    expect((await send(tenant, 'post', `/invoices/${created.id}/mark-paid`, { received_on: '2026-10-05' })).body.error.code).toBe(
      'INVOICE_CANCELLED',
    );

    const history = (await get(tenant, `/invoices/${created.id}/history`)).body.data.events.map((event) => event.action);
    expect(history).toEqual(['invoice.cancelled', 'invoice.unpaid', 'invoice.paid', 'invoice.issued', 'invoice.created']);
  });

  test('criar já emitida (número e data obrigatórios) e valor recebido informado', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const incomplete = await post(app, headers, '/invoices', { description: 'x', gross_amount_cents: 500, issue: true, number: '7' });
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.error.details).toEqual([expect.objectContaining({ field: 'issue_date', code: 'INVOICE_DATE_REQUIRED' })]);

    const invoice = await createIssuedInvoice(app, headers, { kind: 'nfe', series: '1', competence: '2026-09' });
    expect(invoice).toMatchObject({ status: 'issued', kind: 'nfe', series: '1', competence: '2026-09' });
    expect((await auditEvents({ companyId: tenant.company.id, action: 'invoice.issued', entityId: invoice.id })).length).toBe(1);

    const paid = await send(tenant, 'post', `/invoices/${invoice.id}/mark-paid`, { received_on: '2026-10-02', received_amount_cents: 99_000 });
    expect(paid.body.data.invoice.received_amount_cents).toBe(99_000);
  });

  test('arquivar e desarquivar (qualquer estado), sem mexer no ciclo', async () => {
    const tenant = await createTenant();
    const invoice = await createIssuedInvoice(app, tenant.headers('owner'));
    expect((await send(tenant, 'post', `/invoices/${invoice.id}/archive`)).body.data.invoice.archived_at).not.toBeNull();
    expect(await invoiceRow(invoice.id)).toMatchObject({ status: 'issued', payment_status: 'pending' });
    await send(tenant, 'post', `/invoices/${invoice.id}/archive`); // de novo: sem auditoria nova
    expect(await auditEvents({ companyId: tenant.company.id, action: 'invoice.archived', entityId: invoice.id })).toHaveLength(1);
    expect((await send(tenant, 'post', `/invoices/${invoice.id}/unarchive`)).body.data.invoice.archived_at).toBeNull();
  });
});

describe('regras de valores, número e edição', () => {
  test('número único por tipo e série; a cancelada continua ocupando o número', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const first = await createIssuedInvoice(app, headers, { number: '150', series: 'A' });
    const duplicate = await post(app, headers, '/invoices', {
      description: 'x',
      gross_amount_cents: 1,
      issue: true,
      number: '150',
      series: 'A',
      issue_date: '2026-10-02',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toMatchObject({ code: 'INVOICE_NUMBER_TAKEN', details: [expect.objectContaining({ field: 'number' })] });
    await createIssuedInvoice(app, headers, { number: '150', series: 'B' });
    await createIssuedInvoice(app, headers, { number: '150', series: 'A', kind: 'nfe' });

    await send(tenant, 'post', `/invoices/${first.id}/cancel`, { reason: 'Erro de digitação' });
    const again = await post(app, headers, '/invoices', {
      description: 'x',
      gross_amount_cents: 1,
      issue: true,
      number: '150',
      series: 'A',
      issue_date: '2026-10-02',
    });
    expect(again.status).toBe(409);
  });

  test('retenções: entre 0 e o bruto, na criação e na edição', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const above = await post(app, headers, '/invoices', { description: 'x', gross_amount_cents: 100, withheld_cents: 101 });
    expect(above.status).toBe(422);
    expect(above.body.error.code).toBe('WITHHELD_ABOVE_GROSS');
    expect((await post(app, headers, '/invoices', { description: 'x', gross_amount_cents: 100, withheld_cents: -1 })).status).toBe(422);
    expect((await post(app, headers, '/invoices', { description: 'x', gross_amount_cents: 10.5 })).status).toBe(422);

    const invoice = await createInvoice(app, headers, { gross_amount_cents: 1000, withheld_cents: 100 });
    const lowered = await send(tenant, 'patch', `/invoices/${invoice.id}`, { version: invoice.version, gross_amount_cents: 50 });
    expect(lowered.status).toBe(422);
  });

  test('PATCH: versão, campos pessoais na auditoria, emitida não perde número, cancelada não muda', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const invoice = await createIssuedInvoice(app, headers);
    const edited = await send(tenant, 'patch', `/invoices/${invoice.id}`, {
      version: invoice.version,
      description: 'Medição 2 — Sr. Fulano de Tal',
      due_date: '2026-10-30',
      verification_code: 'ABCD-1234',
    });
    expect(edited.status).toBe(200);
    expect(edited.body.data.invoice).toMatchObject({ due_date: '2026-10-30', verification_code: 'ABCD-1234' });
    const [event] = await auditEvents({ companyId: tenant.company.id, action: 'invoice.updated', entityId: invoice.id });
    expect(event.metadata.changes).toEqual({
      description: PERSONAL_DATA,
      due_date: { from: null, to: '2026-10-30' },
      verification_code: { from: null, to: 'ABCD-1234' },
    });

    const stale = await send(tenant, 'patch', `/invoices/${invoice.id}`, { version: invoice.version, notes: 'x' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');

    const current = edited.body.data.invoice;
    const cleared = await send(tenant, 'patch', `/invoices/${invoice.id}`, { version: current.version, number: null });
    expect(cleared.status).toBe(422);
    expect(cleared.body.error.code).toBe('INVOICE_NUMBER_REQUIRED');

    await send(tenant, 'post', `/invoices/${invoice.id}/cancel`, { reason: 'Cancelada na prefeitura' });
    const afterCancel = await send(tenant, 'patch', `/invoices/${invoice.id}`, { version: current.version + 1, notes: 'x' });
    expect(afterCancel.body.error.code).toBe('INVOICE_CANCELLED');
  });

  test('competência AAAA-MM, tipo e campos desconhecidos', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    expect((await post(app, headers, '/invoices', { description: 'x', gross_amount_cents: 1, competence: '2026-13' })).status).toBe(422);
    expect((await post(app, headers, '/invoices', { description: 'x', gross_amount_cents: 1, kind: 'nfce' })).status).toBe(422);
    expect((await post(app, headers, '/invoices', { description: 'x', gross_amount_cents: 1, status: 'issued' })).status).toBe(422);
    expect((await post(app, headers, '/invoices', { description: 'x', gross_amount_cents: 1, company_id: tenant.company.id })).status).toBe(422);
  });
});

describe('lista', () => {
  let tenant;
  const docs = {};

  beforeAll(async () => {
    tenant = await createTenant();
    const headers = tenant.headers('owner');
    const client = await createParty(app, headers, { name: 'Condomínio Residencial Aurora', person_type: 'company', document: '11222333000181', roles: ['customer'] });
    docs.processing = await createInvoice(app, headers, { description: 'Laudo técnico', gross_amount_cents: 50_000 });
    docs.pending = await createIssuedInvoice(app, headers, { number: '901', party_id: client.id, gross_amount_cents: 200_000, withheld_cents: 20_000, due_date: '2026-01-10' });
    docs.paid = await createIssuedInvoice(app, headers, { number: '902', gross_amount_cents: 300_000, issue_date: '2026-09-15' });
    await send(tenant, 'post', `/invoices/${docs.paid.id}/mark-paid`, { received_on: '2026-10-01' });
    docs.cancelled = await createIssuedInvoice(app, headers, { number: '903' });
    await send(tenant, 'post', `/invoices/${docs.cancelled.id}/cancel`, { reason: 'Erro' });
    docs.archived = await createIssuedInvoice(app, headers, { number: '904' });
    await send(tenant, 'post', `/invoices/${docs.archived.id}/archive`);
    docs.client = client;
  });

  test.each([
    ['processing', ['processing']],
    ['pending', ['pending']],
    ['paid', ['paid']],
    ['issued', ['pending', 'paid']],
    ['cancelled', ['cancelled']],
    ['archived', ['archived']],
    ['all', ['processing', 'pending', 'paid', 'cancelled', 'archived']],
  ])('aba %s', async (tab, expected) => {
    const res = await get(tenant, `/invoices?tab=${tab}`);
    expect(res.status).toBe(200);
    expect(ids(res).sort()).toEqual(expected.map((key) => docs[key].id).sort());
  });

  test('padrão "Pendentes", vencida calculada, totais do filtro, busca, tomador e ordenação', async () => {
    const pending = await get(tenant, '/invoices');
    expect(pending.body.data.invoices).toEqual([expect.objectContaining({ id: docs.pending.id, overdue: true, party: { id: docs.client.id, name: 'Condomínio Residencial Aurora' } })]);
    expect(pending.body.meta.totals).toEqual({ gross_cents: 200_000, withheld_cents: 20_000, net_cents: 180_000 });

    expect(ids(await get(tenant, '/invoices?tab=all&q=aurora'))).toEqual([docs.pending.id]);
    expect(ids(await get(tenant, '/invoices?tab=all&q=902'))).toEqual([docs.paid.id]);
    expect(ids(await get(tenant, '/invoices?tab=all&q=laudo tecnico'))).toEqual([docs.processing.id]);
    expect(ids(await get(tenant, '/invoices?tab=all&q=%25'))).toEqual([]);
    expect(ids(await get(tenant, `/invoices?tab=all&party_id=${docs.client.id}`))).toEqual([docs.pending.id]);
    expect(ids(await get(tenant, '/invoices?tab=issued&issued_to=2026-09-30'))).toEqual([docs.paid.id]);
    const byNumber = await get(tenant, '/invoices?tab=all&sort=-number&limit=2');
    expect(byNumber.body.data.invoices.map((invoice) => invoice.number)).toEqual(['904', '903']);
    expect(byNumber.body.meta).toMatchObject({ page: 1, limit: 2, total: 5 });
  });

  test('parâmetros fora da allowlist → 422', async () => {
    expect((await get(tenant, '/invoices?tab=finalized')).status).toBe(422);
    expect((await get(tenant, '/invoices?sort=number;DROP TABLE invoices')).status).toBe(422);
    expect((await get(tenant, '/invoices?company_id=x')).status).toBe(422);
  });
});

describe('anexos', () => {
  test('PDF e XML enviados viram documentos na pasta "Notas fiscais"; documento da Central também; desvincular', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const context = (await get(tenant, '/company/context')).body.data;
    const invoice = await createIssuedInvoice(app, headers);

    const pdfId = await uploadFile(app, headers, { filename: 'NFS-e 1001.pdf', content: FIXTURES.pdf() });
    const withPdf = await post(app, headers, `/invoices/${invoice.id}/documents`, { file_id: pdfId, role: 'pdf' });
    expect(withPdf.status).toBe(201);
    expect(withPdf.body.data.invoice.has_pdf).toBe(true);
    const xmlId = await uploadFile(app, headers, { filename: 'NFS-e 1001.xml', content: FIXTURES.xml() });
    const withXml = await post(app, headers, `/invoices/${invoice.id}/documents`, { file_id: xmlId, role: 'xml' });
    expect(withXml.body.data.invoice.documents.map((doc) => [doc.role, doc.extension])).toEqual([
      ['pdf', 'pdf'],
      ['xml', 'xml'],
    ]);
    const pdfDoc = withXml.body.data.invoice.documents[0];
    const folder = (await get(tenant, `/documents/${pdfDoc.document_id}`)).body.data.document.folder_id;
    expect(folder).toBe(context.document_folders.invoices);

    const receipt = await createDocument(app, headers, { filename: 'Extrato.pdf' });
    const linked = await post(app, headers, `/invoices/${invoice.id}/documents`, { document_id: receipt.id, role: 'receipt' });
    expect(linked.body.data.invoice.documents).toHaveLength(3);
    expect((await post(app, headers, `/invoices/${invoice.id}/documents`, { role: 'pdf' })).status).toBe(422);

    const unlinked = await send(tenant, 'delete', `/invoices/${invoice.id}/documents/${receipt.id}`);
    expect(unlinked.body.data.invoice.documents).toHaveLength(2);
    expect((await get(tenant, `/documents/${receipt.id}`)).status).toBe(200); // continua na Central
    expect((await send(tenant, 'delete', `/invoices/${invoice.id}/documents/${receipt.id}`)).status).toBe(404);
  });
});

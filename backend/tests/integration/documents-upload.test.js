import { randomUUID } from 'node:crypto';
import { cleanupFiles } from '../../src/modules/files/files.service.js';
import { fileKey, uploadKey } from '../../src/modules/storage/storage.keys.js';
import { signDevToken } from '../../src/modules/storage/dev-token.js';
import { pool } from '../../src/shared/db.js';
import {
  createIntent,
  devStoragePath,
  FIXTURES,
  memoryStorage,
  postDocument,
  putUpload,
  uploadFile,
} from '../helpers/documents.js';
import { api, makeApp } from '../helpers/http.js';
import { addMember, auditEvents, createTenant } from '../helpers/tenants.js';

const app = makeApp({ serveFrontend: false });
const storage = memoryStorage();

beforeAll(async () => {
  // Plano minúsculo para provar limite por arquivo e cota.
  await pool.query(
    `INSERT INTO plans (code, name, max_users, storage_quota_bytes, max_file_size_bytes)
     VALUES ('mini_teste', 'Mini (teste)', 5, 100, 80) ON CONFLICT (code) DO NOTHING`,
  );
});

async function usage(companyId) {
  const { rows } = await pool.query('SELECT storage_bytes, file_count FROM company_usage WHERE company_id = $1', [companyId]);
  return rows[0];
}

async function fileRow(id) {
  const { rows } = await pool.query('SELECT status, storage_key, company_id FROM files WHERE id = $1', [id]);
  return rows[0] ?? null;
}

describe('POST /files/upload-intents', () => {
  test('cria o arquivo pendente e devolve a URL de PUT para a chave de envio', async () => {
    const tenant = await createTenant();
    const res = await createIntent(app, tenant.headers('owner'), { filename: 'Contrato Obra.pdf', size: 1234, contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    const { file, upload } = res.body.data;
    expect(file).toMatchObject({ original_name: 'Contrato Obra.pdf', extension: 'pdf', content_type: 'application/pdf', size_bytes: 1234, status: 'pending' });
    expect(upload).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'application/pdf' } });
    expect(devStoragePath(upload.url)).toMatch(/^\/dev-storage\/upload\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    // A chave nunca sai para o cliente e não leva o nome original.
    expect(JSON.stringify(res.body)).not.toContain('companies/');
    const row = await fileRow(file.id);
    expect(row.storage_key).toBe(fileKey(tenant.company.id, file.id));
  });

  test.each([
    ['virus.exe', 'application/x-msdownload'],
    ['imagem.svg', 'image/svg+xml'],
    ['pagina.html', 'text/html'],
    ['planilha.xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.12'],
    ['pacote.zip', 'application/zip'],
  ])('recusa %s', async (filename, contentType) => {
    const tenant = await createTenant();
    const res = await createIntent(app, tenant.headers('owner'), { filename, size: 100, contentType });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  test('MIME declarado diferente da extensão é recusado', async () => {
    const tenant = await createTenant();
    const res = await createIntent(app, tenant.headers('owner'), { filename: 'nota.pdf', size: 100, contentType: 'text/html' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  test('limite por arquivo e pré-checagem da cota vêm do plano', async () => {
    const tenant = await createTenant({ plan: 'mini_teste' });
    const tooBig = await createIntent(app, tenant.headers('owner'), { filename: 'a.pdf', size: 81 });
    expect(tooBig.status).toBe(422);
    expect(tooBig.body.error.code).toBe('FILE_TOO_LARGE');

    await pool.query('UPDATE company_usage SET storage_bytes = 50 WHERE company_id = $1', [tenant.company.id]);
    const overQuota = await createIntent(app, tenant.headers('owner'), { filename: 'a.pdf', size: 60 });
    expect(overQuota.status).toBe(422);
    expect(overQuota.body.error.code).toBe('STORAGE_QUOTA_EXCEEDED');
  });

  test('company_id, chave ou campos extras no corpo são recusados', async () => {
    const tenant = await createTenant();
    const res = await api(app)
      .post('/api/v1/files/upload-intents')
      .set(tenant.headers('owner'))
      .send({ filename: 'a.pdf', size_bytes: 10, company_id: randomUUID(), storage_key: 'companies/x' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.map((item) => item.field).sort()).toEqual(['company_id', 'storage_key']);
  });
});

describe('PUT no /dev-storage (papel do R2)', () => {
  test('tipo ou tamanho diferente do assinado é recusado', async () => {
    const tenant = await createTenant();
    const content = FIXTURES.pdf();
    const intent = await createIntent(app, tenant.headers('owner'), { filename: 'a.pdf', content });
    const { upload } = intent.body.data;

    const wrongType = await api(app).put(devStoragePath(upload.url)).set('Content-Type', 'text/html').send(content);
    expect(wrongType.status).toBe(403);
    const wrongSize = await api(app)
      .put(devStoragePath(upload.url))
      .set('Content-Type', 'application/pdf')
      .send(Buffer.concat([content, Buffer.from('x')]));
    expect(wrongSize.status).toBe(403);
    expect(storage.has(uploadKey(tenant.company.id, intent.body.data.file.id))).toBe(false);
  });

  test('token expirado ou adulterado não grava nada', async () => {
    const key = uploadKey(randomUUID(), randomUUID());
    const expired = signDevToken({ op: 'put', key, ct: 'application/pdf', len: 4, exp: Math.floor(Date.now() / 1000) - 1 });
    const res = await api(app).put(`/dev-storage/upload/${expired}`).set('Content-Type', 'application/pdf').send(Buffer.from('%PDF'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SIGNATURE_INVALID');

    const download = signDevToken({ op: 'get', key, ct: 'application/pdf', disp: 'inline', name: 'a.pdf', exp: 9_999_999_999 });
    const misuse = await api(app).put(`/dev-storage/upload/${download}`).set('Content-Type', 'application/pdf').send(Buffer.from('%PDF'));
    expect(misuse.status).toBe(403);
    expect(storage.has(key)).toBe(false);
  });
});

describe('POST /documents (confirmação do envio)', () => {
  test('fluxo completo: confere, copia para a chave definitiva, consome a cota e audita', async () => {
    const tenant = await createTenant();
    const content = FIXTURES.pdf();
    const fileId = await uploadFile(app, tenant.headers('owner'), { filename: 'Contrato Obra Centro.pdf', content });

    const res = await postDocument(app, tenant.headers('owner'), { file_id: fileId, tags: ['Obra', 'obra', 'Contratos'] });
    expect(res.status).toBe(201);
    const { document } = res.body.data;
    expect(document).toMatchObject({
      title: 'Contrato Obra Centro',
      folder_id: null,
      current_version: 1,
      tags: ['Contratos', 'Obra'],
      favorite: false,
      file: { original_name: 'Contrato Obra Centro.pdf', extension: 'pdf', size_bytes: content.length, inline: true },
      version: 1,
    });

    expect(await fileRow(fileId)).toMatchObject({ status: 'ready' });
    expect(storage.has(fileKey(tenant.company.id, fileId))).toBe(true);
    expect(await usage(tenant.company.id)).toEqual({ storage_bytes: content.length, file_count: 1 });

    const [event] = await auditEvents({ companyId: tenant.company.id, action: 'document.uploaded', entityId: document.id });
    expect(event.metadata).toMatchObject({ version_number: 1, extension: 'pdf', size_bytes: content.length });
    // Título e nome de arquivo podem ter nome de pessoa: não vão para a auditoria.
    expect(JSON.stringify(event.metadata)).not.toMatch(/Contrato|Obra/);
  });

  test('conteúdo que não bate com a extensão é recusado e não consome cota', async () => {
    const tenant = await createTenant();
    const fake = Buffer.from('<html><script>alert(1)</script></html>');
    const fileId = await uploadFile(app, tenant.headers('owner'), { filename: 'boleto.pdf', content: fake });

    const res = await postDocument(app, tenant.headers('owner'), { file_id: fileId });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('FILE_REJECTED');
    expect(await fileRow(fileId)).toMatchObject({ status: 'rejected' });
    expect(storage.has(fileKey(tenant.company.id, fileId))).toBe(false);
    expect(await usage(tenant.company.id)).toEqual({ storage_bytes: 0, file_count: 0 });
    const [event] = await auditEvents({ companyId: tenant.company.id, action: 'file.rejected', entityId: fileId });
    expect(event.metadata.reason).toBe('signature_mismatch');

    // Recusado não volta a valer.
    const again = await postDocument(app, tenant.headers('owner'), { file_id: fileId });
    expect(again.body.error.code).toBe('FILE_REJECTED');
  });

  test('antes do PUT: 422 FILE_NOT_UPLOADED e o arquivo continua pendente', async () => {
    const tenant = await createTenant();
    const content = FIXTURES.png();
    const intent = await createIntent(app, tenant.headers('owner'), { filename: 'foto.png', content });
    const fileId = intent.body.data.file.id;

    const early = await postDocument(app, tenant.headers('owner'), { file_id: fileId });
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('FILE_NOT_UPLOADED');
    expect(await fileRow(fileId)).toMatchObject({ status: 'pending' });

    await putUpload(app, intent.body.data.upload, content);
    const late = await postDocument(app, tenant.headers('owner'), { file_id: fileId });
    expect(late.status).toBe(201);
  });

  test('um arquivo vira um documento só; arquivo de outra pessoa ou vencido não serve', async () => {
    const tenant = await createTenant({ roles: ['owner', 'assistant'] });
    const fileId = await uploadFile(app, tenant.headers('owner'));
    expect((await postDocument(app, tenant.headers('owner'), { file_id: fileId })).status).toBe(201);
    const reused = await postDocument(app, tenant.headers('owner'), { file_id: fileId });
    expect(reused.body.error.code).toBe('FILE_ALREADY_USED');

    const othersFile = await uploadFile(app, tenant.headers('owner'));
    const byOther = await postDocument(app, tenant.headers('assistant'), { file_id: othersFile });
    expect(byOther.status).toBe(422);
    expect(byOther.body.error.code).toBe('FILE_NOT_FOUND');

    const expiredFile = await uploadFile(app, tenant.headers('owner'));
    await pool.query("UPDATE files SET expires_at = now() - interval '1 minute' WHERE id = $1", [expiredFile]);
    const expired = await postDocument(app, tenant.headers('owner'), { file_id: expiredFile });
    expect(expired.body.error.code).toBe('FILE_EXPIRED');
  });

  test('a cota de verdade é o UPDATE atômico da confirmação', async () => {
    const tenant = await createTenant({ plan: 'mini_teste' });
    const content = Buffer.concat([FIXTURES.pdf(), Buffer.alloc(60 - FIXTURES.pdf().length, 0x20)]);
    // As duas intenções passam na pré-checagem (0 + 60 <= 100); só uma cabe de verdade.
    const first = await uploadFile(app, tenant.headers('owner'), { filename: 'a.pdf', content });
    const second = await uploadFile(app, tenant.headers('owner'), { filename: 'b.pdf', content });
    expect((await postDocument(app, tenant.headers('owner'), { file_id: first })).status).toBe(201);
    const res = await postDocument(app, tenant.headers('owner'), { file_id: second });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('STORAGE_QUOTA_EXCEEDED');
    expect(await fileRow(second)).toMatchObject({ status: 'pending' });
    expect(await usage(tenant.company.id)).toEqual({ storage_bytes: 60, file_count: 1 });
  });

  test('PUT de novo depois da confirmação não troca o arquivo guardado', async () => {
    const tenant = await createTenant();
    const content = FIXTURES.pdf();
    const intent = await createIntent(app, tenant.headers('owner'), { filename: 'a.pdf', content });
    const { file, upload } = intent.body.data;
    await putUpload(app, upload, content);
    expect((await postDocument(app, tenant.headers('owner'), { file_id: file.id })).status).toBe(201);

    // A URL de PUT ainda vale por minutos: o segundo envio só atinge a chave de envio.
    const evil = Buffer.alloc(content.length, 0x41);
    expect((await putUpload(app, upload, evil)).status).toBe(200);
    expect(await storage.read(fileKey(tenant.company.id, file.id))).toEqual(content);
  });

  test('Idempotency-Key: repetição devolve o mesmo documento; sem chave é 422', async () => {
    const tenant = await createTenant();
    const fileId = await uploadFile(app, tenant.headers('owner'));
    const key = randomUUID();
    const first = await postDocument(app, tenant.headers('owner'), { file_id: fileId }, key);
    const replay = await postDocument(app, tenant.headers('owner'), { file_id: fileId }, key);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.data.document.id).toBe(first.body.data.document.id);

    const noKey = await api(app).post('/api/v1/documents').set(tenant.headers('owner')).send({ file_id: fileId });
    expect(noKey.status).toBe(422);
    expect(noKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  test('pasta e tipo do corpo precisam ser da empresa (422), e o arquivo continua pendente', async () => {
    const tenant = await createTenant();
    const other = await createTenant();
    const { rows } = await pool.query(
      "INSERT INTO folders (company_id, name, created_by) VALUES ($1, 'Alheia', $2) RETURNING id",
      [other.company.id, other.members.owner.user.id],
    );
    const fileId = await uploadFile(app, tenant.headers('owner'));
    const res = await postDocument(app, tenant.headers('owner'), { file_id: fileId, folder_id: rows[0].id });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('FOLDER_NOT_FOUND');
    expect(await fileRow(fileId)).toMatchObject({ status: 'pending' });
    expect(await usage(tenant.company.id)).toEqual({ storage_bytes: 0, file_count: 0 });
  });
});

describe('job cleanup.files', () => {
  test('descarta envios vencidos e recusados antigos; apaga a chave de envio dos confirmados', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const companyId = tenant.company.id;

    const abandoned = await uploadFile(app, headers);
    await pool.query("UPDATE files SET expires_at = now() - interval '2 hours' WHERE id = $1", [abandoned]);

    const rejected = await uploadFile(app, headers, { filename: 'x.pdf', content: Buffer.from('não é pdf') });
    await postDocument(app, headers, { file_id: rejected });
    await pool.query("UPDATE files SET created_at = now() - interval '2 days' WHERE id = $1", [rejected]);

    const confirmed = await uploadFile(app, headers);
    await postDocument(app, headers, { file_id: confirmed });
    await pool.query("UPDATE files SET created_at = now() - interval '1 hour' WHERE id = $1", [confirmed]);

    const recent = await uploadFile(app, headers);

    const result = await cleanupFiles();
    expect(result.discarded).toBeGreaterThanOrEqual(2);
    expect(await fileRow(abandoned)).toBeNull();
    expect(await fileRow(rejected)).toBeNull();
    expect(storage.has(uploadKey(companyId, abandoned))).toBe(false);
    expect(storage.has(uploadKey(companyId, rejected))).toBe(false);

    expect(await fileRow(confirmed)).toMatchObject({ status: 'ready' });
    expect(storage.has(uploadKey(companyId, confirmed))).toBe(false);
    expect(storage.has(fileKey(companyId, confirmed))).toBe(true);

    // Envio recente (URL de PUT ainda válida) fica intacto.
    expect(await fileRow(recent)).toMatchObject({ status: 'pending' });
    expect(storage.has(uploadKey(companyId, recent))).toBe(true);
  });
});

describe('papéis', () => {
  test('Visualização não envia arquivo', async () => {
    const tenant = await createTenant();
    const viewer = await addMember(tenant.company, 'viewer');
    const res = await api(app)
      .post('/api/v1/files/upload-intents')
      .set({ Authorization: `Bearer ${viewer.token}`, 'X-Company-Id': tenant.company.id })
      .send({ filename: 'a.pdf', size_bytes: 10 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });
});

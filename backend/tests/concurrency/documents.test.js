// Concorrência em cota, versões e árvore de pastas (CLAUDE.md: obrigatório quando mexe em cota ou estado).
import { randomUUID } from 'node:crypto';
import { pool } from '../../src/shared/db.js';
import { createDocument, FIXTURES, postDocument, uploadFile } from '../helpers/documents.js';
import { api, makeApp } from '../helpers/http.js';
import { createTenant } from '../helpers/tenants.js';

const app = makeApp({ serveFrontend: false });

beforeAll(async () => {
  await pool.query(
    `INSERT INTO plans (code, name, max_users, storage_quota_bytes, max_file_size_bytes)
     VALUES ('mini_concorrencia', 'Mini (concorrência)', 5, 150, 100) ON CONFLICT (code) DO NOTHING`,
  );
});

function pdfOfSize(size) {
  const head = FIXTURES.pdf();
  return Buffer.concat([head, Buffer.alloc(size - head.length, 0x20)]);
}

describe('cota', () => {
  test('4 confirmações simultâneas de 60 bytes numa cota de 150: só 2 passam', async () => {
    const tenant = await createTenant({ plan: 'mini_concorrencia' });
    const headers = tenant.headers('owner');
    const files = [];
    for (let i = 0; i < 4; i += 1) files.push(await uploadFile(app, headers, { filename: `a${i}.pdf`, content: pdfOfSize(60) }));

    const results = await Promise.all(files.map((fileId) => postDocument(app, headers, { file_id: fileId })));
    expect(results.map((res) => res.status).sort()).toEqual([201, 201, 422, 422]);
    expect(results.filter((res) => res.status === 422).every((res) => res.body.error.code === 'STORAGE_QUOTA_EXCEEDED')).toBe(true);
    const { rows } = await pool.query('SELECT storage_bytes, file_count FROM company_usage WHERE company_id = $1', [tenant.company.id]);
    expect(rows[0]).toEqual({ storage_bytes: 120, file_count: 2 });
  });

  test('o mesmo arquivo confirmado 3 vezes ao mesmo tempo (chaves diferentes): um documento', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const fileId = await uploadFile(app, headers);
    const results = await Promise.all([1, 2, 3].map(() => postDocument(app, headers, { file_id: fileId })));
    expect(results.map((res) => res.status).sort()).toEqual([201, 422, 422]);
    const { rows } = await pool.query('SELECT count(*) AS total FROM document_versions WHERE file_id = $1', [fileId]);
    expect(rows[0].total).toBe(1);
    const usage = await pool.query('SELECT file_count FROM company_usage WHERE company_id = $1', [tenant.company.id]);
    expect(usage.rows[0].file_count).toBe(1);
  });
});

describe('versões', () => {
  test('5 versões enviadas ao mesmo tempo ganham números 2..6, sem buraco nem repetição', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    const doc = await createDocument(app, headers);
    const files = [];
    for (let i = 0; i < 5; i += 1) files.push(await uploadFile(app, headers));

    const results = await Promise.all(
      files.map((fileId) =>
        api(app)
          .post(`/api/v1/documents/${doc.id}/versions`)
          .set(headers)
          .set('Idempotency-Key', randomUUID())
          .send({ file_id: fileId }),
      ),
    );
    expect(results.every((res) => res.status === 201)).toBe(true);
    const { rows } = await pool.query(
      'SELECT version_number FROM document_versions WHERE document_id = $1 ORDER BY version_number',
      [doc.id],
    );
    expect(rows.map((row) => row.version_number)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('pastas', () => {
  test('mover A para dentro de B e B para dentro de A ao mesmo tempo: nunca forma ciclo', async () => {
    const tenant = await createTenant();
    const create = async (name) =>
      (await api(app).post('/api/v1/folders').set(tenant.headers('owner')).send({ name })).body.data.folder;
    for (let round = 0; round < 5; round += 1) {
      const a = await create(`A${round}`);
      const b = await create(`B${round}`);
      const move = (id, parentId) =>
        api(app).post(`/api/v1/folders/${id}/move`).set(tenant.headers('owner')).send({ parent_id: parentId });
      const results = await Promise.all([move(a.id, b.id), move(b.id, a.id)]);
      expect(results.map((res) => res.status).sort()).toEqual([200, 422]);

      const { rows } = await pool.query('SELECT id, parent_id FROM folders WHERE id = ANY ($1::uuid[])', [[a.id, b.id]]);
      const parents = Object.fromEntries(rows.map((row) => [row.id, row.parent_id]));
      expect(parents[a.id] === b.id && parents[b.id] === a.id).toBe(false);
    }
  });

  test('excluir a pasta enquanto um documento entra nela: ou a pasta fica, ou o documento é recusado', async () => {
    const tenant = await createTenant();
    const headers = tenant.headers('owner');
    for (let round = 0; round < 5; round += 1) {
      const folder = (await api(app).post('/api/v1/folders').set(headers).send({ name: `Corrida ${round}` })).body.data.folder;
      const fileId = await uploadFile(app, headers);
      const [created, deleted] = await Promise.all([
        postDocument(app, headers, { file_id: fileId, folder_id: folder.id }),
        api(app).delete(`/api/v1/folders/${folder.id}`).set(headers).send({}),
      ]);
      const { rows } = await pool.query(
        `SELECT f.deleted_at, (SELECT count(*) FROM documents d WHERE d.folder_id = f.id AND d.deleted_at IS NULL) AS docs
           FROM folders f WHERE f.id = $1`,
        [folder.id],
      );
      // Nunca: pasta excluída com documento ativo dentro.
      expect(rows[0].deleted_at !== null && rows[0].docs > 0).toBe(false);
      expect([201, 422]).toContain(created.status);
      expect([204, 409]).toContain(deleted.status);
    }
  });
});

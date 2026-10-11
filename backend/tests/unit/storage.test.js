import { randomUUID } from 'node:crypto';
import { signDevToken, verifyDevToken } from '../../src/modules/storage/dev-token.js';
import { createMemoryProvider } from '../../src/modules/storage/providers/memory.provider.js';
import { createR2Provider } from '../../src/modules/storage/providers/r2.provider.js';
import { StoragePreconditionError } from '../../src/modules/storage/storage.errors.js';
import { assertKey, fileKey, uploadKey } from '../../src/modules/storage/storage.keys.js';

const companyId = randomUUID();
const fileId = randomUUID();

describe('chaves do storage', () => {
  test('geradas pelo servidor, sem nome original', () => {
    expect(fileKey(companyId, fileId)).toBe(`companies/${companyId}/files/${fileId}`);
    expect(uploadKey(companyId, fileId)).toBe(`companies/${companyId}/uploads/${fileId}`);
  });

  test('recusa qualquer coisa fora do formato', () => {
    expect(() => fileKey('../../x', fileId)).toThrow();
    expect(() => fileKey(companyId, 'arquivo.pdf')).toThrow();
    for (const key of [
      `companies/${companyId}/files/${fileId}/../../outro`,
      `companies/${companyId}/files/../${fileId}`,
      `/companies/${companyId}/files/${fileId}`,
      `companies/${companyId}/other/${fileId}`,
      '',
      null,
    ]) {
      expect(() => assertKey(key)).toThrow(/formato/);
    }
  });
});

describe('token do /dev-storage', () => {
  const payload = { op: 'put', key: uploadKey(companyId, fileId), ct: 'application/pdf', len: 10 };

  test('vale para a operação assinada, dentro da validade', () => {
    const token = signDevToken({ ...payload, exp: Math.floor(Date.now() / 1000) + 60 });
    expect(verifyDevToken(token, 'put')).toMatchObject(payload);
    expect(verifyDevToken(token, 'get')).toBeNull();
  });

  test('expirado, adulterado ou malformado não vale', () => {
    const expired = signDevToken({ ...payload, exp: Math.floor(Date.now() / 1000) - 1 });
    expect(verifyDevToken(expired, 'put')).toBeNull();

    const token = signDevToken({ ...payload, exp: Math.floor(Date.now() / 1000) + 60 });
    const [body, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, len: 999_999, exp: 9_999_999_999 })).toString('base64url');
    expect(verifyDevToken(`${forged}.${signature}`, 'put')).toBeNull();
    expect(verifyDevToken(`${body}.${'A'.repeat(43)}`, 'put')).toBeNull();
    expect(verifyDevToken('abc', 'put')).toBeNull();
    expect(verifyDevToken(undefined, 'put')).toBeNull();
  });
});

describe('provider memory (mesma interface do R2)', () => {
  const provider = createMemoryProvider({ baseUrl: 'http://localhost:3000' });
  const source = uploadKey(companyId, fileId);
  const target = fileKey(companyId, fileId);

  test('head, leitura parcial e cópia condicionada à ETag', async () => {
    await provider.write(source, Buffer.from('%PDF-1.7 conteúdo'));
    const head = await provider.head(source);
    expect(head.size).toBe(Buffer.byteLength('%PDF-1.7 conteúdo'));
    expect(head.etag).toMatch(/^"[0-9a-f]{32}"$/);
    expect((await provider.readRange(source, 0, 4, { ifMatch: head.etag })).toString()).toBe('%PDF-');

    await provider.copy(source, target, { ifMatch: head.etag });
    expect(provider.has(target)).toBe(true);

    // Conteúdo trocado depois da conferência: a cópia não acontece.
    await provider.write(source, Buffer.from('outro conteúdo'));
    await expect(provider.copy(source, target, { ifMatch: head.etag })).rejects.toBeInstanceOf(StoragePreconditionError);
    await expect(provider.readRange(source, 0, 4, { ifMatch: head.etag })).rejects.toBeInstanceOf(StoragePreconditionError);
  });

  test('objeto inexistente: head null, delete sem erro', async () => {
    expect(await provider.head(fileKey(companyId, randomUUID()))).toBeNull();
    await expect(provider.delete(fileKey(companyId, randomUUID()))).resolves.toBeUndefined();
  });
});

describe('provider r2 (assinatura, sem rede)', () => {
  // Credenciais fictícias: só o formato importa para assinar.
  const provider = createR2Provider({
    accountId: '0123456789abcdef0123456789abcdef',
    accessKeyId: 'chave-ficticia-0001',
    secretAccessKey: 'segredo-ficticio-com-mais-de-32-caracteres',
    bucket: 'nexus-teste',
  });

  test('URL de PUT assina Content-Length e Content-Type (o R2 recusa corpo diferente)', async () => {
    const upload = await provider.createUploadUrl({
      key: uploadKey(companyId, fileId),
      contentType: 'application/pdf',
      contentLength: 1234,
      expiresIn: 600,
    });
    const url = new URL(upload.url);
    expect(url.origin).toBe('https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com');
    expect(url.pathname).toBe(`/nexus-teste/companies/${companyId}/uploads/${fileId}`);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(upload).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'application/pdf' } });
  });

  test('URL de GET curta, com tipo, disposição e cache forçados', async () => {
    const url = new URL(
      await provider.createDownloadUrl({
        key: fileKey(companyId, fileId),
        filename: 'Relatório.pdf',
        contentType: 'application/pdf',
        disposition: 'inline',
        expiresIn: 60,
      }),
    );
    expect(url.pathname).toBe(`/nexus-teste/companies/${companyId}/files/${fileId}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
    expect(url.searchParams.get('response-content-type')).toBe('application/pdf');
    expect(url.searchParams.get('response-content-disposition')).toMatch(/^inline; filename=/);
    expect(url.searchParams.get('response-cache-control')).toBe('private, no-store');
  });

  test('a CSP recebe a origem S3 da conta', () => {
    expect(provider.origins).toEqual(['https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com']);
  });

  test('chave fora do formato nunca vira URL', async () => {
    await expect(
      provider.createUploadUrl({ key: '../segredo', contentType: 'application/pdf', contentLength: 1, expiresIn: 60 }),
    ).rejects.toThrow(/formato/);
  });
});

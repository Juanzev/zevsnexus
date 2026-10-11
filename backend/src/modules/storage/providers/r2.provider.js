// Cloudflare R2 pela API S3, assinada com aws4fetch (ARCHITECTURE §10.3).
// - URL de PUT: Content-Type e Content-Length nos SignedHeaders → o R2 recusa corpo diferente do declarado.
// - URL de GET: 60 s, com tipo, disposição e cache forçados na resposta.
// - HEAD, GET com Range, cópia e DELETE: assinatura por header, com tempo limite.
// Nenhuma URL assinada vai para log ou mensagem de erro.
import { AwsClient } from 'aws4fetch';
import { contentDisposition } from '../../../shared/files.js';
import { StorageObjectTooLargeError, StoragePreconditionError, StorageUnavailableError } from '../storage.errors.js';
import { assertKey } from '../storage.keys.js';

const TIMEOUT_MS = 8000;

export function createR2Provider({ accountId, accessKeyId, secretAccessKey, bucket }) {
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto', retries: 2 });
  const objectUrl = (key) => new URL(`${endpoint}/${bucket}/${assertKey(key)}`);

  async function send(operation, key, init = {}) {
    try {
      return await client.fetch(objectUrl(key), { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      throw new StorageUnavailableError(`R2 ${operation}: falha de comunicação`, { cause: err });
    }
  }

  function unexpected(operation, res) {
    return new StorageUnavailableError(`R2 ${operation}: status ${res.status}`);
  }

  async function presign(url, init) {
    const signed = await client.sign(url, { ...init, aws: { signQuery: true, allHeaders: true } });
    return signed.url;
  }

  return {
    name: 'r2',
    /** connect-src (PUT do navegador) e img-src (prévia de imagem) da CSP. */
    origins: [endpoint],

    async createUploadUrl({ key, contentType, contentLength, expiresIn }) {
      const url = objectUrl(key);
      url.searchParams.set('X-Amz-Expires', String(expiresIn));
      const signed = await presign(url, {
        method: 'PUT',
        headers: { 'content-type': contentType, 'content-length': String(contentLength) },
      });
      return { url: signed, method: 'PUT', headers: { 'Content-Type': contentType } };
    },

    async createDownloadUrl({ key, filename, contentType, disposition, expiresIn }) {
      const url = objectUrl(key);
      url.searchParams.set('X-Amz-Expires', String(expiresIn));
      url.searchParams.set('response-content-disposition', contentDisposition(disposition, filename));
      url.searchParams.set('response-content-type', contentType);
      url.searchParams.set('response-cache-control', 'private, no-store');
      return presign(url, { method: 'GET' });
    },

    async head(key) {
      const res = await send('HEAD', key, { method: 'HEAD' });
      if (res.status === 404) return null;
      if (!res.ok) throw unexpected('HEAD', res);
      return { size: Number(res.headers.get('content-length')), etag: res.headers.get('etag') };
    },

    async readRange(key, start, end, { ifMatch } = {}) {
      const headers = { range: `bytes=${start}-${end}` };
      if (ifMatch) headers['if-match'] = ifMatch;
      const res = await send('GET', key, { method: 'GET', headers });
      if (res.status === 412 || res.status === 404) {
        await res.body?.cancel();
        throw new StoragePreconditionError();
      }
      if (res.status === 416) return Buffer.alloc(0);
      if (res.status !== 206 && res.status !== 200) throw unexpected('GET', res);
      const body = Buffer.from(await res.arrayBuffer());
      return body.subarray(0, end - start + 1);
    },

    async copy(fromKey, toKey, { ifMatch } = {}) {
      const headers = { 'x-amz-copy-source': `/${bucket}/${assertKey(fromKey)}` };
      if (ifMatch) headers['x-amz-copy-source-if-match'] = ifMatch;
      const res = await send('COPY', toKey, { method: 'PUT', headers });
      const text = await res.text();
      if (res.status === 412 || res.status === 404) throw new StoragePreconditionError();
      // A API S3 pode responder 200 com <Error> no corpo durante a cópia.
      if (!res.ok || !text.includes('CopyObjectResult')) throw unexpected('COPY', res);
    },

    /** Objeto inteiro (prévia de planilha), ou null se não existir. Recusa acima de maxBytes. */
    async readObject(key, { maxBytes }) {
      const res = await send('GET', key, { method: 'GET' });
      if (res.status === 404) {
        await res.body?.cancel();
        return null;
      }
      if (!res.ok) throw unexpected('GET', res);
      if (Number(res.headers.get('content-length') ?? 0) > maxBytes) {
        await res.body?.cancel();
        throw new StorageObjectTooLargeError();
      }
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length > maxBytes) throw new StorageObjectTooLargeError();
      return body;
    },

    async delete(key) {
      const res = await send('DELETE', key, { method: 'DELETE' });
      await res.body?.cancel();
      if (!res.ok && res.status !== 404) throw unexpected('DELETE', res);
    },
  };
}

// Base dos providers de desenvolvimento (local) e teste (memory): mesma interface do R2, com as
// "URLs assinadas" apontando para /dev-storage/* na própria API (ver dev-storage.routes.js).
// O "blob store" só sabe ler, gravar, copiar e apagar bytes; ETag, Range e condições ficam aqui.
import { createHash } from 'node:crypto';
import { StorageObjectTooLargeError, StoragePreconditionError } from '../storage.errors.js';
import { assertKey } from '../storage.keys.js';
import { signDevToken } from '../dev-token.js';

function etagOf(body) {
  return `"${createHash('md5').update(body).digest('hex')}"`;
}

function expiry(expiresIn) {
  return Math.floor(Date.now() / 1000) + expiresIn;
}

/**
 * @param name     'local' | 'memory'
 * @param baseUrl  origem da API (APP_URL)
 * @param blobs    { get(key) → Buffer | null, set(key, body), remove(key) }
 */
export function createDevProvider({ name, baseUrl, blobs }) {
  async function current(key, ifMatch) {
    const body = await blobs.get(assertKey(key));
    if (body && ifMatch && etagOf(body) !== ifMatch) throw new StoragePreconditionError();
    return body;
  }

  return {
    name,
    /** Origens extras para a CSP: as rotas de dev são da própria API ('self'). */
    origins: [],

    async createUploadUrl({ key, contentType, contentLength, expiresIn }) {
      const token = signDevToken({
        op: 'put',
        key: assertKey(key),
        ct: contentType,
        len: contentLength,
        exp: expiry(expiresIn),
      });
      return { url: `${baseUrl}/dev-storage/upload/${token}`, method: 'PUT', headers: { 'Content-Type': contentType } };
    },

    async createDownloadUrl({ key, filename, contentType, disposition, expiresIn }) {
      const token = signDevToken({
        op: 'get',
        key: assertKey(key),
        ct: contentType,
        disp: disposition === 'inline' ? 'inline' : 'attachment',
        name: filename,
        exp: expiry(expiresIn),
      });
      return `${baseUrl}/dev-storage/download/${token}`;
    },

    async head(key) {
      const body = await current(key);
      return body ? { size: body.length, etag: etagOf(body) } : null;
    },

    /** Bytes [start, end] (inclusivo), como o Range do S3. */
    async readRange(key, start, end, { ifMatch } = {}) {
      const body = await current(key, ifMatch);
      if (!body) throw new StoragePreconditionError('o objeto não existe');
      return body.subarray(start, end + 1);
    },

    async copy(fromKey, toKey, { ifMatch } = {}) {
      const body = await current(fromKey, ifMatch);
      if (!body) throw new StoragePreconditionError('o objeto de origem não existe');
      await blobs.set(assertKey(toKey), Buffer.from(body));
    },

    /** Objeto inteiro (prévia de planilha), ou null se não existir. Recusa acima de maxBytes. */
    async readObject(key, { maxBytes }) {
      const body = await blobs.get(assertKey(key));
      if (body && body.length > maxBytes) throw new StorageObjectTooLargeError();
      return body ?? null;
    },

    async delete(key) {
      await blobs.remove(assertKey(key));
    },

    // Só para as rotas /dev-storage/* e para os testes.
    async write(key, body) {
      await blobs.set(assertKey(key), body);
    },

    async read(key) {
      return blobs.get(assertKey(key));
    },
  };
}

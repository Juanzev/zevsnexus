// Envio de arquivos nos testes: intenção → PUT no /dev-storage (provider memory) → POST /documents.
// O PUT vai para a própria app, como o navegador faria com a URL pré-assinada do R2.
import { randomUUID } from 'node:crypto';
import { storage } from '../../src/modules/storage/storage.service.js';
import { api } from './http.js';

/** Conteúdos mínimos que passam na conferência de magic bytes. */
export const FIXTURES = Object.freeze({
  pdf: () => Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'),
  png: () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]),
  jpg: () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)]),
  xlsx: () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 3)]),
  csv: () => Buffer.from('﻿data;valor\n2026-10-01;10,50\n'),
  xml: () => Buffer.from('<?xml version="1.0" encoding="UTF-8"?><nfeProc></nfeProc>'),
  txt: () => Buffer.from('anotação simples\n'),
});

/** Caminho local de uma URL do /dev-storage (supertest fala com a app, não com a rede). */
export function devStoragePath(url) {
  const parsed = new URL(url);
  return parsed.pathname;
}

export function createIntent(app, headers, { filename = 'contrato.pdf', size, content, contentType } = {}) {
  const body = { filename, size_bytes: size ?? content?.length ?? 100 };
  if (contentType !== undefined) body.content_type = contentType;
  return api(app).post('/api/v1/files/upload-intents').set(headers).send(body);
}

export function putUpload(app, upload, content) {
  return api(app)
    .put(devStoragePath(upload.url))
    .set('Content-Type', upload.headers['Content-Type'])
    .send(content);
}

/** Intenção + PUT. Devolve o file_id pronto para POST /documents ou /versions. */
export async function uploadFile(app, headers, { filename = 'contrato.pdf', content = FIXTURES.pdf(), contentType } = {}) {
  const intent = await createIntent(app, headers, { filename, content, contentType });
  if (intent.status !== 201) throw new Error(`upload-intent ${intent.status}: ${JSON.stringify(intent.body)}`);
  const put = await putUpload(app, intent.body.data.upload, content);
  if (put.status !== 200) throw new Error(`PUT ${put.status}: ${JSON.stringify(put.body)}`);
  return intent.body.data.file.id;
}

export function postDocument(app, headers, body, key = randomUUID()) {
  return api(app).post('/api/v1/documents').set(headers).set('Idempotency-Key', key).send(body);
}

/** Envia um arquivo e cria o documento. Devolve o documento criado. */
export async function createDocument(app, headers, { filename, content, ...fields } = {}) {
  const fileId = await uploadFile(app, headers, { filename, content });
  const res = await postDocument(app, headers, { file_id: fileId, ...fields });
  if (res.status !== 201) throw new Error(`POST /documents ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data.document;
}

export function memoryStorage() {
  return storage();
}

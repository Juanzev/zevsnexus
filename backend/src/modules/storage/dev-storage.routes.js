// /dev-storage/* — só com STORAGE_PROVIDER=local|memory (desenvolvimento e testes); nunca em produção.
// Faz o papel do R2: a autorização é o token assinado (gerado pela API depois de checar tenant e
// permissão), com as mesmas condições da URL pré-assinada — tipo e tamanho exatos, validade curta.
// Fora do tenantRouter: o navegador chama esta URL sem Authorization, como faria com o R2.
import { Router } from 'express';
import { AppError, BadRequestError, NotFoundError } from '../../shared/errors.js';
import { contentDisposition } from '../../shared/files.js';
import { verifyDevToken } from './dev-token.js';
import { storage } from './storage.service.js';

function invalidLink() {
  return new AppError(403, 'SIGNATURE_INVALID', 'Link inválido ou expirado.');
}

/** Lê o corpo cru sem passar de `limit` bytes. */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new BadRequestError('BODY_SIZE_MISMATCH', 'O arquivo tem tamanho diferente do declarado.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function createDevStorageRouter() {
  const router = Router();

  router.put('/upload/:token', async (req, res) => {
    const grant = verifyDevToken(req.params.token, 'put');
    if (!grant) throw invalidLink();
    // Como nos SignedHeaders do R2: tipo e tamanho precisam ser exatamente os assinados.
    if (req.get('content-type') !== grant.ct || Number(req.get('content-length')) !== grant.len) {
      throw new AppError(403, 'SIGNATURE_MISMATCH', 'O envio não confere com o link assinado.');
    }
    const body = await readBody(req, grant.len);
    if (body.length !== grant.len) {
      throw new BadRequestError('BODY_SIZE_MISMATCH', 'O arquivo tem tamanho diferente do declarado.');
    }
    await storage().write(grant.key, body);
    res.status(200).end();
  });

  router.get('/download/:token', async (req, res) => {
    const grant = verifyDevToken(req.params.token, 'get');
    if (!grant) throw invalidLink();
    const body = await storage().read(grant.key);
    if (!body) throw new NotFoundError('OBJECT_NOT_FOUND', 'Arquivo não encontrado.');
    res.set({
      'Content-Type': grant.ct,
      'Content-Disposition': contentDisposition(grant.disp, grant.name),
      'Cache-Control': 'private, no-store',
      // Servido pela origem da API só em dev/teste (em produção vem do domínio do R2): conteúdo enviado
      // nunca roda script aqui. Inline (só PDF e imagem) fica sem sandbox/object-src, que bloqueariam o
      // visualizador de PDF do navegador.
      'Content-Security-Policy':
        grant.disp === 'inline'
          ? "script-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
          : "default-src 'none'; sandbox",
    });
    res.send(body);
  });

  return router;
}

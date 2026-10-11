// Serviço da SPA na mesma origem da API (pág. 01 e 09):
// - estáticos de frontend/public e módulos de frontend/src, com no-cache + ETag (304 barato);
// - qualquer GET sem extensão fora de /api devolve o index.html com a versão carimbada
//   (refresh em rota profunda funciona e o banner de nova versão consegue comparar — pág. 11).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';
import { backendDir, env } from './config/env.js';
import { NotFoundError } from './shared/errors.js';

export const frontendDir = path.resolve(backendDir, '../frontend');
const publicDir = path.join(frontendDir, 'public');
const srcDir = path.join(frontendDir, 'src');
const VERSION_PLACEHOLDER = /%%APP_VERSION%%/g;

const staticOptions = {
  index: false,
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    // Service worker nunca em cache (pág. 11); o resto revalida sempre.
    res.setHeader('Cache-Control', path.basename(filePath) === 'sw.js' ? 'no-store' : 'no-cache');
  },
};

/**
 * /sw.js: o service worker normal, ou o kill switch (SW_KILL_SWITCH=true) — limpa caches, se
 * desregistra e recarrega as abas. Sempre `no-store`: o navegador confere a cada navegação.
 */
function serviceWorker(killSwitch) {
  const file = path.join(publicDir, killSwitch ? 'sw-kill-switch.js' : 'sw.js');
  return (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.type('application/javascript');
    res.sendFile(file);
  };
}

function loadIndex() {
  return readFileSync(path.join(publicDir, 'index.html'), 'utf8').replace(VERSION_PLACEHOLDER, env.appVersion);
}

export function createSpaRouter({ swKillSwitch = env.SW_KILL_SWITCH } = {}) {
  const router = Router();
  // Em produção o index é lido uma vez; em desenvolvimento, a cada requisição.
  const cachedIndex = env.isProduction ? loadIndex() : null;

  router.get('/sw.js', serviceWorker(swKillSwitch));
  router.use(express.static(publicDir, staticOptions));
  router.use('/src', express.static(srcDir, staticOptions));

  router.get('/{*path}', (req, res, next) => {
    // Arquivo inexistente (ex.: /src/x.js) é 404, nunca o index.html com MIME errado.
    if (req.path.startsWith('/api/') || path.extname(req.path) !== '') {
      next(new NotFoundError());
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(cachedIndex ?? loadIndex());
  });

  return router;
}

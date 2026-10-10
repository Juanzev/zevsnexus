// IP real do cliente (pág. 06 §6).
// CF-Connecting-IP só é aceito quando a requisição traz o segredo de origem injetado pelo
// Cloudflare (X-Origin-Auth == CF_ORIGIN_SECRET, comparação em tempo constante).
// Sem ele, vale req.ip com `trust proxy` — impede falsificar IP batendo direto no *.onrender.com.
import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

function digest(value) {
  return createHash('sha256').update(String(value), 'utf8').digest();
}

export function createClientIpResolver(originSecret) {
  const expected = originSecret ? digest(originSecret) : null;

  return function clientIp(req, _res, next) {
    let ip = req.ip;
    if (expected) {
      const provided = req.get('x-origin-auth');
      const forwarded = req.get('cf-connecting-ip');
      // Comparar digests de tamanho fixo evita vazar o tamanho do segredo.
      if (provided && forwarded && timingSafeEqual(digest(provided), expected) && isIP(forwarded)) {
        ip = forwarded;
      }
    }
    req.clientIp = ip || req.socket?.remoteAddress || 'unknown';
    next();
  };
}

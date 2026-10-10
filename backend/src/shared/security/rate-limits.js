// Rate limits (pág. 06 §1–§2), sempre pelo IP real (req.clientIp), com IPv6 agrupado por /56.
// O global vale só em /api: a SPA carrega dezenas de módulos e não pode esgotar a cota.
// Em teste ficam desligados, salvo nos testes do próprio limite (createApp({ rateLimits: true })).
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { RateLimitError } from '../errors.js';

const MINUTE = 60_000;

function ipKey(req) {
  return ipKeyGenerator(req.clientIp, 56);
}

function passthrough(_req, _res, next) {
  next();
}

function normalizedEmail(req) {
  const email = req.body?.email;
  return typeof email === 'string' ? email.trim().toLowerCase().slice(0, 254) : '';
}

export function createRateLimiters({ enabled }) {
  const make = (options) =>
    enabled
      ? rateLimit({
          standardHeaders: 'draft-8',
          legacyHeaders: false,
          keyGenerator: ipKey,
          handler: (_req, _res, next) => next(new RateLimitError()),
          ...options,
        })
      : passthrough;

  return {
    // Equipe que sai pelo mesmo Wi-Fi compartilha o IP (lição do Wash): limite alto.
    global: make({ windowMs: 15 * MINUTE, limit: 2000 }),
    // Teto por IP antes do bcrypt, para o login não virar DoS de CPU (Vale).
    loginIp: make({ windowMs: MINUTE, limit: 30 }),
    // 5 falhas por IP + e-mail em 15 min; sucesso não conta.
    login: make({
      windowMs: 15 * MINUTE,
      limit: 5,
      skipSuccessfulRequests: true,
      keyGenerator: (req) => `${ipKey(req)}|${normalizedEmail(req)}`,
    }),
    // Cadastro, recuperação/redefinição de senha e verificação de e-mail.
    auth: make({ windowMs: 15 * MINUTE, limit: 10 }),
    refresh: make({ windowMs: 15 * MINUTE, limit: 60 }),
  };
}

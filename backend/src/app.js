// createApp() separado do server.js: a app é testável com Supertest sem `listen` (pág. 01).
// Cadeia global (pág. 08): requestId → helmet → cors → pino-http → json → cookies → limiter → rotas.
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { health, ready, version } from './infra.routes.js';
import { apiHeaders } from './middlewares/api-headers.js';
import { apiNotFound, errorHandler } from './middlewares/error-handler.js';
import { httpLogger } from './middlewares/http-logger.js';
import { requestId } from './middlewares/request-id.js';
import { createAuthRouter, createMeRouter } from './modules/auth/auth.routes.js';
import { createClientIpResolver } from './shared/security/client-ip.js';
import { createCsrfGuard } from './shared/security/csrf.js';
import { createRateLimiters } from './shared/security/rate-limits.js';
import { createSpaRouter } from './spa.js';

// CSP de referência da STRUCTURE (pág. 06 §7): nenhum script inline nem de terceiros.
const contentSecurityPolicy = {
  useDefaults: false,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:'],
    fontSrc: ["'self'"],
    connectSrc: ["'self'"],
    manifestSrc: ["'self'"],
    workerSrc: ["'self'"],
    frameAncestors: ["'none'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
  },
};

export function createApp({ rateLimits = !env.isTest, serveFrontend = env.SERVE_FRONTEND } = {}) {
  const app = express();
  const limiters = createRateLimiters({ enabled: rateLimits });
  const csrfGuard = createCsrfGuard(env.allowedOrigins);

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestId);
  app.use(createClientIpResolver(env.CF_ORIGIN_SECRET));
  app.use(
    helmet({
      contentSecurityPolicy,
      strictTransportSecurity: env.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(
    '/api',
    cors({
      origin: (origin, done) => done(null, !origin || env.allowedOrigins.includes(origin)),
      credentials: true,
    }),
  );
  app.use(httpLogger);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Infraestrutura: /health e /ready fora do rate limit.
  app.get('/health', health);
  app.get('/ready', ready);

  app.use('/api', apiHeaders, limiters.global);
  app.get('/api/version', version);
  app.use('/api/v1/auth', createAuthRouter({ limiters, csrfGuard }));
  app.use('/api/v1/me', createMeRouter());
  app.use('/api', apiNotFound);

  if (serveFrontend) app.use(createSpaRouter());

  app.use(errorHandler);
  return app;
}

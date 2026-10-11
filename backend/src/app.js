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
import { createCompanyRouter } from './modules/companies/companies.routes.js';
import { createOnboardingRouter } from './modules/companies/onboarding.routes.js';
import { createDashboardRouter } from './modules/dashboard/dashboard.routes.js';
import {
  createDocumentsRouter,
  createDocumentTypesRouter,
  createFoldersRouter,
  createTagsRouter,
  createTrashRouter,
} from './modules/documents/documents.routes.js';
import { createFilesRouter } from './modules/files/files.routes.js';
import {
  createExpensePaymentsRouter,
  createExpensesRouter,
  createFinanceCategoriesRouter,
} from './modules/finance/finance.routes.js';
import { createPartiesRouter } from './modules/parties/parties.routes.js';
import { createSpreadsheetsRouter } from './modules/spreadsheets/spreadsheets.routes.js';
import { createPlatformRouter } from './modules/platform/platform.routes.js';
import { createDevStorageRouter } from './modules/storage/dev-storage.routes.js';
import { storage, usesDevStorage } from './modules/storage/storage.service.js';
import { createClientIpResolver } from './shared/security/client-ip.js';
import { createCsrfGuard } from './shared/security/csrf.js';
import { createRateLimiters } from './shared/security/rate-limits.js';
import { createSpaRouter } from './spa.js';

// CSP de referência da STRUCTURE (pág. 06 §7): nenhum script inline nem de terceiros.
// O storage entra em connect-src (PUT direto do navegador) e img-src (prévia) — ARCHITECTURE §10.2.
const storageOrigins = storage().origins;
const contentSecurityPolicy = {
  useDefaults: false,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', ...storageOrigins],
    fontSrc: ["'self'"],
    connectSrc: ["'self'", ...storageOrigins],
    manifestSrc: ["'self'"],
    workerSrc: ["'self'"],
    frameAncestors: ["'none'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
  },
};

export function createApp({
  rateLimits = !env.isTest,
  serveFrontend = env.SERVE_FRONTEND,
  swKillSwitch = env.SW_KILL_SWITCH,
} = {}) {
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
  app.use('/api/v1/companies', createOnboardingRouter());
  app.use('/api/v1/company', createCompanyRouter());
  app.use('/api/v1/files', createFilesRouter({ limiters }));
  app.use('/api/v1/documents', createDocumentsRouter({ limiters }));
  app.use('/api/v1/trash', createTrashRouter());
  app.use('/api/v1/folders', createFoldersRouter());
  app.use('/api/v1/document-types', createDocumentTypesRouter());
  app.use('/api/v1/tags', createTagsRouter());
  app.use('/api/v1/parties', createPartiesRouter());
  app.use('/api/v1/expenses', createExpensesRouter());
  app.use('/api/v1/expense-payments', createExpensePaymentsRouter());
  app.use('/api/v1/finance-categories', createFinanceCategoriesRouter());
  app.use('/api/v1/spreadsheets', createSpreadsheetsRouter({ limiters }));
  app.use('/api/v1/dashboard', createDashboardRouter());
  app.use('/api/v1/admin', createPlatformRouter());
  app.use('/api', apiNotFound);

  // "R2 de mentira" de desenvolvimento e testes; não existe com STORAGE_PROVIDER=r2.
  if (usesDevStorage()) app.use('/dev-storage', createDevStorageRouter());

  if (serveFrontend) app.use(createSpaRouter({ swKillSwitch }));

  app.use(errorHandler);
  return app;
}

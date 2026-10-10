// Configuração validada com Zod no boot (ZEVS STRUCTURE pág. 08).
// Em produção, qualquer variável obrigatória ausente ou insegura derruba o processo na partida.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod';

export const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const DURATION_UNITS = { s: 1, m: 60, h: 3600, d: 86400 };

/** Converte "15m", "7d", "30s" em segundos. */
export function parseDuration(value) {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) throw new Error(`duração inválida: ${value}`);
  return Number(match[1]) * DURATION_UNITS[match[2]];
}

const boolean = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const duration = z
  .string()
  .regex(/^\d+[smhd]$/, 'use o formato 30s, 15m, 12h ou 7d')
  .transform(parseDuration);

const origins = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    APP_URL: z.url().default('http://localhost:3000'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
    DATABASE_SSL: boolean.default(false),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de pelo menos 32 caracteres'),
    JWT_EXPIRES_IN: duration.prefault('15m'),
    REFRESH_TOKEN_EXPIRES_IN: duration.prefault('7d'),
    REFRESH_FAMILY_MAX_AGE: duration.prefault('30d'),
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
    CORS_ORIGIN: origins.prefault(''),
    SERVE_FRONTEND: boolean.default(true),
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),
    CF_ORIGIN_SECRET: z.string().min(16).optional(),
    EMAIL_PROVIDER: z.enum(['log', 'resend']).default('log'),
    RESEND_API_KEY: z.string().min(1).optional(),
    EMAIL_FROM: z.string().min(3).default('ZEVS Nexus <no-reply@localhost>'),
    EMAIL_OUTBOX_DIR: z.string().min(1).optional(),
    JOBS_ENABLED: boolean.default(false),
    RENDER_GIT_COMMIT: z.string().min(1).optional(),
    // Bootstrap do Painel ZEVS: só vale com o e-mail verificado (pág. 05).
    PLATFORM_ADMIN_EMAILS: z
      .string()
      .transform((value) =>
        value
          .split(',')
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean),
      )
      .prefault(''),
    // Plano e período de teste de empresa nova (pág. 13). Sem DEFAULT_PLAN, vale o plano padrão do catálogo.
    DEFAULT_PLAN: z.string().regex(/^[a-z_]+$/).optional(),
    TRIAL_DAYS: z.coerce.number().int().min(0).max(365).default(30),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.CORS_ORIGIN.includes('*')) {
      ctx.addIssue({ code: 'custom', path: ['CORS_ORIGIN'], message: 'CORS_ORIGIN não pode ser *' });
    }
    if (cfg.EMAIL_PROVIDER === 'resend' && !cfg.RESEND_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'obrigatória com EMAIL_PROVIDER=resend' });
    }
    if (cfg.NODE_ENV === 'production') {
      if (!cfg.APP_URL.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'precisa ser https em produção' });
      }
      if (cfg.BCRYPT_ROUNDS < 12) {
        ctx.addIssue({ code: 'custom', path: ['BCRYPT_ROUNDS'], message: 'mínimo 12 em produção' });
      }
    }
  });

/** Valida um objeto de ambiente e devolve a configuração imutável (lança em caso de erro). */
export function loadEnv(source) {
  // Variável vazia (ex.: "CF_ORIGIN_SECRET=" no .env) vale como não definida.
  const defined = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const result = schema.safeParse(defined);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`);
    throw new Error(`Configuração inválida:\n${lines.join('\n')}`);
  }
  const cfg = result.data;
  const appUrl = new URL(cfg.APP_URL);
  return Object.freeze({
    ...cfg,
    isProduction: cfg.NODE_ENV === 'production',
    isTest: cfg.NODE_ENV === 'test',
    appOrigin: appUrl.origin,
    secureCookies: appUrl.protocol === 'https:',
    allowedOrigins: Object.freeze([...new Set([appUrl.origin, ...cfg.CORS_ORIGIN])]),
    appVersion: cfg.RENDER_GIT_COMMIT ?? 'dev',
  });
}

// .env só fora de produção e de teste (em produção as variáveis vêm do Render;
// nos testes, de tests/setup/env.js). Variáveis já definidas no processo prevalecem.
if (!['production', 'test'].includes(process.env.NODE_ENV)) {
  const envFile = path.join(backendDir, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

export const env = loadEnv(process.env);

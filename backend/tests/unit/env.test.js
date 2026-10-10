import { loadEnv, parseDuration } from '../../src/config/env.js';

const base = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://localhost/x',
  JWT_SECRET: 'x'.repeat(32),
};

describe('parseDuration', () => {
  test('converte unidades em segundos', () => {
    expect(parseDuration('30s')).toBe(30);
    expect(parseDuration('15m')).toBe(900);
    expect(parseDuration('12h')).toBe(43_200);
    expect(parseDuration('7d')).toBe(604_800);
  });

  test('recusa formato inválido', () => {
    expect(() => parseDuration('15 minutos')).toThrow();
  });
});

describe('loadEnv', () => {
  test('aplica padrões seguros', () => {
    const cfg = loadEnv(base);
    expect(cfg.JWT_EXPIRES_IN).toBe(900);
    expect(cfg.REFRESH_TOKEN_EXPIRES_IN).toBe(604_800);
    expect(cfg.BCRYPT_ROUNDS).toBe(12);
    expect(cfg.allowedOrigins).toEqual(['http://localhost:3000']);
    expect(cfg.secureCookies).toBe(false);
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  test('variável vazia vale como não definida', () => {
    const cfg = loadEnv({ ...base, CF_ORIGIN_SECRET: '', RESEND_API_KEY: '' });
    expect(cfg.CF_ORIGIN_SECRET).toBeUndefined();
  });

  test('exige JWT_SECRET com pelo menos 32 caracteres', () => {
    expect(() => loadEnv({ ...base, JWT_SECRET: 'curto' })).toThrow(/JWT_SECRET/);
    expect(() => loadEnv({ ...base, JWT_SECRET: undefined })).toThrow(/JWT_SECRET/);
  });

  test('recusa CORS_ORIGIN=*', () => {
    expect(() => loadEnv({ ...base, CORS_ORIGIN: '*' })).toThrow(/CORS_ORIGIN/);
  });

  test('resend exige chave', () => {
    expect(() => loadEnv({ ...base, EMAIL_PROVIDER: 'resend' })).toThrow(/RESEND_API_KEY/);
  });

  test('produção exige https e bcrypt >= 12', () => {
    const prod = { ...base, NODE_ENV: 'production', APP_URL: 'https://nexus.exemplo.com.br' };
    expect(() => loadEnv(prod)).not.toThrow();
    expect(() => loadEnv({ ...prod, APP_URL: 'http://nexus.exemplo.com.br' })).toThrow(/APP_URL/);
    expect(() => loadEnv({ ...prod, BCRYPT_ROUNDS: '10' })).toThrow(/BCRYPT_ROUNDS/);
  });

  test('cookies seguros quando APP_URL é https', () => {
    expect(loadEnv({ ...base, APP_URL: 'https://app.exemplo.com' }).secureCookies).toBe(true);
  });

  test('origens permitidas incluem APP_URL e CORS_ORIGIN, sem repetição', () => {
    const cfg = loadEnv({ ...base, CORS_ORIGIN: 'http://localhost:3000, https://outro.exemplo.com' });
    expect(cfg.allowedOrigins).toEqual(['http://localhost:3000', 'https://outro.exemplo.com']);
  });
});

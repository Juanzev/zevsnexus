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

  // Credenciais fictícias, só no formato.
  const r2 = {
    STORAGE_PROVIDER: 'r2',
    R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    R2_ACCESS_KEY_ID: 'chave-de-acesso-ficticia',
    R2_SECRET_ACCESS_KEY: 'segredo-ficticio-com-mais-de-32-caracteres',
    R2_BUCKET: 'nexus-staging',
  };

  test('produção exige https e bcrypt >= 12', () => {
    const prod = { ...base, ...r2, NODE_ENV: 'production', APP_URL: 'https://nexus.exemplo.com.br' };
    expect(() => loadEnv(prod)).not.toThrow();
    expect(() => loadEnv({ ...prod, APP_URL: 'http://nexus.exemplo.com.br' })).toThrow(/APP_URL/);
    expect(() => loadEnv({ ...prod, BCRYPT_ROUNDS: '10' })).toThrow(/BCRYPT_ROUNDS/);
  });

  test('storage: local em dev, memory em teste, r2 obrigatório em produção', () => {
    expect(loadEnv(base).storageProvider).toBe('local');
    expect(loadEnv({ ...base, NODE_ENV: 'test' }).storageProvider).toBe('memory');
    const prod = { ...base, NODE_ENV: 'production', APP_URL: 'https://nexus.exemplo.com.br' };
    expect(() => loadEnv(prod)).toThrow(/STORAGE_PROVIDER/);
    expect(() => loadEnv({ ...prod, STORAGE_PROVIDER: 'local' })).toThrow(/STORAGE_PROVIDER/);
    expect(loadEnv({ ...prod, ...r2 }).storageProvider).toBe('r2');
  });

  test('r2 exige as quatro variáveis da conta', () => {
    for (const key of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
      expect(() => loadEnv({ ...base, ...r2, [key]: undefined })).toThrow(new RegExp(key));
    }
    expect(() => loadEnv({ ...base, ...r2, R2_BUCKET: 'Bucket_Invalido' })).toThrow(/R2_BUCKET/);
  });

  test('cookies seguros quando APP_URL é https', () => {
    expect(loadEnv({ ...base, APP_URL: 'https://app.exemplo.com' }).secureCookies).toBe(true);
  });

  test('origens permitidas incluem APP_URL e CORS_ORIGIN, sem repetição', () => {
    const cfg = loadEnv({ ...base, CORS_ORIGIN: 'http://localhost:3000, https://outro.exemplo.com' });
    expect(cfg.allowedOrigins).toEqual(['http://localhost:3000', 'https://outro.exemplo.com']);
  });
});

// Ambiente dos testes, definido antes de qualquer import da aplicação.
import { TEST_DATABASE_URL } from './test-database.js';

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  APP_URL: 'http://localhost:3000',
  CORS_ORIGIN: '',
  DATABASE_URL: TEST_DATABASE_URL,
  DATABASE_POOL_MAX: '5',
  JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres-0123456789',
  BCRYPT_ROUNDS: '4',
  SERVE_FRONTEND: 'false',
  EMAIL_PROVIDER: 'log',
  JOBS_ENABLED: 'false',
});
delete process.env.EMAIL_OUTBOX_DIR;
delete process.env.CF_ORIGIN_SECRET;
delete process.env.RENDER_GIT_COMMIT;

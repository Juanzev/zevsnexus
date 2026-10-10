// E2E dos fluxos críticos (D12a). O servidor sobe com banco *_e2e_test zerado a cada execução.
// Pré-requisito: frontend construído (npm run build em frontend/) e PostgreSQL local (npm run db:local -- start).
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.E2E_PORT ?? '3100';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'pt-BR',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node ../backend/scripts/e2e-server.js',
    url: `http://localhost:${PORT}/ready`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    env: { E2E_PORT: PORT, ...(process.env.E2E_DATABASE_URL ? { E2E_DATABASE_URL: process.env.E2E_DATABASE_URL } : {}) },
  },
});

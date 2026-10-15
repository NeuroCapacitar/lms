import { defineConfig, devices } from '@playwright/test';
import { loadEnv } from 'vite';

const fileEnv = loadEnv('test', process.cwd(), '');
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? fileEnv.TEST_DATABASE_URL ?? '';
const port = Number(process.env.JOURNEY_PORT ?? 4174);

// Jornada E2E gratuita (M3-05): navegador real contra a API REAL (`createApp`) e o Postgres de TESTE.
// Um servidor só, uma sequência só (os passos dependem uns dos outros): sem paralelismo nem retentativa,
// porque o limite de pedidos de link por e-mail é parte do que se está provando.
export default defineConfig({
  testDir: './e2e-journey',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-journey' }]]
    : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bun run build && bun e2e-journey/server.ts',
    url: `http://localhost:${port}/__test/ids`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    env: {
      TEST_DATABASE_URL: testDatabaseUrl,
      JOURNEY_PORT: String(port),
      // Chave de TESTE da Cloudflare (o widget é simulado no teste).
      VITE_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    },
  },
});

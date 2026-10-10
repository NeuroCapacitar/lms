import { defineConfig, devices } from '@playwright/test';
import { loadEnv } from 'vite';

const fileEnv = loadEnv('test', process.cwd(), '');
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? fileEnv.TEST_DATABASE_URL ?? '';
const port = 4173;

// Smoke em Chromium contra o build servido pelo `vite preview` (workerd local) com o banco de TESTE.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `bun run build && bun x vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/api/health/live`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: testDatabaseUrl },
  },
});

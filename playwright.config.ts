import { defineConfig, devices } from '@playwright/test';
import { loadEnv } from 'vite';

const fileEnv = loadEnv('test', process.cwd(), '');
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? fileEnv.TEST_DATABASE_URL ?? '';
const port = Number(process.env.E2E_PORT ?? 4173);

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
    command: `bun run build && node scripts/e2e-prepare-fake-video.mjs && bun x vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/api/health/live`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // O preview não pode morrer por um ECONNRESET do navegador de teste (ver o arquivo).
      NODE_OPTIONS: '--require=./scripts/e2e-survive-reset.cjs',
      CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: testDatabaseUrl,
      // Chave de TESTE da Cloudflare (sempre aprova) só para o build dos testes; o widget é simulado.
      VITE_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
      // Adapter de vídeo FALSO (M5-02): só nos testes; nunca em Staging nem Production.
      VITE_FAKE_VIDEO: '1',
    },
  },
});

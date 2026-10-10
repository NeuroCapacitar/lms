import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// `.env.test` (ignorado pelo Git) traz TEST_DATABASE_URL no desenvolvimento local; o CI define a variável.
const fileEnv = loadEnv('test', process.cwd(), '');
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? fileEnv.TEST_DATABASE_URL ?? '';
process.env.TEST_DATABASE_URL = testDatabaseUrl;
// O binding Hyperdrive do Worker, nos testes, aponta para o Postgres de TESTE.
process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE = testDatabaseUrl;

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['scripts/**/*.test.ts', 'src/**/*.test.ts', 'test/unit/**/*.test.ts'],
        },
      },
      {
        // Testa o Worker CONSTRUÍDO (`bun run build` gera dist/hub): o que vai para produção, com `pg` já
        // empacotado (no workerd, `pg-protocol` resolve para um arquivo ESM dentro de pacote CommonJS).
        plugins: [cloudflareTest({ wrangler: { configPath: './dist/hub/wrangler.json' } })],
        test: {
          name: 'workers',
          include: ['test/workers/**/*.test.ts'],
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'pg',
          environment: 'node',
          include: ['test/pg/**/*.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});

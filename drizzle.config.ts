import { defineConfig } from 'drizzle-kit';

// Só gera SQL (`bun run db:generate`). O SQL gerado é REVISADO À MÃO antes do commit.
// Proibido `drizzle-kit push` e `drizzle-kit migrate`: migrações rodam por scripts/db/migrate.ts.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
  strict: true,
  verbose: true,
});

/**
 * Aplica as migrações SQL versionadas (pasta drizzle/) no banco do ambiente, pela conexão DIRETA
 * e com a role de migração. Forward-only: sem rollback automático, sem `drizzle-kit push`.
 *
 *   DATABASE_URL_MIGRATION=... bun scripts/db/migrate.ts <dev|staging|production>
 *
 * Production exige CONFIRM_MIGRATE_PRODUCTION=<host do banco> e execução manual do responsável.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { parseTarget } from './guards.ts';

async function main() {
  const target = parseTarget(process.argv[2] ?? '', process.env.DATABASE_URL_MIGRATION);
  if (
    target.environment === 'production' &&
    process.env.CONFIRM_MIGRATE_PRODUCTION !== target.url.hostname
  ) {
    throw new Error(
      'Production: defina CONFIRM_MIGRATE_PRODUCTION com o host do banco (execução manual do responsável).',
    );
  }

  const client = new pg.Client({ connectionString: target.url.toString() });
  await client.connect();
  try {
    // Timeouts de DDL: uma migração que espera lock ou demora demais falha em vez de travar o banco.
    await client.query("set lock_timeout = '5s'");
    await client.query("set statement_timeout = '120s'");
    await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
    const applied = await client.query<{ count: string }>(
      'select count(*) as count from drizzle.__drizzle_migrations',
    );
    console.log(
      `migrações aplicadas em "${target.environment}": ${applied.rows[0]?.count ?? '?'} no journal`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(`ERRO: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

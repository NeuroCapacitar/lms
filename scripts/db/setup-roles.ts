/**
 * Cria (ou atualiza a senha de) a role de RUNTIME do ambiente: só DML, sem DDL.
 * A role de MIGRAÇÃO é a dona do banco (`neondb_owner`) e roda DDL pela conexão direta.
 *
 * Uso (a senha vem do ambiente; nunca é impressa nem gravada):
 *   DATABASE_URL_MIGRATION=... HUB_RUNTIME_PASSWORD=... bun scripts/db/setup-roles.ts <dev|staging|production>
 * Idempotente. Nunca roda em Worker, HTTP ou Cron.
 */
import pg from 'pg';

import { parseTarget } from './guards.ts';

const RUNTIME_ROLE = 'hub_runtime';

async function main() {
  const target = parseTarget(process.argv[2] ?? '', process.env.DATABASE_URL_MIGRATION);
  const password = process.env.HUB_RUNTIME_PASSWORD;
  if (!password || password.length < 32) {
    throw new Error('HUB_RUNTIME_PASSWORD ausente ou curta (mínimo 32 caracteres)');
  }

  const client = new pg.Client({ connectionString: target.url.toString() });
  await client.connect();
  try {
    const owner = (await client.query<{ current_user: string }>('select current_user')).rows[0]
      ?.current_user;
    const database = (await client.query<{ current_database: string }>('select current_database()'))
      .rows[0]?.current_database;
    if (!owner || !database) throw new Error('não foi possível identificar a role e o banco');

    const exists = await client.query('select 1 from pg_roles where rolname = $1', [RUNTIME_ROLE]);
    const verb = exists.rowCount ? 'alter' : 'create';
    // CREATE/ALTER ROLE não aceitam parâmetros: o SQL é montado com format(%I, %L) no servidor.
    const ddl = await client.query<{ sql: string }>(
      `select format('${verb} role %I with login nosuperuser nocreatedb nocreaterole noinherit password %L', $1::text, $2::text) as sql`,
      [RUNTIME_ROLE, password],
    );
    await client.query(ddl.rows[0]?.sql ?? '');

    const q = (identifier: string) => client.escapeIdentifier(identifier);
    await client.query(`grant connect on database ${q(database)} to ${q(RUNTIME_ROLE)}`);
    await client.query(`grant usage on schema public to ${q(RUNTIME_ROLE)}`);
    await client.query(`revoke create on schema public from ${q(RUNTIME_ROLE)}`);
    // Objetos criados pela role de migração ficam acessíveis (DML) ao runtime.
    await client.query(
      `alter default privileges for role ${q(owner)} in schema public grant select, insert, update, delete on tables to ${q(RUNTIME_ROLE)}`,
    );
    await client.query(
      `alter default privileges for role ${q(owner)} in schema public grant usage, select on sequences to ${q(RUNTIME_ROLE)}`,
    );
    console.log(
      `role de runtime "${RUNTIME_ROLE}" configurada em "${target.environment}" (dono: ${owner})`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(`ERRO: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

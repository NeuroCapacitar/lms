/**
 * Cria (ou atualiza a senha de) a role de BACKUP do ambiente (M9-05): `hub_backup`, SOMENTE LEITURA
 * (`pg_read_all_data`), sem DDL, sem DML, sem `neon_superuser`, sem `BYPASSRLS`. É a role do `pg_dump`.
 *
 * Uso (a senha vem do ambiente; nunca é impressa nem gravada):
 *   DATABASE_URL_MIGRATION=... HUB_BACKUP_PASSWORD=... bun scripts/db/setup-backup-role.ts <dev|staging|production>
 *
 * Idempotente. NÃO use `neon roles create`: o Neon dá a uma role criada por ele a participação em
 * `neon_superuser` (CREATEDB, CREATEROLE, BYPASSRLS). Este script cria a role por SQL e, no fim, confere os
 * privilégios e FALHA se algum sobrou. Nunca roda em Worker, HTTP ou Cron.
 */
import pg from 'pg';

import { parseTarget } from './guards.ts';

const BACKUP_ROLE = 'hub_backup';

async function main() {
  const target = parseTarget(process.argv[2] ?? '', process.env.DATABASE_URL_MIGRATION);
  const password = process.env.HUB_BACKUP_PASSWORD;
  if (!password || password.length < 32) {
    throw new Error('HUB_BACKUP_PASSWORD ausente ou curta (mínimo 32 caracteres)');
  }

  const client = new pg.Client({ connectionString: target.url.toString() });
  await client.connect();
  try {
    const database = (await client.query<{ current_database: string }>('select current_database()'))
      .rows[0]?.current_database;
    if (!database) throw new Error('não foi possível identificar o banco');

    const exists = await client.query('select 1 from pg_roles where rolname = $1', [BACKUP_ROLE]);
    const verb = exists.rowCount ? 'alter' : 'create';
    const ddl = await client.query<{ sql: string }>(
      `select format('${verb} role %I with login nosuperuser nocreatedb nocreaterole inherit nobypassrls password %L', $1::text, $2::text) as sql`,
      [BACKUP_ROLE, password],
    );
    await client.query(ddl.rows[0]?.sql ?? '');

    const q = (identifier: string) => client.escapeIdentifier(identifier);
    await client.query(`grant connect on database ${q(database)} to ${q(BACKUP_ROLE)}`);
    await client.query(`grant pg_read_all_data to ${q(BACKUP_ROLE)} with inherit true`);

    // Conferência: a role NÃO pode ter nada além de ler.
    const attrs = (
      await client.query<{
        rolsuper: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolbypassrls: boolean;
      }>(
        'select rolsuper, rolcreatedb, rolcreaterole, rolbypassrls from pg_roles where rolname = $1',
        [BACKUP_ROLE],
      )
    ).rows[0];
    const memberships = (
      await client.query<{ rolname: string }>(
        `select m.rolname from pg_auth_members am
           join pg_roles r on r.oid = am.member join pg_roles m on m.oid = am.roleid
          where r.rolname = $1`,
        [BACKUP_ROLE],
      )
    ).rows.map((row) => row.rolname);
    if (!attrs || attrs.rolsuper || attrs.rolcreatedb || attrs.rolcreaterole || attrs.rolbypassrls)
      throw new Error(
        `a role "${BACKUP_ROLE}" tem atributos além de ler: ${JSON.stringify(attrs)}`,
      );
    if (memberships.length !== 1 || memberships[0] !== 'pg_read_all_data')
      throw new Error(
        `a role "${BACKUP_ROLE}" deve ser membro só de pg_read_all_data (é: ${memberships.join(', ')})`,
      );
    console.log(
      `role de backup "${BACKUP_ROLE}" (somente leitura) configurada em "${target.environment}"`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(`ERRO: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

/**
 * Testes de integração do banco de DESENVOLVIMENTO (Neon). Precisam de credenciais no ambiente:
 *   DATABASE_URL_MIGRATION (role de migração, conexão direta) e DATABASE_URL_RUNTIME (role hub_runtime).
 * Sem elas, os testes são pulados. Nunca apontar para Staging ou Production.
 *   bun run test:db
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import pg from 'pg';

const migrationUrl = process.env.DATABASE_URL_MIGRATION;
const runtimeUrl = process.env.DATABASE_URL_RUNTIME;
const skip =
  !migrationUrl || !runtimeUrl ? 'defina DATABASE_URL_MIGRATION e DATABASE_URL_RUNTIME' : false;

async function withClient<T>(url: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function journalCount(): Promise<number> {
  return withClient(migrationUrl as string, async (client) => {
    const result = await client.query<{ count: string }>(
      'select count(*) as count from drizzle.__drizzle_migrations',
    );
    return Number(result.rows[0]?.count);
  });
}

describe('banco de desenvolvimento', { skip }, () => {
  it('migrações aplicadas duas vezes: a segunda é no-op', async () => {
    const run = () =>
      spawnSync('bun', [fileURLToPath(new URL('./migrate.ts', import.meta.url)), 'dev'], {
        encoding: 'utf8',
        shell: process.platform === 'win32',
        env: process.env,
      });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    const afterFirst = await journalCount();
    const second = run();
    assert.equal(second.status, 0, second.stderr);
    assert.equal(await journalCount(), afterFirst);
  });

  it('role de runtime não executa DDL (CREATE, ALTER, DROP)', async () => {
    await withClient(runtimeUrl as string, async (client) => {
      for (const ddl of [
        'create table runtime_nao_pode (id int)',
        'alter table health_probe add column x int',
        'drop table health_probe',
      ]) {
        await assert.rejects(client.query(ddl), (error: { code?: string }) => {
          assert.equal(error.code, '42501', `esperado "permission denied" para: ${ddl}`);
          return true;
        });
      }
    });
  });

  it('role de runtime não lê o journal de migrações', async () => {
    await withClient(runtimeUrl as string, async (client) => {
      await assert.rejects(
        client.query('select 1 from drizzle.__drizzle_migrations'),
        (error: { code?: string }) => error.code === '42501',
      );
    });
  });

  it('role de runtime faz DML na tabela de verificação', async () => {
    await withClient(runtimeUrl as string, async (client) => {
      const note = `teste-${Date.now()}`;
      await client.query('insert into health_probe (note) values ($1)', [note]);
      const read = await client.query('select note from health_probe where note = $1', [note]);
      assert.equal(read.rowCount, 1);
      await client.query('delete from health_probe where note = $1', [note]);
    });
  });
});

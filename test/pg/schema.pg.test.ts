import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

let schema: TestSchema;
beforeAll(async () => {
  schema = await createTestSchema();
});
afterAll(async () => {
  await schema.drop();
});

describe('migrations em Postgres 18 real', () => {
  it('rodam num schema isolado e criam a tabela de verificação', async () => {
    const client = await schema.client();
    const version = await client.query<{ server_version_num: string }>('show server_version_num');
    expect(Number(version.rows[0]?.server_version_num)).toBeGreaterThanOrEqual(180000);
    const table = await client.query(
      'select 1 from information_schema.tables where table_schema = $1 and table_name = $2',
      [schema.name, 'health_probe'],
    );
    expect(table.rowCount).toBe(1);
  });

  it('o schema de cada arquivo é isolado dos demais', async () => {
    const other = await createTestSchema();
    try {
      const mine = await schema.client();
      const theirs = await other.client();
      await mine.query("insert into health_probe (note) values ('so-meu')");
      const visible = await theirs.query("select 1 from health_probe where note = 'so-meu'");
      expect(visible.rowCount).toBe(0);
    } finally {
      await other.drop();
    }
  });
});

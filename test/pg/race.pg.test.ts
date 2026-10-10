import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * Testes de corrida de REFERÊNCIA: modelo para os marcos seguintes (matrícula gratuita, pagamento,
 * emissão de certificado). Rodam sempre em Postgres real: mock não prova concorrência.
 */
let schema: TestSchema;
beforeAll(async () => {
  schema = await createTestSchema();
  const client = await schema.client();
  await client.query('create table race_unique (key text primary key, winner int not null)');
  await client.query('create table race_counter (id int primary key, value int not null)');
  await client.query('insert into race_counter (id, value) values (1, 0)');
});
afterAll(async () => {
  await schema.drop();
});

describe('concorrência', () => {
  it('N inserções paralelas na mesma chave única: exatamente uma vence', async () => {
    const pool = schema.pool(20);
    const attempts = 20;
    const results = await Promise.all(
      Array.from({ length: attempts }, (_, winner) =>
        pool.query(
          'insert into race_unique (key, winner) values ($1, $2) on conflict (key) do nothing returning winner',
          ['mesma-chave', winner],
        ),
      ),
    );
    const winners = results.filter((result) => result.rowCount === 1);
    expect(winners).toHaveLength(1);
    const rows = await pool.query<{ n: number }>('select count(*)::int as n from race_unique');
    expect(rows.rows[0]?.n).toBe(1);
  });

  it('duas transações com FOR UPDATE se serializam e nenhuma atualização se perde', async () => {
    const pool = schema.pool(5);
    const hold = 400;
    const run = async () => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const waitStart = Date.now();
        const row = await client.query<{ value: number }>(
          'select value from race_counter where id = 1 for update',
        );
        const acquiredAfter = Date.now() - waitStart;
        await client.query('select pg_sleep($1)', [hold / 1000]);
        await client.query('update race_counter set value = $1 where id = 1', [
          (row.rows[0]?.value ?? 0) + 1,
        ]);
        await client.query('commit');
        return acquiredAfter;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    };
    const waits = await Promise.all([run(), run()]);
    const final = await pool.query<{ value: number }>(
      'select value from race_counter where id = 1',
    );
    expect(final.rows[0]?.value).toBe(2);
    // Quem entrou depois esperou a outra terminar (a maior parte do tempo de retenção do lock).
    expect(Math.max(...waits)).toBeGreaterThanOrEqual(hold * 0.7);
  });
});

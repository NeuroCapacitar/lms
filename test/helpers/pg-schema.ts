import { randomBytes } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { ENVIRONMENTS } from '../../scripts/environments.ts';

/**
 * Banco de TESTE: um Postgres 18 que pode ser destruído (serviço do CI ou projeto Neon `hub-test`).
 * Nunca é o banco de Development, Staging ou Production.
 */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL não definida (ver .env.example e docs/operations/testing.md)',
    );
  }
  const host = new URL(url).hostname;
  for (const [name, environment] of Object.entries(ENVIRONMENTS)) {
    if (host === environment.databaseHost) {
      throw new Error(
        `recusado: TEST_DATABASE_URL aponta para o banco de "${name}", não para o de teste`,
      );
    }
  }
  return url;
}

export interface TestSchema {
  readonly name: string;
  /** URL de conexão com search_path no schema isolado (para código que recebe só a URL). */
  readonly connectionString: string;
  /** Conexão com `search_path` no schema isolado deste arquivo de teste. */
  client(): Promise<pg.Client>;
  pool(max?: number): pg.Pool;
  drop(): Promise<void>;
}

/**
 * Cria um schema isolado por arquivo de teste, aplica as migrations do projeto nele e devolve
 * ajudantes. Cada arquivo roda no próprio schema, então arquivos em paralelo não se enxergam.
 */
/**
 * Cria um schema isolado já migrado. As duas versões PROVISÓRIAS de Termos e Política que a migration
 * semeia são removidas por padrão: sem versão vigente não há o que aceitar, então os testes dos outros
 * marcos não precisam registrar aceite. `keepLegalSeeds` as mantém (testes do M1-09).
 */
export async function createTestSchema(
  settings: { keepLegalSeeds?: boolean } = {},
): Promise<TestSchema> {
  const url = testDatabaseUrl();
  const name = `t_${randomBytes(6).toString('hex')}`;
  const options = `-c search_path=${name}`;

  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  try {
    await admin.query(`create schema ${admin.escapeIdentifier(name)}`);
  } finally {
    await admin.end();
  }

  const migrator = new pg.Client({ connectionString: url, options });
  await migrator.connect();
  try {
    await migrate(drizzle(migrator), {
      migrationsFolder: 'drizzle',
      migrationsSchema: name,
      migrationsTable: '__migrations',
    });
    if (!settings.keepLegalSeeds) await migrator.query('delete from legal_document_version');
  } finally {
    await migrator.end();
  }

  const open: Array<{ end(): Promise<void> }> = [];
  const scoped = new URL(url);
  scoped.searchParams.set('options', options);
  return {
    name,
    connectionString: scoped.toString(),
    async client() {
      const client = new pg.Client({ connectionString: url, options });
      await client.connect();
      open.push(client);
      return client;
    },
    pool(max = 10) {
      const pool = new pg.Pool({ connectionString: url, options, max });
      open.push(pool);
      return pool;
    },
    async drop() {
      await Promise.allSettled(open.map((item) => item.end()));
      const cleaner = new pg.Client({ connectionString: url });
      await cleaner.connect();
      try {
        await cleaner.query(`drop schema if exists ${cleaner.escapeIdentifier(name)} cascade`);
      } finally {
        await cleaner.end();
      }
    },
  };
}

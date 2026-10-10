import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

/**
 * Um cliente `pg` POR REQUISIÇÃO, fechado no fim (o pool fica no Hyperdrive; um pool global
 * quebra com "Cannot perform I/O on behalf of a different request"). Hyperdrive sem cache.
 */
export async function withDatabase<T>(
  hyperdrive: Hyperdrive,
  work: (db: Database) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: hyperdrive.connectionString });
  await client.connect();
  try {
    return await work(drizzle(client, { schema, casing: 'snake_case' }));
  } finally {
    await client.end();
  }
}

export const naoUsado = 1;

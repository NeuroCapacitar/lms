import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export interface OpenDatabase {
  readonly db: Database;
  /** Fecha o cliente. Chamar sempre, num `finally`. */
  close(): Promise<void>;
}

/**
 * Um cliente `pg` POR REQUISIÇÃO, fechado no fim (o pool fica no Hyperdrive; um pool global
 * quebra com "Cannot perform I/O on behalf of a different request"). Hyperdrive sem cache.
 */
export async function openDatabase(connectionString: string): Promise<OpenDatabase> {
  const client = new pg.Client({ connectionString });
  // Sem ouvinte, um 'error' do cliente vira exceção não tratada. O pg-cloudflare emite um erro
  // ("This socket has been closed") quando o leitor do socket é cancelado ao fechar a conexão; a
  // resposta não é afetada, mas o erro poluiria os logs. Erros reais de consulta chegam pelo `await`.
  client.on('error', () => {});
  await client.connect();
  return {
    db: drizzle(client, { schema, casing: 'snake_case' }),
    close: () => client.end(),
  };
}

export async function withDatabase<T>(
  hyperdrive: Hyperdrive,
  work: (db: Database) => Promise<T>,
): Promise<T> {
  const opened = await openDatabase(hyperdrive.connectionString);
  try {
    return await work(opened.db);
  } finally {
    await opened.close();
  }
}

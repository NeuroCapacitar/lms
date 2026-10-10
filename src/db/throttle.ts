import { sql } from 'drizzle-orm';

import type { Database } from './client';

/**
 * Conta mais um evento na janela da chave e devolve o total ATUAL da janela. Uma única instrução
 * atômica (insert/update com a janela decidida no SQL), então pedidos concorrentes não perdem
 * contagem nem leem valor velho. Passou da janela: a contagem recomeça em 1.
 */
export async function hitThrottle(
  db: Database,
  key: string,
  windowSeconds: number,
): Promise<number> {
  const result = await db.execute<{ count: number }>(sql`
    insert into auth_throttle (key, window_start, count)
    values (${key}, now(), 1)
    on conflict (key) do update set
      count = case
        when auth_throttle.window_start + make_interval(secs => ${windowSeconds}) <= now() then 1
        else auth_throttle.count + 1
      end,
      window_start = case
        when auth_throttle.window_start + make_interval(secs => ${windowSeconds}) <= now() then now()
        else auth_throttle.window_start
      end
    returning count
  `);
  const row = result.rows[0];
  if (!row) throw new Error('hitThrottle: sem resposta do banco');
  return Number(row.count);
}

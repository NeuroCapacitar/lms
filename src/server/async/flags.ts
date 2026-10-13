import { eq } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { systemFlag } from '../../db/schema';
import type { QueueName } from '../../features/async/intents';

export const pauseFlagKey = (queue: QueueName) => `queue.${queue}.paused`;

/**
 * Kill switch por fila. Lido do Postgres a cada lote (uma consulta); ausência da linha = não pausada.
 * Pausada, o consumidor NÃO reivindica nem executa nada e as intenções seguem `pending` no banco.
 */
export async function isQueuePaused(db: Database, queue: QueueName): Promise<boolean> {
  const [flag] = await db
    .select({ enabled: systemFlag.enabled })
    .from(systemFlag)
    .where(eq(systemFlag.key, pauseFlagKey(queue)));
  return flag?.enabled === true;
}

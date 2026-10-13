import { openDatabase, type Database, type OpenDatabase } from '../../db/client';
import { laneOfQueueName } from '../../features/async/envelope';
import { logAlert } from './alerts';
import { processBatch, processDeadLetters } from './consumer';
import { HANDLERS } from './handlers';

/**
 * Entrada `queue()` do Worker (M4-02): roteia o lote pela lane do NOME da fila (`…-finance`,
 * `…-general` ou a DLQ de cada uma). O banco só é aberto se uma mensagem precisar dele e é fechado no
 * fim do lote. Nome de fila fora do padrão é erro de configuração: falha alto (a Cloudflare reentrega).
 */
export async function handleQueueBatch(batch: MessageBatch<unknown>, env: Env): Promise<void> {
  const lane = laneOfQueueName(batch.queue);
  if (!lane) throw new Error('queue_name_unknown');

  let opened: OpenDatabase | undefined;
  const getDb = async (): Promise<Database> => {
    opened ??= await openDatabase(env.HYPERDRIVE.connectionString);
    return opened.db;
  };
  try {
    if (lane.dlq) {
      await processDeadLetters(batch.messages, { getDb, alert: logAlert });
      return;
    }
    const deadLetterQueue = lane.queue === 'finance' ? env.DLQ_FINANCE : env.DLQ_GENERAL;
    await processBatch(batch.messages, {
      lane: lane.queue,
      getDb,
      sendToDeadLetter: async (body) => {
        await deadLetterQueue.send(body, { contentType: 'json' });
      },
      handlers: HANDLERS,
      owner: `queue:${batch.queue}:${crypto.randomUUID()}`,
      alert: logAlert,
    });
  } finally {
    await opened?.close();
  }
}

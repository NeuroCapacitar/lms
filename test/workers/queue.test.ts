import { createExecutionContext, createMessageBatch, getQueueResult } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

// O Worker CONSTRUÍDO (o que vai para produção). `exports.default` é um stub que serializa os argumentos
// e não aceita um lote de Queue; o import roda o mesmo código no isolate do teste.
// @ts-expect-error arquivo gerado pelo build, sem tipos
import worker from '../../dist/hub/index.js';

/**
 * M4-02 no workerd, contra o Worker CONSTRUÍDO: a entrada `queue()` roteia pela lane do nome da fila e
 * nunca confirma em silêncio uma mensagem inválida. Só caminhos que NÃO abrem o banco (o consumidor
 * contra o Postgres real é testado em test/pg/consumer.pg.test.ts); mensagens sem id de intenção legível
 * para que o consumidor local da DLQ também não consulte o banco.
 */
async function deliver(queue: string, bodies: unknown[]) {
  const batch = createMessageBatch(
    queue,
    bodies.map((body, index) => ({
      id: `msg-${index}`,
      timestamp: new Date(),
      attempts: 1,
      body,
    })),
  );
  const ctx = createExecutionContext();
  await (worker as ExportedHandler<Env>).queue!(batch, env as unknown as Env, ctx);
  return getQueueResult(batch, ctx);
}

describe('queue() do Worker', () => {
  it('envelope inválido na fila de trabalho: vai para a DLQ e a mensagem é confirmada', async () => {
    const result = await deliver('hub-general', ['lixo', { v: 9 }, { v: 1, kind: 'nao.existe' }]);
    expect(result.explicitAcks.sort()).toEqual(['msg-0', 'msg-1', 'msg-2']);
    expect(result.retryMessages).toEqual([]);
  });

  it('kind de outra lane não roda: finance recebe o que é do general e desvia para a DLQ', async () => {
    const result = await deliver('hub-finance', [
      { v: 1, kind: 'system.demo', intentId: 'não-é-uuid', correlationId: 'c' },
    ]);
    expect(result.explicitAcks).toEqual(['msg-0']);
  });

  it('mensagem ilegível na DLQ é confirmada (só alerta, não há linha para marcar)', async () => {
    const result = await deliver('hub-general-dlq', ['lixo']);
    expect(result.explicitAcks).toEqual(['msg-0']);
    expect(result.retryMessages).toEqual([]);
  });

  it('nome de fila fora do padrão é erro de configuração: falha alto', async () => {
    await expect(deliver('hub-media', ['x'])).rejects.toThrow('queue_name_unknown');
  });
});

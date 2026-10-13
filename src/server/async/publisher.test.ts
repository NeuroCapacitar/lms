import { describe, expect, it } from 'vitest';

import type { AlertEvent } from './alerts';
import { publishAfterCommit, publishIntents } from './publisher';

const ID = '3f0c7a52-8d1b-4c63-9b1e-6a3f5d2c9e10';
const intent = { id: ID, kind: 'system.demo' as const, correlationId: 'corr-1' };

function fakeEnv(failWith?: Error) {
  const sent: { queue: string; body: unknown; options: unknown }[] = [];
  const binding = (queue: string) => ({
    send: async (body: unknown, options: unknown) => {
      if (failWith) throw failWith;
      sent.push({ queue, body, options });
    },
  });
  const env = {
    QUEUE_FINANCE: binding('finance'),
    QUEUE_GENERAL: binding('general'),
  } as unknown as Pick<Env, 'QUEUE_FINANCE' | 'QUEUE_GENERAL'>;
  return { env, sent };
}

describe('publicação pós-commit', () => {
  it('envia só o envelope (IDs) para a fila da lane do kind', async () => {
    const { env, sent } = fakeEnv();
    await publishIntents(env, [intent]);
    expect(sent).toEqual([
      {
        queue: 'general',
        body: { v: 1, kind: 'system.demo', intentId: ID, correlationId: 'corr-1' },
        options: { contentType: 'json' },
      },
    ]);
  });

  it('falha no envio NÃO lança (a requisição não falha): vira alerta e o Cron recupera', async () => {
    const { env } = fakeEnv(new Error('queue indisponível para ana@example.com'));
    const alerts: AlertEvent[] = [];
    await expect(
      publishIntents(env, [intent], (event) => alerts.push(event)),
    ).resolves.toBeUndefined();
    expect(alerts).toEqual([
      { code: 'publish_failed', queue: 'general', intentId: ID, correlationId: 'corr-1' },
    ]);
    expect(JSON.stringify(alerts)).not.toContain('ana@example.com');
  });

  it('publishAfterCommit entrega a promessa ao waitUntil (não bloqueia a resposta)', async () => {
    const { env, sent } = fakeEnv();
    const pending: Promise<unknown>[] = [];
    publishAfterCommit(env, { waitUntil: (promise) => void pending.push(promise) }, [intent]);
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(sent).toHaveLength(1);
  });
});

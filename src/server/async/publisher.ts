import { buildEnvelope, queueOfKind } from '../../features/async/envelope';
import type { IntentKind } from '../../features/async/intents';
import { logAlert, type Alert } from './alerts';

export interface PublishableIntent {
  id: string;
  kind: IntentKind;
  correlationId: string;
}

type QueueBindings = Pick<Env, 'QUEUE_FINANCE' | 'QUEUE_GENERAL'>;

/**
 * Publica na Queue DEPOIS do commit (M4-02). Best-effort: a intenção já é durável no Postgres, então
 * uma falha aqui NUNCA falha a requisição nem desfaz a mudança de domínio; só gera um alerta, e o Cron
 * (M4-03) republica o que ficou `pending`. Leva só o envelope (IDs), nunca o payload.
 */
export async function publishIntents(
  env: QueueBindings,
  intents: readonly PublishableIntent[],
  alert: Alert = logAlert,
): Promise<void> {
  await Promise.all(
    intents.map(async (intent) => {
      const queue = queueOfKind(intent.kind);
      const binding = queue === 'finance' ? env.QUEUE_FINANCE : env.QUEUE_GENERAL;
      try {
        await binding.send(
          buildEnvelope({
            kind: intent.kind,
            intentId: intent.id,
            correlationId: intent.correlationId,
          }),
          { contentType: 'json' },
        );
      } catch {
        alert({
          code: 'publish_failed',
          queue,
          intentId: intent.id,
          correlationId: intent.correlationId,
        });
      }
    }),
  );
}

/** Atalho para o handler HTTP: `publishAfterCommit(c.env, c.executionCtx, [intent])` depois do commit. */
export function publishAfterCommit(
  env: QueueBindings,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  intents: readonly PublishableIntent[],
  alert: Alert = logAlert,
): void {
  ctx.waitUntil(publishIntents(env, intents, alert));
}

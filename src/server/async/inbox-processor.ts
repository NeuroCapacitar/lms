import type { Database } from '../../db/client';
import type { Alert } from './alerts';
import { PermanentError, TransientError } from './handlers';
import { claimInbox, completeInbox, failInbox, type InboxProvider } from './inbox-store';

interface InboxEventContext {
  db: Database;
  eventId: string;
  provider: InboxProvider;
  /** Payload bruto do provider, já autenticado antes de entrar na inbox. */
  payload: unknown;
  correlationId: string;
  attempt: number;
}

type InboxHandler = (context: InboxEventContext) => Promise<void>;

/**
 * Handlers por provider. Um provider SEM handler não é reivindicado (o evento fica `pending`, sem gastar
 * tentativa) até o handler existir: o do Resend entra no M4-07 e o do Asaas no M6. Mesmas regras dos
 * handlers da outbox: idempotente (at-least-once), `TransientError` ou `PermanentError`, nenhuma chamada
 * a provider dentro de transação PG.
 */
export type InboxHandlers = Partial<Record<InboxProvider, InboxHandler>>;

export const INBOX_HANDLERS: InboxHandlers = {};

const BATCH_SIZE = 10;
/** Teto por execução do Cron: o excedente fica para o próximo ciclo (protege o tempo do Worker e o Neon). */
const MAX_BATCHES = 5;

/**
 * Processa os eventos pendentes da inbox (job do Cron, M4-03). Devolve quantos foram CONCLUÍDOS.
 * Falha transitória volta a `pending` com backoff; permanente vai para `failed`; esgotadas as tentativas,
 * `dead`. O lease é por linha, então duas execuções simultâneas nunca tratam o mesmo evento.
 */
export async function processInbox(
  db: Database,
  options: { handlers: InboxHandlers; owner: string; alert: Alert },
): Promise<number> {
  const providers = Object.keys(options.handlers) as InboxProvider[];
  if (providers.length === 0) return 0;

  let completed = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const claimed = await claimInbox(db, BATCH_SIZE, options.owner, undefined, providers);
    if (claimed.length === 0) break;
    for (const event of claimed) {
      const provider = event.provider as InboxProvider;
      const handler = options.handlers[provider];
      if (!handler) continue;
      try {
        await handler({
          db,
          eventId: event.id,
          provider,
          payload: event.payload,
          correlationId: event.correlationId,
          attempt: event.attempts,
        });
      } catch (error) {
        const failure =
          error instanceof PermanentError
            ? ({ kind: 'permanent', code: error.code } as const)
            : error instanceof TransientError
              ? ({ kind: 'transient', code: error.code } as const)
              : ({ kind: 'transient', code: 'handler_unexpected' } as const);
        const outcome = await failInbox(db, event.id, event.leaseVersion, failure);
        if (outcome === 'dead' || outcome === 'failed') {
          options.alert({
            code: outcome === 'dead' ? 'inbox_event_dead' : 'inbox_event_failed',
            intentId: event.id,
            correlationId: event.correlationId,
            reason: failure.code,
          });
        }
        continue;
      }
      if (await completeInbox(db, event.id, event.leaseVersion)) completed += 1;
    }
    if (claimed.length < BATCH_SIZE) break;
  }
  return completed;
}

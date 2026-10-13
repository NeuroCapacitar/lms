import { and, eq } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { inboxEvent } from '../../db/schema';
import { INBOX_PAYLOAD_MAX_BYTES, RETENTION_DAYS } from '../../features/async/intents';
import { DEFAULT_LEASE_SECONDS } from './outbox-store';
import {
  claimRows,
  completeRow,
  failRow,
  purgeRows,
  type ClaimedRow,
  type FailureKind,
  type FailureOutcome,
} from './lease';

type InboxProvider = 'asaas' | 'resend';

/** O evento passa do limite de payload (o ACK do webhook não pode depender de gravar um corpo enorme). */
export class InboxPayloadTooLargeError extends Error {
  constructor() {
    super('inbox_payload_too_large');
  }
}

export interface RecordInboxInput {
  provider: InboxProvider;
  /** Id do evento no provider (único por provider): a repetição do webhook não duplica. */
  eventId: string;
  payload: Record<string, unknown>;
  correlationId: string;
}

export interface RecordInboxResult {
  id: string;
  /** `false`: o evento já estava na inbox (reenvio do provider); nada novo foi gravado. */
  created: boolean;
}

/**
 * Persiste o evento EXTERNO já autenticado, antes do ACK. Idempotente por `(provider, eventId)`.
 * A autenticação do webhook é de quem chama (M4-07 e M5); aqui só se guarda e se deduplica.
 */
export async function recordInboxEvent(
  db: Database,
  input: RecordInboxInput,
): Promise<RecordInboxResult> {
  if (
    new TextEncoder().encode(JSON.stringify(input.payload)).byteLength > INBOX_PAYLOAD_MAX_BYTES
  ) {
    throw new InboxPayloadTooLargeError();
  }
  const inserted = await db
    .insert(inboxEvent)
    .values({
      provider: input.provider,
      eventId: input.eventId,
      payload: input.payload,
      correlationId: input.correlationId,
    })
    .onConflictDoNothing({ target: [inboxEvent.provider, inboxEvent.eventId] })
    .returning({ id: inboxEvent.id });
  if (inserted[0]) return { id: inserted[0].id, created: true };

  const [existing] = await db
    .select({ id: inboxEvent.id })
    .from(inboxEvent)
    .where(and(eq(inboxEvent.provider, input.provider), eq(inboxEvent.eventId, input.eventId)));
  if (!existing) throw new Error('inbox_event_missing_after_conflict');
  return { id: existing.id, created: false };
}

export function claimInbox(
  db: Database,
  limit: number,
  owner: string,
  leaseSeconds: number = DEFAULT_LEASE_SECONDS,
): Promise<ClaimedRow[]> {
  return claimRows(db, 'inbox_event', limit, owner, leaseSeconds);
}

/** `false` = lease perdido: descarte o resultado e não repita o efeito. */
export function completeInbox(db: Database, id: string, leaseVersion: number): Promise<boolean> {
  return completeRow(db, 'inbox_event', id, leaseVersion);
}

export function failInbox(
  db: Database,
  id: string,
  leaseVersion: number,
  failure: { kind: FailureKind; code: string },
  random?: () => number,
): Promise<FailureOutcome> {
  return failRow(db, 'inbox_event', id, leaseVersion, failure, random);
}

/** Retenção do payload bruto: 30 dias depois de concluído; `failed` e `dead` ficam 180 dias. */
export function purgeInbox(db: Database): Promise<number> {
  return purgeRows(db, 'inbox_event', {
    doneDays: RETENTION_DAYS.done,
    problemDays: RETENTION_DAYS.problem,
  });
}

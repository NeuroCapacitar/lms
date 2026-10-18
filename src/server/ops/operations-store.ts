import { eq, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { emailMessage, outboxMessage, systemFlag } from '../../db/schema';
import {
  type EmailStateCount,
  type JobStatus,
  type LaneName,
  type OperationsSnapshot,
  type OutboxCount,
  type ProblemItem,
  type ProviderActivity,
} from '../../features/ops/operations';
import { FREE_PLAN_QUOTA, type QuotaPolicy } from '../../features/email/quota';
import { isIntentKind, type IntentKind } from '../../features/async/intents';
import { auditEvent } from '../auth/access-store';
import { pauseFlagKey } from '../async/flags';
import { quotaSummary } from '../email/quota-store';

function rowsOf(result: unknown): Record<string, unknown>[] {
  return (result as { rows: Record<string, unknown>[] }).rows;
}

const iso = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : null;

/**
 * Foto do estado assíncrono para a tela "Operação" (M4-05). SOMENTE LEITURA e SEM payload: contagens por
 * fila e estado, idade da intenção aberta mais antiga, itens `dead` e `failed` (id, tipo, código do erro),
 * atividade de cada webhook, último resultado de cada job, estado dos e-mails, cota e kill switch.
 * Todas as idades são calculadas pelo `now()` do BANCO.
 */
export async function loadOperationsSnapshot(
  db: Database,
  policy: QuotaPolicy = FREE_PLAN_QUOTA,
): Promise<OperationsSnapshot> {
  const outboxRows = rowsOf(
    await db.execute(sql`
      select queue, state, count(*)::int as count
        from outbox_message group by queue, state order by queue, state`),
  );
  const outbox: OutboxCount[] = outboxRows.map((row) => ({
    queue: row.queue as LaneName,
    state: row.state as string,
    count: row.count as number,
  }));

  const ageRows = rowsOf(
    await db.execute(sql`
      select queue,
             floor(extract(epoch from (now() - min(available_at))))::int as age
        from outbox_message
       where state in ('pending', 'leased') and available_at <= now()
       group by queue`),
  );
  const oldestOpenAgeSeconds: Record<LaneName, number | null> = { finance: null, general: null };
  for (const row of ageRows) oldestOpenAgeSeconds[row.queue as LaneName] = row.age as number;

  const problems: ProblemItem[] = rowsOf(
    await db.execute(sql`
      select id, kind, queue, state, attempts, last_error_code, finished_at, correlation_id
        from outbox_message
       where state in ('dead', 'failed')
       order by finished_at desc nulls last, id
       limit 50`),
  ).map((row) => ({
    id: row.id as string,
    kind: row.kind as string,
    queue: row.queue as LaneName,
    state: row.state as 'dead' | 'failed',
    attempts: row.attempts as number,
    lastErrorCode: (row.last_error_code as string | null) ?? null,
    finishedAt: iso(row.finished_at),
    correlationId: row.correlation_id as string,
  }));

  const inbox: ProviderActivity[] = rowsOf(
    await db.execute(sql`
      select provider,
             max(received_at) as last_received_at,
             count(*) filter (where state in ('pending', 'leased'))::int as pending,
             count(*) filter (where state in ('failed', 'dead'))::int as problems
        from inbox_event group by provider order by provider`),
  ).map((row) => ({
    provider: row.provider as string,
    lastReceivedAt: iso(row.last_received_at),
    pending: row.pending as number,
    problems: row.problems as number,
  }));

  const jobRows = rowsOf(
    await db.execute(sql`
      select name, last_status, last_count, last_duration_ms, last_error_code, last_finished_at,
             (lease_until is not null and lease_until > now()) as running,
             floor(extract(epoch from (now() - last_finished_at)))::int as age
        from job_run order by name`),
  );
  const jobs: JobStatus[] = jobRows.map((row) => ({
    name: row.name as string,
    lastStatus: (row.last_status as 'ok' | 'error' | null) ?? null,
    lastCount: (row.last_count as number | null) ?? null,
    lastDurationMs: (row.last_duration_ms as number | null) ?? null,
    lastErrorCode: (row.last_error_code as string | null) ?? null,
    lastFinishedAt: iso(row.last_finished_at),
    running: row.running as boolean,
  }));
  const cron = jobRows.find((row) => row.name === 'cron');
  const cronAgeSeconds = cron && cron.age !== null ? (cron.age as number) : null;

  const email: EmailStateCount[] = rowsOf(
    await db.execute(
      sql`select state, count(*)::int as count from email_message group by state order by state`,
    ),
  ).map((row) => ({ state: row.state as string, count: row.count as number }));

  const extra = rowsOf(
    await db.execute(sql`
      select (select count(*) from email_recipient_state)::int as suppressed,
             (select count(*) from email_message
               where state = 'accepted' and accepted_at > now() - interval '24 hours')::int as accepted24`),
  )[0];

  const financeRow = rowsOf(
    await db.execute(sql`
      select (select count(*) from purchase_order
               where status = 'pending' and created_at < now() - interval '30 minutes')::int as over30,
             (select count(*) from purchase_order
               where status = 'pending' and created_at < now() - interval '2 hours')::int as over2h,
             (select count(*) from financial_review where state = 'open')::int as open_reviews,
             (select floor(extract(epoch from (now() - min(created_at))))::int
                from financial_review where state = 'open') as oldest_review`),
  )[0];

  const healthRow = rowsOf(
    await db.execute(sql`
      select (select count(*) from certificate where status = 'failed')::int as certificates_failed,
             pg_database_size(current_database())::text as database_size`),
  )[0];

  const flags = await db
    .select({ key: systemFlag.key, enabled: systemFlag.enabled })
    .from(systemFlag);
  const isPaused = (lane: LaneName) =>
    flags.some((flag) => flag.key === pauseFlagKey(lane) && flag.enabled);

  return {
    outbox,
    oldestOpenAgeSeconds,
    problems,
    inbox,
    jobs,
    cronAgeSeconds,
    quota: await quotaSummary(db, policy),
    email,
    suppressedRecipients: (extra?.suppressed as number | undefined) ?? 0,
    emailAcceptedLast24h: (extra?.accepted24 as number | undefined) ?? 0,
    paused: { finance: isPaused('finance'), general: isPaused('general') },
    finance: {
      pendingOver30Min: (financeRow?.over30 as number | undefined) ?? 0,
      pendingOver2Hours: (financeRow?.over2h as number | undefined) ?? 0,
      openReviews: (financeRow?.open_reviews as number | undefined) ?? 0,
      oldestOpenReviewAgeSeconds: (financeRow?.oldest_review as number | null | undefined) ?? null,
    },
    certificatesFailed: (healthRow?.certificates_failed as number | undefined) ?? 0,
    databaseSizeBytes:
      healthRow?.database_size === undefined ? null : Number(healthRow.database_size as string),
  };
}

export interface RequeuedItem {
  kind: IntentKind;
  correlationId: string;
}

/**
 * Reenfileira um item `dead` ou `failed` (decisão HUMANA, com motivo): volta a `pending`, disponível agora,
 * com as tentativas zeradas, e grava a auditoria na MESMA transação (ator, motivo e o erro anterior; sem
 * payload). `undefined` = o item não existe ou não está em estado reenfileirável (já foi tratado por outro).
 * Para o e-mail, o `email_message` que ficou `failed` volta a `queued` (senão o handler o trataria como final).
 */
export async function requeueProblemItem(
  db: Database,
  input: { id: string; actorId: string; reason: string },
): Promise<RequeuedItem | undefined> {
  return db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      update outbox_message
         set state = 'pending', attempts = 0, available_at = now(), finished_at = null,
             lease_owner = null, lease_until = null, updated_at = now()
       where id = ${input.id} and state in ('dead', 'failed')
      returning kind, correlation_id, payload, last_error_code`);
    const row = rowsOf(result)[0];
    if (!row) return undefined;

    if (row.kind === 'email.send') {
      const emailId = (row.payload as { emailMessageId?: string }).emailMessageId;
      if (emailId) {
        await tx
          .update(emailMessage)
          .set({ state: 'queued', lastErrorCode: null, updatedAt: sql`now()` })
          .where(sql`${emailMessage.id} = ${emailId} and ${emailMessage.state} = 'failed'`);
      }
    }
    await auditEvent(tx, {
      actorId: input.actorId,
      action: 'ops.requeue',
      targetType: 'outbox_message',
      targetId: input.id,
      details: {
        reason: input.reason,
        kind: row.kind,
        previousError: (row.last_error_code as string | null) ?? null,
      },
    });
    const kind = row.kind as string;
    if (!isIntentKind(kind)) return undefined;
    return { kind, correlationId: row.correlation_id as string };
  });
}

/** Kill switch por fila (só Admin; motivo na auditoria, na mesma transação). */
export async function setQueuePaused(
  db: Database,
  input: { lane: LaneName; paused: boolean; actorId: string; reason: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(systemFlag)
      .values({ key: pauseFlagKey(input.lane), enabled: input.paused, reason: input.reason })
      .onConflictDoUpdate({
        target: systemFlag.key,
        set: { enabled: input.paused, reason: input.reason, updatedAt: sql`now()` },
      });
    await auditEvent(tx, {
      actorId: input.actorId,
      action: input.paused ? 'ops.queue_pause' : 'ops.queue_resume',
      targetType: 'queue',
      targetId: input.lane,
      details: { reason: input.reason },
    });
  });
}

/** Confere se a intenção ainda existe e em que estado (para a resposta de "não reenfileirável"). */
export async function intentState(db: Database, id: string): Promise<string | undefined> {
  const [row] = await db
    .select({ state: outboxMessage.state })
    .from(outboxMessage)
    .where(eq(outboxMessage.id, id));
  return row?.state;
}

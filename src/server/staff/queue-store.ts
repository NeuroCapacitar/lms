import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { hasCapability, type AccessContext } from '../../features/identity/capabilities';
import {
  QUEUE_KINDS,
  QUEUE_LIMIT,
  QUEUE_PER_KIND,
  QUEUE_RULES,
  QUEUE_THRESHOLDS,
  type QueueItem,
  type QueueKind,
  type StaffQueueDto,
} from '../../features/staff/queue';

function rowsOf(result: unknown): Record<string, unknown>[] {
  return (result as { rows: Record<string, unknown>[] }).rows;
}

/** `age` em segundos, pelo `now()` do banco, e `total` = quantos itens do tipo existem (mesmo os que passam do limite). */
const age = (column: SQL) => sql`floor(extract(epoch from (now() - ${column})))::int as age`;
const ago = (seconds: number) => sql`(now() - (${seconds}::int * interval '1 second'))`;

/** Uma consulta por tipo; cada uma devolve `id`, `detail`, `age` e `total`, sem nenhum dado pessoal. */
const QUERIES: Record<QueueKind, () => SQL> = {
  financial_review: () => sql`
    select id::text as id, type as detail, ${age(sql`created_at`)}, (count(*) over ())::int as total
      from financial_review where state = 'open'
     order by created_at limit ${QUEUE_PER_KIND}`,
  refund_pending: () => sql`
    select id::text as id, state as detail, ${age(sql`created_at`)}, (count(*) over ())::int as total
      from refund_request
     where state in ('requested', 'submitting', 'submitted')
       and created_at <= ${ago(QUEUE_THRESHOLDS.refundPendingSeconds)}
     order by created_at limit ${QUEUE_PER_KIND}`,
  refund_uncertain: () => sql`
    select id::text as id, state as detail, ${age(sql`created_at`)}, (count(*) over ())::int as total
      from refund_request
     where state in ('unknown', 'awaiting_external_authorization')
     order by created_at limit ${QUEUE_PER_KIND}`,
  refund_failed: () => sql`
    select id::text as id, failure_code as detail, ${age(sql`updated_at`)}, (count(*) over ())::int as total
      from refund_request
     where state = 'failed' and updated_at >= ${ago(QUEUE_THRESHOLDS.refundFailedWindowSeconds)}
     order by updated_at limit ${QUEUE_PER_KIND}`,
  certificate_failed: () => sql`
    select id::text as id, failure_code as detail, ${age(sql`updated_at`)}, (count(*) over ())::int as total
      from certificate where status = 'failed'
     order by updated_at limit ${QUEUE_PER_KIND}`,
  certificate_awaiting_name: () => sql`
    select id::text as id, null::text as detail, ${age(sql`updated_at`)}, (count(*) over ())::int as total
      from certificate
     where status = 'awaiting_name' and updated_at <= ${ago(QUEUE_THRESHOLDS.awaitingNameSeconds)}
     order by updated_at limit ${QUEUE_PER_KIND}`,
  email_problem: () => sql`
    select id::text as id, template || ' / ' || state as detail, ${age(sql`updated_at`)}, (count(*) over ())::int as total
      from email_message
     where state in ('failed', 'suppressed', 'bounced', 'complained', 'blocked')
       and created_at >= ${ago(QUEUE_THRESHOLDS.emailWindowSeconds)}
     order by updated_at limit ${QUEUE_PER_KIND}`,
  outbox_problem: () => sql`
    select id::text as id,
           kind || ' / ' || coalesce(last_error_code, state) as detail,
           ${age(sql`coalesce(finished_at, available_at)`)},
           (count(*) over ())::int as total
      from outbox_message
     where state in ('dead', 'failed')
        or (state in ('pending', 'leased') and available_at <= ${ago(QUEUE_THRESHOLDS.outboxLateSeconds)})
     order by coalesce(finished_at, available_at) limit ${QUEUE_PER_KIND}`,
  discussion_report: () => sql`
    select post_id::text as id, null::text as detail,
           floor(extract(epoch from (now() - first_at)))::int as age,
           (count(*) over ())::int as total
      from (select post_id, min(created_at) as first_at
              from discussion_report where resolved_at is null group by post_id) open_reports
     order by first_at limit ${QUEUE_PER_KIND}`,
};

/**
 * A fila unificada: o que precisa de ação, com a idade de cada item. Cada tipo só entra para quem tem a capacidade de VÊ-lo; a AÇÃO só
 * vai a quem tem o grant. Sem nome, e-mail nem dado de pagamento. Ordem: o mais antigo primeiro.
 */
export async function loadStaffQueue(db: Database, access: AccessContext): Promise<StaffQueueDto> {
  const visible = QUEUE_KINDS.filter((kind) =>
    hasCapability(access, QUEUE_RULES[kind].visibleWith),
  );
  const hidden = QUEUE_KINDS.filter((kind) => !visible.includes(kind));

  const items: QueueItem[] = [];
  const totals: Partial<Record<QueueKind, number>> = {};
  for (const kind of visible) {
    const rows = rowsOf(await db.execute(QUERIES[kind]()));
    totals[kind] = rows.length === 0 ? 0 : (rows[0]!.total as number);
    const rule = QUEUE_RULES[kind];
    const canAct = rule.action !== null && hasCapability(access, rule.action.capability);
    for (const row of rows) {
      items.push({
        id: `${kind}:${row.id as string}`,
        kind,
        title: rule.title,
        detail: (row.detail as string | null) ?? null,
        ageSeconds: Math.max(0, row.age as number),
        action: canAct ? { label: rule.action!.label, screen: rule.action!.screen } : null,
      });
    }
  }
  items.sort((a, b) => b.ageSeconds - a.ageSeconds || a.id.localeCompare(b.id));

  const generated = rowsOf(await db.execute(sql`select now() as now`))[0]?.now;
  const listed = items.slice(0, QUEUE_LIMIT);
  const totalAll = Object.values(totals).reduce((sum, value) => sum + value, 0);
  return {
    generatedAt: generated instanceof Date ? generated.toISOString() : String(generated),
    items: listed,
    totals,
    truncated: totalAll > listed.length,
    hidden,
  };
}

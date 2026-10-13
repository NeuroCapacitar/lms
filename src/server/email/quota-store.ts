import { sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import {
  FREE_PLAN_QUOTA,
  capsFor,
  summarize,
  type QuotaPolicy,
  type QuotaSummary,
} from '../../features/email/quota';
import type { PriorityClass } from '../../features/email/templates';

/**
 * Livro-razão da cota (M4-08). TODO o cálculo de dia e mês usa o `now()` do BANCO em UTC (o Resend zera a
 * cota à meia-noite UTC), nunca o relógio do Worker. A reserva é um único comando atômico: dois envios
 * simultâneos nunca passam do teto do dia (a linha do dia serializa). O teto do MÊS é conferido na mesma
 * instrução, mas contra uma leitura anterior: sob concorrência extrema pode passar por poucas unidades.
 */
export type QuotaReservation =
  | { ok: true; day: string }
  | { ok: false; reason: 'daily' | 'monthly'; retryAfterSeconds: number };

function rowsOf(result: unknown): Record<string, unknown>[] {
  return (result as { rows: Record<string, unknown>[] }).rows;
}

const TODAY = sql`(now() at time zone 'utc')::date`;
const MONTH_START = sql`date_trunc('month', now() at time zone 'utc')::date`;

/** Segundos até o início da próxima janela (meia-noite UTC do dia seguinte ou do próximo mês), pelo banco. */
async function secondsUntilNextWindow(db: Database, window: 'daily' | 'monthly'): Promise<number> {
  const next =
    window === 'daily'
      ? sql`(date_trunc('day', now() at time zone 'utc') + interval '1 day') at time zone 'utc'`
      : sql`(date_trunc('month', now() at time zone 'utc') + interval '1 month') at time zone 'utc'`;
  const result = await db.execute(
    sql`select ceil(extract(epoch from (${next} - now())))::int as seconds`,
  );
  return Math.max(1, (rowsOf(result)[0]?.seconds as number | undefined) ?? 60);
}

/**
 * Reserva UMA vaga para um envio da classe dada. `ok: false` = sem folga PARA ESTA CLASSE (não é falha da
 * mensagem): `retryAfterSeconds` é até o início da próxima janela, mais um espalhamento de até 10 min para
 * o excedente não chegar todo junto à meia-noite.
 */
export async function reserveQuota(
  db: Database,
  priorityClass: PriorityClass,
  policy: QuotaPolicy = FREE_PLAN_QUOTA,
  random: () => number = Math.random,
): Promise<QuotaReservation> {
  const caps = capsFor(policy, priorityClass);
  const result = await db.execute(sql`
    insert into email_send_ledger (day, count)
    select ${TODAY}, 1
     where (select coalesce(sum(count), 0) from email_send_ledger where day >= ${MONTH_START}) < ${caps.monthly}
       and 1 <= ${caps.daily}
    on conflict (day) do update
       set count = email_send_ledger.count + 1, updated_at = now()
     where email_send_ledger.count < ${caps.daily}
       and (select coalesce(sum(count), 0) from email_send_ledger where day >= ${MONTH_START}) < ${caps.monthly}
    returning day::text as day`);
  const reserved = rowsOf(result)[0];
  if (reserved) return { ok: true, day: reserved.day as string };

  const month = await db.execute(
    sql`select coalesce(sum(count), 0)::int as total from email_send_ledger where day >= ${MONTH_START}`,
  );
  const monthTotal = (rowsOf(month)[0]?.total as number | undefined) ?? 0;
  const reason = monthTotal >= caps.monthly ? 'monthly' : 'daily';
  const base = await secondsUntilNextWindow(db, reason);
  return { ok: false, reason, retryAfterSeconds: base + Math.floor(random() * 600) };
}

/** Devolve a vaga reservada no `day` (o provider NÃO aceitou o envio). Nunca fica abaixo de zero. */
export async function releaseQuota(db: Database, day: string): Promise<void> {
  await db.execute(sql`
    update email_send_ledger set count = greatest(count - 1, 0), updated_at = now()
     where day = ${day}::date`);
}

/**
 * O Resend respondeu `daily_quota_exceeded`: o nosso livro-razão estava ABAIXO do real (e-mails recebidos
 * também contam, ou houve envio fora do Hub). Encosta o dia no limite para os próximos já saírem adiados.
 */
export async function markDayExhausted(
  db: Database,
  policy: QuotaPolicy = FREE_PLAN_QUOTA,
): Promise<void> {
  await db.execute(sql`
    insert into email_send_ledger (day, count) values (${TODAY}, ${policy.dailyLimit})
    on conflict (day) do update
       set count = greatest(email_send_ledger.count, ${policy.dailyLimit}), updated_at = now()`);
}

/**
 * Contabiliza um envio feito FORA da outbox (o link de acesso, caminho direto do M1): conta sem reservar
 * nem recusar, para o livro-razão refletir o real. Devolve se o dia JÁ passou do limite (alerta P1).
 */
export async function recordDirectSend(
  db: Database,
  policy: QuotaPolicy = FREE_PLAN_QUOTA,
): Promise<{ overDailyLimit: boolean }> {
  const result = await db.execute(sql`
    insert into email_send_ledger (day, count) values (${TODAY}, 1)
    on conflict (day) do update set count = email_send_ledger.count + 1, updated_at = now()
    returning count`);
  const count = (rowsOf(result)[0]?.count as number | undefined) ?? 0;
  return { overDailyLimit: count > policy.dailyLimit };
}

/**
 * A cota diária de e-mail do dia (UTC) já foi toda usada? Só o link de acesso (classe 1) usa o limite
 * inteiro, então este é o teste de "o link de acesso pode não chegar". Uma consulta barata.
 */
export async function emailQuotaExhausted(
  db: Database,
  policy: QuotaPolicy = FREE_PLAN_QUOTA,
): Promise<boolean> {
  const result = await db.execute(
    sql`select coalesce(sum(count), 0)::int as today from email_send_ledger where day = ${TODAY}`,
  );
  return ((rowsOf(result)[0]?.today as number | undefined) ?? 0) >= policy.dailyLimit;
}

/** Uso atual (para a tela de Operação, M4-09, e para o sinal de upgrade). */
export async function quotaSummary(
  db: Database,
  policy: QuotaPolicy = FREE_PLAN_QUOTA,
): Promise<QuotaSummary> {
  const result = await db.execute(sql`
    select
      coalesce(sum(count) filter (where day = ${TODAY}), 0)::int as today,
      coalesce(sum(count) filter (where day >= ${MONTH_START}), 0)::int as month,
      coalesce(sum(count) filter (where day > ${TODAY} - 7), 0)::int as last7
    from email_send_ledger`);
  const row = rowsOf(result)[0] ?? {};
  return summarize(policy, {
    today: (row.today as number) ?? 0,
    month: (row.month as number) ?? 0,
    last7Days: (row.last7 as number) ?? 0,
  });
}

/** A cota como o handler de e-mail a usa (injetável nos testes). */
export interface QuotaGate {
  reserve(db: Database, priorityClass: PriorityClass): Promise<QuotaReservation>;
  release(db: Database, day: string): Promise<void>;
  /** O Resend disse que a cota do dia acabou: encosta o livro-razão no limite. */
  markDayExhausted(db: Database): Promise<void>;
  /** Segundos até a próxima janela (para adiar quando o Resend respondeu 429 de cota). */
  retryAfter(db: Database, window: 'daily' | 'monthly'): Promise<number>;
}

export function createQuotaGate(policy: QuotaPolicy = FREE_PLAN_QUOTA): QuotaGate {
  return {
    reserve: (db, priorityClass) => reserveQuota(db, priorityClass, policy),
    release: releaseQuota,
    markDayExhausted: (db) => markDayExhausted(db, policy),
    retryAfter: secondsUntilNextWindow,
  };
}

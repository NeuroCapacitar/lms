import { sql } from 'drizzle-orm';

import type { Database } from '../../db/client';

/**
 * Lease e registro da última execução de cada job do Cron (M4-03), na tabela `job_run`. O tempo vem do
 * `now()` do BANCO e `lease_version` é o fencing, como na outbox. Só código de erro, nunca texto.
 */
const JOB_LEASE_SECONDS = 600;

export interface JobResult {
  status: 'ok' | 'error';
  /** Quantas linhas o job tratou (republicadas, processadas, apagadas). */
  count: number;
  errorCode?: string;
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  return (result as { rows: Record<string, unknown>[] }).rows;
}

/**
 * Tenta assumir o job. `undefined` = outra execução está com o lease vivo (sobreposição): quem chama
 * NÃO roda. Devolve a `lease_version` a passar para `finishJob`.
 */
export async function acquireJob(
  db: Database,
  name: string,
  owner: string,
  leaseSeconds: number = JOB_LEASE_SECONDS,
): Promise<number | undefined> {
  const result = await db.execute(sql`
    insert into job_run (name, lease_owner, lease_until, lease_version, last_started_at)
    values (${name}, ${owner}, now() + make_interval(secs => ${leaseSeconds}), 1, now())
    on conflict (name) do update
       set lease_owner = ${owner}, lease_until = now() + make_interval(secs => ${leaseSeconds}),
           lease_version = job_run.lease_version + 1, last_started_at = now()
     where job_run.lease_until is null or job_run.lease_until < now()
    returning lease_version`);
  const found = rowsOf(result)[0];
  return found ? (found.lease_version as number) : undefined;
}

/** Encerra a execução com o resultado. `false` = o lease se perdeu (outro assumiu): o registro é dele. */
export async function finishJob(
  db: Database,
  name: string,
  leaseVersion: number,
  result: JobResult,
): Promise<boolean> {
  const done = await db.execute(sql`
    update job_run
       set lease_owner = null, lease_until = null, last_finished_at = now(),
           last_status = ${result.status}, last_count = ${result.count},
           last_error_code = ${result.errorCode?.slice(0, 100) ?? null},
           last_duration_ms = greatest(0, (extract(epoch from (now() - last_started_at)) * 1000)::int)
     where name = ${name} and lease_version = ${leaseVersion}
    returning name`);
  return rowsOf(done).length === 1;
}

/**
 * Registra que o ciclo do Cron RODOU (mesmo sem nada a fazer): é o que o alerta "Cron sem rodar > 90 min"
 * lê. Linha própria (`cron`), sem lease. O início é `now() - duração` (relógio do banco).
 */
export async function recordCycle(
  db: Database,
  summary: { durationMs: number; status: 'ok' | 'error'; count: number; errorCode?: string },
): Promise<void> {
  const duration = Math.max(0, Math.round(summary.durationMs));
  await db.execute(sql`
    insert into job_run (name, last_started_at, last_finished_at, last_status, last_count, last_error_code, last_duration_ms)
    values ('cron', now() - make_interval(secs => ${duration / 1000}), now(), ${summary.status},
            ${summary.count}, ${summary.errorCode ?? null}, ${duration})
    on conflict (name) do update
       set last_started_at = excluded.last_started_at, last_finished_at = excluded.last_finished_at,
           last_status = excluded.last_status, last_count = excluded.last_count,
           last_error_code = excluded.last_error_code, last_duration_ms = excluded.last_duration_ms`);
}

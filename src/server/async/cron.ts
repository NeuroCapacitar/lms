import { openDatabase, type OpenDatabase } from '../../db/client';
import { logAlert, type Alert } from './alerts';
import { resendEventHandler } from '../email/resend-events';
import { createCronJobs, runCycle, type CronJob } from './jobs';
import { recordCycle } from './job-store';

/** Teto para o Neon acordar: passou disso, o ciclo termina com erro em vez de pendurar. */
const CRON_CONNECT_TIMEOUT_MS = 20_000;

export interface ScheduledDeps {
  openDb?: () => Promise<OpenDatabase>;
  jobs?: readonly CronJob[];
  alert?: Alert;
}

/**
 * Entrada `scheduled()` do Worker (M4-03), a cada 30 min. Abre UMA conexão, roda os jobs em ordem e
 * fecha. Cada execução custa CU-h do Neon Free: sem trabalho, o ciclo só faz as sondas baratas e o
 * registro de que rodou. NÃO aumentar a frequência para "ficar mais rápido".
 *
 * Banco que não responde a tempo: alerta e o erro sobe (o painel da Cloudflare mostra a execução
 * falha); não há onde gravar o registro sem banco, e o alerta "Cron sem rodar" cobre a ausência.
 */
export async function handleScheduled(env: Env, deps: ScheduledDeps = {}): Promise<void> {
  const alert = deps.alert ?? logAlert;
  const startedAt = Date.now();
  let opened: OpenDatabase;
  try {
    opened = await (
      deps.openDb ??
      (() =>
        openDatabase(env.HYPERDRIVE.connectionString, {
          connectionTimeoutMillis: CRON_CONNECT_TIMEOUT_MS,
        }))
    )();
  } catch (error) {
    alert({ code: 'cron_database_unavailable' });
    throw error;
  }
  try {
    const summary = await runCycle(
      { db: opened.db, env, alert, owner: `cron:${crypto.randomUUID()}` },
      deps.jobs ?? createCronJobs({ resend: resendEventHandler }),
    );
    await recordCycle(opened.db, {
      durationMs: Date.now() - startedAt,
      status: summary.failed > 0 ? 'error' : 'ok',
      count: summary.ran,
      errorCode: summary.failed > 0 ? 'job_failed' : undefined,
    });
  } finally {
    await opened.close();
  }
}

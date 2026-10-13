import type { Database } from '../../db/client';
import { RETENTION_DAYS, isIntentKind } from '../../features/async/intents';
import type { Alert } from './alerts';
import { isQueuePaused } from './flags';
import { INBOX_HANDLERS, processInbox, type InboxHandlers } from './inbox-processor';
import { hasClaimableInbox, purgeInbox, type InboxProvider } from './inbox-store';
import { acquireJob, finishJob, type JobResult } from './job-store';
import { deadLetterExhausted, hasPurgeableRows } from './lease';
import { hasRepublishable, listRepublishable, markOutboxDead, purgeOutbox } from './outbox-store';
import { publishIntents, type PublishableIntent } from './publisher';

export interface JobContext {
  db: Database;
  env: Pick<Env, 'QUEUE_FINANCE' | 'QUEUE_GENERAL'>;
  alert: Alert;
  /** Identifica esta execução do Cron (dono dos leases). */
  owner: string;
}

/**
 * Job do Cron (M4-03): lista simples de nomes e funções, sem framework. `probe` é uma consulta barata
 * que diz se HÁ trabalho; sem trabalho o job nem assume o lease (o Cron acorda o Neon o mínimo possível).
 * Os M4-08 (liberar adiados), M5-07 (órfãos do R2) e M6-04 (reconciliação Asaas) registram os seus aqui.
 */
export interface CronJob {
  /** Minúsculo, único: é a chave da linha em `job_run`. */
  name: string;
  probe?: (context: JobContext) => Promise<boolean>;
  run: (context: JobContext) => Promise<{ count: number; errorCode?: string }>;
}

/** Quantas intenções o Cron republica por execução (o excedente fica para o ciclo seguinte). */
const REPUBLISH_LIMIT = 50;

/**
 * Republica na Queue as intenções cuja mensagem se perdeu e encerra como `dead` as que esgotaram as
 * tentativas. Respeita o kill switch (lane pausada não é republicada). Não reivindica nada: o
 * consumidor reivindica ao receber, com fencing. Mensagem duplicada é segura (at-least-once).
 */
export const republishJob: CronJob = {
  name: 'outbox.republish',
  probe: ({ db }) => hasRepublishable(db),
  async run({ db, env, alert }) {
    await deadLetterExhausted(db, 'outbox_message');

    const lanes: ('finance' | 'general')[] = [];
    for (const lane of ['finance', 'general'] as const) {
      if (!(await isQueuePaused(db, lane))) lanes.push(lane);
    }
    const rows = await listRepublishable(db, { lanes, limit: REPUBLISH_LIMIT });

    const publishable: PublishableIntent[] = [];
    for (const row of rows) {
      if (isIntentKind(row.kind)) {
        publishable.push({ id: row.id, kind: row.kind, correlationId: row.correlationId });
      } else if (await markOutboxDead(db, row.id, 'unknown_kind')) {
        alert({ code: 'intent_dead', intentId: row.id, reason: 'unknown_kind' });
      }
    }
    const { sent, failed } = await publishIntents(env, publishable, alert);
    return failed > 0 ? { count: sent, errorCode: 'publish_failed' } : { count: sent };
  },
};

export function inboxJob(handlers: InboxHandlers = INBOX_HANDLERS): CronJob {
  const providers = Object.keys(handlers) as InboxProvider[];
  return {
    name: 'inbox.process',
    probe: ({ db }) => hasClaimableInbox(db, providers),
    async run({ db, owner, alert }) {
      return { count: await processInbox(db, { handlers, owner, alert }) };
    },
  };
}

const retention = { doneDays: RETENTION_DAYS.done, problemDays: RETENTION_DAYS.problem };

/** Retenção: apaga da outbox e da inbox o que passou do prazo (30 dias concluídos; 180 `failed`/`dead`). */
export const purgeJob: CronJob = {
  name: 'async.purge',
  async probe({ db }) {
    return (
      (await hasPurgeableRows(db, 'outbox_message', retention)) ||
      (await hasPurgeableRows(db, 'inbox_event', retention))
    );
  },
  async run({ db }) {
    return { count: (await purgeOutbox(db)) + (await purgeInbox(db)) };
  },
};

export const CRON_JOBS: readonly CronJob[] = [republishJob, inboxJob(), purgeJob];

export interface CycleSummary {
  ran: number;
  skipped: number;
  failed: number;
}

/**
 * Um ciclo do Cron: para cada job, sonda, assume o lease, roda e registra o resultado em `job_run`.
 * Um job que lança (ou falha em publicar) NÃO impede os demais; sobreposição (lease vivo) pula o job.
 * Só códigos de erro são gravados.
 */
export async function runCycle(
  context: JobContext,
  jobs: readonly CronJob[] = CRON_JOBS,
): Promise<CycleSummary> {
  const summary: CycleSummary = { ran: 0, skipped: 0, failed: 0 };
  for (const job of jobs) {
    try {
      if (job.probe && !(await job.probe(context))) {
        summary.skipped += 1;
        continue;
      }
      const leaseVersion = await acquireJob(context.db, job.name, context.owner);
      if (leaseVersion === undefined) {
        summary.skipped += 1;
        continue;
      }
      let result: JobResult;
      try {
        const outcome = await job.run(context);
        result = outcome.errorCode
          ? { status: 'error', count: outcome.count, errorCode: outcome.errorCode }
          : { status: 'ok', count: outcome.count };
      } catch {
        result = { status: 'error', count: 0, errorCode: 'job_failed' };
      }
      await finishJob(context.db, job.name, leaseVersion, result);
      summary.ran += 1;
      if (result.status === 'error') {
        summary.failed += 1;
        context.alert({ code: 'cron_job_failed', reason: `${job.name}:${result.errorCode}` });
      }
    } catch {
      // Falha ao falar com o banco no meio do job: o lease expira sozinho e o próximo ciclo tenta de novo.
      summary.failed += 1;
      context.alert({ code: 'cron_job_infrastructure_error', reason: job.name });
    }
  }
  return summary;
}

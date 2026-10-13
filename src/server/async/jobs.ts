import type { Database } from '../../db/client';
import { RETENTION_DAYS, isIntentKind } from '../../features/async/intents';
import type { Alert } from './alerts';
import { isQueuePaused } from './flags';
import { processInbox, type InboxHandlers } from './inbox-processor';
import { hasClaimableInbox, purgeInbox, type InboxProvider } from './inbox-store';
import { acquireJob, finishJob, type JobResult } from './job-store';
import { deadLetterExhausted, hasPurgeableRows } from './lease';
import { hasRepublishable, listRepublishable, markOutboxDead, purgeOutbox } from './outbox-store';
import { evaluateAlerts } from '../../features/ops/operations';
import { createR2Storage } from '../media/r2-storage';
import { cleanupMedia, hasMediaWork } from '../media/store';
import { loadOperationsSnapshot } from '../ops/operations-store';
import { publishIntents, type PublishableIntent } from './publisher';

export interface JobContext {
  db: Database;
  env: Pick<Env, 'QUEUE_FINANCE' | 'QUEUE_GENERAL'> &
    Pick<
      Env,
      | 'MEDIA_PRIVATE'
      | 'MEDIA_PUBLIC'
      | 'R2_ACCOUNT_ID'
      | 'R2_ACCESS_KEY_ID'
      | 'R2_SECRET_ACCESS_KEY'
      | 'R2_PRIVATE_BUCKET_NAME'
    >;
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

export function inboxJob(handlers: InboxHandlers): CronJob {
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

/**
 * Avalia o estado e REGISTRA os alertas P0 a P3 (M4-05) no log do Worker (um evento por alerta, só
 * severidade e código, sem dado pessoal). Só lê. Roda por último, depois da republicação e da purga, e como
 * o banco já está acordado pelo ciclo, custa só consultas leves. Enquanto o problema existir o alerta se
 * repete a cada ciclo (30 min): é de propósito, não há estado de "já avisei".
 */
export const alertsJob: CronJob = {
  name: 'ops.alerts',
  async run({ db, alert }) {
    const alerts = evaluateAlerts(await loadOperationsSnapshot(db));
    for (const item of alerts)
      alert({ code: 'ops_alert', reason: `${item.severity}:${item.code}` });
    return { count: alerts.length };
  },
};

/**
 * Limpeza de mídia (M5-07): upload pendente vencido (>24 h), objeto sem referência há mais de 24 h (relendo a
 * contagem sob trava) e a purga dos objetos no R2, fora de transação. Sem R2 configurado a mídia nem existe,
 * então o job não acorda (a sonda devolve falso). Falha do R2 fica para o próximo ciclo.
 */
const mediaCleanupJob: CronJob = {
  name: 'media.cleanup',
  async probe({ db, env }) {
    return createR2Storage(env) !== undefined && (await hasMediaWork(db));
  },
  async run({ db, env }) {
    const storage = createR2Storage(env);
    if (!storage) return { count: 0 };
    const result = await cleanupMedia(db, storage);
    const count = result.expired + result.orphaned + result.purged;
    return result.failed > 0 ? { count, errorCode: 'purge_failed' } : { count };
  },
};

/** Os jobs do Cron, na ordem. M6-04 registra o seu aqui; `handlers` são os dos eventos da inbox. */
export function createCronJobs(handlers: InboxHandlers): readonly CronJob[] {
  return [republishJob, inboxJob(handlers), purgeJob, mediaCleanupJob, alertsJob];
}

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
  jobs: readonly CronJob[],
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

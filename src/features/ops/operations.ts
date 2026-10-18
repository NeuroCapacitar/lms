import { z } from 'zod';

import type { QuotaSummary } from '../email/quota';

/**
 * Operations Center (M4-05), parte pura: o que a tela "Operação" mostra e como o estado vira alerta. Sem
 * SQL nem Hono. NADA aqui carrega payload, e-mail, nome, token ou segredo: só contagens, idades, ids,
 * tipos e códigos de erro.
 */
export type LaneName = 'finance' | 'general';

export interface OutboxCount {
  queue: LaneName;
  state: string;
  count: number;
}

/** Um item que terminou mal (`dead` ou `failed`): sem payload. */
export interface ProblemItem {
  id: string;
  kind: string;
  queue: LaneName;
  state: 'dead' | 'failed';
  attempts: number;
  lastErrorCode: string | null;
  finishedAt: string | null;
  correlationId: string;
}

export interface JobStatus {
  name: string;
  lastStatus: 'ok' | 'error' | null;
  lastCount: number | null;
  lastDurationMs: number | null;
  lastErrorCode: string | null;
  lastFinishedAt: string | null;
  /** O lease do job está vivo agora (uma execução em andamento). */
  running: boolean;
}

export interface ProviderActivity {
  provider: string;
  /** Quando o último evento chegou à inbox (silêncio do webhook). */
  lastReceivedAt: string | null;
  pending: number;
  problems: number;
}

export interface EmailStateCount {
  state: string;
  count: number;
}

export interface OperationsSnapshot {
  outbox: OutboxCount[];
  /** Idade (s) da intenção aberta mais antiga já DISPONÍVEL por fila, ou `null` se não há. */
  oldestOpenAgeSeconds: Record<LaneName, number | null>;
  problems: ProblemItem[];
  inbox: ProviderActivity[];
  jobs: JobStatus[];
  /** Segundos desde o fim do último ciclo do Cron, ou `null` se nunca rodou. */
  cronAgeSeconds: number | null;
  quota: QuotaSummary;
  email: EmailStateCount[];
  suppressedRecipients: number;
  /** E-mails aceitos pelo Resend nas últimas 24 h (para o alerta de silêncio do webhook). */
  emailAcceptedLast24h: number;
  paused: Record<LaneName, boolean>;
  /** Dinheiro (M6-04): pedidos que não andam e revisões que esperam a Staff. Só contagens e idades. */
  finance: FinanceSnapshot;
  /** Certificados em `failed` (a renderização esgotou as tentativas): esperam a Staff reenfileirar (M9-06). */
  certificatesFailed: number;
  /** Tamanho do banco em bytes (`pg_database_size`), para os gatilhos de upgrade do Neon (M9-06). */
  databaseSizeBytes: number | null;
  /** Backups registrados (`backup_run`) e a idade (s) do mais recente pelo relógio do BANCO (M9-05). */
  backup: { count: number; lastAgeSeconds: number | null };
}

interface FinanceSnapshot {
  /** Pedidos `pending` com mais de 30 minutos. */
  pendingOver30Min: number;
  /** Pedidos `pending` com mais de 2 horas (a reconciliação já devia ter fechado). */
  pendingOver2Hours: number;
  openReviews: number;
  /** Idade (s) da revisão aberta mais antiga, ou `null`. */
  oldestOpenReviewAgeSeconds: number | null;
}

type Severity = 'P0' | 'P1' | 'P2' | 'P3';

export interface OpsAlert {
  code: string;
  severity: Severity;
  message: string;
}

/**
 * Limites INICIAIS dos alertas. Não são SLO: são o que o desenho de recuperação já implica, para o alerta
 * só acender quando algo está mesmo preso.
 * - O Cron roda a cada 30 min e republica o esquecido em até 2 ciclos: uma intenção disponível há mais de
 *   60 min é suspeita (P2), e há mais de 180 min é grave (P1).
 * - "Cron sem rodar": 90 min = 3 ciclos perdidos (valor da tarefa).
 * - Silêncio do webhook: o Resend avisa a entrega em segundos; 24 h sem nenhum evento com e-mails aceitos no
 *   período indica endpoint ou segredo quebrado.
 */
export const OPS_THRESHOLDS = {
  oldestOpenWarnSeconds: 60 * 60,
  oldestOpenCriticalSeconds: 180 * 60,
  cronSilenceSeconds: 90 * 60,
  webhookSilenceSeconds: 24 * 60 * 60,
  /** Silêncio do webhook do Asaas COM pedido esperando: o Pix costuma avisar em minutos; 6 h é anormal. */
  asaasSilenceSeconds: 6 * 60 * 60,
  /** Revisão financeira aberta há mais de 24 h sobe de P2 para P1 (é dinheiro de cliente parado). */
  reviewStaleSeconds: 24 * 60 * 60,
  /** Gatilho de upgrade do Neon (spec de segurança e operação, §5): banco acima de 600 MB (limite do Free: 1 GB). */
  databaseUpgradeBytes: 600 * 1024 * 1024,
  /** Backup velho: mais de 26 h (o agendador do GitHub atrasa horas; o RPO de 24 h é a meta, o alerta é para o que NÃO veio). */
  backupStaleSeconds: 26 * 60 * 60,
  /** Perto do limite: 900 MB. Acima disto o banco pode parar de aceitar gravação. */
  databaseCriticalBytes: 900 * 1024 * 1024,
} as const;

const SEVERITY_ORDER: Record<Severity, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

function count(snapshot: OperationsSnapshot, state: string, queue?: LaneName): number {
  return snapshot.outbox
    .filter((row) => row.state === state && (queue === undefined || row.queue === queue))
    .reduce((sum, row) => sum + row.count, 0);
}

/** Converte o estado em alertas, do mais grave ao menos grave. Pura e determinística. */
export function evaluateAlerts(
  snapshot: OperationsSnapshot,
  nowMs: number = Date.now(),
): OpsAlert[] {
  const alerts: OpsAlert[] = [];

  if (snapshot.cronAgeSeconds === null) {
    alerts.push({
      code: 'cron_never_ran',
      severity: 'P2',
      message: 'O Cron de reconciliação ainda não registrou nenhuma execução.',
    });
  } else if (snapshot.cronAgeSeconds > OPS_THRESHOLDS.cronSilenceSeconds) {
    alerts.push({
      code: 'cron_silent',
      severity: 'P1',
      message: 'O Cron de reconciliação não roda há mais de 90 minutos.',
    });
  }
  for (const job of snapshot.jobs) {
    if (job.lastStatus === 'error') {
      alerts.push({
        code: `job_failed:${job.name}`,
        severity: 'P2',
        message: `A última execução do job "${job.name}" terminou com erro (${job.lastErrorCode ?? 'sem código'}).`,
      });
    }
  }

  for (const lane of ['finance', 'general'] as const) {
    const age = snapshot.oldestOpenAgeSeconds[lane];
    if (age !== null && age > OPS_THRESHOLDS.oldestOpenCriticalSeconds) {
      alerts.push({
        code: `queue_stuck:${lane}`,
        severity: 'P1',
        message: `Fila "${lane}" travada: há item aberto há mais de 3 horas.`,
      });
    } else if (age !== null && age > OPS_THRESHOLDS.oldestOpenWarnSeconds) {
      alerts.push({
        code: `queue_slow:${lane}`,
        severity: 'P2',
        message: `Fila "${lane}" atrasada: há item aberto há mais de 1 hora.`,
      });
    }
    const dead = count(snapshot, 'dead', lane);
    if (dead > 0) {
      alerts.push({
        code: `dead_letter:${lane}`,
        // Dinheiro e acesso (finance) sobem de gravidade.
        severity: lane === 'finance' ? 'P1' : 'P2',
        message: `Fila "${lane}": ${dead} item(ns) esgotaram as tentativas (DLQ) e esperam decisão.`,
      });
    }
    if (snapshot.paused[lane]) {
      alerts.push({
        code: `queue_paused:${lane}`,
        severity: 'P2',
        message: `Fila "${lane}" está PAUSADA (kill switch): nada é processado até retomar.`,
      });
    }
  }
  const failed = count(snapshot, 'failed');
  if (failed > 0) {
    alerts.push({
      code: 'failed_items',
      severity: 'P3',
      message: `${failed} item(ns) falharam de forma definitiva e esperam decisão.`,
    });
  }

  if (snapshot.quota.today >= snapshot.quota.dailyLimit) {
    alerts.push({
      code: 'email_quota_exhausted',
      severity: 'P1',
      message:
        'A cota diária de e-mails acabou: o link de acesso pode não chegar até a meia-noite UTC.',
    });
  }
  if (snapshot.quota.upgradeSignal) {
    alerts.push({
      code: 'email_quota_upgrade',
      severity: 'P3',
      message:
        'O uso de e-mail dos últimos 7 dias passou de 60% do que o plano permite: avalie o upgrade.',
    });
  }

  const resend = snapshot.inbox.find((provider) => provider.provider === 'resend');
  const silentFor = resend?.lastReceivedAt
    ? (nowMs - new Date(resend.lastReceivedAt).getTime()) / 1000
    : null;
  if (
    snapshot.emailAcceptedLast24h > 0 &&
    (silentFor === null || silentFor > OPS_THRESHOLDS.webhookSilenceSeconds)
  ) {
    alerts.push({
      code: 'webhook_silent:resend',
      severity: 'P2',
      message:
        'Há e-mails aceitos nas últimas 24 h, mas o webhook do Resend não entregou nenhum evento.',
    });
  }

  const finance = snapshot.finance;
  if (finance.pendingOver2Hours > 0) {
    alerts.push({
      code: 'finance_orders_stuck',
      severity: 'P1',
      message: `${finance.pendingOver2Hours} pedido(s) pendente(s) há mais de 2 horas: a reconciliação não os fechou (Asaas fora do ar ou job parado).`,
    });
  }
  if (finance.openReviews > 0) {
    const stale =
      finance.oldestOpenReviewAgeSeconds !== null &&
      finance.oldestOpenReviewAgeSeconds > OPS_THRESHOLDS.reviewStaleSeconds;
    alerts.push({
      code: 'finance_review_open',
      severity: stale ? 'P1' : 'P2',
      message: `${finance.openReviews} revisão(ões) financeira(s) esperam decisão da Staff${stale ? ' (a mais antiga há mais de 24 h)' : ''}.`,
    });
  }
  const asaas = snapshot.inbox.find((provider) => provider.provider === 'asaas');
  const asaasSilentFor = asaas?.lastReceivedAt
    ? (nowMs - new Date(asaas.lastReceivedAt).getTime()) / 1000
    : null;
  if (
    finance.pendingOver30Min > 0 &&
    (asaasSilentFor === null || asaasSilentFor > OPS_THRESHOLDS.asaasSilenceSeconds)
  ) {
    alerts.push({
      code: 'webhook_silent:asaas',
      severity: 'P3',
      message:
        'Há pedido pendente há mais de 30 minutos e o webhook do Asaas não entrega evento há mais de 6 horas (ou nunca entregou): confira o endpoint e o token.',
    });
  }

  if (snapshot.certificatesFailed > 0) {
    alerts.push({
      code: 'certificate_failed',
      severity: 'P2',
      message: `${snapshot.certificatesFailed} certificado(s) em "failed": a emissão esgotou as tentativas e a pessoa ainda não recebeu o PDF.`,
    });
  }

  if (snapshot.backup.lastAgeSeconds === null) {
    alerts.push({
      code: 'backup_never',
      severity: 'P2',
      message:
        'Nenhum backup do banco foi registrado: o agendamento ainda não rodou ou não está ligado.',
    });
  } else if (snapshot.backup.lastAgeSeconds > OPS_THRESHOLDS.backupStaleSeconds) {
    alerts.push({
      code: 'backup_stale',
      severity: 'P1',
      message: 'O último backup do banco tem mais de 26 horas: confira o workflow de backup.',
    });
  }

  const size = snapshot.databaseSizeBytes;
  if (size !== null && size > OPS_THRESHOLDS.databaseCriticalBytes) {
    alerts.push({
      code: 'database_size_critical',
      severity: 'P1',
      message:
        'O banco passou de 900 MB (limite do plano gratuito do Neon: 1 GB): decida o upgrade já.',
    });
  } else if (size !== null && size > OPS_THRESHOLDS.databaseUpgradeBytes) {
    alerts.push({
      code: 'database_size_upgrade',
      severity: 'P3',
      message:
        'O banco passou de 600 MB: é o gatilho de upgrade do Neon. Reabra a decisão de custo (nunca automática).',
    });
  }

  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

const reason = z.string().trim().min(5).max(500);

/** Reenfileirar um item `dead` ou `failed`: o motivo é obrigatório e vai para a auditoria. */
export const requeueBodySchema = z.strictObject({ reason });

/** Pausar ou retomar uma fila (kill switch): só Admin; o motivo vai para a auditoria. */
export const pauseBodySchema = z.strictObject({ paused: z.boolean(), reason });

import { describe, expect, it } from 'vitest';

import { FREE_PLAN_QUOTA, summarize } from '../email/quota';
import {
  OPS_THRESHOLDS,
  evaluateAlerts,
  pauseBodySchema,
  requeueBodySchema,
  type OperationsSnapshot,
} from './operations';

const NOW = Date.parse('2026-10-13T12:00:00.000Z');

const healthy = (): OperationsSnapshot => ({
  outbox: [{ queue: 'general', state: 'delivered', count: 5 }],
  oldestOpenAgeSeconds: { finance: null, general: null },
  problems: [],
  inbox: [],
  jobs: [],
  cronAgeSeconds: 600,
  quota: summarize(FREE_PLAN_QUOTA, { today: 10, month: 100, last7Days: 50 }),
  email: [],
  suppressedRecipients: 0,
  emailAcceptedLast24h: 0,
  finance: {
    pendingOver30Min: 0,
    pendingOver2Hours: 0,
    openReviews: 0,
    oldestOpenReviewAgeSeconds: null,
  },
  paused: { finance: false, general: false },
  certificatesFailed: 0,
  databaseSizeBytes: 50 * 1024 * 1024,
});

const codes = (snapshot: OperationsSnapshot) =>
  evaluateAlerts(snapshot, NOW).map((alert) => `${alert.severity}:${alert.code}`);

describe('alertas do Operations Center', () => {
  it('estado saudável não gera alerta', () => {
    expect(codes(healthy())).toEqual([]);
  });

  it('Cron nunca rodou (P2), parou há mais de 90 min (P1) e dentro do limite não alerta', () => {
    expect(codes({ ...healthy(), cronAgeSeconds: null })).toEqual(['P2:cron_never_ran']);
    expect(codes({ ...healthy(), cronAgeSeconds: OPS_THRESHOLDS.cronSilenceSeconds })).toEqual([]);
    expect(codes({ ...healthy(), cronAgeSeconds: OPS_THRESHOLDS.cronSilenceSeconds + 1 })).toEqual([
      'P1:cron_silent',
    ]);
  });

  it('job com a última execução em erro (P2), com o código', () => {
    const snapshot = {
      ...healthy(),
      jobs: [
        {
          name: 'outbox.republish',
          lastStatus: 'error' as const,
          lastCount: 0,
          lastDurationMs: 10,
          lastErrorCode: 'publish_failed',
          lastFinishedAt: null,
          running: false,
        },
      ],
    };
    const [alert] = evaluateAlerts(snapshot, NOW);
    expect(alert).toMatchObject({ severity: 'P2', code: 'job_failed:outbox.republish' });
    expect(alert!.message).toContain('publish_failed');
  });

  it('item aberto há mais de 1 h é P2 (atrasada); mais de 3 h é P1 (travada); por fila', () => {
    const slow = { ...healthy(), oldestOpenAgeSeconds: { finance: null, general: 3601 } };
    expect(codes(slow)).toEqual(['P2:queue_slow:general']);
    const stuck = { ...healthy(), oldestOpenAgeSeconds: { finance: 10_801, general: 100 } };
    expect(codes(stuck)).toEqual(['P1:queue_stuck:finance']);
    const edge = { ...healthy(), oldestOpenAgeSeconds: { finance: 3600, general: 10_800 } };
    expect(codes(edge)).toEqual(['P2:queue_slow:general']);
  });

  it('DLQ: dead em finance é P1 e em general é P2; failed é P3; tudo ordenado do mais grave', () => {
    const snapshot = {
      ...healthy(),
      outbox: [
        { queue: 'finance' as const, state: 'dead', count: 1 },
        { queue: 'general' as const, state: 'dead', count: 2 },
        { queue: 'general' as const, state: 'failed', count: 3 },
      ],
    };
    expect(codes(snapshot)).toEqual([
      'P1:dead_letter:finance',
      'P2:dead_letter:general',
      'P3:failed_items',
    ]);
  });

  it('fila pausada (kill switch) é P2 e diz qual', () => {
    expect(codes({ ...healthy(), paused: { finance: false, general: true } })).toEqual([
      'P2:queue_paused:general',
    ]);
  });

  it('cota: dia esgotado é P1 e o sinal de upgrade é P3', () => {
    const exhausted = {
      ...healthy(),
      quota: summarize(FREE_PLAN_QUOTA, { today: 100, month: 100, last7Days: 100 }),
    };
    expect(codes(exhausted)).toEqual(['P1:email_quota_exhausted']);
    const upgrade = {
      ...healthy(),
      quota: summarize(FREE_PLAN_QUOTA, { today: 50, month: 500, last7Days: 420 }),
    };
    expect(codes(upgrade)).toEqual(['P3:email_quota_upgrade']);
  });

  it('silêncio do webhook: só alerta se HÁ e-mail aceito nas últimas 24 h e nenhum evento chegou', () => {
    const accepted = { ...healthy(), emailAcceptedLast24h: 4 };
    expect(codes(accepted)).toEqual(['P2:webhook_silent:resend']);
    const recent = {
      ...accepted,
      inbox: [
        {
          provider: 'resend',
          lastReceivedAt: new Date(NOW - 3600_000).toISOString(),
          pending: 0,
          problems: 0,
        },
      ],
    };
    expect(codes(recent)).toEqual([]);
    const old = {
      ...accepted,
      inbox: [
        {
          provider: 'resend',
          lastReceivedAt: new Date(NOW - 25 * 3600_000).toISOString(),
          pending: 0,
          problems: 0,
        },
      ],
    };
    expect(codes(old)).toEqual(['P2:webhook_silent:resend']);
    expect(codes({ ...healthy(), emailAcceptedLast24h: 0 })).toEqual([]);
  });

  it('os alertas só trazem código, severidade e mensagem (nada de dado pessoal)', () => {
    const [alert] = evaluateAlerts({ ...healthy(), cronAgeSeconds: null }, NOW);
    expect(Object.keys(alert!).sort()).toEqual(['code', 'message', 'severity']);
  });
});

describe('alertas do M9-06: certificado failed e tamanho do banco', () => {
  const MB = 1024 * 1024;

  it('certificado em failed é P2 e diz quantos', () => {
    const snapshot = { ...healthy(), certificatesFailed: 2 };
    expect(codes(snapshot)).toEqual(['P2:certificate_failed']);
    expect(evaluateAlerts(snapshot, NOW)[0]?.message).toContain('2 certificado(s)');
  });

  it('banco: até 600 MB não alerta; acima, P3 (gatilho de upgrade); acima de 900 MB, P1', () => {
    expect(codes({ ...healthy(), databaseSizeBytes: 600 * MB })).toEqual([]);
    expect(codes({ ...healthy(), databaseSizeBytes: 600 * MB + 1 })).toEqual([
      'P3:database_size_upgrade',
    ]);
    expect(codes({ ...healthy(), databaseSizeBytes: 900 * MB })).toEqual([
      'P3:database_size_upgrade',
    ]);
    expect(codes({ ...healthy(), databaseSizeBytes: 900 * MB + 1 })).toEqual([
      'P1:database_size_critical',
    ]);
  });

  it('tamanho desconhecido (null) não alerta', () => {
    expect(codes({ ...healthy(), databaseSizeBytes: null })).toEqual([]);
  });
});

describe('corpos das ações', () => {
  it('o motivo é obrigatório (5 a 500 caracteres) e o corpo é estrito', () => {
    expect(requeueBodySchema.safeParse({ reason: 'provider voltou' }).success).toBe(true);
    expect(requeueBodySchema.safeParse({ reason: 'ok' }).success).toBe(false);
    expect(requeueBodySchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
    expect(requeueBodySchema.safeParse({ reason: 'provider voltou', extra: 1 }).success).toBe(
      false,
    );
    expect(pauseBodySchema.safeParse({ paused: true, reason: 'incidente no Resend' }).success).toBe(
      true,
    );
    expect(
      pauseBodySchema.safeParse({ paused: 'sim', reason: 'incidente no Resend' }).success,
    ).toBe(false);
    expect(pauseBodySchema.safeParse({ paused: true }).success).toBe(false);
  });
});

describe('alertas financeiros (M6-04)', () => {
  const finance = (overrides: Partial<OperationsSnapshot['finance']>) => ({
    ...healthy(),
    finance: { ...healthy().finance, ...overrides },
  });

  it('pedido pendente há mais de 2 horas: P1 (a reconciliação deveria ter fechado)', () => {
    expect(codes(finance({ pendingOver2Hours: 1, pendingOver30Min: 1 }))).toContain(
      'P1:finance_orders_stuck',
    );
  });

  it('revisão aberta: P2; a mais antiga com mais de 24 h sobe para P1', () => {
    expect(codes(finance({ openReviews: 2, oldestOpenReviewAgeSeconds: 3600 }))).toEqual([
      'P2:finance_review_open',
    ]);
    expect(
      codes(
        finance({
          openReviews: 1,
          oldestOpenReviewAgeSeconds: OPS_THRESHOLDS.reviewStaleSeconds + 1,
        }),
      ),
    ).toEqual(['P1:finance_review_open']);
  });

  it('silêncio do webhook do Asaas SÓ alerta com pedido esperando há mais de 30 minutos', () => {
    // sem pedido esperando, o silêncio é normal (poucos alunos)
    expect(codes({ ...healthy(), inbox: [] })).toEqual([]);
    const waiting = finance({ pendingOver30Min: 1 });
    expect(codes(waiting)).toEqual(['P3:webhook_silent:asaas']);
    const recent = {
      ...waiting,
      inbox: [
        {
          provider: 'asaas',
          lastReceivedAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
          pending: 0,
          problems: 0,
        },
      ],
    };
    expect(codes(recent)).toEqual([]);
    const old = {
      ...waiting,
      inbox: [
        {
          provider: 'asaas',
          lastReceivedAt: new Date(
            NOW - (OPS_THRESHOLDS.asaasSilenceSeconds + 60) * 1000,
          ).toISOString(),
          pending: 0,
          problems: 0,
        },
      ],
    };
    expect(codes(old)).toEqual(['P3:webhook_silent:asaas']);
  });
});

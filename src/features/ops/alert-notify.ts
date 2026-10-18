import type { OpsAlert } from './operations';

/**
 * Entrega ativa dos alertas (M9-06, ADR 0033), parte pura. O Cron avalia os alertas a cada 30 min e um problema
 * persistente os repetiria 48 vezes por dia: aqui se decide QUEM merece uma notificação nova. Regras:
 * - alerta que apareceu agora (sem estado): notifica;
 * - alerta que continua ativo: só notifica de novo depois do intervalo da sua severidade;
 * - alerta que sumiu: o estado é apagado, então se voltar notifica na hora.
 * Sem texto livre nem dado pessoal: só código, severidade e instantes.
 */
export interface AlertStateRow {
  code: string;
  lastNotifiedAt: number | null;
}

const HOUR_MS = 60 * 60 * 1000;

/** De quanto em quanto tempo um alerta que PERSISTE é avisado de novo. P3 é informativo: semanal. */
export const RENOTIFY_AFTER_MS: Record<OpsAlert['severity'], number> = {
  P0: 24 * HOUR_MS,
  P1: 24 * HOUR_MS,
  P2: 24 * HOUR_MS,
  P3: 7 * 24 * HOUR_MS,
};

export interface NotificationPlan {
  /** Alertas a enviar agora. */
  notify: OpsAlert[];
  /** Códigos cujo estado deve ser apagado (o alerta sumiu). */
  clear: string[];
}

export function planNotifications(
  active: readonly OpsAlert[],
  states: readonly AlertStateRow[],
  nowMs: number,
): NotificationPlan {
  const byCode = new Map(states.map((state) => [state.code, state]));
  const notify: OpsAlert[] = [];
  for (const alert of active) {
    const state = byCode.get(alert.code);
    if (
      !state ||
      state.lastNotifiedAt === null ||
      nowMs - state.lastNotifiedAt >= RENOTIFY_AFTER_MS[alert.severity]
    )
      notify.push(alert);
  }
  const activeCodes = new Set(active.map((alert) => alert.code));
  return { notify, clear: states.filter((s) => !activeCodes.has(s.code)).map((s) => s.code) };
}

import type { PriorityClass } from './templates';

/**
 * Política da cota do Resend Free (M4-08), sem SQL nem SDK. O plano Free tem 100 e-mails por dia (dia
 * CALENDÁRIO em UTC, zera à meia-noite UTC) e 3.000 por mês, contando enviados e recebidos. O excedente é
 * ADIADO, nunca descartado nem marcado como falha. Mudar o plano ou os limites exige decisão (ADR 0003 e
 * ADR 0018): estes valores não são um ajuste de rotina.
 */
export interface QuotaPolicy {
  dailyLimit: number;
  monthlyLimit: number;
  /**
   * Parte do limite reservada à classe 1 (link de acesso): as demais classes só usam o que SOBRA depois
   * dela. Garante que uma rajada de e-mail de baixa prioridade nunca bloqueie o login.
   */
  loginReserve: number;
}

export const FREE_PLAN_QUOTA: QuotaPolicy = {
  dailyLimit: 100,
  monthlyLimit: 3000,
  loginReserve: 20,
};

export interface QuotaCaps {
  daily: number;
  monthly: number;
}

/** Até onde a classe pode ENCHER o dia e o mês. A classe 1 usa tudo; as outras deixam a reserva do login. */
export function capsFor(policy: QuotaPolicy, priorityClass: PriorityClass): QuotaCaps {
  if (priorityClass === 1) return { daily: policy.dailyLimit, monthly: policy.monthlyLimit };
  const monthlyReserve = Math.floor(
    (policy.monthlyLimit * policy.loginReserve) / policy.dailyLimit,
  );
  return {
    daily: Math.max(0, policy.dailyLimit - policy.loginReserve),
    monthly: Math.max(0, policy.monthlyLimit - monthlyReserve),
  };
}

export interface QuotaSummary {
  /** Reservados ou aceitos hoje (UTC) e no mês (UTC). */
  today: number;
  month: number;
  /** Soma dos últimos 7 dias (incluindo hoje). */
  last7Days: number;
  dailyLimit: number;
  monthlyLimit: number;
  /**
   * Sinal de upgrade (ADR 0018): a soma de 7 dias passou de 60% do que o plano permitiria em 7 dias. A
   * leitura do texto original ("60% da cota mensal em 7 dias" = 1.800) é inatingível no Free (7 × 100 = 700),
   * então o gatilho usa 60% de 7 × o limite diário; a confirmação é do responsável.
   */
  upgradeSignal: boolean;
}

export function summarize(
  policy: QuotaPolicy,
  counts: { today: number; month: number; last7Days: number },
): QuotaSummary {
  return {
    ...counts,
    dailyLimit: policy.dailyLimit,
    monthlyLimit: policy.monthlyLimit,
    upgradeSignal: counts.last7Days >= 0.6 * 7 * policy.dailyLimit,
  };
}

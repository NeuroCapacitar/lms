import { describe, expect, it } from 'vitest';

import { FREE_PLAN_QUOTA, capsFor, summarize } from './quota';

describe('política da cota do Resend Free', () => {
  it('o plano Free é 100 por dia e 3.000 por mês, com reserva para o link de acesso', () => {
    expect(FREE_PLAN_QUOTA).toEqual({ dailyLimit: 100, monthlyLimit: 3000, loginReserve: 20 });
  });

  it('a classe 1 usa tudo; as outras deixam a reserva (no dia e, proporcional, no mês)', () => {
    expect(capsFor(FREE_PLAN_QUOTA, 1)).toEqual({ daily: 100, monthly: 3000 });
    for (const priorityClass of [2, 3, 4, 5] as const) {
      expect(capsFor(FREE_PLAN_QUOTA, priorityClass)).toEqual({ daily: 80, monthly: 2400 });
    }
  });

  it('nunca devolve teto negativo', () => {
    expect(capsFor({ dailyLimit: 10, monthlyLimit: 30, loginReserve: 50 }, 3).daily).toBe(0);
  });

  it('o sinal de upgrade liga a 60% do que o plano permitiria em 7 dias (420 de 700)', () => {
    const counts = { today: 0, month: 0 };
    expect(summarize(FREE_PLAN_QUOTA, { ...counts, last7Days: 419 }).upgradeSignal).toBe(false);
    expect(summarize(FREE_PLAN_QUOTA, { ...counts, last7Days: 420 }).upgradeSignal).toBe(true);
    expect(summarize(FREE_PLAN_QUOTA, { ...counts, last7Days: 700 })).toMatchObject({
      dailyLimit: 100,
      monthlyLimit: 3000,
    });
  });
});

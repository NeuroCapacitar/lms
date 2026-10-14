import { z } from 'zod';

/**
 * Reembolso integral (M6-05), parte PURA. Sempre valor INTEGRAL: nenhum campo de valor existe na API. A Staff cria o
 * pedido de reembolso a pedido da pessoa (que escreveu ao suporte); a política é de 7 dias.
 */
export const REFUND_WINDOW_DAYS = 7;
const SAO_PAULO = 'America/Sao_Paulo';

/** Dia do calendário em São Paulo (`aaaa-mm-dd`) do instante. */
function saoPauloDay(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SAO_PAULO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

function dayNumber(isoDay: string): number {
  const [year, month, day] = isoDay.split('-').map(Number) as [number, number, number];
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/**
 * A janela de 7 dias, contada em DIAS DO CALENDÁRIO de São Paulo a partir do dia da confirmação do pagamento (o dia
 * da confirmação é o dia 0; o dia 7 ainda vale e o dia 8 já não). Termo inicial e contagem são PENDENTES de
 * confirmação do advogado: esta é a regra mais favorável à pessoa que ainda é simples de explicar.
 */
export function refundWindow(confirmedAt: Date, now: Date): 'within' | 'after' {
  const elapsed = dayNumber(saoPauloDay(now)) - dayNumber(saoPauloDay(confirmedAt));
  return elapsed <= REFUND_WINDOW_DAYS ? 'within' : 'after';
}

/** Corpo do pedido de reembolso: SÓ o motivo. Valor, pagamento e pessoa vêm do pedido, no servidor. */
export const requestRefundSchema = z.strictObject({ reason: z.string().trim().min(5).max(500) });

export interface RefundRequestDto {
  id: string;
  orderId: string;
  state: string;
  reason: string;
  courseTitle: string;
  buyerName: string;
  priceCents: number;
  failureCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

export const REFUND_STATE_LABELS: Record<string, string> = {
  requested: 'Pedido registrado',
  submitting: 'Enviando ao Asaas',
  submitted: 'Enviado ao Asaas',
  unknown: 'Resultado incerto (conferindo no Asaas)',
  awaiting_external_authorization: 'Aguardando aprovação no painel do Asaas',
  done: 'Reembolsado',
  failed: 'Falhou',
};

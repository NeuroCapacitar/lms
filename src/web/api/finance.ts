import type {
  FinanceOrderRowDto,
  FinanceOrdersQuery,
  FinanceSummaryDto,
} from '../../features/commerce/finance-view';
import type { RefundRequestDto } from '../../features/commerce/refund';
import type { ReviewDto } from '../../features/commerce/review';
import { postAction } from './action';
import { getJson } from './http';

/**
 * Clientes das revisões financeiras (M6-04). A tela só mostra e envia; quem decide permissão, tipo da revisão,
 * valor observado e a releitura do pagamento é o servidor.
 */
export const fetchReviews = async (state: 'open' | 'resolved') =>
  (await getJson<{ reviews: ReviewDto[] }>(`/api/staff/finance/reviews?state=${state}`)).reviews;

export const resolveReviewRequest = (
  id: string,
  action: 'approve' | 'reconcile' | 'dismiss',
  reason: string,
) => postAction(`/api/staff/finance/reviews/${encodeURIComponent(id)}/resolve`, { action, reason });

export const fetchRefunds = async () =>
  (await getJson<{ refunds: RefundRequestDto[] }>('/api/staff/finance/refunds')).refunds;

/** Reembolso INTEGRAL: o corpo é só o motivo (nenhum campo de valor). */
export const requestRefundRequest = (orderId: string, reason: string) =>
  postAction(`/api/staff/finance/orders/${encodeURIComponent(orderId)}/refund`, { reason });

export interface FinanceOrdersResult {
  orders: FinanceOrderRowDto[];
  summary: FinanceSummaryDto;
  truncated: boolean;
}

export const fetchFinanceOrders = (query: FinanceOrdersQuery) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  return getJson<FinanceOrdersResult>(`/api/staff/finance/orders?${params.toString()}`);
};

/** Revela o CPF/CNPJ completo (reautenticação + auditoria no servidor); a resposta não é guardada em cache. */
export const revealDocument = (paymentId: string) =>
  postAction<{ document: string }>(
    `/api/staff/finance/payments/${encodeURIComponent(paymentId)}/reveal-document`,
    {},
  );

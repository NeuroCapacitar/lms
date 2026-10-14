import type { RefundRequestDto } from '../../features/commerce/refund';
import type { ReviewDto } from '../../features/commerce/review';
import { postAction } from './action';
import { getJson } from './staff';

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

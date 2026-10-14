import type { OrderDto } from '../../features/commerce/commerce';
import { postAction } from './action';

/**
 * Cliente do pedido (M6-07). A página de retorno pede a CONFERÊNCIA e mostra o estado que o servidor devolve; nada aqui
 * informa ao servidor que o pagamento aconteceu nem concede acesso.
 */
export const checkOrder = (orderId: string) =>
  postAction<{ order: OrderDto; limited: boolean }>(
    `/api/me/orders/${encodeURIComponent(orderId)}/check`,
    {},
  );

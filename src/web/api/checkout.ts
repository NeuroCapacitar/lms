import { postAction } from './action';

/**
 * Cliente da compra (M6-02). A tela só pede o checkout de uma oferta e segue para o endereço que o servidor devolveu;
 * preço, parcelas e a decisão de abrir ou não são do servidor. O `attemptId` é gerado aqui e repete com segurança.
 */
export const startCheckoutRequest = (offerId: string, attemptId: string) =>
  postAction<{ orderId: string; checkoutUrl: string; expiresAt: string }>('/api/me/checkout', {
    offerId,
    attemptId,
  });

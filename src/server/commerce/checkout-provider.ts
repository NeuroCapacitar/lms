import type { AsaasCheckoutRequest } from '../../features/commerce/checkout';

/**
 * Porta do provider de checkout (M6-02). A regra de negócio fala só com esta interface; o Asaas de verdade
 * (`asaas-client.ts`) e o dublê dos testes (`fake-checkout.ts`) a implementam. NUNCA é chamada dentro de transação PG.
 */
export interface CheckoutProvider {
  createCheckout(request: AsaasCheckoutRequest): Promise<{ id: string; link: string }>;
}

/** O provider RECUSOU de forma conhecida (4xx, corpo inválido do nosso lado): nada foi criado, pode tentar de novo. */
export class CheckoutRejectedError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`checkout_rejected:${status}:${code}`);
  }
}

/**
 * Resultado AMBÍGUO: timeout, queda de rede, 5xx ou resposta que não dá para entender. O checkout pode ter sido
 * criado do outro lado: a sessão fica `unknown` e NÃO se recria até a janela expirar (M6-04 reconcilia).
 */
export class CheckoutAmbiguousError extends Error {
  constructor(readonly reason: string) {
    super(`checkout_ambiguous:${reason}`);
  }
}

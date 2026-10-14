import type { AsaasCheckoutRequest } from '../../features/commerce/checkout';
import {
  CheckoutAmbiguousError,
  CheckoutRejectedError,
  type CheckoutProvider,
} from './checkout-provider';

/**
 * Dublê do checkout do Asaas, só para testes e desenvolvimento sem conta (M6-02). Guarda os pedidos recebidos para o
 * teste conferir o que SERIA enviado e deixa programar o próximo resultado.
 */
export interface FakeCheckoutProvider extends CheckoutProvider {
  /** Pedidos recebidos, na ordem. */
  readonly requests: AsaasCheckoutRequest[];
  /** Host do link devolvido (padrão: o sandbox). */
  host: string;
  /** O próximo resultado: sucesso (padrão), recusa conhecida, ambíguo ou ambíguo DEPOIS de criar do lado de lá. */
  next: 'ok' | 'reject' | 'ambiguous' | 'ambiguous_after_create';
  /** Espera antes de responder (para corridas). */
  delayMs: number;
  /** Quantos checkouts "existem" do lado do provider. */
  readonly created: { id: string; link: string }[];
}

export function createFakeCheckoutProvider(): FakeCheckoutProvider {
  const provider: FakeCheckoutProvider = {
    requests: [],
    created: [],
    host: 'sandbox.asaas.com',
    next: 'ok',
    delayMs: 0,
    async createCheckout(request) {
      provider.requests.push(structuredClone(request));
      if (provider.delayMs > 0)
        await new Promise((resolve) => setTimeout(resolve, provider.delayMs));
      if (provider.next === 'reject') throw new CheckoutRejectedError(400, 'http_400');
      if (provider.next === 'ambiguous') throw new CheckoutAmbiguousError('timeout');
      const id = crypto.randomUUID();
      const created = { id, link: `https://${provider.host}/checkoutSession/show/${id}` };
      provider.created.push(created);
      if (provider.next === 'ambiguous_after_create') throw new CheckoutAmbiguousError('timeout');
      return created;
    },
  };
  return provider;
}

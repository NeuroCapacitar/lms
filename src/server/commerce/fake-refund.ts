import {
  RefundAmbiguousError,
  RefundRejectedError,
  type RefundAccepted,
  type RefundProvider,
} from './refund-provider';

/**
 * Dublê do reembolso do Asaas (M6-05), só para testes e desenvolvimento sem conta. Guarda o que SERIA enviado e deixa
 * programar o resultado; `after` permite que o teste mude o estado do pagamento no dublê da leitura quando o estorno
 * "acontece" do lado do provider.
 */
export interface FakeRefundProvider extends RefundProvider {
  readonly calls: { paymentId: string; installmentId: string | null }[];
  next:
    | { kind: 'ok'; status: RefundAccepted['status'] }
    | { kind: 'reject'; code: string }
    | { kind: 'ambiguous'; afterAccepting: boolean };
  /** Chamado quando o provider "aceita" (inclusive no ambíguo que aceitou). */
  onAccepted: (target: { paymentId: string; installmentId: string | null }) => void;
  delayMs: number;
}

export function createFakeRefundProvider(): FakeRefundProvider {
  const provider: FakeRefundProvider = {
    calls: [],
    next: { kind: 'ok', status: 'requested' },
    onAccepted: () => undefined,
    delayMs: 0,
    async refund(target) {
      provider.calls.push({ ...target });
      if (provider.delayMs > 0)
        await new Promise((resolve) => setTimeout(resolve, provider.delayMs));
      const next = provider.next;
      if (next.kind === 'reject') throw new RefundRejectedError(400, next.code);
      if (next.kind === 'ambiguous') {
        if (next.afterAccepting) provider.onAccepted(target);
        throw new RefundAmbiguousError('timeout');
      }
      provider.onAccepted(target);
      return { status: next.status };
    },
  };
  return provider;
}

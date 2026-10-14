/**
 * Porta do reembolso no provider (M6-05). SEMPRE integral (não há parâmetro de valor). NUNCA é chamada dentro de
 * transação PG nem repetida às cegas: depois de um resultado ambíguo o executor só RELÊ o pagamento.
 */
export interface RefundProvider {
  /** Reembolsa um pagamento (ou, quando ele é parcela, o parcelamento inteiro). */
  refund(target: { paymentId: string; installmentId: string | null }): Promise<RefundAccepted>;
}

export interface RefundAccepted {
  /** `requested`: o Asaas aceitou e vai processar; `done`: já estornado; `awaiting_authorization`: espera aprovação humana no painel do Asaas. */
  status: 'requested' | 'done' | 'awaiting_authorization';
}

/** O provider RECUSOU de forma conhecida (4xx): nada foi estornado. `code` é o código do erro do Asaas, sem texto livre. */
export class RefundRejectedError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`refund_rejected:${status}:${code}`);
  }
}

/** Resultado ambíguo (timeout, rede, 5xx, resposta ilegível): o estorno PODE ter sido aceito. Nunca reenviar às cegas. */
export class RefundAmbiguousError extends Error {
  constructor(readonly reason: string) {
    super(`refund_ambiguous:${reason}`);
  }
}

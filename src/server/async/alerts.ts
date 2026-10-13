/**
 * Sinal de alerta do assíncrono (M4-02). Um evento por problema que um humano precisa ver: mensagem
 * enviada à DLQ, intenção `dead` ou `failed`, falha inesperada do consumidor. SÓ códigos e IDs: nunca
 * e-mail, nome, token nem a mensagem de um erro (que poderia carregar dado pessoal).
 *
 * Hoje o sinal vai para o log do Worker (Workers Logs). Ligar a um canal ativo (Sentry, Operations
 * Center do M4-09) é trocar ESTE arquivo.
 */
export interface AlertEvent {
  code: string;
  queue?: string;
  intentId?: string;
  correlationId?: string;
  /** Código curto do motivo (ex.: `unknown_kind`, `payload_invalid`). Nunca texto livre de erro. */
  reason?: string;
}

export type Alert = (event: AlertEvent) => void;

export const logAlert: Alert = (event) => {
  console.error(JSON.stringify({ level: 'error', source: 'async', ...event }));
};

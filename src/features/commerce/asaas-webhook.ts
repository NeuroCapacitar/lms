/**
 * Webhook do Asaas (M6-03), parte PURA: reduz o corpo recebido ao MÍNIMO que vai para a inbox. O evento é só uma
 * DICA: o estado do pagamento vem da leitura na API (M6-07), então aqui ficam apenas o tipo do evento e os ids. Nada de
 * nome, CPF, e-mail, telefone, valor nem corpo bruto.
 */

/** O corpo do webhook acima disto é recusado sem ser lido por inteiro. */
export const MAX_ASAAS_WEBHOOK_BYTES = 128 * 1024;

interface AsaasEventPayload {
  /** Tipo do evento (`PAYMENT_RECEIVED`, `CHECKOUT_PAID`...), ou `null` se ausente ou fora do formato. */
  event: string | null;
  /** Id do pagamento no Asaas (`pay_...`). */
  paymentId: string | null;
  /** Id da sessão de checkout (`payment.checkoutSession` ou `checkout.id`): a correlação com o pedido. */
  checkoutSessionId: string | null;
  /** Id do parcelamento (cartão parcelado). */
  installmentId: string | null;
  /** Dica do status do provider; NUNCA autoriza nada. */
  statusHint: string | null;
  /** `true` quando o corpo não era um JSON de objeto (guardado só como evidência, sem conteúdo). */
  malformed: boolean;
}

export interface MinimizedAsaasEvent {
  /** Chave de deduplicação na inbox: o `id` do evento, ou o hash do corpo quando o evento não traz `id`. */
  eventId: string;
  payload: AsaasEventPayload;
}

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const KIND = /^[A-Z][A-Z0-9_]{0,63}$/;
/** O id do EVENTO do Asaas tem a forma `evt_<hex>&<número>`: aceita `&` e poucos separadores, nunca espaço nem aspas. */
const EVENT_ID = /^[A-Za-z0-9_&.:=-]{1,150}$/;

const idOf = (value: unknown): string | null =>
  typeof value === 'string' && ID.test(value) ? value : null;

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * `sha256Hex` entra por parâmetro (o puro não toca em WebCrypto). Corpo ilegível ou sem `id` ainda vira um evento
 * (`noid:<hash do corpo>`): "evento desconhecido também é gravado", e o mesmo corpo repetido não duplica.
 */
export async function minimizeAsaasEvent(
  body: string,
  sha256Hex: (text: string) => Promise<string>,
): Promise<MinimizedAsaasEvent> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = undefined;
  }
  const root = record(parsed);
  if (!root) {
    return {
      eventId: `noid:${await sha256Hex(body)}`,
      payload: {
        event: null,
        paymentId: null,
        checkoutSessionId: null,
        installmentId: null,
        statusHint: null,
        malformed: true,
      },
    };
  }
  const payment = record(root.payment);
  const checkout = record(root.checkout);
  const event = typeof root.event === 'string' && KIND.test(root.event) ? root.event : null;
  const status =
    typeof payment?.status === 'string' && KIND.test(payment.status) ? payment.status : null;
  const eventId =
    typeof root.id === 'string' && EVENT_ID.test(root.id)
      ? root.id
      : `noid:${await sha256Hex(body)}`;
  return {
    eventId,
    payload: {
      event,
      paymentId: idOf(payment?.id),
      checkoutSessionId: idOf(payment?.checkoutSession) ?? idOf(checkout?.id),
      installmentId: idOf(payment?.installment),
      statusHint: status,
      malformed: false,
    },
  };
}

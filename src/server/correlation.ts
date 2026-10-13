/**
 * Id de correlação (M4-05): o `x-request-id` que o Worker GERA no servidor (o do cliente é ignorado, ver
 * `src/server/index.ts`) e devolve na resposta. É o MESMO id do evento de log (evlog), e quem grava uma
 * intenção na outbox o passa como `correlationId`: ele segue HTTP → outbox → envelope da Queue → handler →
 * provider (tag `correlation_id` do Resend, que volta nos eventos do webhook). Só aceita um UUID; qualquer
 * outra coisa vira um novo (nunca grava texto livre de fora).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requestCorrelationId(headers: { get(name: string): string | null }): string {
  const value = headers.get('x-request-id');
  return value && UUID.test(value) ? value : crypto.randomUUID();
}

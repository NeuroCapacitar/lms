/**
 * Porta de saída do e-mail TRANSACIONAL pelo outbox (M4-04). Diferente do `EmailSender` dos hooks do login
 * (link com token, sem rastro), este devolve um RESULTADO tipado, porque o handler precisa distinguir o
 * que repetir, o que esperar e o que desistir. Nunca lança por erro de HTTP e nunca põe destinatário,
 * variável ou resposta do provider no resultado: só a classe da falha e o status.
 */
export interface MailRequest {
  to: string;
  /** Alias (ou id) do modelo PUBLICADO no Resend. */
  templateAlias: string;
  variables: Record<string, string>;
  /** Chave de idempotência do Resend (janela de ~24 h): a mesma chave devolve o mesmo envio. */
  idempotencyKey: string;
  from: string;
  replyTo?: string;
}

type MailFailureKind =
  /** 429: sem folga agora; NÃO é falha da mensagem (o M4-08 reagenda sem gastar tentativa). */
  | 'rate_limited'
  /** 409 de idempotência concorrente: outra requisição com a mesma chave está em andamento. */
  | 'conflict'
  /** 5xx: o provider pode ou não ter aceitado. */
  | 'unavailable'
  /** Sem resposta: o provider pode ou não ter aceitado. */
  | 'timeout'
  /** Outro 4xx: a mensagem foi recusada e repetir não adianta. */
  | 'rejected';

export type MailResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; kind: MailFailureKind; status?: number };

export interface Mailer {
  send(request: MailRequest): Promise<MailResult>;
}

export interface ResendMailerConfig {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Resend por `fetch` (sem SDK, sem React Email). Envia o modelo hospedado e as variáveis, com a chave de
 * idempotência no cabeçalho, e SEM rastreio de abertura ou clique (isso é configuração do domínio no
 * Resend, não do envio). O assunto vem do modelo.
 */
export function createResendMailer(config: ResendMailerConfig): Mailer {
  const doFetch = config.fetchImpl ?? fetch;
  return {
    async send(request) {
      let response: Response;
      try {
        response = await doFetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            'content-type': 'application/json',
            'idempotency-key': request.idempotencyKey,
          },
          body: JSON.stringify({
            from: request.from,
            to: [request.to],
            ...(request.replyTo ? { reply_to: request.replyTo } : {}),
            template: { id: request.templateAlias, variables: request.variables },
          }),
          signal: AbortSignal.timeout(config.timeoutMs ?? 10_000),
        });
      } catch {
        return { ok: false, kind: 'timeout' };
      }
      if (response.ok) {
        let providerMessageId: string | null = null;
        try {
          const body = (await response.json()) as { id?: unknown };
          providerMessageId = typeof body.id === 'string' ? body.id : null;
        } catch {
          // Aceito sem corpo legível: o envio vale; só não há id para correlacionar.
        }
        return { ok: true, providerMessageId };
      }
      const status = response.status;
      if (status === 429) return { ok: false, kind: 'rate_limited', status };
      if (status === 409) return { ok: false, kind: 'conflict', status };
      if (status >= 500) return { ok: false, kind: 'unavailable', status };
      return { ok: false, kind: 'rejected', status };
    },
  };
}

/** Mailer de Development: guarda em memória e avisa SEM o endereço nem as variáveis (só o modelo). */
export interface FakeMailer extends Mailer {
  readonly sent: MailRequest[];
}

export function createFakeMailer(onSend?: (request: MailRequest) => void): FakeMailer {
  const sent: MailRequest[] = [];
  return {
    sent,
    async send(request) {
      sent.push(request);
      onSend?.(request);
      return { ok: true, providerMessageId: `fake-${sent.length}` };
    },
  };
}

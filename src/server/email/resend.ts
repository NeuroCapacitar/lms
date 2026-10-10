import type { EmailMessage, EmailSender } from '../../features/identity/link-policy';

export interface ResendConfig {
  apiKey: string;
  /** Remetente, ex.: `NeuroCapacitar <acesso@dominio>`. Enquanto o domínio não existe, o de teste do Resend. */
  from: string;
  /** ID do modelo HOSPEDADO no Resend (Hosted Templates), por tipo de mensagem. */
  templates: Record<EmailMessage['template'], string>;
  /** Se não vazia, só estes destinatários recebem (Staging). Os demais são descartados em silêncio. */
  allowlist?: readonly string[];
  fetchImpl?: typeof fetch;
}

const SUBJECTS: Record<EmailMessage['template'], string> = {
  'magic-link': 'Seu link de acesso ao NeuroCapacitar',
  'reauth-link': 'Confirme sua identidade no NeuroCapacitar',
  'staff-invitation': 'Você foi convidado para a equipe do NeuroCapacitar',
};

/**
 * Envio pelo Resend (API REST, modelo hospedado). O destinatário e o link nunca entram na mensagem
 * de erro: só o status HTTP. Validado só por mock até existir chave de API; o teste real é o do M4-04.
 */
export function createResendSender(config: ResendConfig): EmailSender {
  const doFetch = config.fetchImpl ?? fetch;
  return {
    async send(message) {
      const allowlist = config.allowlist ?? [];
      if (allowlist.length > 0 && !allowlist.includes(message.to)) {
        return;
      }
      const templateId = config.templates[message.template];
      if (!templateId) throw new Error(`modelo de e-mail "${message.template}" não configurado`);
      const response = await doFetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
          'idempotency-key': message.idempotencyKey,
        },
        body: JSON.stringify({
          from: config.from,
          to: [message.to],
          subject: SUBJECTS[message.template],
          template: { id: templateId, variables: message.variables },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`Resend respondeu HTTP ${response.status}`);
      }
    },
  };
}

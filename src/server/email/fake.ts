import type { EmailMessage, EmailSender } from '../../features/identity/link-policy';

export interface FakeEmailSender extends EmailSender {
  readonly sent: EmailMessage[];
}

/** Sender falso: guarda as mensagens em memória (testes) e, se pedido, chama um observador (dev). */
export function createFakeEmailSender(onSend?: (message: EmailMessage) => void): FakeEmailSender {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
      onSend?.(message);
    },
  };
}

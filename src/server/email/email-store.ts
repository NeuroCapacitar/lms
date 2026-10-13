import { eq } from 'drizzle-orm';

import { emailMessage } from '../../db/schema';
import { OUTBOX_PRIORITY_BY_CLASS, queuedContract } from '../../features/email/templates';
import { enqueueIntent, type DomainTx } from '../async/outbox-store';

/** O template não existe ou é de link direto (com token), que NUNCA passa pela outbox. */
export class TemplateNotQueueableError extends Error {
  constructor() {
    super('template_not_queueable');
  }
}

/** Variável faltando, a mais ou fora do formato do contrato: falha ANTES de gravar e de enviar. */
export class EmailVariablesInvalidError extends Error {
  constructor() {
    super('email_variables_invalid');
  }
}

/** O contrato exige (ou proíbe) o destinatário que foi informado. */
export class EmailRecipientInvalidError extends Error {
  constructor() {
    super('email_recipient_invalid');
  }
}

export interface QueueEmailInput {
  template: string;
  /** Obrigatório nos modelos `user`; proibido no `support_inbox`. É a PESSOA, nunca o endereço. */
  recipientUserId?: string;
  /** Só valores não sensíveis; o formato exato vem do contrato do template. */
  variables: Record<string, string>;
  /** Idempotência do e-mail (ex.: `purchase-confirmed:<orderId>`). Repetir não duplica o envio. */
  dedupeKey: string;
  correlationId: string;
}

export interface QueueEmailResult {
  emailMessageId: string;
  /** `false`: a mesma `dedupeKey` já existia (repetição idempotente). */
  created: boolean;
}

/**
 * Enfileira um e-mail transacional NA transação de domínio (matrícula, pagamento, reembolso, certificado):
 * se a transação der rollback o e-mail some junto; se der commit, o e-mail é durável mesmo que a Queue
 * ou o Resend falhem, e a falha de e-mail NUNCA desfaz o que aconteceu. Valida o contrato antes de gravar.
 */
export async function queueEmail(tx: DomainTx, input: QueueEmailInput): Promise<QueueEmailResult> {
  const contract = queuedContract(input.template);
  if (!contract) throw new TemplateNotQueueableError();
  const variables = contract.variables.safeParse(input.variables);
  if (!variables.success) throw new EmailVariablesInvalidError();
  const wantsUser = contract.recipient === 'user';
  if (wantsUser !== (input.recipientUserId !== undefined)) throw new EmailRecipientInvalidError();

  const inserted = await tx
    .insert(emailMessage)
    .values({
      dedupeKey: input.dedupeKey,
      template: input.template,
      recipientKind: contract.recipient,
      recipientUserId: input.recipientUserId ?? null,
      variables: variables.data,
    })
    .onConflictDoNothing({ target: emailMessage.dedupeKey })
    .returning({ id: emailMessage.id });

  if (!inserted[0]) {
    const [existing] = await tx
      .select({ id: emailMessage.id, template: emailMessage.template })
      .from(emailMessage)
      .where(eq(emailMessage.dedupeKey, input.dedupeKey));
    if (!existing || existing.template !== input.template) {
      throw new EmailVariablesInvalidError();
    }
    return { emailMessageId: existing.id, created: false };
  }

  const emailMessageId = inserted[0].id;
  await enqueueIntent(tx, {
    kind: 'email.send',
    dedupeKey: `email:${input.dedupeKey}`,
    payload: { emailMessageId },
    correlationId: input.correlationId,
    priority: OUTBOX_PRIORITY_BY_CLASS[contract.priorityClass],
  });
  return { emailMessageId, created: true };
}

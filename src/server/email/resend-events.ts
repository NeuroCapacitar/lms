import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '../../db/client';
import { emailMessage, emailRecipientState } from '../../db/schema';
import type { InboxHandler } from '../async/inbox-processor';
import { hashRecipient } from './recipient-hash';

/**
 * Eventos do webhook do Resend (M4-07). O que entra na inbox é MÍNIMO: o tipo, o id do e-mail no Resend, o
 * instante, o tipo do bounce e, SÓ para bounce e reclamação, o hash do destinatário (HMAC, nunca o
 * endereço). Sem corpo, sem assunto e sem destinatário em claro.
 */
export const resendEventPayloadSchema = z.strictObject({
  type: z.string().min(1).max(60),
  emailId: z.string().min(1).max(100),
  occurredAt: z.string().max(40).optional(),
  bounceType: z.enum(['permanent', 'transient', 'undetermined']).optional(),
  recipientHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});

export type ResendEventPayload = z.infer<typeof resendEventPayloadSchema>;

const rawEventSchema = z.object({
  type: z.string().min(1).max(60),
  created_at: z.string().max(40).optional(),
  data: z.object({
    email_id: z.string().min(1).max(100),
    to: z.array(z.string()).optional(),
    bounce: z.object({ type: z.string().optional() }).optional(),
  }),
});

const SUPPRESSION_TYPES = new Set(['email.bounced', 'email.complained']);

/**
 * Reduz o corpo bruto (já AUTENTICADO) ao mínimo. `undefined` = um corpo que não é um evento de e-mail
 * utilizável (JSON inválido ou sem `email_id`): quem chama responde 200 e ignora.
 */
export async function minimizeResendEvent(
  rawBody: string,
  hashKey: string,
): Promise<ResendEventPayload | undefined> {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return undefined;
  }
  const parsed = rawEventSchema.safeParse(json);
  if (!parsed.success) return undefined;
  const { type, created_at: occurredAt, data } = parsed.data;

  const bounce = data.bounce?.type?.toLowerCase();
  const payload: ResendEventPayload = {
    type,
    emailId: data.email_id,
    ...(occurredAt ? { occurredAt } : {}),
    ...(bounce === 'permanent' || bounce === 'transient' || bounce === 'undetermined'
      ? { bounceType: bounce }
      : {}),
  };
  const recipient = data.to?.[0];
  if (SUPPRESSION_TYPES.has(type) && recipient) {
    payload.recipientHash = await hashRecipient(hashKey, recipient);
  }
  return payload;
}

/** Quanto mais alto, mais "final" o estado de entrega. Um evento só avança, nunca recua nem "desfaz". */
const CURRENT_RANK: Record<string, number> = {
  queued: 0,
  sending: 0,
  accepted: 0,
  acceptance_unknown: 0,
  delayed: 1,
  delivered: 2,
  bounced: 3,
  complained: 4,
  // Estados que o PRÓPRIO envio decidiu: nenhum evento os altera.
  failed: 99,
  suppressed: 99,
  blocked: 99,
};

const EVENT_TARGET: Record<string, { state: string; rank: number; errorCode?: string }> = {
  'email.delivery_delayed': { state: 'delayed', rank: 1 },
  'email.delivered': { state: 'delivered', rank: 2 },
  'email.bounced': { state: 'bounced', rank: 3 },
  'email.complained': { state: 'complained', rank: 4 },
  'email.failed': { state: 'failed', rank: 3, errorCode: 'provider_failed' },
  'email.suppressed': { state: 'suppressed', rank: 3 },
};

/**
 * Handler dos eventos do Resend na inbox (job do Cron, M4-03). Reflete a entrega em `email_message`, só
 * para frente (delivered depois de bounced NÃO desfaz), e marca como suprimido o destinatário com bounce
 * PERMANENTE ou reclamação. Bounce e reclamação NÃO alteram User, Enrollment nem Order. Evento sem
 * `email_message` correspondente (ex.: link de acesso, enviado direto) só alimenta a supressão.
 * Idempotente: o mesmo evento aplicado duas vezes dá o mesmo resultado.
 */
export const resendEventHandler: InboxHandler = async ({ db, payload, eventId }) => {
  const parsed = resendEventPayloadSchema.safeParse(payload);
  // Payload que não é nosso formato: nada a fazer e repetir não ajuda.
  if (!parsed.success) return;
  const event = parsed.data;

  const target = EVENT_TARGET[event.type];
  if (target) await advanceState(db, event.emailId, target);

  const hardBounce = event.type === 'email.bounced' && event.bounceType === 'permanent';
  const complaint = event.type === 'email.complained';
  if ((hardBounce || complaint) && event.recipientHash) {
    await db
      .insert(emailRecipientState)
      .values({
        recipientHash: event.recipientHash,
        reason: complaint ? 'complaint' : 'hard_bounce',
        sourceEventId: eventId,
      })
      .onConflictDoNothing({ target: emailRecipientState.recipientHash });
  }
};

async function advanceState(
  db: Database,
  providerMessageId: string,
  target: { state: string; rank: number; errorCode?: string },
) {
  const lower = Object.entries(CURRENT_RANK)
    .filter(([, rank]) => rank < target.rank)
    .map(([state]) => state);
  await db
    .update(emailMessage)
    .set({
      state: target.state,
      updatedAt: sql`now()`,
      ...(target.errorCode ? { lastErrorCode: target.errorCode } : {}),
    })
    .where(
      sql`${emailMessage.providerMessageId} = ${providerMessageId}
          and ${emailMessage.state} in (${sql.join(
            lower.map((state) => sql`${state}`),
            sql`, `,
          )})`,
    );
}

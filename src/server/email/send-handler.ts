import { eq, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { emailMessage, user } from '../../db/schema';
import { queuedContract } from '../../features/email/templates';
import {
  DeferError,
  PermanentError,
  TransientError,
  type HandlerContext,
} from '../async/handler-types';
import type { QuotaGate } from './quota-store';
import type { Mailer } from './mailer';

/** Janela da chave de idempotência do Resend (~24 h), com margem. Fora dela não se repete às cegas. */
const IDEMPOTENCY_WINDOW_HOURS = 23;

export interface EmailHandlerDeps {
  /** Lança se o ambiente não tem Resend configurado (o handler vira `mailer_not_configured`, transitório). */
  getMailer: () => Mailer;
  /** Cota do Resend (M4-08): reserva ANTES de enviar; sem folga a intenção é adiada, nunca falha. */
  quota: QuotaGate;
  /** Remetente padrão (`EMAIL_FROM`); o contrato do template pode sobrepor. */
  from: string;
  /** Origem pública do app (`APP_BASE_URL`), injetada em toda mensagem como `APP_URL`. */
  appUrl: string;
  /** Se não vazia, só estes endereços recebem (Staging); os demais ficam `blocked`. Minúsculos. */
  allowlist: readonly string[];
  /** Caixa de suporte, destino dos modelos `support_inbox` (não é dado de pessoa). */
  supportInbox?: string;
  /** Gancho da supressão por bounce/complaint (M4-07). Verdadeiro = não envia, estado `suppressed`. */
  isSuppressed?: (db: Database, address: string) => Promise<boolean>;
}

const FINAL_STATES = new Set([
  'accepted',
  'delivered',
  'delayed',
  'bounced',
  'complained',
  'failed',
  'suppressed',
  'blocked',
]);

async function setState(
  db: Database,
  id: string,
  state: string,
  extra: { errorCode?: string | null; providerMessageId?: string; accepted?: boolean } = {},
) {
  await db
    .update(emailMessage)
    .set({
      state,
      updatedAt: sql`now()`,
      ...(extra.errorCode !== undefined ? { lastErrorCode: extra.errorCode } : {}),
      ...(extra.providerMessageId ? { providerMessageId: extra.providerMessageId } : {}),
      ...(extra.accepted ? { acceptedAt: sql`now()` } : {}),
    })
    .where(eq(emailMessage.id, id));
}

/**
 * Handler do `email.send` (M4-04). Reivindicado pelo consumidor com fencing; ESTE código só decide o envio.
 * Regras: nenhuma chamada ao Resend dentro de transação; o destinatário vem da conta só agora e nunca é
 * gravado nem logado; a mesma chave de idempotência (a `dedupeKey` da intenção) vale em toda repetição;
 * 429 e 5xx NUNCA marcam falha definitiva; timeout/5xx deixam `acceptance_unknown` e só se repete com a
 * mesma chave dentro da janela.
 */
export function createEmailHandler(deps: EmailHandlerDeps) {
  return async (context: HandlerContext<'email.send'>): Promise<void> => {
    const { db, payload, idempotencyKey } = context;
    const [message] = await db
      .select({
        id: emailMessage.id,
        template: emailMessage.template,
        recipientKind: emailMessage.recipientKind,
        recipientUserId: emailMessage.recipientUserId,
        variables: emailMessage.variables,
        state: emailMessage.state,
        quotaReservedDay: emailMessage.quotaReservedDay,
        windowExpired: sql<boolean>`${emailMessage.firstAttemptAt} is not null and ${emailMessage.firstAttemptAt} < now() - make_interval(hours => ${IDEMPOTENCY_WINDOW_HOURS})`,
      })
      .from(emailMessage)
      .where(eq(emailMessage.id, payload.emailMessageId));
    if (!message) throw new PermanentError('email_message_missing');
    // Entrega repetida da mesma intenção depois de concluída: nada a fazer.
    if (FINAL_STATES.has(message.state)) return;

    const contract = queuedContract(message.template);
    if (!contract) throw new PermanentError('template_unknown');
    const variables = contract.variables.safeParse(message.variables);
    if (!variables.success) {
      await setState(db, message.id, 'failed', { errorCode: 'variables_invalid' });
      throw new PermanentError('variables_invalid');
    }

    // Quem recebe: lido agora da conta (nunca guardado no e-mail nem na outbox).
    let address: string;
    let name: string | undefined;
    if (message.recipientKind === 'user') {
      const [account] = message.recipientUserId
        ? await db
            .select({ email: user.email, name: user.name })
            .from(user)
            .where(eq(user.id, message.recipientUserId))
        : [];
      if (!account) {
        await setState(db, message.id, 'failed', { errorCode: 'recipient_missing' });
        throw new PermanentError('recipient_missing');
      }
      address = account.email.toLowerCase();
      name = account.name;
    } else {
      if (!deps.supportInbox) {
        await setState(db, message.id, 'failed', { errorCode: 'recipient_unconfigured' });
        throw new PermanentError('recipient_unconfigured');
      }
      address = deps.supportInbox.toLowerCase();
    }

    if (deps.allowlist.length > 0 && !deps.allowlist.includes(address)) {
      await setState(db, message.id, 'blocked');
      return;
    }
    if (deps.isSuppressed && (await deps.isSuppressed(db, address))) {
      await setState(db, message.id, 'suppressed');
      return;
    }
    // Já houve tentativa que pode ter sido aceita (`sending` = o processo caiu no meio) e a janela da
    // chave passou: não repete às cegas.
    if (
      (message.state === 'acceptance_unknown' || message.state === 'sending') &&
      message.windowExpired
    ) {
      await setState(db, message.id, 'failed', { errorCode: 'idempotency_window_expired' });
      throw new PermanentError('idempotency_window_expired');
    }

    let mailer: Mailer;
    try {
      mailer = deps.getMailer();
    } catch {
      throw new TransientError('mailer_not_configured');
    }

    // Cota (M4-08): reserva UMA vez por mensagem (a repetição com a mesma chave não conta de novo).
    let reservedDay = message.quotaReservedDay;
    if (!reservedDay) {
      const reservation = await deps.quota.reserve(db, contract.priorityClass);
      if (!reservation.ok) {
        // Sem folga PARA ESTA CLASSE: não é falha. Volta para a próxima janela, sem gastar tentativa.
        await setState(db, message.id, 'queued', { errorCode: `quota_${reservation.reason}` });
        throw new DeferError(`quota_${reservation.reason}`, reservation.retryAfterSeconds);
      }
      reservedDay = reservation.day;
      await db
        .update(emailMessage)
        .set({ quotaReservedDay: reservedDay })
        .where(eq(emailMessage.id, message.id));
    }
    const giveBackQuota = async () => {
      await deps.quota.release(db, reservedDay);
      await db
        .update(emailMessage)
        .set({ quotaReservedDay: null })
        .where(eq(emailMessage.id, message.id));
    };

    await db
      .update(emailMessage)
      .set({
        state: 'sending',
        firstAttemptAt: sql`coalesce(${emailMessage.firstAttemptAt}, now())`,
        updatedAt: sql`now()`,
      })
      .where(eq(emailMessage.id, message.id));

    const result = await mailer.send({
      to: address,
      templateAlias: contract.alias,
      variables: {
        ...variables.data,
        ...(contract.usesName && name ? { NAME: name } : {}),
        APP_URL: deps.appUrl,
      },
      idempotencyKey,
      from: contract.from ?? deps.from,
      replyTo: contract.replyTo,
    });

    if (result.ok) {
      await setState(db, message.id, 'accepted', {
        providerMessageId: result.providerMessageId ?? undefined,
        accepted: true,
        errorCode: null,
      });
      return;
    }
    if (result.kind === 'rejected') {
      const code = `provider_${result.status ?? 'rejected'}`;
      await giveBackQuota();
      await setState(db, message.id, 'failed', { errorCode: code });
      throw new PermanentError(code);
    }
    if (result.kind === 'rate_limited') {
      // 429: NADA foi aceito, então a vaga volta e a intenção é ADIADA (não é falha, não gasta tentativa).
      await giveBackQuota();
      if (result.quota) {
        // Cota do dia ou do mês acabou no Resend: o nosso livro-razão estava abaixo do real.
        if (result.quota === 'daily') await deps.quota.markDayExhausted(db);
        await setState(db, message.id, 'queued', { errorCode: `provider_quota_${result.quota}` });
        throw new DeferError(
          `provider_quota_${result.quota}`,
          await deps.quota.retryAfter(db, result.quota),
        );
      }
      await setState(db, message.id, 'queued', { errorCode: 'provider_429' });
      throw new DeferError('provider_429', 60);
    }
    if (result.kind === 'conflict') {
      // Envio concorrente com a mesma chave: pode ter sido aceito; a vaga fica reservada.
      await setState(db, message.id, 'queued', { errorCode: `provider_${result.status}` });
      throw new TransientError(`provider_${result.status}`);
    }
    // 5xx ou sem resposta: pode ter sido aceito. Repetir SÓ com a mesma chave, dentro da janela.
    const code = result.kind === 'timeout' ? 'provider_timeout' : `provider_${result.status}`;
    await setState(db, message.id, 'acceptance_unknown', { errorCode: code });
    throw new TransientError(code);
  };
}

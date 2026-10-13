import { eq, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { emailMessage, user } from '../../db/schema';
import { queuedContract } from '../../features/email/templates';
import { PermanentError, TransientError, type HandlerContext } from '../async/handler-types';
import type { Mailer } from './mailer';

/** Janela da chave de idempotência do Resend (~24 h), com margem. Fora dela não se repete às cegas. */
const IDEMPOTENCY_WINDOW_HOURS = 23;

export interface EmailHandlerDeps {
  /** Lança se o ambiente não tem Resend configurado (o handler vira `mailer_not_configured`, transitório). */
  getMailer: () => Mailer;
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
      await setState(db, message.id, 'failed', { errorCode: code });
      throw new PermanentError(code);
    }
    if (result.kind === 'rate_limited' || result.kind === 'conflict') {
      // Sem folga ou envio concorrente com a mesma chave: nada foi aceito por esta chamada.
      await setState(db, message.id, 'queued', { errorCode: `provider_${result.status}` });
      throw new TransientError(`provider_${result.status}`);
    }
    // 5xx ou sem resposta: pode ter sido aceito. Repetir SÓ com a mesma chave, dentro da janela.
    const code = result.kind === 'timeout' ? 'provider_timeout' : `provider_${result.status}`;
    await setState(db, message.id, 'acceptance_unknown', { errorCode: code });
    throw new TransientError(code);
  };
}

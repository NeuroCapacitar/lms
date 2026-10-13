import type { EmailSender } from '../../features/identity/link-policy';
import { createFakeEmailSender } from './fake';
import { eq } from 'drizzle-orm';

import { emailRecipientState } from '../../db/schema';
import { createFakeMailer, createResendMailer, type Mailer } from './mailer';
import { hashRecipient } from './recipient-hash';
import { createResendSender } from './resend';
import type { EmailHandlerDeps } from './send-handler';

/**
 * Escolhe o envio pelo ambiente. Com `RESEND_API_KEY`, Resend. Sem ela, o falso SÓ em
 * Development (origem localhost): em Staging e Production a falta da chave é erro, nunca um
 * "envio" que não envia.
 */
export function createEmailSender(env: Env): EmailSender {
  if (env.RESEND_API_KEY) {
    // As variáveis do `wrangler types` têm tipo literal (por ambiente); aqui são só texto.
    const allowlist = env.EMAIL_ALLOWLIST ?? '';
    const magicLinkTemplate: string = env.RESEND_TEMPLATE_MAGIC_LINK;
    const reauthTemplate: string = env.RESEND_TEMPLATE_REAUTH_LINK;
    const invitationTemplate: string = env.RESEND_TEMPLATE_STAFF_INVITATION;
    return createResendSender({
      apiKey: env.RESEND_API_KEY,
      from: env.EMAIL_FROM,
      templates: {
        'magic-link': magicLinkTemplate,
        'reauth-link': reauthTemplate,
        'staff-invitation': invitationTemplate,
      },
      allowlist: allowlist
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    });
  }
  const isDevelopment = new URL(env.APP_BASE_URL).hostname === 'localhost';
  if (isDevelopment) {
    // Dev: o link aparece no terminal do desenvolvedor (nunca em ambiente publicado).
    return createFakeEmailSender((message) => {
      console.warn(`[dev] e-mail para ${message.to}: ${message.variables.LINK_URL}`);
    });
  }
  return {
    async send() {
      throw new Error('RESEND_API_KEY ausente: envio de e-mail não configurado neste ambiente');
    },
  };
}

/**
 * Mailer do e-mail TRANSACIONAL pelo outbox (M4-04). Com `RESEND_API_KEY`, Resend. Sem ela, o falso SÓ em
 * Development (origem localhost); em Staging e Production a falta da chave lança (o handler a trata como
 * `mailer_not_configured`, que tenta de novo depois de corrigido, e nunca finge que enviou).
 */
function createMailer(env: Env): Mailer {
  if (env.RESEND_API_KEY) return createResendMailer({ apiKey: env.RESEND_API_KEY });
  if (new URL(env.APP_BASE_URL).hostname === 'localhost') {
    // Dev: avisa SEM o endereço nem as variáveis (só o modelo).
    return createFakeMailer((request) => {
      console.warn(`[dev] e-mail transacional "${request.templateAlias}" simulado`);
    });
  }
  throw new Error('RESEND_API_KEY ausente: envio de e-mail não configurado neste ambiente');
}

/** Dependências do handler `email.send` a partir do ambiente do Worker. */
export function emailHandlerDeps(env: Env): EmailHandlerDeps {
  let mailer: Mailer | undefined;
  return {
    // Criado sob demanda: um lote sem e-mail não depende da chave do Resend.
    getMailer: () => (mailer ??= createMailer(env)),
    from: env.EMAIL_FROM,
    appUrl: env.APP_BASE_URL,
    allowlist: (env.EMAIL_ALLOWLIST ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
    supportInbox: env.SUPPORT_INBOX_EMAIL,
    // Supressão por bounce permanente ou reclamação (M4-07). Sem a chave do HMAC não há como consultar.
    isSuppressed: env.EMAIL_HASH_KEY
      ? async (db, address) => {
          const hash = await hashRecipient(env.EMAIL_HASH_KEY ?? '', address);
          const [found] = await db
            .select({ hash: emailRecipientState.recipientHash })
            .from(emailRecipientState)
            .where(eq(emailRecipientState.recipientHash, hash));
          return found !== undefined;
        }
      : undefined,
  };
}

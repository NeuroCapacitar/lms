import type { EmailSender } from '../../features/identity/link-policy';
import { createFakeEmailSender } from './fake';
import { createResendSender } from './resend';

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

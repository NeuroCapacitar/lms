import { Hono } from 'hono';

import { withDatabase } from '../../db/client';
import type { LogVariables } from '../logging';
import { recordInboxEvent } from '../async/inbox-store';
import { requestCorrelationId } from '../correlation';
import { minimizeResendEvent } from '../email/resend-events';
import { verifySvixSignature } from '../email/svix';

/** O Resend manda eventos pequenos; acima disto o corpo é recusado SEM ser lido por inteiro. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * `POST /api/webhooks/resend` (M4-07). Ordem que importa: (1) lê o corpo BRUTO; (2) verifica a assinatura
 * Svix ANTES de qualquer outra coisa (inválida: 400 e nada é gravado); (3) reduz o evento ao mínimo
 * (sem corpo e sem destinatário em claro); (4) persiste na inbox, deduplicado por `svix-id`; (5) responde
 * 200. O processamento é assíncrono (inbox pelo Cron). Se a inbox não conseguir gravar, responde 5xx para o
 * Resend reenviar. Não passa pelo CSRF (autentica por assinatura, não por cookie).
 */
export function resendWebhookRoutes() {
  const routes = new Hono<{ Bindings: Env } & LogVariables>();

  routes.post('/resend', async (c) => {
    const secret = c.env.RESEND_WEBHOOK_SECRET;
    const hashKey = c.env.EMAIL_HASH_KEY;
    // Fail closed: sem os segredos nada é aceito (e o Resend reenvia quando forem configurados).
    if (!secret || !hashKey) return c.json({ error: { code: 'webhook_not_configured' } }, 500);

    const declared = Number(c.req.header('content-length') ?? 0);
    if (declared > MAX_BODY_BYTES) return c.json({ error: { code: 'payload_too_large' } }, 413);
    const body = await c.req.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
      return c.json({ error: { code: 'payload_too_large' } }, 413);
    }

    const svixId = c.req.header('svix-id');
    const valid = await verifySvixSignature({
      secret,
      id: svixId,
      timestamp: c.req.header('svix-timestamp'),
      signature: c.req.header('svix-signature'),
      body,
    });
    if (!valid || !svixId) return c.json({ error: { code: 'invalid_signature' } }, 400);

    const payload = await minimizeResendEvent(body, hashKey);
    // Assinado, mas não é um evento de e-mail utilizável: confirma e ignora (repetir não adiantaria).
    if (!payload) return c.json({ ok: true }, 200);

    try {
      await withDatabase(c.env.HYPERDRIVE, (db) =>
        recordInboxEvent(db, {
          provider: 'resend',
          eventId: svixId,
          payload,
          correlationId: requestCorrelationId(c.req.raw.headers),
        }),
      );
    } catch (error) {
      c.get('log')?.error(error instanceof Error ? error : new Error('inbox_record_failed'));
      return c.json({ error: { code: 'inbox_unavailable' } }, 500);
    }
    return c.json({ ok: true }, 200);
  });

  return routes;
}

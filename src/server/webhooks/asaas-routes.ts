import { Hono } from 'hono';

import { withDatabase } from '../../db/client';
import { MAX_ASAAS_WEBHOOK_BYTES, minimizeAsaasEvent } from '../../features/commerce/asaas-webhook';
import { recordInboxEvent } from '../async/inbox-store';
import { requestCorrelationId } from '../correlation';
import type { LogVariables } from '../logging';
import { constantTimeEqual, sha256Hex } from '../security/constant-time';

/** Token curto demais não autentica nada: o Asaas exige 32 a 255 caracteres. */
const MIN_TOKEN_LENGTH = 32;

/**
 * `POST /api/webhooks/asaas` (M6-03). Ordem que importa: (1) autentica pelo cabeçalho `asaas-access-token` em tempo
 * constante ANTES de ler o corpo; (2) token ausente ou errado: NÃO grava nada e responde 200 (decisão do registro:
 * não pausar a fila do Asaas nem revelar a validade do token), deixando só uma contagem no log; (3) lê o corpo com
 * limite de tamanho; (4) reduz o evento aos ids (sem PII e sem valor); (5) grava na inbox, deduplicado por `event.id`,
 * ANTES de responder; (6) responde HTTP 200 explícito (nunca 201/204), inclusive duplicata e evento desconhecido. A
 * ÚNICA exceção é a inbox indisponível: 500 para o Asaas reenviar. Nenhuma regra de negócio roda aqui: a leitura do
 * pagamento e a liberação do acesso são do M6-07, pela inbox. Fora do CSRF (autentica por token, não por cookie).
 */
export function asaasWebhookRoutes() {
  const routes = new Hono<{ Bindings: Env } & LogVariables>();

  routes.post('/asaas', async (c) => {
    const secret = c.env.ASAAS_WEBHOOK_TOKEN;
    // Fail closed: sem o segredo nada é aceito e o Asaas reenvia quando ele for configurado.
    if (!secret || secret.length < MIN_TOKEN_LENGTH) {
      return c.json({ error: { code: 'webhook_not_configured' } }, 500);
    }

    const presented = c.req.header('asaas-access-token');
    if (!presented || !(await constantTimeEqual(presented, secret))) {
      c.get('log')?.warn('asaas_webhook_unauthorized');
      return c.json({ ok: true }, 200);
    }

    const declared = Number(c.req.header('content-length') ?? 0);
    if (declared > MAX_ASAAS_WEBHOOK_BYTES) {
      c.get('log')?.warn('asaas_webhook_too_large');
      return c.json({ error: { code: 'payload_too_large' } }, 413);
    }
    const body = await c.req.text();
    if (new TextEncoder().encode(body).byteLength > MAX_ASAAS_WEBHOOK_BYTES) {
      c.get('log')?.warn('asaas_webhook_too_large');
      return c.json({ error: { code: 'payload_too_large' } }, 413);
    }

    const { eventId, payload } = await minimizeAsaasEvent(body, sha256Hex);
    try {
      await withDatabase(c.env.HYPERDRIVE, (db) =>
        recordInboxEvent(db, {
          provider: 'asaas',
          eventId,
          payload: { ...payload },
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

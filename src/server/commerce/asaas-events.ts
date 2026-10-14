import { z } from 'zod';

import type { Database } from '../../db/client';
import type { ProviderPayment } from '../../features/commerce/payment-evidence';
import { PermanentError, TransientError } from '../async/handler-types';
import type { InboxHandler } from '../async/inbox-processor';
import { applyPaymentEvidence } from './payment-evidence-store';
import {
  PaymentReadPermanentError,
  PaymentReadTransientError,
  type PaymentReader,
} from './payment-reader';

/** O que o webhook (M6-03) guardou na inbox: só tipo e ids. */
const payloadSchema = z.object({
  event: z.string().nullable(),
  paymentId: z.string().nullable(),
  checkoutSessionId: z.string().nullable(),
});

/**
 * Handler dos eventos do Asaas na inbox (M6-07), executado pelo Cron. O evento é só uma DICA: relê o pagamento na API
 * e aplica o MESMO caso de uso do retorno e do reconciliador. Falha de leitura (429, 5xx, rede) é transitória e volta
 * com atraso; recusa definitiva (401, 403) é permanente e vai para `failed` com alerta. `CHECKOUT_PAID` (sem pagamento
 * no corpo) só dispara a consulta da sessão: NUNCA libera nada por si. Evento sem id utilizável não faz nada.
 */
export function createAsaasEventHandler(deps: {
  reader: PaymentReader;
  now?: () => Date;
  afterGrant?: (db: Database, read: ProviderPayment) => Promise<void>;
}): InboxHandler {
  return async ({ db, payload }) => {
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) return;
    const { event, paymentId, checkoutSessionId } = parsed.data;
    try {
      if (paymentId) {
        const result = await applyPaymentEvidence(db, deps, {
          paymentId,
          eventHint: event,
          source: 'webhook',
        });
        // O Asaas ainda não mostra o pagamento que ele mesmo avisou (consistência eventual): tenta de novo.
        if (result.outcome === 'not_found') throw new TransientError('payment_not_visible');
        return;
      }
      if (checkoutSessionId) {
        const ids = await deps.reader.listPaymentIds(checkoutSessionId);
        if (ids.length === 0) throw new TransientError('payment_not_visible');
        for (const id of ids) {
          await applyPaymentEvidence(db, deps, {
            paymentId: id,
            eventHint: event,
            source: 'webhook',
          });
        }
      }
    } catch (error) {
      if (error instanceof PaymentReadTransientError) throw new TransientError(error.reason);
      if (error instanceof PaymentReadPermanentError) throw new PermanentError(error.reason);
      throw error;
    }
  };
}

import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import { financeOrdersQuerySchema } from '../../features/commerce/finance-view';
import { requestRefundSchema } from '../../features/commerce/refund';
import { resolveReviewSchema } from '../../features/commerce/review';
import { requireCapability } from '../auth/authorization';
import { requireRecentAuth } from '../auth/reauth';
import { publishAfterCommit } from '../async/publisher';
import type { AuthVars } from '../auth/types';
import { paymentReaderFor, refundProviderFor } from './factory';
import { listFinanceOrders } from './finance-view-store';
import { DocumentVaultUnavailableError, NoDocumentError, revealPayerDocument } from './payer-store';
import {
  PaymentReadPermanentError,
  PaymentReadTransientError,
  type PaymentReader,
} from './payment-reader';
import {
  OrderNotRefundableError,
  RefundAlreadyActiveError,
  RefundOrderNotFoundError,
  RefundWindowClosedError,
  listRefunds,
  requestRefund,
} from './refund-store';
import type { RefundProvider } from './refund-provider';
import {
  OtherOpenReviewsError,
  ReviewActionNotAllowedError,
  ReviewAlreadyResolvedError,
  ReviewNotFoundError,
  ReviewNotReconcilableError,
  ReviewStaleError,
  ReviewStillDivergentError,
  listReviews,
  resolveReview,
} from './review-store';

type FinanceContext = Context<{ Bindings: Env; Variables: AuthVars }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failure(c: FinanceContext, error: unknown): Response {
  const conflict = (code: string) => c.json({ error: { code } }, 409);
  if (error instanceof ReviewNotFoundError) return c.json({ error: { code: 'not_found' } }, 404);
  if (error instanceof ReviewAlreadyResolvedError) return conflict('already_resolved');
  if (error instanceof ReviewActionNotAllowedError) return conflict('action_not_allowed');
  if (error instanceof ReviewNotReconcilableError) return conflict('not_reconcilable');
  if (error instanceof ReviewStaleError) return conflict('stale');
  if (error instanceof OtherOpenReviewsError) return conflict('other_open_reviews');
  if (error instanceof ReviewStillDivergentError) return conflict('still_divergent');
  if (error instanceof NoDocumentError) return c.json({ error: { code: 'not_found' } }, 404);
  if (error instanceof DocumentVaultUnavailableError) {
    return c.json({ error: { code: 'document_vault_unavailable' } }, 503);
  }
  if (error instanceof RefundOrderNotFoundError)
    return c.json({ error: { code: 'not_found' } }, 404);
  if (error instanceof OrderNotRefundableError) return conflict('order_not_refundable');
  if (error instanceof RefundAlreadyActiveError) return conflict('refund_already_active');
  if (error instanceof RefundWindowClosedError) {
    return c.json({ error: { code: 'refund_window_closed' } }, 403);
  }
  if (error instanceof PaymentReadTransientError) {
    return c.json({ error: { code: 'payment_provider_unavailable' } }, 503);
  }
  if (error instanceof PaymentReadPermanentError) {
    return c.json({ error: { code: 'payment_provider_error' } }, 502);
  }
  throw error;
}

/**
 * Revisões financeiras da Staff (M6-04), sob `/api/staff/finance`. Tudo exige o grant `finance.review` (o Suporte sem
 * o grant recebe 403 direto pela API). Resolver exige motivo e é auditado; só `amount_mismatch` admite aprovar.
 */
export function financeStaffRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
  reader?: (c: FinanceContext) => PaymentReader | undefined;
  /** Provider de reembolso (dublê nos testes; em produção vem de `ASAAS_API_KEY`). */
  refundProvider?: (c: FinanceContext) => RefundProvider | undefined;
  /** Relógio (só nos testes): o instante da concessão ao aprovar ou reconciliar. */
  clock?: () => Date;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();
  const guarded = [deps.withDatabase, requireCapability('finance.review')] as const;

  routes.get('/finance/reviews', ...guarded, async (c) => {
    c.header('Cache-Control', 'no-store');
    const state = c.req.query('state');
    return c.json({
      reviews: await listReviews(c.var.db, state === 'resolved' ? { state } : { state: 'open' }),
    });
  });

  routes.post('/finance/reviews/:id/resolve', ...guarded, async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ error: { code: 'not_found' } }, 404);
    const parsed = resolveReviewSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    const reader = (deps.reader ?? ((context) => paymentReaderFor(context.env)))(c);
    // Dispensar não lê o provider; aprovar e reconciliar precisam dele.
    if (!reader && parsed.data.action !== 'dismiss') {
      return c.json({ error: { code: 'checkout_not_configured' } }, 503);
    }
    const actorId = c.var.access!.userId;
    try {
      await resolveReview(
        c.var.db,
        { reader: reader ?? unavailableReader, ...(deps.clock ? { now: deps.clock } : {}) },
        { reviewId: id, actorId, ...parsed.data },
      );
      return c.json({ resolved: true });
    } catch (error) {
      return failure(c, error);
    }
  });

  /**
   * Pedido de reembolso INTEGRAL (M6-05): grant `refund.execute` + reautenticação recente + motivo. O corpo é só o motivo
   * (nenhum campo de valor). Dentro dos 7 dias qualquer Suporte com o grant; depois, só o Admin (403 para os demais).
   * Suspende o acesso ao pedir; o executor roda na fila `finance`.
   */
  routes.post(
    '/finance/orders/:id/refund',
    deps.withDatabase,
    requireCapability('refund.execute'),
    requireRecentAuth(),
    async (c) => {
      const id = c.req.param('id');
      if (!UUID.test(id)) return c.json({ error: { code: 'not_found' } }, 404);
      const parsed = requestRefundSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
      const provider = (deps.refundProvider ?? ((context) => refundProviderFor(context.env)))(c);
      if (!provider) return c.json({ error: { code: 'checkout_not_configured' } }, 503);
      const access = c.var.access!;
      try {
        const created = await requestRefund(c.var.db, {
          orderId: id,
          actorId: access.userId,
          actorIsAdmin: access.roles.has('admin'),
          reason: parsed.data.reason,
          ...(deps.clock ? { now: deps.clock() } : {}),
        });
        // Acelera pela fila (melhor esforço): o Cron republica se a mensagem se perder.
        try {
          if (c.env.QUEUE_FINANCE) {
            publishAfterCommit(c.env, c.executionCtx, [
              { id: created.intentId, kind: 'finance.refund', correlationId: created.id },
            ]);
          }
        } catch {
          // sem contexto de execução (teste) ou fila indisponível: o Cron cobre
        }
        return c.json({ id: created.id }, 201);
      } catch (error) {
        return failure(c, error);
      }
    },
  );

  /**
   * Pedidos e pagamentos (M6-08), grant `finance.view`: filtros por período, curso e estado, totais do mesmo filtro e o
   * pagador com o CPF/CNPJ MASCARADO. Sem o grant, 403 direto pela API.
   */
  routes.get('/finance/orders', deps.withDatabase, requireCapability('finance.view'), async (c) => {
    const parsed = financeOrdersQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    c.header('Cache-Control', 'no-store');
    return c.json(await listFinanceOrders(c.var.db, parsed.data));
  });

  /**
   * Revela o CPF/CNPJ completo de UM pagamento: grant `finance.view` + reautenticação recente; a auditoria é gravada
   * ANTES de devolver (quem, quando e qual pagamento, nunca o número). Resposta `no-store`.
   */
  routes.post(
    '/finance/payments/:id/reveal-document',
    deps.withDatabase,
    requireCapability('finance.view'),
    requireRecentAuth(),
    async (c) => {
      const id = c.req.param('id');
      if (!UUID.test(id)) return c.json({ error: { code: 'not_found' } }, 404);
      c.header('Cache-Control', 'no-store');
      try {
        const document = await revealPayerDocument(c.var.db, {
          paymentId: id,
          actorId: c.var.access!.userId,
          masterKey: c.env.FINANCE_SECRETS_MASTER_KEY,
        });
        return c.json({ document });
      } catch (error) {
        return failure(c, error);
      }
    },
  );

  routes.get(
    '/finance/refunds',
    deps.withDatabase,
    requireCapability('refund.execute'),
    async (c) => {
      c.header('Cache-Control', 'no-store');
      return c.json({ refunds: await listRefunds(c.var.db) });
    },
  );

  return routes;
}

/** Só alcançável em `dismiss` (que não lê o provider): qualquer leitura aqui é bug e falha alto. */
const unavailableReader: PaymentReader = {
  async getPayment() {
    throw new PaymentReadTransientError('reader_unavailable');
  },
  async getCustomer() {
    throw new PaymentReadTransientError('reader_unavailable');
  },
  async listPaymentIds() {
    throw new PaymentReadTransientError('reader_unavailable');
  },
};

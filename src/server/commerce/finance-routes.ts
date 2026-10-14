import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import { resolveReviewSchema } from '../../features/commerce/review';
import { requireCapability } from '../auth/authorization';
import type { AuthVars } from '../auth/types';
import { paymentReaderFor } from './factory';
import {
  PaymentReadPermanentError,
  PaymentReadTransientError,
  type PaymentReader,
} from './payment-reader';
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

  return routes;
}

/** Só alcançável em `dismiss` (que não lê o provider): qualquer leitura aqui é bug e falha alto. */
const unavailableReader: PaymentReader = {
  async getPayment() {
    throw new PaymentReadTransientError('reader_unavailable');
  },
  async listPaymentIds() {
    throw new PaymentReadTransientError('reader_unavailable');
  },
};

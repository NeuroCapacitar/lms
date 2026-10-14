import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import { checkoutHostsFor } from '../../features/commerce/checkout';
import { createOrderInputSchema } from '../../features/commerce/commerce';
import type { AuthVars } from '../auth/types';
import { APP_ENV } from '../release';
import type { CheckoutProvider } from './checkout-provider';
import { checkoutProviderFor, payerEnricherFor, paymentReaderFor } from './factory';
import { getOrderForUser, checkOrderForUser } from './order-view';
import {
  PaymentReadPermanentError,
  PaymentReadTransientError,
  type PaymentReader,
} from './payment-reader';
import {
  AccountSuspendedError,
  AlreadyHasAccessError,
  CheckoutFailedError,
  CheckoutInProgressError,
  CheckoutUnknownError,
  EmailNotVerifiedError,
  OrderExpiredError,
  OrderNotPendingError,
  startCheckout,
} from './checkout-service';
import {
  OrderAttemptConflictError,
  OrderOfferNotPaidError,
  OrderOfferUnavailableError,
} from './order-store';

type CommerceContext = Context<{ Bindings: Env; Variables: AuthVars }>;

function failure(c: CommerceContext, error: unknown): Response {
  const conflict = (code: string) => c.json({ error: { code } }, 409);
  if (error instanceof AccountSuspendedError) {
    return c.json({ error: { code: 'account_suspended' } }, 403);
  }
  if (error instanceof EmailNotVerifiedError) {
    return c.json({ error: { code: 'email_not_verified' } }, 403);
  }
  if (error instanceof AlreadyHasAccessError) return conflict('already_has_access');
  if (error instanceof OrderOfferUnavailableError || error instanceof OrderOfferNotPaidError) {
    return conflict('offer_unavailable');
  }
  if (error instanceof OrderAttemptConflictError) return conflict('attempt_conflict');
  if (error instanceof OrderNotPendingError) return conflict('order_not_pending');
  if (error instanceof OrderExpiredError) return conflict('order_expired');
  if (error instanceof CheckoutInProgressError) return conflict('checkout_in_progress');
  if (error instanceof CheckoutUnknownError) return conflict('checkout_unknown');
  if (error instanceof CheckoutFailedError) {
    return c.json({ error: { code: 'checkout_failed' } }, 502);
  }
  throw error;
}

/**
 * Compra (M6-02), sob `/api/me/checkout` (sessão e termos). O corpo é SÓ `{offerId, attemptId}`: preço, e-mail e
 * callbacks são recusados. `attemptId` (UUID do cliente) repete com segurança: o mesmo pedido, a mesma sessão. 200
 * devolve a URL do Checkout hospedado; a página de retorno e a concessão do acesso são do M6-07.
 */
export function commerceRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
  provider?: (c: CommerceContext) => CheckoutProvider | undefined;
  /** Leitor de pagamentos (dublê nos testes; em produção vem de `ASAAS_API_KEY`). */
  reader?: (c: CommerceContext) => PaymentReader | undefined;
  clock?: () => Date;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();

  routes.post('/me/checkout', deps.withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const parsed = createOrderInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    const provider = (deps.provider ?? ((context) => checkoutProviderFor(context.env)))(c);
    if (!provider) return c.json({ error: { code: 'checkout_not_configured' } }, 503);
    c.header('Cache-Control', 'no-store');
    try {
      const started = await startCheckout(
        c.var.db,
        { provider, hosts: checkoutHostsFor(APP_ENV), appBaseUrl: c.env.APP_BASE_URL },
        {
          userId: session.user.id,
          ...parsed.data,
          ...(deps.clock ? { now: deps.clock() } : {}),
        },
      );
      return c.json({
        orderId: started.orderId,
        checkoutUrl: started.checkoutUrl,
        expiresAt: started.expiresAt.toISOString(),
      });
    } catch (error) {
      return failure(c, error);
    }
  });

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** O estado do pedido da PRÓPRIA pessoa (a de outra pessoa é indistinguível de uma inexistente: 404). */
  routes.get('/me/orders/:id', deps.withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ error: { code: 'not_found' } }, 404);
    c.header('Cache-Control', 'no-store');
    const order = await getOrderForUser(c.var.db, session.user.id, id);
    return order ? c.json({ order }) : c.json({ error: { code: 'not_found' } }, 404);
  });

  /**
   * A página de retorno pede a conferência do pedido: o MESMO caso de uso do webhook lê o pagamento na API do Asaas e
   * decide. O corpo não traz nada (a pessoa não informa resultado); no máximo 10 conferências por pedido.
   */
  routes.post('/me/orders/:id/check', deps.withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ error: { code: 'not_found' } }, 404);
    const reader = (deps.reader ?? ((context) => paymentReaderFor(context.env)))(c);
    if (!reader) return c.json({ error: { code: 'checkout_not_configured' } }, 503);
    c.header('Cache-Control', 'no-store');
    try {
      const checked = await checkOrderForUser(
        c.var.db,
        {
          reader,
          afterGrant: payerEnricherFor(c.env, reader),
          ...(deps.clock ? { now: deps.clock } : {}),
        },
        { userId: session.user.id, orderId: id },
      );
      if (!checked) return c.json({ error: { code: 'not_found' } }, 404);
      return c.json({ order: checked.order, limited: checked.limited });
    } catch (error) {
      if (error instanceof PaymentReadTransientError) {
        return c.json({ error: { code: 'payment_provider_unavailable' } }, 503);
      }
      if (error instanceof PaymentReadPermanentError) {
        return c.json({ error: { code: 'payment_provider_error' } }, 502);
      }
      throw error;
    }
  });

  return routes;
}

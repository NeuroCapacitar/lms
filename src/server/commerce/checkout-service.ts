import { and, eq, inArray } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { isUniqueViolation } from '../../db/pg-errors';
import { checkoutSession, offer, purchaseOrder, user } from '../../db/schema';
import {
  PLACEHOLDER_ITEM_IMAGE_BASE64,
  buildCheckoutRequest,
  checkoutReturnUrls,
  isAllowedCheckoutUrl,
} from '../../features/commerce/checkout';
import { ORDER_TTL_MINUTES } from '../../features/commerce/commerce';
import { resolveAccess } from '../access/entitlement-store';
import { isSuspended } from '../auth/access-store';
import {
  CheckoutAmbiguousError,
  CheckoutRejectedError,
  type CheckoutProvider,
} from './checkout-provider';
import {
  OrderOfferUnavailableError,
  createOrder,
  recordFinancialEventIn,
  type OrderRow,
} from './order-store';

/**
 * Início da compra (M6-02): leva a pessoa autenticada e verificada ao Checkout hospedado do Asaas, com o preço do
 * SNAPSHOT, sem que o Hub toque em dados de cartão. Ordem (e por quê):
 *  1. bloqueios ANTES de qualquer cobrança (conta suspensa, e-mail não verificado, oferta indisponível, acesso já ativo);
 *  2. o pedido (idempotente pelo `attemptId`) e a sessão `creating` são gravados e CONFIRMADOS antes de chamar o Asaas;
 *  3. a chamada ao provider acontece FORA de transação;
 *  4. o resultado vira `open` (URL conferida contra a allowlist), `failed` (recusa conhecida) ou `unknown` (ambíguo:
 *     não se recria até o pedido expirar, a M6-04 reconcilia).
 */

export class AccountSuspendedError extends Error {
  constructor() {
    super('account_suspended');
  }
}
export class EmailNotVerifiedError extends Error {
  constructor() {
    super('email_not_verified');
  }
}
export class AlreadyHasAccessError extends Error {
  constructor() {
    super('already_has_access');
  }
}
/** O pedido já não está aberto para pagamento (pago, cancelado, em revisão...). */
export class OrderNotPendingError extends Error {
  constructor() {
    super('order_not_pending');
  }
}
/** O pedido passou dos 60 minutos: a nova compra usa um `attemptId` novo (novo pedido). */
export class OrderExpiredError extends Error {
  constructor() {
    super('order_expired');
  }
}
/** Já há uma sessão sendo criada para este pedido (outro clique ou aba). */
export class CheckoutInProgressError extends Error {
  constructor() {
    super('checkout_in_progress');
  }
}
/** A sessão ficou com resultado incerto: não se recria até o pedido expirar. */
export class CheckoutUnknownError extends Error {
  constructor() {
    super('checkout_unknown');
  }
}
/** O provider recusou ou devolveu um endereço fora da allowlist: nada foi aberto. */
export class CheckoutFailedError extends Error {
  constructor(readonly reason: string) {
    super(`checkout_failed:${reason}`);
  }
}

export interface CheckoutStarted {
  orderId: string;
  checkoutUrl: string;
  expiresAt: Date;
  /** `true`: a sessão aberta já existia e foi reaproveitada (nada novo foi pedido ao provider). */
  reused: boolean;
}

interface Deps {
  provider: CheckoutProvider;
  /** Hosts permitidos para a URL devolvida (por ambiente). */
  hosts: readonly string[];
  appBaseUrl: string;
  imageBase64?: string;
}

type Reservation =
  | { kind: 'reuse'; url: string; order: OrderRow }
  | { kind: 'create'; sessionId: string; order: OrderRow };

async function reserveSession(db: Database, order: OrderRow, now: Date): Promise<Reservation> {
  return db.transaction(async (tx) => {
    // O pedido é travado: dois cliques do mesmo pedido entram em fila e o segundo enxerga a sessão do primeiro.
    const [locked] = await tx
      .select()
      .from(purchaseOrder)
      .where(eq(purchaseOrder.id, order.id))
      .for('update');
    if (!locked || locked.status !== 'pending') throw new OrderNotPendingError();
    if (now.getTime() >= locked.expiresAt.getTime()) throw new OrderExpiredError();
    const [active] = await tx
      .select()
      .from(checkoutSession)
      .where(
        and(
          eq(checkoutSession.orderId, order.id),
          inArray(checkoutSession.state, ['creating', 'open', 'unknown']),
        ),
      );
    if (active) {
      if (active.state === 'open' && active.checkoutUrl) {
        return { kind: 'reuse', url: active.checkoutUrl, order } as const;
      }
      throw active.state === 'unknown' ? new CheckoutUnknownError() : new CheckoutInProgressError();
    }
    try {
      const [created] = await tx
        .insert(checkoutSession)
        .values({ orderId: order.id, expiresAt: locked.expiresAt })
        .returning({ id: checkoutSession.id });
      return { kind: 'create', sessionId: created!.id, order } as const;
    } catch (error) {
      if (isUniqueViolation(error)) throw new CheckoutInProgressError();
      throw error;
    }
  });
}

async function finishSession(
  db: Database,
  input: {
    sessionId: string;
    orderId: string;
    state: 'open' | 'failed' | 'unknown';
    kind: string;
    details?: Record<string, unknown>;
    provider?: { id: string; link: string };
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(checkoutSession)
      .set({
        state: input.state,
        ...(input.provider
          ? { providerSessionId: input.provider.id, checkoutUrl: input.provider.link }
          : {}),
      })
      .where(and(eq(checkoutSession.id, input.sessionId), eq(checkoutSession.state, 'creating')));
    await recordFinancialEventIn(tx, {
      orderId: input.orderId,
      kind: input.kind,
      source: 'api',
      details: { sessionId: input.sessionId, ...input.details },
    });
  });
}

export async function startCheckout(
  db: Database,
  deps: Deps,
  input: { userId: string; offerId: string; attemptId: string; now?: Date },
): Promise<CheckoutStarted> {
  const now = input.now ?? new Date();

  // 1. Bloqueios antes de qualquer cobrança.
  if (await isSuspended(db, input.userId)) throw new AccountSuspendedError();
  const [account] = await db
    .select({ emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.id, input.userId));
  if (!account?.emailVerified) throw new EmailNotVerifiedError();
  const [target] = await db
    .select({ courseId: offer.courseId })
    .from(offer)
    .where(eq(offer.id, input.offerId));
  if (!target) throw new OrderOfferUnavailableError();
  if ((await resolveAccess(db, input.userId, target.courseId, now)).hasAccess) {
    throw new AlreadyHasAccessError();
  }

  // 2. Pedido e sessão `creating`, confirmados antes de falar com o provider.
  const { order } = await createOrder(db, {
    userId: input.userId,
    offerId: input.offerId,
    attemptId: input.attemptId,
    now,
  });
  const reservation = await reserveSession(db, order, now);
  if (reservation.kind === 'reuse') {
    return {
      orderId: order.id,
      checkoutUrl: reservation.url,
      expiresAt: order.expiresAt,
      reused: true,
    };
  }

  // 3. Fora de transação: o provider.
  const request = buildCheckoutRequest({
    orderId: order.id,
    snapshot: order.snapshot,
    minutesToExpire: ORDER_TTL_MINUTES,
    urls: checkoutReturnUrls(deps.appBaseUrl, order.id),
    imageBase64: deps.imageBase64 ?? PLACEHOLDER_ITEM_IMAGE_BASE64,
  });
  const base = { sessionId: reservation.sessionId, orderId: order.id };
  let created: { id: string; link: string };
  try {
    created = await deps.provider.createCheckout(request);
  } catch (error) {
    if (error instanceof CheckoutRejectedError) {
      await finishSession(db, {
        ...base,
        state: 'failed',
        kind: 'checkout.rejected',
        details: { status: error.status },
      });
      throw new CheckoutFailedError('rejected');
    }
    // Qualquer outra coisa (timeout, rede, 5xx, erro inesperado) é ambígua: pode ter sido criado do outro lado.
    await finishSession(db, {
      ...base,
      state: 'unknown',
      kind: 'checkout.unknown',
      details: {
        reason: error instanceof CheckoutAmbiguousError ? error.reason : 'unexpected_error',
      },
    });
    throw new CheckoutUnknownError();
  }

  // 4. A URL só vale se for HTTPS e de um host da allowlist; senão nada é aberto nem guardado.
  if (!isAllowedCheckoutUrl(created.link, deps.hosts)) {
    await finishSession(db, {
      ...base,
      state: 'failed',
      kind: 'checkout.invalid_url',
      details: { providerSessionId: created.id },
    });
    throw new CheckoutFailedError('invalid_url');
  }
  await finishSession(db, {
    ...base,
    state: 'open',
    kind: 'checkout.opened',
    provider: created,
    details: { providerSessionId: created.id },
  });
  return {
    orderId: order.id,
    checkoutUrl: created.link,
    expiresAt: order.expiresAt,
    reused: false,
  };
}

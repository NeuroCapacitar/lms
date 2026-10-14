import { and, eq } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { course, curriculumState, financialEvent, offer, purchaseOrder } from '../../db/schema';
import {
  isOfferAcquirable,
  type CourseStatus,
  type OfferStatus,
} from '../../features/catalog/catalog';
import {
  InvalidOrderTransitionError,
  buildOrderSnapshot,
  canTransitionOrder,
  orderExpiresAt,
  type FinancialEventSource,
  type OrderSnapshot,
  type OrderStatus,
} from '../../features/commerce/commerce';
import type { DomainTx } from '../async/outbox-store';

/**
 * Pedidos de compra (M6-01). Este módulo guarda e protege o MODELO: o snapshot nasce do que o servidor leu da Offer e
 * do Course (nunca do cliente), a máquina de estados é explícita e cada mudança deixa um fato append-only na MESMA
 * transação. Nada aqui chama o Asaas (M6-02 em diante) nem concede acesso (M6-07).
 */

/** Oferta inexistente, não aberta, de curso não publicado ou sem currículo publicado. */
export class OrderOfferUnavailableError extends Error {
  constructor() {
    super('offer_unavailable');
  }
}

/** A oferta é gratuita: não existe pedido para ela (a inscrição gratuita não usa nada financeiro). */
export class OrderOfferNotPaidError extends Error {
  constructor() {
    super('offer_not_paid');
  }
}

/** O pedido não existe. */
class OrderNotFoundError extends Error {
  constructor() {
    super('order_not_found');
  }
}

/** O mesmo `attemptId` da pessoa já pertence a um pedido de OUTRA oferta. */
export class OrderAttemptConflictError extends Error {
  constructor() {
    super('order_attempt_conflict');
  }
}

export interface OrderRow {
  id: string;
  userId: string;
  offerId: string;
  courseId: string;
  attemptId: string;
  status: OrderStatus;
  snapshot: OrderSnapshot;
  expiresAt: Date;
  createdAt: Date;
}

type Row = typeof purchaseOrder.$inferSelect;

function toOrder(row: Row): OrderRow {
  return {
    id: row.id,
    userId: row.userId,
    offerId: row.offerId,
    courseId: row.courseId,
    attemptId: row.attemptId,
    status: row.status as OrderStatus,
    snapshot: {
      courseTitle: row.courseTitle,
      offerName: row.offerName,
      priceCents: row.priceCents,
      currency: 'BRL',
      accessMonths: row.accessMonths,
      maxInstallments: row.maxInstallments,
      methods: row.paymentMethods as OrderSnapshot['methods'],
    },
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

/** Acrescenta um fato financeiro (append-only) na transação do chamador. `providerEventId` repetido não duplica. */
export async function recordFinancialEventIn(
  tx: DomainTx,
  input: {
    orderId?: string | null;
    paymentId?: string | null;
    kind: string;
    source: FinancialEventSource;
    providerEventId?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<{ recorded: boolean }> {
  const inserted = await tx
    .insert(financialEvent)
    .values({
      orderId: input.orderId ?? null,
      paymentId: input.paymentId ?? null,
      kind: input.kind,
      source: input.source,
      providerEventId: input.providerEventId ?? null,
      details: input.details ?? {},
    })
    .onConflictDoNothing()
    .returning({ id: financialEvent.id });
  return { recorded: inserted.length > 0 };
}

/**
 * Cria o pedido (rascunho da compra) a partir de uma Offer PAGA e ABERTA. O preço, o prazo e as parcelas vêm da Offer
 * lida AQUI (sob `FOR SHARE`: pausar a oferta espera); o corpo só traz `offerId` e `attemptId`. Repetir o mesmo
 * `attemptId` da mesma pessoa devolve o mesmo pedido (idempotente, mesmo se a Offer mudou entretanto: o snapshot é o
 * da primeira vez). `attemptId` de OUTRA pessoa é recusado. Deixa o fato `order.created`.
 */
export async function createOrder(
  db: Database,
  input: { userId: string; offerId: string; attemptId: string; now?: Date },
): Promise<{ order: OrderRow; created: boolean }> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(purchaseOrder)
      .where(
        and(eq(purchaseOrder.userId, input.userId), eq(purchaseOrder.attemptId, input.attemptId)),
      );
    if (existing) {
      if (existing.offerId !== input.offerId) throw new OrderAttemptConflictError();
      return { order: toOrder(existing), created: false };
    }

    const [row] = await tx
      .select({
        courseId: offer.courseId,
        name: offer.name,
        kind: offer.kind,
        status: offer.status,
        priceCents: offer.priceCents,
        accessMonths: offer.accessMonths,
        maxInstallments: offer.maxInstallments,
        courseStatus: course.status,
        courseTitle: course.title,
      })
      .from(offer)
      .innerJoin(course, eq(course.id, offer.courseId))
      .where(eq(offer.id, input.offerId))
      .for('share');
    if (!row) throw new OrderOfferUnavailableError();
    const [state] = await tx
      .select({ version: curriculumState.publishedVersion })
      .from(curriculumState)
      .where(eq(curriculumState.courseId, row.courseId));
    const acquirable = isOfferAcquirable({
      courseStatus: row.courseStatus as CourseStatus,
      offerStatus: row.status as OfferStatus,
      hasPublishedCurriculum: (state?.version ?? 0) > 0,
    });
    if (!acquirable) throw new OrderOfferUnavailableError();
    if (row.kind !== 'paid') throw new OrderOfferNotPaidError();

    const now = input.now ?? new Date();
    const snapshot = buildOrderSnapshot({
      courseTitle: row.courseTitle,
      offerName: row.name,
      priceCents: row.priceCents,
      accessMonths: row.accessMonths,
      maxInstallments: row.maxInstallments,
    });
    const [created] = await tx
      .insert(purchaseOrder)
      .values({
        userId: input.userId,
        offerId: input.offerId,
        courseId: row.courseId,
        attemptId: input.attemptId,
        courseTitle: snapshot.courseTitle,
        offerName: snapshot.offerName,
        priceCents: snapshot.priceCents,
        accessMonths: snapshot.accessMonths,
        maxInstallments: snapshot.maxInstallments,
        paymentMethods: [...snapshot.methods],
        expiresAt: orderExpiresAt(now),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [purchaseOrder.userId, purchaseOrder.attemptId] })
      .returning();
    if (!created) {
      // Duas requisições com a mesma tentativa: a outra ganhou a corrida; devolve o pedido dela.
      const [winner] = await tx
        .select()
        .from(purchaseOrder)
        .where(
          and(eq(purchaseOrder.userId, input.userId), eq(purchaseOrder.attemptId, input.attemptId)),
        );
      if (!winner || winner.offerId !== input.offerId) throw new OrderAttemptConflictError();
      return { order: toOrder(winner), created: false };
    }
    await recordFinancialEventIn(tx, {
      orderId: created.id,
      kind: 'order.created',
      source: 'api',
      details: { priceCents: snapshot.priceCents, offerId: input.offerId },
    });
    return { order: toOrder(created), created: true };
  });
}

export async function getOrder(db: Database, orderId: string): Promise<OrderRow | null> {
  const [row] = await db.select().from(purchaseOrder).where(eq(purchaseOrder.id, orderId));
  return row ? toOrder(row) : null;
}

/**
 * Muda o estado do pedido NA transação do chamador: trava a linha, confere a transição (`InvalidOrderTransitionError`
 * se não for permitida) e deixa o fato `order.<para>` com a proveniência. O `UPDATE` é condicionado ao estado lido,
 * então duas transições concorrentes nunca passam as duas.
 */
export async function transitionOrderIn(
  tx: DomainTx,
  input: {
    orderId: string;
    to: OrderStatus;
    source: FinancialEventSource;
    providerEventId?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<OrderRow> {
  const [current] = await tx
    .select()
    .from(purchaseOrder)
    .where(eq(purchaseOrder.id, input.orderId))
    .for('update');
  if (!current) throw new OrderNotFoundError();
  const from = current.status as OrderStatus;
  if (!canTransitionOrder(from, input.to)) throw new InvalidOrderTransitionError(from, input.to);
  const [updated] = await tx
    .update(purchaseOrder)
    .set({ status: input.to })
    .where(and(eq(purchaseOrder.id, current.id), eq(purchaseOrder.status, from)))
    .returning();
  if (!updated) throw new InvalidOrderTransitionError(from, input.to);
  await recordFinancialEventIn(tx, {
    orderId: current.id,
    kind: `order.${input.to}`,
    source: input.source,
    providerEventId: input.providerEventId ?? null,
    details: { from, to: input.to, ...input.details },
  });
  return toOrder(updated);
}

export async function transitionOrder(
  db: Database,
  input: Parameters<typeof transitionOrderIn>[1],
): Promise<OrderRow> {
  return db.transaction((tx) => transitionOrderIn(tx, input));
}

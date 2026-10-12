import { and, count, eq } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { course, curriculumState, entitlement, offer } from '../../db/schema';
import { decideAccess, type AccessResult } from '../../features/access/access';
import {
  isOfferAcquirable,
  type CourseStatus,
  type OfferStatus,
} from '../../features/catalog/catalog';
import { grantEntitlementIn, lockEnrollmentIn } from './entitlement-store';

/**
 * Inscrição GRATUITA (M3-02). Este módulo NÃO importa nada de pagamento (Order, Payment, checkout,
 * Asaas): a oferta gratuita gera o direito direto, na própria transação, sem chamada externa. A regra
 * de arquitetura `acesso-nao-importa-pagamentos` (dependency-cruiser) fiscaliza isso.
 */

/** Oferta inexistente, de outro curso, não aberta ou de curso não publicado/sem currículo publicado. */
export class OfferUnavailableError extends Error {
  constructor() {
    super('offer_unavailable');
  }
}

/** A oferta existe e está aberta, mas é paga: a compra é do M6 e nunca passa por esta rota. */
export class OfferNotFreeError extends Error {
  constructor() {
    super('offer_not_free');
  }
}

/** A Staff suspendeu a matrícula: inscrever de novo não devolve o acesso. */
export class EnrollmentSuspendedError extends Error {
  constructor() {
    super('enrollment_suspended');
  }
}

export interface EnrollResult {
  /** `already_enrolled`: já havia acesso válido; nada foi gravado. */
  status: 'enrolled' | 'already_enrolled';
  access: AccessResult;
}

/**
 * Inscreve a pessoa numa oferta gratuita ABERTA, uma única vez por período de acesso:
 *  1. trava a oferta e o curso (`FOR SHARE`: pausar a oferta espera a inscrição em curso terminar) e
 *     revalida tudo na hora (a página pode ter sido carregada antes de a oferta ser pausada);
 *  2. trava a matrícula (`FOR UPDATE`): cliques simultâneos entram na fila;
 *  3. com acesso válido, devolve o estado atual (idempotente); expirado ou ausente, concede um novo
 *     direito, e a âncora e o progresso continuam os mesmos (recomeçar depois de expirar).
 * A chave de idempotência (`source_ref`) é por pessoa, oferta e ordem da concessão, então até um erro
 * de lógica acima não cria direito duplicado (o índice único recusa).
 */
export async function enrollInFreeOffer(
  db: Database,
  input: {
    userId: string;
    courseId: string;
    offerId: string;
    /** Relógio (teste). O padrão é o do servidor, lido DEPOIS de travar a matrícula. */
    clock?: () => Date;
  },
): Promise<EnrollResult> {
  const clock = input.clock ?? (() => new Date());
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        kind: offer.kind,
        status: offer.status,
        accessMonths: offer.accessMonths,
        courseStatus: course.status,
      })
      .from(offer)
      .innerJoin(course, eq(course.id, offer.courseId))
      .where(and(eq(offer.id, input.offerId), eq(offer.courseId, input.courseId)))
      .for('share');
    if (!row) throw new OfferUnavailableError();
    const [state] = await tx
      .select({ version: curriculumState.publishedVersion })
      .from(curriculumState)
      .where(eq(curriculumState.courseId, input.courseId));
    const acquirable = isOfferAcquirable({
      courseStatus: row.courseStatus as CourseStatus,
      offerStatus: row.status as OfferStatus,
      hasPublishedCurriculum: (state?.version ?? 0) > 0,
    });
    if (!acquirable) throw new OfferUnavailableError();
    if (row.kind !== 'free') throw new OfferNotFreeError();

    const enrolled = await lockEnrollmentIn(tx, input.userId, input.courseId, clock());
    // O `agora` é lido com a matrícula TRAVADA: quem espera a fila vê o direito do vencedor já gravado.
    const now = clock();
    const read = async () => {
      const rows = await tx
        .select({
          startsAt: entitlement.startsAt,
          expiresAt: entitlement.expiresAt,
          revokedAt: entitlement.revokedAt,
        })
        .from(entitlement)
        .where(and(eq(entitlement.userId, input.userId), eq(entitlement.courseId, input.courseId)));
      // Um direito desta mesma inscrição começa no instante em que foi concedido. Se o início está
      // ligeiramente à frente do relógio DESTE pedido, é diferença de relógio entre pedidos
      // simultâneos, não uma concessão futura: sem isto, o perdedor da corrida criaria um segundo direito.
      const latestStart = rows.reduce((max, row) => Math.max(max, row.startsAt.getTime()), 0);
      return decideAccess({
        enrollment: enrolled,
        accountSuspended: false,
        entitlements: rows,
        now: new Date(Math.max(now.getTime(), latestStart)),
      });
    };

    const before = await read();
    if (before.reason === 'suspended') throw new EnrollmentSuspendedError();
    if (before.hasAccess) return { status: 'already_enrolled', access: before };

    const [previous] = await tx
      .select({ total: count() })
      .from(entitlement)
      .where(
        and(
          eq(entitlement.userId, input.userId),
          eq(entitlement.offerId, input.offerId),
          eq(entitlement.source, 'free_offer'),
        ),
      );
    await grantEntitlementIn(tx, {
      userId: input.userId,
      courseId: input.courseId,
      offerId: input.offerId,
      source: 'free_offer',
      sourceRef: `free:${input.userId}:${input.offerId}:${previous?.total ?? 0}`,
      accessMonths: row.accessMonths,
      startsAt: now,
      grantedBy: input.userId,
    });
    return { status: 'enrolled', access: await read() };
  });
}

import { eq, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { certificateIssuer, certificateSignatory, course } from '../../db/schema';
import {
  formatCnpj,
  type IssuerDto,
  type IssuerInput,
  type SignatoryDto,
  type SignatoryInput,
} from '../../features/certificate/issuer';
import { auditEvent } from '../auth/access-store';
import type { DomainTx } from '../async/outbox-store';
import { setReferenceIn } from '../media/references';

/**
 * Emitente (global) e signatário (por curso) do certificado (M7-06). Só o Admin escreve (a rota exige `staff.manage`).
 * A assinatura é mídia PRIVADA `certificate_asset`, referenciada por `media_reference` na mesma transação que grava o
 * signatário: confere `ready` e o propósito, e a limpeza do órfão nunca apaga uma assinatura em uso.
 */
export class SignerCourseNotFoundError extends Error {
  constructor() {
    super('course_not_found');
  }
}

type Reader = Database | DomainTx;

export async function getIssuer(db: Reader): Promise<IssuerDto | null> {
  const [row] = await db.select().from(certificateIssuer);
  return row
    ? {
        legalName: row.legalName,
        cnpj: row.cnpj,
        cnpjFormatted: formatCnpj(row.cnpj),
        updatedAt: row.updatedAt.toISOString(),
      }
    : null;
}

export async function saveIssuer(
  db: Database,
  input: IssuerInput & { actorId: string },
): Promise<IssuerDto> {
  await db.transaction(async (tx) => {
    await tx
      .insert(certificateIssuer)
      .values({ legalName: input.legalName, cnpj: input.cnpj, updatedBy: input.actorId })
      .onConflictDoUpdate({
        target: certificateIssuer.singleton,
        set: {
          legalName: input.legalName,
          cnpj: input.cnpj,
          updatedBy: input.actorId,
          updatedAt: sql`now()`,
        },
      });
    await auditEvent(tx, {
      actorId: input.actorId,
      action: 'certificate.issuer.save',
      targetType: 'certificate_issuer',
      targetId: 'singleton',
    });
  });
  return (await getIssuer(db))!;
}

export async function getSignatory(db: Reader, courseId: string): Promise<SignatoryDto | null> {
  const [row] = await db
    .select()
    .from(certificateSignatory)
    .where(eq(certificateSignatory.courseId, courseId));
  return row
    ? {
        courseId: row.courseId,
        name: row.name,
        title: row.title,
        signatureMediaId: row.signatureMediaId,
        updatedAt: row.updatedAt.toISOString(),
      }
    : null;
}

/**
 * Grava (ou troca) o signatário do curso. Trocar o signatário NÃO altera certificados já emitidos: cada um copiou o
 * que valia no snapshot. `signatureMediaId = null` remove a assinatura (o signatário continua com nome e cargo).
 */
export async function saveSignatory(
  db: Database,
  input: SignatoryInput & { actorId: string; courseId: string },
): Promise<SignatoryDto> {
  await db.transaction(async (tx) => {
    const [exists] = await tx
      .select({ id: course.id })
      .from(course)
      .where(eq(course.id, input.courseId));
    if (!exists) throw new SignerCourseNotFoundError();
    await setReferenceIn(tx, {
      ownerType: 'certificate_signatory',
      ownerId: input.courseId,
      slot: 'signature',
      mediaId: input.signatureMediaId,
      purpose: 'certificate_asset',
    });
    await tx
      .insert(certificateSignatory)
      .values({
        courseId: input.courseId,
        name: input.name,
        title: input.title,
        signatureMediaId: input.signatureMediaId,
        updatedBy: input.actorId,
      })
      .onConflictDoUpdate({
        target: certificateSignatory.courseId,
        set: {
          name: input.name,
          title: input.title,
          signatureMediaId: input.signatureMediaId,
          updatedBy: input.actorId,
          updatedAt: sql`now()`,
        },
      });
    await auditEvent(tx, {
      actorId: input.actorId,
      action: 'certificate.signatory.save',
      targetType: 'course',
      targetId: input.courseId,
    });
  });
  return (await getSignatory(db, input.courseId))!;
}

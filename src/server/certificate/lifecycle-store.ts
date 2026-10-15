import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { isUniqueViolation } from '../../db/pg-errors';
import { certificate, courseCompletion, purchaseOrder, user } from '../../db/schema';
import {
  certificateSnapshotSchema,
  generateCertificateCode,
  type CertificateStatus,
} from '../../features/certificate/certificate';
import type {
  MyCertificateDto,
  RevocationCategory,
  StaffCertificateDto,
} from '../../features/certificate/lifecycle';
import { enqueueIntent } from '../async/outbox-store';
import { auditEvent } from '../auth/access-store';
import { readPublishedTree } from '../catalog/curriculum-store';
import type { ObjectStorage } from '../media/storage';
import { buildSnapshotIn } from './certificate-store';

/**
 * Ciclo de vida do certificado (M7-04): download do dono, revogação (Admin) e reemissão (grant), tudo decidido no
 * servidor. O PDF vem do R2 PRIVADO pelo Worker (nunca URL pré-assinada reutilizável) e o SHA-256 é recalculado a cada
 * download: se divergir do gravado, o arquivo NÃO é entregue e a divergência fica na auditoria. Reembolso não revoga.
 */
export class CertificateNotFoundError extends Error {
  constructor() {
    super('certificate_not_found');
  }
}

/** O objeto do R2 não confere com o hash gravado (ou sumiu): nada é entregue. */
export class CertificateIntegrityError extends Error {
  constructor() {
    super('certificate_integrity');
  }
}

export class CertificateStateError extends Error {
  readonly code: 'not_ready' | 'not_reissuable' | 'no_template' | 'invalid_snapshot' | 'conflict';
  constructor(code: CertificateStateError['code']) {
    super(`certificate_state:${code}`);
    this.code = code;
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const titleOf = (snapshot: unknown): string => {
  const parsed = certificateSnapshotSchema.safeParse(snapshot);
  return parsed.success ? parsed.data.courseTitle : '';
};

/** Os certificados da PESSOA (sem os substituídos). Nada de nota interna, motivo nem caminho do arquivo. */
export async function listMyCertificates(
  db: Database,
  userId: string,
): Promise<MyCertificateDto[]> {
  const rows = await db
    .select()
    .from(certificate)
    .where(eq(certificate.userId, userId))
    .orderBy(desc(certificate.createdAt));
  return rows
    .filter((row) => row.status !== 'superseded' && row.status !== 'awaiting_name')
    .map((row) => ({
      id: row.id,
      courseTitle: titleOf(row.snapshot),
      status: row.status as CertificateStatus,
      code: row.code,
      readyAt: row.readyAt ? row.readyAt.toISOString() : null,
      canDownload: row.status === 'ready',
    }));
}

/**
 * Abre o PDF para o DONO: só `ready`. Quem não é dono, ou o certificado que não está `ready` (revogado, substituído,
 * na fila...), recebe a mesma resposta de "não existe". O hash é recalculado sobre os bytes lidos.
 */
export async function openCertificateDownload(
  db: Database,
  storage: ObjectStorage,
  input: { userId: string; certificateId: string },
): Promise<{ bytes: Uint8Array; filename: string }> {
  const [row] = await db
    .select()
    .from(certificate)
    .where(and(eq(certificate.id, input.certificateId), eq(certificate.userId, input.userId)));
  if (!row || row.status !== 'ready' || !row.pdfKey || !row.pdfSha256) {
    throw new CertificateNotFoundError();
  }
  const bytes = await storage.read('private', row.pdfKey);
  if (!bytes || (await sha256Hex(bytes)) !== row.pdfSha256) {
    await db.transaction((tx) =>
      auditEvent(tx, {
        actorId: null,
        action: 'certificate.integrity_failed',
        targetType: 'certificate',
        targetId: row.id,
        details: { missing: bytes === null },
      }),
    );
    throw new CertificateIntegrityError();
  }
  return { bytes, filename: `certificado-${row.code}.pdf` };
}

/**
 * Revoga um certificado `ready` (Admin, com a reautenticação já exigida pela rota): em transação, grava quem, quando,
 * a categoria e a nota INTERNA; novos downloads falham na hora. O snapshot e o PDF ficam como estavam (evidência).
 */
export async function revokeCertificate(
  db: Database,
  input: { actorId: string; certificateId: string; category: RevocationCategory; note: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(certificate)
      .where(eq(certificate.id, input.certificateId))
      .for('update');
    if (!row) throw new CertificateNotFoundError();
    if (row.status !== 'ready') throw new CertificateStateError('not_ready');
    await tx
      .update(certificate)
      .set({
        status: 'revoked',
        revokedAt: sql`now()`,
        revokedBy: input.actorId,
        revocationCategory: input.category,
        revocationNote: input.note,
      })
      .where(eq(certificate.id, row.id));
    await auditEvent(tx, {
      actorId: input.actorId,
      action: 'certificate.revoke',
      targetType: 'certificate',
      targetId: row.id,
      details: { category: input.category },
    });
  });
}

/**
 * Reemite: cria um certificado NOVO (código novo, nome atual, template publicado vigente) ligado ao anterior; o
 * anterior `ready` vira `superseded` (um `revoked` continua revogado). Só o mais recente é reemitível: o índice único
 * de sucessor decide a corrida. O PDF antigo NÃO é corrigido: continua o que era.
 */
export async function reissueCertificate(
  db: Database,
  input: { actorId: string; certificateId: string; reason: string },
): Promise<string> {
  try {
    return await db.transaction(async (tx) => {
      const [old] = await tx
        .select()
        .from(certificate)
        .where(eq(certificate.id, input.certificateId))
        .for('update');
      if (!old) throw new CertificateNotFoundError();
      if (old.status !== 'ready' && old.status !== 'revoked') {
        throw new CertificateStateError('not_reissuable');
      }
      const [successor] = await tx
        .select({ id: certificate.id })
        .from(certificate)
        .where(eq(certificate.predecessorId, old.id));
      if (successor) throw new CertificateStateError('not_reissuable');

      const [completion] = await tx
        .select()
        .from(courseCompletion)
        .where(
          and(eq(courseCompletion.userId, old.userId), eq(courseCompletion.courseId, old.courseId)),
        );
      if (!completion) throw new CertificateNotFoundError();
      const tree = await readPublishedTree(tx, old.courseId);
      const built = await buildSnapshotIn(tx, {
        userId: old.userId,
        courseId: old.courseId,
        completedAt: completion.completedAt,
        requiredTotal: completion.requiredTotal,
        courseTitle: tree.details.displayTitle,
        workloadHours: tree.details.workloadHours,
      });
      if (built.status === 'no_template') throw new CertificateStateError('no_template');
      if (built.status === 'invalid') throw new CertificateStateError('invalid_snapshot');

      if (old.status === 'ready') {
        await tx
          .update(certificate)
          .set({ status: 'superseded' })
          .where(eq(certificate.id, old.id));
      }
      const [created] = await tx
        .insert(certificate)
        .values({
          userId: old.userId,
          courseId: old.courseId,
          code: generateCertificateCode(),
          status: 'queued',
          snapshot: built.snapshot,
          predecessorId: old.id,
        })
        .returning({ id: certificate.id });
      await enqueueIntent(tx, {
        kind: 'certificate.render',
        dedupeKey: `certificate:${created!.id}`,
        payload: { certificateId: created!.id },
        correlationId: `certificate:${created!.id}`,
      });
      await auditEvent(tx, {
        actorId: input.actorId,
        action: 'certificate.reissue',
        targetType: 'certificate',
        targetId: old.id,
        details: { newId: created!.id, reason: input.reason },
      });
      return created!.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new CertificateStateError('conflict');
    throw error;
  }
}

/** Lista da Staff: por pessoa e curso, com o reembolso do curso à vista (o reembolso NÃO revoga). */
export async function listStaffCertificates(
  db: Database,
  input: { status?: CertificateStatus; limit?: number } = {},
): Promise<StaffCertificateDto[]> {
  const rows = await db
    .select({ cert: certificate, name: user.name, email: user.email })
    .from(certificate)
    .innerJoin(user, eq(user.id, certificate.userId))
    .where(input.status ? eq(certificate.status, input.status) : undefined)
    .orderBy(desc(certificate.createdAt))
    .limit(input.limit ?? 200);
  if (rows.length === 0) return [];

  const successors = new Set(
    (
      await db
        .select({ predecessorId: certificate.predecessorId })
        .from(certificate)
        .where(
          inArray(
            certificate.predecessorId,
            rows.map((row) => row.cert.id),
          ),
        )
    ).flatMap((row) => (row.predecessorId ? [row.predecessorId] : [])),
  );
  const refunds = await db
    .select({
      userId: purchaseOrder.userId,
      courseId: purchaseOrder.courseId,
      at: purchaseOrder.updatedAt,
    })
    .from(purchaseOrder)
    .where(
      and(
        eq(purchaseOrder.status, 'refunded'),
        inArray(purchaseOrder.userId, [...new Set(rows.map((row) => row.cert.userId))]),
      ),
    );
  const refundedAt = (userId: string, courseId: string) =>
    refunds
      .filter((refund) => refund.userId === userId && refund.courseId === courseId)
      .map((refund) => refund.at.getTime())
      .sort((a, b) => b - a)[0];

  return rows.map(({ cert, name, email }) => {
    const refunded = refundedAt(cert.userId, cert.courseId);
    const parsed = certificateSnapshotSchema.safeParse(cert.snapshot);
    return {
      id: cert.id,
      courseId: cert.courseId,
      courseTitle: parsed.success ? parsed.data.courseTitle : '',
      holderName: parsed.success ? parsed.data.holderName : name,
      holderEmail: email,
      status: cert.status as CertificateStatus,
      code: cert.code,
      failureCode: cert.failureCode,
      readyAt: cert.readyAt ? cert.readyAt.toISOString() : null,
      revokedAt: cert.revokedAt ? cert.revokedAt.toISOString() : null,
      revocationCategory: (cert.revocationCategory as RevocationCategory | null) ?? null,
      predecessorId: cert.predecessorId,
      createdAt: cert.createdAt.toISOString(),
      refundedAt: refunded ? new Date(refunded).toISOString() : null,
      hasSuccessor: successors.has(cert.id),
    };
  });
}

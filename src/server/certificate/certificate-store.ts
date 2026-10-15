import { and, eq, isNull, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { isUniqueViolation } from '../../db/pg-errors';
import {
  certificate,
  certificatePolicy,
  course,
  courseCompletion,
  profile,
  user,
} from '../../db/schema';
import {
  buildCertificateSnapshot,
  certificateSnapshotSchema,
  generateCertificateCode,
  SnapshotInvalidError,
  type CertificateSnapshot,
} from '../../features/certificate/certificate';
import { auditEvent } from '../auth/access-store';
import { queueEmail } from '../email/email-store';
import { PermanentError, TransientError, type HandlerRegistry } from '../async/handler-types';
import { enqueueIntent, type DomainTx } from '../async/outbox-store';
import { getIssuer, getSignatory } from './signer-store';
import { readPublishedTemplateIn } from './template-store';

/**
 * Certificado (M7-01), parte do servidor. A emissão roda DENTRO da transação que cria a `course_completion`: só o
 * vencedor do insert chama `issueCertificateIn`, que cria o certificado e a intenção `certificate.render` JUNTOS (ou
 * nada acontece). Nenhuma chamada externa aqui; o PDF é do renderer (M7-02), atrás de uma porta. Falha de PDF nunca
 * remove a conclusão nem duplica o certificado.
 */

export interface CertificateSource {
  userId: string;
  courseId: string;
  completedAt: Date;
  requiredTotal: number;
  courseTitle: string;
  workloadHours: number | null;
}

/** A política do curso liga a emissão. Sem linha: desligada. */
async function policyEnabledIn(tx: DomainTx, courseId: string): Promise<boolean> {
  const [row] = await tx
    .select({ enabled: certificatePolicy.enabled })
    .from(certificatePolicy)
    .where(eq(certificatePolicy.courseId, courseId));
  return row?.enabled === true;
}

async function holderIn(tx: DomainTx, userId: string) {
  const [row] = await tx
    .select({ certificateName: profile.certificateName, displayName: profile.displayName })
    .from(profile)
    .where(eq(profile.userId, userId));
  if (row) return row;
  // Sem perfil (não deveria existir: o gatilho cria junto do usuário): cai no nome da conta.
  const [account] = await tx.select({ name: user.name }).from(user).where(eq(user.id, userId));
  return { certificateName: null, displayName: account?.name ?? '' };
}

/**
 * Monta o snapshot de um certificado NOVO com o que vale AGORA: nome do perfil, emitente, signatário do curso e o
 * template PUBLICADO. Compartilhado pela emissão (conclusão) e pela reemissão (M7-04). `no_template`: sem template
 * publicado não há o que imprimir; `invalid`: algum dado não cabe no certificado (nome gigante...).
 */
export async function buildSnapshotIn(
  tx: DomainTx,
  source: CertificateSource,
): Promise<
  | { status: 'ok'; snapshot: CertificateSnapshot }
  | { status: 'no_template' }
  | { status: 'invalid' }
> {
  const template = await readPublishedTemplateIn(tx, source.courseId);
  if (!template) return { status: 'no_template' };
  const holder = await holderIn(tx, source.userId);
  const issuerRow = await getIssuer(tx);
  const signatoryRow = await getSignatory(tx, source.courseId);
  const issuer = issuerRow ? { legalName: issuerRow.legalName, cnpj: issuerRow.cnpj } : null;
  const signatory = signatoryRow
    ? {
        name: signatoryRow.name,
        title: signatoryRow.title,
        signatureMediaId: signatoryRow.signatureMediaId,
      }
    : null;
  try {
    return {
      status: 'ok',
      snapshot: buildCertificateSnapshot({
        certificateName: holder.certificateName,
        displayName: holder.displayName,
        courseTitle: source.courseTitle,
        workloadHours: source.workloadHours,
        completedAt: source.completedAt,
        requiredTotal: source.requiredTotal,
        issuer,
        signatory,
        layout: template.layout,
        backgroundMediaId: template.backgroundMediaId,
      }),
    };
  } catch (error) {
    if (!(error instanceof SnapshotInvalidError)) throw error;
    return { status: 'invalid' };
  }
}

/**
 * Cria o certificado `queued` e a intenção de renderização, na transação do chamador. Devolve o id, ou `null` se a
 * política está desligada ou se a conclusão já tem certificado (repetir nunca duplica: índice único parcial).
 */
export async function issueCertificateIn(
  tx: DomainTx,
  source: CertificateSource,
): Promise<string | null> {
  if (!(await policyEnabledIn(tx, source.courseId))) return null;
  // Sem template PUBLICADO do curso (M7-03) não há o que imprimir: a conclusão existe e nada nasce.
  const built = await buildSnapshotIn(tx, source);
  if (built.status === 'no_template') return null;
  if (built.status === 'invalid') {
    // Dado que não cabe no certificado (nome gigante...): a CONCLUSÃO do curso fica intacta, o certificado não nasce e
    // a Staff vê a falha na auditoria. Nunca derruba a transação da conclusão.
    await auditEvent(tx, {
      actorId: null,
      action: 'certificate.issue_failed',
      targetType: 'course',
      targetId: source.courseId,
      details: { userId: source.userId, code: 'snapshot_invalid' },
    });
    return null;
  }
  const snapshot = built.snapshot;

  const inserted = await tx
    .insert(certificate)
    .values({
      userId: source.userId,
      courseId: source.courseId,
      code: generateCertificateCode(),
      status: 'queued',
      snapshot,
    })
    .onConflictDoNothing({
      target: [certificate.userId, certificate.courseId],
      where: isNull(certificate.predecessorId),
    })
    .returning({ id: certificate.id });
  const created = inserted[0];
  if (!created) return null;

  await enqueueIntent(tx, {
    kind: 'certificate.render',
    dedupeKey: `certificate:${created.id}`,
    payload: { certificateId: created.id },
    correlationId: `certificate:${created.id}`,
  });
  return created.id;
}

/** Liga ou desliga a emissão do curso (Admin). Desligar NÃO apaga certificados já emitidos. */
export async function setCertificatePolicy(
  db: Database,
  input: { actorId: string; courseId: string; enabled: boolean },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [exists] = await tx
      .select({ id: course.id })
      .from(course)
      .where(eq(course.id, input.courseId));
    if (!exists) throw new PermanentError('course_not_found');
    await tx
      .insert(certificatePolicy)
      .values({ courseId: input.courseId, enabled: input.enabled })
      .onConflictDoUpdate({
        target: certificatePolicy.courseId,
        set: { enabled: input.enabled, updatedAt: sql`now()` },
      });
    await auditEvent(tx, {
      actorId: input.actorId,
      action: input.enabled ? 'certificate.policy.enable' : 'certificate.policy.disable',
      targetType: 'course',
      targetId: input.courseId,
    });
  });
}

/**
 * "Emitir pendentes" (comando EXPLÍCITO do Admin, nunca backfill silencioso): cria o certificado das conclusões do
 * curso que ainda não têm nenhum. Exige a política ligada. Repetir não duplica. Cada certificado nasce na sua
 * própria transação, para que um nome inválido não derrube o lote.
 */
export async function issuePendingCertificates(
  db: Database,
  input: {
    actorId: string;
    courseId: string;
    courseTitle: string;
    workloadHours: number | null;
    limit?: number;
  },
): Promise<{ issued: number; skipped: number }> {
  const pending = await db
    .select({
      userId: courseCompletion.userId,
      completedAt: courseCompletion.completedAt,
      requiredTotal: courseCompletion.requiredTotal,
    })
    .from(courseCompletion)
    .leftJoin(
      certificate,
      and(
        eq(certificate.userId, courseCompletion.userId),
        eq(certificate.courseId, courseCompletion.courseId),
        isNull(certificate.predecessorId),
      ),
    )
    .where(and(eq(courseCompletion.courseId, input.courseId), isNull(certificate.id)))
    .limit(input.limit ?? 200);

  let issued = 0;
  let skipped = 0;
  for (const row of pending) {
    try {
      const id = await db.transaction((tx) =>
        issueCertificateIn(tx, {
          userId: row.userId,
          courseId: input.courseId,
          completedAt: row.completedAt,
          requiredTotal: row.requiredTotal,
          courseTitle: input.courseTitle,
          workloadHours: input.workloadHours,
        }),
      );
      if (id) issued += 1;
      else skipped += 1;
    } catch (error) {
      if (isUniqueViolation(error)) skipped += 1;
      else throw error;
    }
  }
  if (issued > 0) {
    await db.transaction((tx) =>
      auditEvent(tx, {
        actorId: input.actorId,
        action: 'certificate.issue_pending',
        targetType: 'course',
        targetId: input.courseId,
        details: { issued, skipped },
      }),
    );
  }
  return { issued, skipped };
}

/** Nova tentativa de um certificado em `failed` (Staff com a fila operacional): volta a `queued` SEM criar outro. */
export async function retryCertificate(
  db: Database,
  input: { actorId: string; certificateId: string },
): Promise<'requeued' | 'not_failed' | 'not_found'> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: certificate.status, attempts: certificate.renderAttempts })
      .from(certificate)
      .where(eq(certificate.id, input.certificateId))
      .for('update');
    if (!row) return 'not_found';
    if (row.status !== 'failed') return 'not_failed';
    await tx
      .update(certificate)
      .set({ status: 'queued', failureCode: null })
      .where(eq(certificate.id, input.certificateId));
    await enqueueIntent(tx, {
      kind: 'certificate.render',
      dedupeKey: `certificate:${input.certificateId}:retry:${row.attempts}`,
      payload: { certificateId: input.certificateId },
      correlationId: `certificate:${input.certificateId}`,
    });
    await auditEvent(tx, {
      actorId: input.actorId,
      action: 'certificate.retry',
      targetType: 'certificate',
      targetId: input.certificateId,
    });
    return 'requeued';
  });
}

/** O PDF já guardado (M7-02 grava no R2 privado e devolve a chave e o SHA-256 dos bytes). */
interface RenderedCertificate {
  pdfKey: string;
  pdfSha256: string;
}

/** Falha definitiva do renderer: repetir não adianta (o certificado vai a `failed`). */
export class CertificateRenderRejectedError extends Error {
  constructor(readonly code: string) {
    super(`certificate_render_rejected:${code}`);
  }
}

/** Falha de infraestrutura do renderer (Browser Run fora do ar, timeout, R2): tentar de novo é seguro. */
export class CertificateRenderTransientError extends Error {
  constructor(readonly reason: string) {
    super(`certificate_render_transient:${reason}`);
  }
}

/**
 * Porta do renderer (M7-02): HTML/CSS → Browser Run `/pdf` → R2 privado + SHA-256. `snapshot` é tudo o que o PDF
 * pode dizer; `certificateId` e `code` identificam o objeto. NUNCA devolve a mensagem do provider.
 */
export interface CertificateRenderer {
  render(input: {
    certificateId: string;
    code: string;
    snapshot: CertificateSnapshot;
  }): Promise<RenderedCertificate>;
}

export interface CertificateHandlerDeps {
  /** Sem renderer configurado (M7-02 ainda não ativo no ambiente), o certificado vai a `failed` com código claro. */
  renderer?: CertificateRenderer | undefined;
}

/**
 * Handler do `certificate.render`. A entrega é at-least-once e o consumidor já deu o claim com fencing; AQUI a
 * idempotência vem do estado: `ready`, `revoked` e `superseded` são terminais (no-op), e o commit só vale se o
 * certificado ainda está `rendering`. O renderer roda FORA de transação. Erro transitório volta a `queued` (a outbox
 * repete com backoff); definitivo vai a `failed` com código, e a conclusão do curso fica intacta.
 */
export function createCertificateRenderHandler(
  deps: CertificateHandlerDeps,
): HandlerRegistry['certificate.render'] {
  return async ({ db, payload }) => {
    const [row] = await db
      .select()
      .from(certificate)
      .where(eq(certificate.id, payload.certificateId));
    if (!row) throw new PermanentError('certificate_missing');
    if (row.status === 'ready' || row.status === 'revoked' || row.status === 'superseded') return;
    if (row.status === 'awaiting_name') throw new PermanentError('certificate_awaiting_name');

    const snapshot = certificateSnapshotSchema.safeParse(row.snapshot);
    const failWith = async (code: string) => {
      await db
        .update(certificate)
        .set({ status: 'failed', failureCode: code })
        .where(eq(certificate.id, row.id));
      throw new PermanentError(code);
    };
    if (!snapshot.success) return failWith('snapshot_invalid');
    if (!deps.renderer) return failWith('renderer_not_configured');

    // queued/failed → rendering (conta a tentativa); quem perdeu a corrida não renderiza.
    const claimed = await db
      .update(certificate)
      .set({ status: 'rendering', renderAttempts: sql`${certificate.renderAttempts} + 1` })
      .where(
        and(
          eq(certificate.id, row.id),
          sql`${certificate.status} in ('queued', 'rendering', 'failed')`,
        ),
      )
      .returning({ id: certificate.id });
    if (claimed.length === 0) return;

    let rendered: RenderedCertificate;
    try {
      rendered = await deps.renderer.render({
        certificateId: row.id,
        code: row.code,
        snapshot: snapshot.data,
      });
    } catch (error) {
      if (error instanceof CertificateRenderTransientError) {
        await db
          .update(certificate)
          .set({ status: 'queued' })
          .where(and(eq(certificate.id, row.id), eq(certificate.status, 'rendering')));
        throw new TransientError(error.reason);
      }
      if (error instanceof CertificateRenderRejectedError) return failWith(error.code);
      // Erro desconhecido: não vaza a mensagem; trata como transitório (a outbox limita as tentativas).
      await db
        .update(certificate)
        .set({ status: 'queued' })
        .where(and(eq(certificate.id, row.id), eq(certificate.status, 'rendering')));
      throw new TransientError('renderer_unknown_error');
    }

    // Commit depois do PUT no R2 (fencing: só vale se ainda está `rendering`). O e-mail "certificado emitido" nasce na
    // MESMA transação (outbox, com dedupe por certificado: reprocessar nunca reenvia); falha do e-mail depois NUNCA
    // muda o certificado.
    await db.transaction(async (tx) => {
      const committed = await tx
        .update(certificate)
        .set({
          status: 'ready',
          pdfKey: rendered.pdfKey,
          pdfSha256: rendered.pdfSha256,
          readyAt: sql`now()`,
          failureCode: null,
        })
        .where(and(eq(certificate.id, row.id), eq(certificate.status, 'rendering')))
        .returning({ id: certificate.id });
      if (committed.length === 0) return;
      await queueEmail(tx, {
        template: 'certificate-issued',
        recipientUserId: row.userId,
        variables: { COURSE_TITLE: snapshot.data.courseTitle, CERTIFICATE_ID: row.id },
        dedupeKey: `certificate-issued:${row.id}`,
        correlationId: `certificate:${row.id}`,
      });
    });
  };
}

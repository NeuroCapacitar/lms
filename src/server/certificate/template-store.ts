import { and, eq, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { isUniqueViolation } from '../../db/pg-errors';
import { certificateTemplate, course, mediaReference } from '../../db/schema';
import {
  certificateLayoutSchema,
  layoutProblems,
  type LayoutProblem,
} from '../../features/certificate/layout';
import type {
  TemplateDraftInput,
  TemplateDto,
  TemplatesDto,
} from '../../features/certificate/template';
import type { DomainTx } from '../async/outbox-store';
import { auditEvent } from '../auth/access-store';
import { setReferenceIn } from '../media/references';

/**
 * Template do certificado por curso (M7-03), parte do servidor. Só o Admin escreve (a rota exige `staff.manage`). O
 * fundo é mídia PRIVADA referenciada por `media_reference` na mesma transação (dono `certificate_template`, espaços
 * `draft_background` e `published_background`). Publicar valida o layout NO SERVIDOR, congela e substitui o publicado
 * anterior; certificados já emitidos mantêm o layout do SEU snapshot.
 */
export class TemplateCourseNotFoundError extends Error {
  constructor() {
    super('course_not_found');
  }
}

/** O rascunho mudou desde que a tela o viu (ou já existe um quando se esperava nenhum). */
export class TemplateConflictError extends Error {
  readonly currentVersion: number | null;
  constructor(currentVersion: number | null) {
    super('template_conflict');
    this.currentVersion = currentVersion;
  }
}

export class TemplateDraftMissingError extends Error {
  constructor() {
    super('template_draft_missing');
  }
}

/** O layout tem ERRO (fora da página ou sobre a moldura): não publica. */
export class TemplateLayoutInvalidError extends Error {
  readonly problems: LayoutProblem[];
  constructor(problems: LayoutProblem[]) {
    super('template_layout_invalid');
    this.problems = problems;
  }
}

type Reader = Database | DomainTx;
type Row = typeof certificateTemplate.$inferSelect;

function toDto(row: Row): TemplateDto {
  return {
    id: row.id,
    status: row.status as TemplateDto['status'],
    layout: certificateLayoutSchema.parse(row.layout),
    backgroundMediaId: row.backgroundMediaId,
    version: row.version,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getTemplates(db: Reader, courseId: string): Promise<TemplatesDto> {
  const rows = await db
    .select()
    .from(certificateTemplate)
    .where(eq(certificateTemplate.courseId, courseId));
  const draft = rows.find((row) => row.status === 'draft');
  const published = rows.find((row) => row.status === 'published');
  return {
    draft: draft ? toDto(draft) : null,
    published: published ? toDto(published) : null,
  };
}

/** O template PUBLICADO do curso (para a emissão): layout e fundo, ou `null` se não há. */
export async function readPublishedTemplateIn(tx: Reader, courseId: string) {
  const [row] = await tx
    .select()
    .from(certificateTemplate)
    .where(
      and(eq(certificateTemplate.courseId, courseId), eq(certificateTemplate.status, 'published')),
    );
  return row
    ? {
        layout: certificateLayoutSchema.parse(row.layout),
        backgroundMediaId: row.backgroundMediaId,
      }
    : null;
}

async function requireCourse(tx: DomainTx, courseId: string) {
  const [exists] = await tx.select({ id: course.id }).from(course).where(eq(course.id, courseId));
  if (!exists) throw new TemplateCourseNotFoundError();
}

/** Grava (ou atualiza) o RASCUNHO. Erros de layout NÃO impedem salvar: só publicar exige layout sem erro. */
export async function saveTemplateDraft(
  db: Database,
  input: TemplateDraftInput & { actorId: string; courseId: string },
): Promise<TemplateDto> {
  try {
    return await db.transaction(async (tx) => {
      await requireCourse(tx, input.courseId);
      const [existing] = await tx
        .select()
        .from(certificateTemplate)
        .where(
          and(
            eq(certificateTemplate.courseId, input.courseId),
            eq(certificateTemplate.status, 'draft'),
          ),
        )
        .for('update');
      if (existing ? existing.version !== input.expectedVersion : input.expectedVersion !== null) {
        throw new TemplateConflictError(existing ? existing.version : null);
      }
      await setReferenceIn(tx, {
        ownerType: 'certificate_template',
        ownerId: input.courseId,
        slot: 'draft_background',
        mediaId: input.backgroundMediaId,
        purpose: 'certificate_asset',
      });
      let saved: Row | undefined;
      if (existing) {
        [saved] = await tx
          .update(certificateTemplate)
          .set({
            layout: input.layout,
            backgroundMediaId: input.backgroundMediaId,
            version: existing.version + 1,
            updatedBy: input.actorId,
          })
          .where(eq(certificateTemplate.id, existing.id))
          .returning();
      } else {
        [saved] = await tx
          .insert(certificateTemplate)
          .values({
            courseId: input.courseId,
            status: 'draft',
            layout: input.layout,
            backgroundMediaId: input.backgroundMediaId,
            updatedBy: input.actorId,
          })
          .returning();
      }
      await auditEvent(tx, {
        actorId: input.actorId,
        action: 'certificate.template.save_draft',
        targetType: 'course',
        targetId: input.courseId,
        details: { version: saved!.version },
      });
      return toDto(saved!);
    });
  } catch (error) {
    // Dois Admins criando o primeiro rascunho ao mesmo tempo: o índice único decide, o outro recebe conflito.
    if (isUniqueViolation(error)) throw new TemplateConflictError(null);
    throw error;
  }
}

/** Descarta o rascunho (e a referência do fundo dele). O publicado não é afetado. */
export async function discardTemplateDraft(
  db: Database,
  input: { actorId: string; courseId: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await requireCourse(tx, input.courseId);
    const removed = await tx
      .delete(certificateTemplate)
      .where(
        and(
          eq(certificateTemplate.courseId, input.courseId),
          eq(certificateTemplate.status, 'draft'),
        ),
      )
      .returning({ id: certificateTemplate.id });
    await tx
      .delete(mediaReference)
      .where(
        and(
          eq(mediaReference.ownerType, 'certificate_template'),
          eq(mediaReference.ownerId, input.courseId),
          eq(mediaReference.slot, 'draft_background'),
        ),
      );
    if (removed.length > 0) {
      await auditEvent(tx, {
        actorId: input.actorId,
        action: 'certificate.template.discard_draft',
        targetType: 'course',
        targetId: input.courseId,
      });
    }
    return removed.length > 0;
  });
}

/**
 * Publica o rascunho: valida o layout NO SERVIDOR, congela e vira o template vigente; o publicado anterior vira
 * `superseded`. O fundo passa para o espaço `published_background`. Não há rascunho depois (editar cria outro a partir
 * do publicado).
 */
export async function publishTemplate(
  db: Database,
  input: { actorId: string; courseId: string; expectedVersion: number },
): Promise<TemplateDto> {
  return db.transaction(async (tx) => {
    await requireCourse(tx, input.courseId);
    const [draft] = await tx
      .select()
      .from(certificateTemplate)
      .where(
        and(
          eq(certificateTemplate.courseId, input.courseId),
          eq(certificateTemplate.status, 'draft'),
        ),
      )
      .for('update');
    if (!draft) throw new TemplateDraftMissingError();
    if (draft.version !== input.expectedVersion) throw new TemplateConflictError(draft.version);
    const problems = layoutProblems(certificateLayoutSchema.parse(draft.layout)).filter(
      (problem) => problem.severity === 'error',
    );
    if (problems.length > 0) throw new TemplateLayoutInvalidError(problems);

    await tx
      .update(certificateTemplate)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(certificateTemplate.courseId, input.courseId),
          eq(certificateTemplate.status, 'published'),
        ),
      );
    const [published] = await tx
      .update(certificateTemplate)
      .set({ status: 'published', publishedAt: sql`now()`, updatedBy: input.actorId })
      .where(eq(certificateTemplate.id, draft.id))
      .returning();
    await setReferenceIn(tx, {
      ownerType: 'certificate_template',
      ownerId: input.courseId,
      slot: 'published_background',
      mediaId: draft.backgroundMediaId,
      purpose: 'certificate_asset',
    });
    await setReferenceIn(tx, {
      ownerType: 'certificate_template',
      ownerId: input.courseId,
      slot: 'draft_background',
      mediaId: null,
    });
    await auditEvent(tx, {
      actorId: input.actorId,
      action: 'certificate.template.publish',
      targetType: 'course',
      targetId: input.courseId,
      details: { templateId: draft.id },
    });
    return toDto(published!);
  });
}

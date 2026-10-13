import { and, asc, count, desc, eq, gt, inArray, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { discussionPost, discussionReport, profile } from '../../db/schema';
import {
  MAX_THREADS,
  POST_RATE_LIMIT,
  REPORT_RATE_LIMIT,
  type DiscussionPostDto,
  type LessonDiscussionDto,
} from '../../features/discussion/discussion';
import { loadLessonContext } from '../learning/completion';

/** O post não existe nesta aula (ou a aula foi retirada). */
export class PostNotFoundError extends Error {
  constructor() {
    super('post_not_found');
  }
}

/** Só o autor edita ou exclui o próprio post. */
export class NotAuthorError extends Error {
  constructor() {
    super('not_author');
  }
}

/** O post não está visível (oculto pela moderação ou excluído): não se edita nem se exclui. */
export class PostNotEditableError extends Error {
  constructor() {
    super('post_not_editable');
  }
}

/** Resposta a um post que não existe, não é de topo ou não está visível. */
export class ParentUnavailableError extends Error {
  constructor() {
    super('parent_unavailable');
  }
}

/** Resposta de resposta: só há um nível. */
export class ReplyToReplyError extends Error {
  constructor() {
    super('reply_to_reply');
  }
}

/** Muitas mensagens ou denúncias em pouco tempo. */
export class RateLimitedError extends Error {
  constructor() {
    super('rate_limited');
  }
}

/** Ninguém denuncia o próprio post. */
export class OwnPostError extends Error {
  constructor() {
    super('own_post');
  }
}

/** A pessoa já denunciou este post. */
export class AlreadyReportedError extends Error {
  constructor() {
    super('already_reported');
  }
}

type Row = typeof discussionPost.$inferSelect;
type Reader = Pick<Database, 'select'>;

const FALLBACK_NAME = 'Pessoa';

/** Nome de exibição do perfil (nunca o e-mail), por id. */
export async function displayNames(db: Reader, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ userId: profile.userId, name: profile.displayName })
    .from(profile)
    .where(inArray(profile.userId, [...new Set(ids)]));
  return new Map(rows.map((row) => [row.userId, row.name]));
}

function toDto(row: Row, names: Map<string, string>, viewerId: string): DiscussionPostDto {
  const hidden = row.state !== 'visible';
  return {
    id: row.id,
    authorName: names.get(row.authorId) ?? FALLBACK_NAME,
    authorRole: row.authorRole as 'student' | 'staff',
    body: hidden ? null : row.body,
    ...(hidden ? { placeholder: row.state as 'hidden' | 'deleted' } : {}),
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    mine: row.authorId === viewerId,
  };
}

/**
 * A conversa de uma aula como a pessoa a lê (o CHAMADOR já conferiu que a aula abre para ela). Só aparece o
 * que está visível: post oculto ou excluído que ainda tem resposta visível vira um LUGAR ("mensagem removida")
 * sem texto; sem resposta visível, some. Resposta oculta ou excluída some. As conversas vêm da mais nova
 * para a mais antiga (até `MAX_THREADS`) e as respostas, da mais antiga para a mais nova.
 */
export async function listLessonDiscussion(
  db: Database,
  input: { userId: string; lessonId: string },
): Promise<LessonDiscussionDto> {
  const roots = await db
    .select()
    .from(discussionPost)
    .where(
      and(eq(discussionPost.lessonId, input.lessonId), sql`${discussionPost.parentId} is null`),
    )
    .orderBy(desc(discussionPost.createdAt), desc(discussionPost.id))
    .limit(MAX_THREADS * 2);
  const replies = roots.length
    ? await db
        .select()
        .from(discussionPost)
        .where(
          and(
            inArray(
              discussionPost.parentId,
              roots.map((row) => row.id),
            ),
            eq(discussionPost.state, 'visible'),
          ),
        )
        .orderBy(asc(discussionPost.createdAt), asc(discussionPost.id))
    : [];
  const names = await displayNames(db, [
    ...roots.filter((row) => row.state === 'visible').map((row) => row.authorId),
    ...replies.map((row) => row.authorId),
  ]);
  const threads = roots
    .map((root) => ({
      root,
      replies: replies.filter((reply) => reply.parentId === root.id),
    }))
    .filter((thread) => thread.root.state === 'visible' || thread.replies.length > 0)
    .slice(0, MAX_THREADS)
    .map((thread) => ({
      post: toDto(thread.root, names, input.userId),
      replies: thread.replies.map((reply) => toDto(reply, names, input.userId)),
    }));
  return { threads };
}

export interface PostInput {
  userId: string;
  lessonId: string;
  body: string;
  parentId?: string | undefined;
  clock?: () => Date;
}

/**
 * Escreve uma pergunta ou uma resposta (M5-05), numa transação. Reverifica acesso, expiração, drip e sequência
 * (a matrícula é travada, então duas mensagens da mesma pessoa entram em fila e o limite de frequência é
 * exato). Staff sem matrícula é recusada como qualquer pessoa sem acesso: a prévia não cria post.
 */
export async function createPost(db: Database, input: PostInput): Promise<DiscussionPostDto> {
  return db.transaction(async (tx) => {
    const context = await loadLessonContext(tx, {
      userId: input.userId,
      lessonId: input.lessonId,
      clock: input.clock,
    });
    const since = new Date(context.now.getTime() - POST_RATE_LIMIT.windowMinutes * 60_000);
    const [recent] = await tx
      .select({ total: count() })
      .from(discussionPost)
      .where(and(eq(discussionPost.authorId, input.userId), gt(discussionPost.createdAt, since)));
    if ((recent?.total ?? 0) >= POST_RATE_LIMIT.count) throw new RateLimitedError();

    if (input.parentId !== undefined) {
      const [parent] = await tx
        .select()
        .from(discussionPost)
        .where(
          and(eq(discussionPost.id, input.parentId), eq(discussionPost.lessonId, input.lessonId)),
        );
      if (!parent) throw new ParentUnavailableError();
      if (parent.parentId !== null) throw new ReplyToReplyError();
      if (parent.state !== 'visible') throw new ParentUnavailableError();
    }
    const [created] = await tx
      .insert(discussionPost)
      .values({
        courseId: context.courseId,
        lessonId: input.lessonId,
        parentId: input.parentId ?? null,
        authorId: input.userId,
        authorRole: 'student',
        body: input.body,
        createdAt: context.now,
        updatedAt: context.now,
      })
      .returning();
    const names = await displayNames(tx, [input.userId]);
    return toDto(created!, names, input.userId);
  });
}

/** Carrega o post PRÓPRIO desta aula, travado, depois de reverificar o acesso. */
async function ownPostForUpdate(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  input: { userId: string; lessonId: string; postId: string; clock?: (() => Date) | undefined },
) {
  const context = await loadLessonContext(tx, {
    userId: input.userId,
    lessonId: input.lessonId,
    clock: input.clock,
  });
  const [post] = await tx
    .select()
    .from(discussionPost)
    .where(and(eq(discussionPost.id, input.postId), eq(discussionPost.lessonId, input.lessonId)))
    .for('update');
  if (!post) throw new PostNotFoundError();
  if (post.authorId !== input.userId) throw new NotAuthorError();
  if (post.state !== 'visible') throw new PostNotEditableError();
  return { context, post };
}

/** O autor edita o texto do próprio post (visível). */
export async function editPost(
  db: Database,
  input: {
    userId: string;
    lessonId: string;
    postId: string;
    body: string;
    clock?: () => Date;
  },
): Promise<DiscussionPostDto> {
  return db.transaction(async (tx) => {
    const { context } = await ownPostForUpdate(tx, input);
    const [updated] = await tx
      .update(discussionPost)
      .set({ body: input.body, editedAt: context.now, updatedAt: context.now })
      .where(eq(discussionPost.id, input.postId))
      .returning();
    return toDto(updated!, await displayNames(tx, [input.userId]), input.userId);
  });
}

/** O autor exclui o próprio post (a linha fica, como `deleted`; as respostas dele continuam). */
export async function deleteOwnPost(
  db: Database,
  input: { userId: string; lessonId: string; postId: string; clock?: () => Date },
): Promise<void> {
  await db.transaction(async (tx) => {
    const { context } = await ownPostForUpdate(tx, input);
    await tx
      .update(discussionPost)
      .set({ state: 'deleted', updatedAt: context.now })
      .where(eq(discussionPost.id, input.postId));
  });
}

/**
 * Denuncia um post visível de OUTRA pessoa (uma denúncia por pessoa e post), com limite por janela de tempo.
 * Alimenta a fila da Staff; o texto da denúncia (opcional) fica só para a Staff.
 */
export async function reportPost(
  db: Database,
  input: {
    userId: string;
    lessonId: string;
    postId: string;
    reason?: string | undefined;
    clock?: () => Date;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const context = await loadLessonContext(tx, {
      userId: input.userId,
      lessonId: input.lessonId,
      clock: input.clock,
    });
    const [post] = await tx
      .select()
      .from(discussionPost)
      .where(and(eq(discussionPost.id, input.postId), eq(discussionPost.lessonId, input.lessonId)));
    if (!post || post.state !== 'visible') throw new PostNotFoundError();
    if (post.authorId === input.userId) throw new OwnPostError();
    const since = new Date(context.now.getTime() - REPORT_RATE_LIMIT.windowMinutes * 60_000);
    const [recent] = await tx
      .select({ total: count() })
      .from(discussionReport)
      .where(
        and(eq(discussionReport.reporterId, input.userId), gt(discussionReport.createdAt, since)),
      );
    if ((recent?.total ?? 0) >= REPORT_RATE_LIMIT.count) throw new RateLimitedError();
    const inserted = await tx
      .insert(discussionReport)
      .values({
        postId: input.postId,
        reporterId: input.userId,
        reason: input.reason ?? null,
        createdAt: context.now,
      })
      .onConflictDoNothing()
      .returning({ postId: discussionReport.postId });
    if (inserted.length === 0) throw new AlreadyReportedError();
  });
}

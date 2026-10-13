import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { course, discussionPost, discussionReport, lesson } from '../../db/schema';
import {
  nextState,
  type DiscussionPostDto,
  type ModerationAction,
  type PostState,
  type StaffDiscussionItemDto,
} from '../../features/discussion/discussion';
import { auditEvent } from '../auth/access-store';
import { ParentUnavailableError, PostNotFoundError, displayNames } from './store';

const QUEUE_LIMIT = 50;

/** A transição pedida não vale para o estado atual (ex.: restaurar o que o autor excluiu). */
export class InvalidTransitionError extends Error {
  constructor() {
    super('invalid_transition');
  }
}

/** Não há denúncia aberta neste post. */
export class NoOpenReportsError extends Error {
  constructor() {
    super('no_open_reports');
  }
}

/**
 * A fila da Staff (M5-05): `reported` = posts com denúncia ABERTA (qualquer estado, o mais antigo primeiro);
 * `unanswered` = perguntas visíveis de alunos, de aulas ainda no currículo, sem resposta visível da equipe (a
 * mais nova primeiro). Cada item traz o texto completo e o contexto da aula, para a Staff decidir.
 */
export async function listStaffDiscussions(
  db: Database,
  view: 'reported' | 'unanswered',
): Promise<StaffDiscussionItemDto[]> {
  let ids: string[];
  if (view === 'reported') {
    const open = await db
      .select({
        postId: discussionReport.postId,
        first: sql<Date>`min(${discussionReport.createdAt})`,
      })
      .from(discussionReport)
      .where(isNull(discussionReport.resolvedAt))
      .groupBy(discussionReport.postId)
      .orderBy(sql`min(${discussionReport.createdAt}) asc`)
      .limit(QUEUE_LIMIT);
    ids = open.map((row) => row.postId);
  } else {
    const rows = await db
      .select({ id: discussionPost.id })
      .from(discussionPost)
      .innerJoin(lesson, eq(lesson.id, discussionPost.lessonId))
      .where(
        and(
          isNull(discussionPost.parentId),
          eq(discussionPost.state, 'visible'),
          eq(discussionPost.authorRole, 'student'),
          isNull(lesson.retiredAt),
          sql`not exists (
            select 1 from discussion_post reply
            where reply.parent_id = ${discussionPost.id}
              and reply.author_role = 'staff' and reply.state = 'visible'
          )`,
        ),
      )
      .orderBy(desc(discussionPost.createdAt))
      .limit(QUEUE_LIMIT);
    ids = rows.map((row) => row.id);
  }
  if (ids.length === 0) return [];

  const posts = await db
    .select({
      post: discussionPost,
      lessonTitle: lesson.title,
      courseTitle: course.title,
    })
    .from(discussionPost)
    .innerJoin(lesson, eq(lesson.id, discussionPost.lessonId))
    .innerJoin(course, eq(course.id, discussionPost.courseId))
    .where(inArray(discussionPost.id, ids));
  const reports = await db
    .select({ postId: discussionReport.postId, total: sql<number>`count(*)::int` })
    .from(discussionReport)
    .where(and(inArray(discussionReport.postId, ids), isNull(discussionReport.resolvedAt)))
    .groupBy(discussionReport.postId);
  const staffReplies = await db
    .select({ parentId: discussionPost.parentId, total: sql<number>`count(*)::int` })
    .from(discussionPost)
    .where(
      and(
        inArray(discussionPost.parentId, ids),
        eq(discussionPost.authorRole, 'staff'),
        eq(discussionPost.state, 'visible'),
      ),
    )
    .groupBy(discussionPost.parentId);
  const names = await displayNames(
    db,
    posts.map((row) => row.post.authorId),
  );
  const openByPost = new Map(reports.map((row) => [row.postId, row.total]));
  const repliesByPost = new Map(staffReplies.map((row) => [row.parentId!, row.total]));
  const byId = new Map(posts.map((row) => [row.post.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    return [
      {
        id,
        lessonId: row.post.lessonId,
        lessonTitle: row.lessonTitle,
        courseTitle: row.courseTitle,
        authorName: names.get(row.post.authorId) ?? 'Pessoa',
        authorRole: row.post.authorRole as 'student' | 'staff',
        state: row.post.state as PostState,
        isReply: row.post.parentId !== null,
        body: row.post.body,
        createdAt: row.post.createdAt.toISOString(),
        openReports: openByPost.get(id) ?? 0,
        staffReplies: repliesByPost.get(id) ?? 0,
      },
    ];
  });
}

/**
 * A equipe responde a uma pergunta (de topo e visível, de aula ainda no currículo). A resposta nasce com papel
 * `staff` (a tela a marca como "Equipe"), fica auditada e não depende de matrícula da Staff.
 */
export async function staffReply(
  db: Database,
  input: { actorId: string; parentId: string; body: string },
): Promise<DiscussionPostDto> {
  return db.transaction(async (tx) => {
    const [parent] = await tx
      .select({ post: discussionPost, retiredAt: lesson.retiredAt })
      .from(discussionPost)
      .innerJoin(lesson, eq(lesson.id, discussionPost.lessonId))
      .where(eq(discussionPost.id, input.parentId));
    if (!parent) throw new PostNotFoundError();
    if (
      parent.retiredAt !== null ||
      parent.post.parentId !== null ||
      parent.post.state !== 'visible'
    ) {
      throw new ParentUnavailableError();
    }
    const [created] = await tx
      .insert(discussionPost)
      .values({
        courseId: parent.post.courseId,
        lessonId: parent.post.lessonId,
        parentId: parent.post.id,
        authorId: input.actorId,
        authorRole: 'staff',
        body: input.body,
      })
      .returning();
    await auditEvent(tx, {
      actorId: input.actorId,
      action: 'discussion.staff_reply',
      targetType: 'discussion_post',
      targetId: created!.id,
      details: { lessonId: parent.post.lessonId, parentId: parent.post.id },
    });
    const names = await displayNames(tx, [input.actorId]);
    return {
      id: created!.id,
      authorName: names.get(input.actorId) ?? 'Equipe',
      authorRole: 'staff',
      body: created!.body,
      createdAt: created!.createdAt.toISOString(),
      editedAt: null,
      mine: true,
    };
  });
}

/**
 * Oculta, restaura ou exclui um post, com MOTIVO, na mesma transação da auditoria. Fecha as denúncias abertas
 * do post (a Staff já agiu). O texto do post nunca vai para a auditoria: só ação, estados, aula e motivo.
 */
export async function moderatePost(
  db: Database,
  input: { actorId: string; postId: string; action: ModerationAction; reason: string },
): Promise<{ state: PostState }> {
  return db.transaction(async (tx) => {
    const [post] = await tx
      .select()
      .from(discussionPost)
      .where(eq(discussionPost.id, input.postId))
      .for('update');
    if (!post) throw new PostNotFoundError();
    const to = nextState(post.state as PostState, input.action);
    if (!to) throw new InvalidTransitionError();
    await tx
      .update(discussionPost)
      .set({ state: to, updatedAt: sql`now()` })
      .where(eq(discussionPost.id, post.id));
    await tx
      .update(discussionReport)
      .set({ resolvedAt: sql`now()` })
      .where(and(eq(discussionReport.postId, post.id), isNull(discussionReport.resolvedAt)));
    await auditEvent(tx, {
      actorId: input.actorId,
      action: `discussion.${input.action}`,
      targetType: 'discussion_post',
      targetId: post.id,
      details: { lessonId: post.lessonId, from: post.state, to, reason: input.reason },
    });
    return { state: to };
  });
}

/** Descarta as denúncias abertas de um post sem mudar o post (a Staff leu e não houve infração). */
export async function dismissReports(
  db: Database,
  input: { actorId: string; postId: string; reason?: string | undefined },
): Promise<{ dismissed: number }> {
  return db.transaction(async (tx) => {
    const closed = await tx
      .update(discussionReport)
      .set({ resolvedAt: sql`now()` })
      .where(and(eq(discussionReport.postId, input.postId), isNull(discussionReport.resolvedAt)))
      .returning({ reporterId: discussionReport.reporterId });
    if (closed.length === 0) throw new NoOpenReportsError();
    await auditEvent(tx, {
      actorId: input.actorId,
      action: 'discussion.dismiss_reports',
      targetType: 'discussion_post',
      targetId: input.postId,
      details: { dismissed: closed.length, ...(input.reason ? { reason: input.reason } : {}) },
    });
    return { dismissed: closed.length };
  });
}

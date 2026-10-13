import { and, asc, count, desc, eq, gt, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { course, helpFaqItem, profile, supportRequest } from '../../db/schema';
import type { RichText } from '../../features/content/rich-text';
import {
  HELP_CATEGORY_LABELS,
  SUPPORT_LIST_LIMIT,
  SUPPORT_RATE_LIMIT,
  type FaqState,
  type HelpCategory,
  type HelpFaqItemDto,
  type SupportRequestItemDto,
} from '../../features/help/help';
import { queueEmail } from '../email/email-store';

/** O item da FAQ não existe. */
export class FaqItemNotFoundError extends Error {
  constructor() {
    super('faq_item_not_found');
  }
}

/** O curso do contexto não existe. */
export class SupportContextInvalidError extends Error {
  constructor() {
    super('support_context_invalid');
  }
}

/** Muitos pedidos em pouco tempo. */
export class SupportRateLimitedError extends Error {
  constructor() {
    super('rate_limited');
  }
}

type FaqRow = typeof helpFaqItem.$inferSelect;

const toFaqDto = (row: FaqRow): HelpFaqItemDto => ({
  id: row.id,
  category: row.category as HelpCategory,
  question: row.question,
  answer: row.answer as RichText,
  state: row.state as FaqState,
});

/** O que quem está logado vê: só os PUBLICADOS, na ordem da Staff. */
export async function listPublishedFaq(db: Database): Promise<HelpFaqItemDto[]> {
  const rows = await db
    .select()
    .from(helpFaqItem)
    .where(eq(helpFaqItem.state, 'published'))
    .orderBy(asc(helpFaqItem.position), asc(helpFaqItem.id));
  return rows.map(toFaqDto);
}

/** Todos, inclusive rascunhos (Staff). */
export async function listAllFaq(db: Database): Promise<HelpFaqItemDto[]> {
  const rows = await db
    .select()
    .from(helpFaqItem)
    .orderBy(asc(helpFaqItem.position), asc(helpFaqItem.id));
  return rows.map(toFaqDto);
}

/** Cria um item (rascunho, no fim da lista). */
export async function createFaqItem(
  db: Database,
  input: { category: HelpCategory; question: string; answer: RichText },
): Promise<HelpFaqItemDto> {
  return db.transaction(async (tx) => {
    // Tabela pequena e editada raramente: trava a tabela para serializar a numeração (sem posição repetida).
    await tx.execute(sql`lock table help_faq_item in share row exclusive mode`);
    const [last] = await tx
      .select({ position: helpFaqItem.position })
      .from(helpFaqItem)
      .orderBy(desc(helpFaqItem.position))
      .limit(1);
    const [created] = await tx
      .insert(helpFaqItem)
      .values({
        category: input.category,
        question: input.question,
        answer: input.answer,
        position: (last?.position ?? -1) + 1,
      })
      .returning();
    return toFaqDto(created!);
  });
}

export async function updateFaqItem(
  db: Database,
  input: { id: string; category: HelpCategory; question: string; answer: RichText },
): Promise<HelpFaqItemDto> {
  const [row] = await db
    .update(helpFaqItem)
    .set({
      category: input.category,
      question: input.question,
      answer: input.answer,
      updatedAt: sql`now()`,
    })
    .where(eq(helpFaqItem.id, input.id))
    .returning();
  if (!row) throw new FaqItemNotFoundError();
  return toFaqDto(row);
}

export async function setFaqState(
  db: Database,
  input: { id: string; state: FaqState },
): Promise<HelpFaqItemDto> {
  const [row] = await db
    .update(helpFaqItem)
    .set({ state: input.state, updatedAt: sql`now()` })
    .where(eq(helpFaqItem.id, input.id))
    .returning();
  if (!row) throw new FaqItemNotFoundError();
  return toFaqDto(row);
}

export async function deleteFaqItem(db: Database, id: string): Promise<void> {
  const deleted = await db
    .delete(helpFaqItem)
    .where(eq(helpFaqItem.id, id))
    .returning({ id: helpFaqItem.id });
  if (deleted.length === 0) throw new FaqItemNotFoundError();
}

/**
 * Sobe ou desce um item trocando a posição com o vizinho, numa transação que trava as linhas (duas trocas
 * simultâneas entram em fila). Já na ponta, não faz nada.
 */
export async function moveFaqItem(
  db: Database,
  input: { id: string; direction: 'up' | 'down' },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`lock table help_faq_item in share row exclusive mode`);
    const rows = await tx
      .select({ id: helpFaqItem.id, position: helpFaqItem.position })
      .from(helpFaqItem)
      .orderBy(asc(helpFaqItem.position), asc(helpFaqItem.id));
    const index = rows.findIndex((row) => row.id === input.id);
    if (index === -1) throw new FaqItemNotFoundError();
    const other = rows[input.direction === 'up' ? index - 1 : index + 1];
    if (!other) return;
    // Renumera a lista inteira (0..n-1) com os dois trocados: nunca deixa posições repetidas.
    const ordered = rows.map((row) => row.id);
    [ordered[index], ordered[input.direction === 'up' ? index - 1 : index + 1]] = [
      ordered[input.direction === 'up' ? index - 1 : index + 1]!,
      ordered[index]!,
    ];
    for (const [position, id] of ordered.entries()) {
      await tx.update(helpFaqItem).set({ position }).where(eq(helpFaqItem.id, id));
    }
  });
}

/**
 * Abre um pedido de suporte (M5-14): confere o limite (3 por 10 min por pessoa) e o curso do contexto, grava o
 * pedido E a intenção do e-mail ao suporte na MESMA transação (o texto fica aqui; o e-mail leva só o id e a
 * categoria, com o `Reply-To` da pessoa colocado no envio). Falha do Resend nunca perde o pedido.
 */
export async function createSupportRequest(
  db: Database,
  input: {
    userId: string;
    category: HelpCategory;
    message: string;
    courseId?: string | undefined;
    now?: Date;
  },
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const now = input.now ?? new Date();
    // Trava a linha da pessoa: dois pedidos simultâneos dela entram em fila e o limite fica exato.
    await tx.execute(sql`select 1 from "user" where id = ${input.userId} for update`);
    const since = new Date(now.getTime() - SUPPORT_RATE_LIMIT.windowMinutes * 60_000);
    const [recent] = await tx
      .select({ total: count() })
      .from(supportRequest)
      .where(and(eq(supportRequest.userId, input.userId), gt(supportRequest.createdAt, since)));
    if ((recent?.total ?? 0) >= SUPPORT_RATE_LIMIT.count) throw new SupportRateLimitedError();
    if (input.courseId !== undefined) {
      const [found] = await tx
        .select({ id: course.id })
        .from(course)
        .where(eq(course.id, input.courseId));
      if (!found) throw new SupportContextInvalidError();
    }
    const [created] = await tx
      .insert(supportRequest)
      .values({
        userId: input.userId,
        category: input.category,
        message: input.message,
        courseId: input.courseId ?? null,
        createdAt: now,
      })
      .returning({ id: supportRequest.id });
    await queueEmail(tx, {
      template: 'support-request',
      dedupeKey: `support-request:${created!.id}`,
      variables: { REQUEST_ID: created!.id, CATEGORY: HELP_CATEGORY_LABELS[input.category] },
      correlationId: crypto.randomUUID(),
    });
    return { id: created!.id };
  });
}

/** Os pedidos mais recentes, para a Staff ler o texto (o e-mail só leva o id e a categoria). */
export async function listSupportRequests(db: Database): Promise<SupportRequestItemDto[]> {
  const rows = await db
    .select({
      id: supportRequest.id,
      category: supportRequest.category,
      message: supportRequest.message,
      createdAt: supportRequest.createdAt,
      courseTitle: course.title,
      authorName: profile.displayName,
    })
    .from(supportRequest)
    .leftJoin(course, eq(course.id, supportRequest.courseId))
    .leftJoin(profile, eq(profile.userId, supportRequest.userId))
    .orderBy(desc(supportRequest.createdAt), desc(supportRequest.id))
    .limit(SUPPORT_LIST_LIMIT);
  return rows.map((row) => ({
    id: row.id,
    category: row.category as HelpCategory,
    message: row.message,
    courseTitle: row.courseTitle,
    authorName: row.authorName ?? 'Pessoa',
    createdAt: row.createdAt.toISOString(),
  }));
}

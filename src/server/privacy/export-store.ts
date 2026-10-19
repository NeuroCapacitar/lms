import { sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { isAnonymizedEmail } from '../../features/privacy/erasure-policy';

/**
 * Exportação dos dados de UMA pessoa (acesso e portabilidade, M9-10). Só leitura. Lista os dados que a plataforma guarda
 * SOBRE a pessoa, em colunas escolhidas uma a uma: **nunca** senha, token, chave, o documento cifrado do pagador nem o
 * identificador de sessão. Quem pede o arquivo é o script, que o grava em disco com permissão restrita; este módulo
 * devolve o objeto e nunca o imprime.
 */
export interface PersonExport {
  version: 1;
  exportedAt: string;
  person: { id: string; name: string; email: string; createdAt: string };
  sections: Record<string, Record<string, unknown>[]>;
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  return (result as { rows: Record<string, unknown>[] }).rows;
}

export async function exportPersonData(
  db: Database,
  userId: string,
): Promise<PersonExport | 'not_found' | 'already_erased'> {
  const person = rowsOf(
    await db.execute(sql`select id, name, email, created_at from "user" where id = ${userId}`),
  )[0];
  if (!person) return 'not_found';
  if (isAnonymizedEmail(String(person.email))) return 'already_erased';

  const select = async (query: ReturnType<typeof sql>) => rowsOf(await db.execute(query));
  const sections: PersonExport['sections'] = {
    perfil: await select(sql`
      select display_name, certificate_name, certificate_name_confirmed_at, theme, auto_advance, created_at
        from profile where user_id = ${userId}`),
    matriculas: await select(sql`
      select c.title as curso, e.anchor_at, e.effective_expires_at, e.suspended_at, e.created_at
        from enrollment e join course c on c.id = e.course_id
       where e.user_id = ${userId} order by e.created_at`),
    acessos: await select(sql`
      select c.title as curso, a.source, a.starts_at, a.expires_at, a.revoked_at, a.created_at
        from entitlement a join course c on c.id = a.course_id
       where a.user_id = ${userId} order by a.created_at`),
    aulas_concluidas: await select(sql`
      select lesson_id, completed_at, method from lesson_completion
       where user_id = ${userId} order by completed_at`),
    conclusoes_de_curso: await select(sql`
      select c.title as curso, cc.completed_at from course_completion cc join course c on c.id = cc.course_id
       where cc.user_id = ${userId} order by cc.completed_at`),
    tentativas_de_quiz: await select(sql`
      select lesson_id, number, earned_points, total_points, score_percent, passed, created_at
        from quiz_attempt where user_id = ${userId} order by created_at`),
    progresso_de_video: await select(sql`
      select lesson_id, max_position, duration_seconds, completed_at, updated_at
        from video_progress where user_id = ${userId} order by updated_at`),
    certificados: await select(sql`
      select code, status, ready_at, revoked_at, created_at from certificate
       where user_id = ${userId} order by created_at`),
    pedidos: await select(sql`
      select o.id, o.course_title, o.offer_name, o.price_cents, o.currency, o.status, o.created_at
        from purchase_order o where o.user_id = ${userId} order by o.created_at`),
    pagamentos: await select(sql`
      select p.order_id, p.method, p.amount_cents, p.provider_status, p.paid_at, p.payer_name, p.payer_document_masked
        from payment p join purchase_order o on o.id = p.order_id
       where o.user_id = ${userId} order by p.created_at`),
    reembolsos: await select(sql`
      select r.order_id, r.state, r.reason, r.created_at, r.completed_at
        from refund_request r join purchase_order o on o.id = r.order_id
       where o.user_id = ${userId} order by r.created_at`),
    mensagens_nas_discussoes: await select(sql`
      select course_id, lesson_id, body, state, created_at, edited_at from discussion_post
       where author_id = ${userId} order by created_at`),
    denuncias_feitas: await select(sql`
      select post_id, reason, created_at from discussion_report
       where reporter_id = ${userId} order by created_at`),
    pedidos_de_suporte: await select(sql`
      select category, message, course_id, created_at from support_request
       where user_id = ${userId} order by created_at`),
    interesse_em_cursos: await select(sql`
      select course_id, status, created_at from course_interest
       where user_id = ${userId} order by created_at`),
    aceite_dos_termos: await select(sql`
      select document_version_id, accepted_at, adult_declared from terms_acceptance
       where user_id = ${userId} order by accepted_at`),
    e_mails_enviados: await select(sql`
      select template, state, created_at, accepted_at from email_message
       where recipient_user_id = ${userId} order by created_at`),
  };

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    person: {
      id: String(person.id),
      name: String(person.name),
      email: String(person.email),
      createdAt: new Date(String(person.created_at)).toISOString(),
    },
    sections,
  };
}

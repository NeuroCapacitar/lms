import { sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import {
  FUNNEL_WINDOW_DAYS,
  LEARNING_DEFINITIONS,
  OFFER_DEFINITIONS,
  type CourseAnalyticsDto,
  type InterestConversionRow,
  type LessonAnalytics,
  type OfferAnalyticsDto,
  type OfferFunnelRow,
} from '../../features/staff/analytics';

function rowsOf(result: unknown): Record<string, unknown>[] {
  return (result as { rows: Record<string, unknown>[] }).rows;
}
const num = (value: unknown) => Number(value ?? 0);

/** O instante da leitura, pelo `now()` do banco. */
async function dbNow(db: Database): Promise<string> {
  const value = rowsOf(await db.execute(sql`select now() as now`))[0]?.now;
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Fatos de aprendizagem de UM curso (M9-02). SOMENTE LEITURA, derivados de tabelas que já existem; nada é gravado. "Com acesso" é a regra
 * de `decideAccess` em SQL (a mesma do painel). Atividade = aula concluída, vídeo assistido ou tentativa de quiz; quem nunca teve
 * conta desde a matrícula. `null` = o curso não existe.
 */
export async function loadCourseAnalytics(
  db: Database,
  courseId: string,
): Promise<CourseAnalyticsDto | null> {
  const [course] = rowsOf(
    await db.execute(sql`select id::text as id, title from course where id = ${courseId}::uuid`),
  );
  if (!course) return null;

  const [summary] = rowsOf(
    await db.execute(sql`
      with access_now as (
        select e.user_id
          from entitlement e
          join enrollment en
            on en.user_id = e.user_id and en.course_id = e.course_id and en.suspended_at is null
         where e.course_id = ${courseId}::uuid and e.revoked_at is null
           and not exists (
             select 1 from user_suspension s where s.user_id = e.user_id and s.lifted_at is null)
         group by e.user_id
        having bool_or(e.starts_at <= now() and e.expires_at > now())
      ),
      activity as (
        select user_id, max(at) as last_at
          from (
            select user_id, completed_at as at from lesson_completion where course_id = ${courseId}::uuid
            union all
            select user_id, updated_at from video_progress where course_id = ${courseId}::uuid
            union all
            select user_id, created_at from quiz_attempt where course_id = ${courseId}::uuid
          ) events
         group by user_id
      ),
      people as (
        select a.user_id, coalesce(act.last_at, en.anchor_at) as last_at
          from access_now a
          join enrollment en on en.user_id = a.user_id and en.course_id = ${courseId}::uuid
          left join activity act on act.user_id = a.user_id
      ),
      required as (
        select id from lesson
         where course_id = ${courseId}::uuid and retired_at is null and not is_optional
      ),
      done as (
        select p.user_id, count(r.id)::int as n
          from people p
          left join lesson_completion lc
            on lc.user_id = p.user_id and lc.course_id = ${courseId}::uuid
          left join required r on r.id = lc.lesson_id
         group by p.user_id
      ),
      totals as (select count(*)::int as total from required)
      select
        (select count(*) from enrollment where course_id = ${courseId}::uuid)::int as enrolled,
        (select count(*) from people)::int as with_access,
        (select count(*) from people where last_at <= now() - interval '14 days')::int as d14,
        (select count(*) from people where last_at <= now() - interval '30 days')::int as d30,
        (select total from totals) as required_total,
        (select count(*) from done where n = 0)::int as band0,
        (select count(*) from done, totals where n > 0 and 2 * n < total)::int as band1,
        (select count(*) from done, totals where 2 * n >= total and n < total)::int as band2,
        (select count(*) from done, totals where total > 0 and n = total)::int as band3`),
  );

  const lessons: LessonAnalytics[] = rowsOf(
    await db.execute(sql`
      select l.id::text as id, l.title, l.kind, l.is_optional,
             (select count(*) from lesson_completion lc where lc.lesson_id = l.id)::int as completions,
             vp.started, vp.completed, vp.b1, vp.b2, vp.b3, vp.b4,
             qa.people, qa.attempts, qa.passed
        from lesson l
        join module m on m.id = l.module_id
        left join lateral (
          select count(*)::int as started,
                 (count(*) filter (where v.completed_at is not null))::int as completed,
                 (count(*) filter (where v.duration_seconds <= 0 or v.max_position * 4 < v.duration_seconds))::int as b1,
                 (count(*) filter (where v.duration_seconds > 0 and v.max_position * 4 >= v.duration_seconds
                                     and v.max_position * 2 < v.duration_seconds))::int as b2,
                 (count(*) filter (where v.duration_seconds > 0 and v.max_position * 2 >= v.duration_seconds
                                     and v.max_position * 4 < 3 * v.duration_seconds))::int as b3,
                 (count(*) filter (where v.duration_seconds > 0 and v.max_position * 4 >= 3 * v.duration_seconds))::int as b4
            from video_progress v where v.lesson_id = l.id
        ) vp on l.kind = 'video'
        left join lateral (
          select count(distinct q.user_id)::int as people,
                 count(*)::int as attempts,
                 (count(distinct q.user_id) filter (where q.passed))::int as passed
            from quiz_attempt q where q.lesson_id = l.id
        ) qa on l.kind = 'quiz'
       where l.course_id = ${courseId}::uuid and l.retired_at is null and m.retired_at is null
       order by m.position, l.position`),
  ).map((row) => ({
    lessonId: row.id as string,
    title: row.title as string,
    kind: row.kind as LessonAnalytics['kind'],
    isOptional: row.is_optional as boolean,
    completions: num(row.completions),
    video:
      row.kind === 'video'
        ? {
            started: num(row.started),
            completed: num(row.completed),
            bands: [num(row.b1), num(row.b2), num(row.b3), num(row.b4)],
          }
        : null,
    quiz:
      row.kind === 'quiz'
        ? {
            attemptedPeople: num(row.people),
            attempts: num(row.attempts),
            passedPeople: num(row.passed),
          }
        : null,
  }));

  const requiredLessons = num(summary?.required_total);
  return {
    generatedAt: await dbNow(db),
    course: { id: course.id as string, title: course.title as string },
    enrolled: num(summary?.enrolled),
    withAccess: num(summary?.with_access),
    inactive: { days14: num(summary?.d14), days30: num(summary?.d30) },
    progressBands:
      requiredLessons === 0
        ? null
        : [num(summary?.band0), num(summary?.band1), num(summary?.band2), num(summary?.band3)],
    requiredLessons,
    lessons,
    definitions: LEARNING_DEFINITIONS,
  };
}

/**
 * Funil das ofertas pagas (pedidos criados na janela) e conversão dos pedidos de aviso, por curso (M9-02). Só `finance.view`.
 * SOMENTE LEITURA; sem nome nem e-mail de ninguém.
 */
export async function loadOfferAnalytics(db: Database): Promise<OfferAnalyticsDto> {
  const offers: OfferFunnelRow[] = rowsOf(
    await db.execute(sql`
      select o.id::text as id, o.name, o.course_id::text as course_id, c.title as course_title,
             o.kind, o.status,
             coalesce(f.created, 0) as created, coalesce(f.opened, 0) as opened,
             coalesce(f.paid, 0) as paid, coalesce(f.expired, 0) as expired,
             coalesce(f.canceled, 0) as canceled, coalesce(f.pending, 0) as pending,
             coalesce(f.refunded, 0) as refunded
        from offer o
        join course c on c.id = o.course_id
        left join (
          select po.offer_id,
                 count(*)::int as created,
                 (count(*) filter (where exists (
                    select 1 from checkout_session cs where cs.order_id = po.id)))::int as opened,
                 (count(*) filter (where po.status in ('paid', 'refund_requested', 'refunded', 'disputed')))::int as paid,
                 (count(*) filter (where po.status = 'expired'))::int as expired,
                 (count(*) filter (where po.status = 'canceled'))::int as canceled,
                 (count(*) filter (where po.status = 'pending'))::int as pending,
                 (count(*) filter (where po.status = 'refunded'))::int as refunded
            from purchase_order po
           where po.created_at >= now() - (${FUNNEL_WINDOW_DAYS}::int * interval '1 day')
           group by po.offer_id
        ) f on f.offer_id = o.id
       where o.kind = 'paid'
       order by c.title, o.name`),
  ).map((row) => ({
    offerId: row.id as string,
    offerName: row.name as string,
    courseId: row.course_id as string,
    courseTitle: row.course_title as string,
    kind: row.kind as 'free' | 'paid',
    status: row.status as string,
    ordersCreated: num(row.created),
    checkoutsOpened: num(row.opened),
    paid: num(row.paid),
    expired: num(row.expired),
    canceled: num(row.canceled),
    pending: num(row.pending),
    refunded: num(row.refunded),
  }));

  const interests: InterestConversionRow[] = rowsOf(
    await db.execute(sql`
      select c.id::text as id, c.title,
             count(*)::int as total,
             (count(*) filter (where ci.status = 'active'))::int as active,
             (count(*) filter (where ci.status = 'withdrawn'))::int as withdrawn,
             (count(*) filter (where ci.status = 'converted'))::int as converted
        from course_interest ci
        join course c on c.id = ci.course_id
       group by c.id, c.title
       order by c.title`),
  ).map((row) => ({
    courseId: row.id as string,
    courseTitle: row.title as string,
    total: num(row.total),
    active: num(row.active),
    withdrawn: num(row.withdrawn),
    converted: num(row.converted),
  }));

  return {
    generatedAt: await dbNow(db),
    windowDays: FUNNEL_WINDOW_DAYS,
    offers,
    interests,
    definitions: OFFER_DEFINITIONS,
  };
}

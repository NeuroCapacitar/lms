import { sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import {
  PANEL_COURSE_LIMIT,
  PANEL_FACTS,
  type PanelCourseRow,
  type PanelFact,
  type PanelFactId,
  type StaffPanelDto,
} from '../../features/staff/panel';

function rowsOf(result: unknown): Record<string, unknown>[] {
  return (result as { rows: Record<string, unknown>[] }).rows;
}

/** Contagens com o `now()` do BANCO. Sem nome, e-mail nem id de pessoa: só números por curso e por estado. */
export async function loadStaffPanel(
  db: Database,
  allowed: { finance: boolean; moderation: boolean },
): Promise<StaffPanelDto> {
  // Mesma regra de `decideAccess`: direito não revogado e dentro da janela, matrícula e conta não suspensas; vale a maior expiração.
  const perCourse = rowsOf(
    await db.execute(sql`
      with current_access as (
        select e.user_id, e.course_id, max(e.expires_at) as ends_at
          from entitlement e
          join enrollment en
            on en.user_id = e.user_id and en.course_id = e.course_id and en.suspended_at is null
         where e.revoked_at is null
           and not exists (
             select 1 from user_suspension s where s.user_id = e.user_id and s.lifted_at is null)
         group by e.user_id, e.course_id
        having bool_or(e.starts_at <= now() and e.expires_at > now())
      )
      select c.id, c.title,
             count(a.user_id)::int as with_access,
             (count(a.user_id) filter (where a.ends_at <= now() + interval '7 days'))::int as expiring
        from course c
        left join current_access a on a.course_id = c.id
       group by c.id, c.title`),
  );
  const completions = rowsOf(
    await db.execute(sql`
      select course_id,
             count(*)::int as total,
             (count(*) filter (where completed_at >= now() - interval '30 days'))::int as last30
        from course_completion group by course_id`),
  );
  const interests = rowsOf(
    await db.execute(sql`
      select course_id, count(*)::int as total
        from course_interest where status = 'active' group by course_id`),
  );
  const certificates = rowsOf(
    await db.execute(sql`
      select status, count(*)::int as total
        from certificate where status in ('ready', 'failed', 'awaiting_name') group by status`),
  );

  const completionByCourse = new Map(completions.map((row) => [row.course_id as string, row]));
  const interestByCourse = new Map(
    interests.map((row) => [row.course_id as string, row.total as number]),
  );
  const sum = (rows: Record<string, unknown>[], key: string) =>
    rows.reduce((total, row) => total + (row[key] as number), 0);
  const countOf = (rows: Record<string, unknown>[], status: string) =>
    (rows.find((row) => row.status === status)?.total as number | undefined) ?? 0;

  const values: Partial<Record<PanelFactId, number>> = {
    access_now: sum(perCourse, 'with_access'),
    expiring_7d: sum(perCourse, 'expiring'),
    completions_30d: sum(completions, 'last30'),
    completions_total: sum(completions, 'total'),
    certificates_ready: countOf(certificates, 'ready'),
    certificates_failed: countOf(certificates, 'failed'),
    certificates_awaiting_name: countOf(certificates, 'awaiting_name'),
    interests_active: sum(interests, 'total'),
  };

  if (allowed.finance) {
    const orders = rowsOf(
      await db.execute(sql`
        select status, count(*)::int as total
          from purchase_order
         where created_at >= now() - interval '30 days'
           and status in ('paid', 'pending', 'refund_requested', 'refunded')
         group by status`),
    );
    values.orders_paid_30d = countOf(orders, 'paid');
    values.orders_pending_30d = countOf(orders, 'pending');
    values.orders_refund_requested_30d = countOf(orders, 'refund_requested');
    values.orders_refunded_30d = countOf(orders, 'refunded');
  }
  if (allowed.moderation) {
    const [reports] = rowsOf(
      await db.execute(sql`
        select count(distinct post_id)::int as total
          from discussion_report where resolved_at is null`),
    );
    values.reports_open = (reports?.total as number | undefined) ?? 0;
  }

  const facts: PanelFact[] = (Object.keys(PANEL_FACTS) as PanelFactId[])
    .filter((id) => values[id] !== undefined)
    .map((id) => ({
      id,
      value: values[id]!,
      label: PANEL_FACTS[id].label,
      definition: PANEL_FACTS[id].definition,
      period: PANEL_FACTS[id].period,
    }));

  const courses: PanelCourseRow[] = perCourse
    .map((row) => {
      const courseId = row.id as string;
      return {
        courseId,
        title: row.title as string,
        withAccess: row.with_access as number,
        expiringIn7Days: row.expiring as number,
        completions: (completionByCourse.get(courseId)?.total as number | undefined) ?? 0,
        activeInterests: interestByCourse.get(courseId) ?? 0,
      };
    })
    .sort((a, b) => b.withAccess - a.withAccess || a.title.localeCompare(b.title, 'pt-BR'));

  const generated = rowsOf(await db.execute(sql`select now() as now`))[0]?.now;
  return {
    generatedAt: generated instanceof Date ? generated.toISOString() : String(generated),
    facts,
    courses: courses.slice(0, PANEL_COURSE_LIMIT),
    coursesTruncated: courses.length > PANEL_COURSE_LIMIT,
    restricted: { finance: !allowed.finance, moderation: !allowed.moderation },
  };
}

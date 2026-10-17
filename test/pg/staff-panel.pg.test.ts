import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { PANEL_FACTS, type StaffPanelDto } from '../../src/features/staff/panel.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { loadStaffPanel } from '../../src/server/staff/panel-store.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createDemoCourse, type DemoFixture } from '../helpers/demo-course.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M9-01 (passo 2) em Postgres 18 real: o painel de fatos. Cada contagem confere com uma situação montada à mão (acesso em vigor,
 * empilhamento de direitos, matrícula e conta suspensas, janela que ainda não começou, conclusão, certificado, interesse, pedido,
 * denúncia); as seções de pedidos e denúncias só vão a quem tem a capacidade; a resposta não traz nome nem e-mail; e 10 mil
 * inscrições sintéticas entram na conta certa dentro de um tempo razoável.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const DAY = 86_400_000;

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let demo: DemoFixture;
let courseB: string;
let seq = 0;

const at = (days: number) => new Date(Date.now() + days * DAY);

async function student(label: string) {
  const id = `painel-${label}`;
  await tools.db
    .insert(schema.user)
    .values({ id, name: `Nome ${label}`, email: `${label}@painel.example.test` });
  return id;
}

async function access(
  userId: string,
  courseId: string,
  window: { startsInDays?: number; endsInDays: number },
  options: { suspendedEnrollment?: boolean } = {},
) {
  seq += 1;
  await tools.db
    .insert(schema.enrollment)
    .values({
      userId,
      courseId,
      anchorAt: at(-1),
      ...(options.suspendedEnrollment ? { suspendedAt: new Date(), suspendedReason: 'teste' } : {}),
    })
    .onConflictDoNothing();
  await tools.db.insert(schema.entitlement).values({
    userId,
    courseId,
    source: 'admin_grant',
    sourceRef: `painel-${seq}`,
    startsAt: at(window.startsInDays ?? -1),
    expiresAt: at(window.endsInDays),
  });
}

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
  demo = await createDemoCourse(tools.db);
  const [other] = await tools.db
    .insert(schema.course)
    .values({ slug: 'curso-b-painel', title: 'Curso B', sequenceMode: 'free', status: 'published' })
    .returning({ id: schema.course.id });
  courseB = other!.id;

  const [u1, u2, u3, u4, u5, u6, u7, u8] = await Promise.all(
    ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'].map(student),
  );
  await access(u1!, demo.courseId, { endsInDays: 20 }); // acesso, não vence logo
  await access(u2!, demo.courseId, { endsInDays: 3 }); // acesso, vence em 3 dias
  await access(u3!, demo.courseId, { endsInDays: 2 }); // dois direitos: vale o MAIOR (40 dias), então não vence logo
  await access(u3!, demo.courseId, { endsInDays: 40 });
  await access(u4!, demo.courseId, { startsInDays: -30, endsInDays: -1 }); // expirou
  await access(u5!, demo.courseId, { endsInDays: 30 }); // será revogado
  await access(u6!, demo.courseId, { endsInDays: 30 }, { suspendedEnrollment: true });
  await access(u7!, demo.courseId, { endsInDays: 30 }); // conta suspensa
  await access(u8!, demo.courseId, { startsInDays: 1, endsInDays: 30 }); // janela ainda não começou
  await access(u1!, courseB, { endsInDays: 10 });
  await tools.db.execute(
    sql`update entitlement set revoked_at = now(), revoked_reason = 'teste' where user_id = ${u5}`,
  );
  await tools.db.insert(schema.userSuspension).values({ userId: u7!, reason: 'teste' });

  // Conclusões: u1 agora, u2 há 40 dias, u3 agora.
  for (const [userId, days] of [
    [u1, 0],
    [u2, -40],
    [u3, 0],
  ] as const) {
    await tools.db.insert(schema.courseCompletion).values({
      userId: userId!,
      courseId: demo.courseId,
      completedAt: at(days),
      requiredTotal: 5,
    });
  }
  const cert = (userId: string, status: string, code: string) =>
    tools.db.insert(schema.certificate).values({
      userId,
      courseId: demo.courseId,
      code,
      status,
      snapshot: {},
      ...(status === 'failed' ? { failureCode: 'render_failed' } : {}),
      ...(status === 'ready'
        ? { readyAt: new Date(), pdfKey: 'certificados/teste.pdf', pdfSha256: 'f'.repeat(64) }
        : {}),
    });
  await cert(u1!, 'ready', 'a'.repeat(22));
  await cert(u2!, 'failed', 'b'.repeat(22));
  await cert(u3!, 'awaiting_name', 'c'.repeat(22));

  // Interesses: 2 ativos (um por curso), 1 retirado.
  await tools.db.insert(schema.courseInterest).values([
    { userId: u4!, courseId: demo.courseId, status: 'active' },
    { userId: u5!, courseId: courseB, status: 'active' },
    { userId: u6!, courseId: demo.courseId, status: 'withdrawn' },
  ]);

  // Pedidos do u1: pago, pendente, reembolso pedido e reembolsado (agora) e um pago há 40 dias (fora da janela).
  const order = (status: string, createdDaysAgo: number) =>
    tools.db.insert(schema.purchaseOrder).values({
      userId: u1!,
      offerId: demo.offerId,
      courseId: demo.courseId,
      attemptId: crypto.randomUUID(),
      status,
      courseTitle: 'Curso',
      offerName: 'Oferta',
      priceCents: 5000,
      accessMonths: 3,
      maxInstallments: 1,
      paymentMethods: ['pix'],
      expiresAt: at(1),
      createdAt: at(-createdDaysAgo),
    });
  await order('paid', 1);
  await order('pending', 1);
  await order('refund_requested', 2);
  await order('refunded', 3);
  await order('paid', 40);

  // Denúncias: um post com duas denúncias abertas (conta UMA mensagem) e outro com a denúncia já resolvida.
  const lessonId = (
    await tools.db.select({ id: schema.lesson.id }).from(schema.lesson).limit(1)
  )[0]!.id;
  const post = async (body: string) =>
    (
      await tools.db
        .insert(schema.discussionPost)
        .values({ courseId: demo.courseId, lessonId, authorId: u1!, body })
        .returning({ id: schema.discussionPost.id })
    )[0]!.id;
  const first = await post('Primeira');
  const second = await post('Segunda');
  await tools.db.insert(schema.discussionReport).values([
    { postId: first, reporterId: u2!, reason: 'a' },
    { postId: first, reporterId: u3!, reason: 'b' },
    { postId: second, reporterId: u2!, reason: 'c', resolvedAt: new Date() },
  ]);
}, 180_000);
afterAll(async () => {
  await tools.close();
  await database.drop();
});

const factsOf = (panel: StaffPanelDto) =>
  Object.fromEntries(panel.facts.map((fact) => [fact.id, fact.value]));

describe('contagens do painel', () => {
  it('cada fato confere com a situação montada (acesso, empilhamento, suspensões, janela, conclusões, certificados, interesses, pedidos, denúncias)', async () => {
    const panel = await loadStaffPanel(tools.db, { finance: true, moderation: true });
    expect(factsOf(panel)).toEqual({
      access_now: 4, // u1, u2 e u3 no curso demonstrativo + u1 no curso B
      expiring_7d: 1, // só u2: u3 tem outro direito até 40 dias
      completions_30d: 2,
      completions_total: 3,
      certificates_ready: 1,
      certificates_failed: 1,
      certificates_awaiting_name: 1,
      interests_active: 2,
      orders_paid_30d: 1, // o pago há 40 dias fica fora
      orders_pending_30d: 1,
      orders_refund_requested_30d: 1,
      orders_refunded_30d: 1,
      reports_open: 1, // duas denúncias no mesmo post contam uma mensagem; a resolvida não conta
    });
    expect(panel.restricted).toEqual({ finance: false, moderation: false });
  });

  it('por curso: pessoas com acesso, vencendo, conclusões e interesses; o que tem mais pessoas vem primeiro', async () => {
    const { courses } = await loadStaffPanel(tools.db, { finance: false, moderation: false });
    expect(courses.map((course) => course.title)).toEqual([courses[0]!.title, 'Curso B']);
    expect(courses[0]).toMatchObject({
      courseId: demo.courseId,
      withAccess: 3,
      expiringIn7Days: 1,
      completions: 3,
      activeInterests: 1,
    });
    expect(courses[1]).toMatchObject({
      courseId: courseB,
      withAccess: 1,
      expiringIn7Days: 0,
      completions: 0,
      activeInterests: 1,
    });
  });

  it('sem as capacidades, pedidos e denúncias NÃO saem (nem os números) e a resposta marca "restricted"', async () => {
    const panel = await loadStaffPanel(tools.db, { finance: false, moderation: false });
    const ids = panel.facts.map((fact) => fact.id);
    for (const [id, fact] of Object.entries(PANEL_FACTS)) {
      expect(ids.includes(id as never), id).toBe(fact.section === 'general');
    }
    expect(panel.restricted).toEqual({ finance: true, moderation: true });
  });

  it('todo fato traz rótulo, definição e período escritos', async () => {
    const panel = await loadStaffPanel(tools.db, { finance: true, moderation: true });
    expect(panel.facts).toHaveLength(Object.keys(PANEL_FACTS).length);
    for (const fact of panel.facts) {
      expect(fact.label.length).toBeGreaterThan(3);
      expect(fact.definition.endsWith('.')).toBe(true);
      expect(fact.period.length).toBeGreaterThan(2);
    }
  });
});

describe('o endpoint GET /api/staff/panel', () => {
  const application = () =>
    apiApp({ emailSender: createFakeEmailSender(), isStaffEmail: async () => true });
  const env = () =>
    ({
      HYPERDRIVE: { connectionString: database.connectionString },
      APP_BASE_URL: BASE_URL,
      BETTER_AUTH_SECRET: SECRET,
      TURNSTILE_SECRET_KEY: 'x',
    }) as unknown as Env;

  async function person(options: {
    role: 'support' | 'admin';
    grant?: 'finance.view' | 'discussion.moderate';
  }) {
    seq += 1;
    const user = tools.test.createUser({
      email: `quem${seq}@painel.example.test`,
      name: `Quem ${seq}`,
    });
    await tools.test.saveUser(user);
    await grantRole(tools.db, { actorId: null, targetId: user.id, role: options.role });
    if (options.grant) {
      await tools.db
        .insert(schema.staffGrant)
        .values({ userId: user.id, capability: options.grant, grantedBy: user.id });
    }
    return (await tools.test.login({ userId: user.id })).headers;
  }
  async function panelFor(headers: Headers) {
    const response = await application().request('/api/staff/panel', { headers }, env());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    return { text: await response.clone().text(), panel: (await response.json()) as StaffPanelDto };
  }

  it('Suporte sem grant vê os números gerais; com finance.view vê pedidos; com discussion.moderate vê denúncias; Admin vê tudo', async () => {
    const bare = await panelFor(await person({ role: 'support' }));
    expect(bare.panel.restricted).toEqual({ finance: true, moderation: true });
    expect(bare.panel.facts.map((fact) => fact.id)).not.toContain('orders_paid_30d');
    expect(bare.panel.facts.map((fact) => fact.id)).not.toContain('reports_open');

    const finance = await panelFor(await person({ role: 'support', grant: 'finance.view' }));
    expect(finance.panel.restricted).toEqual({ finance: false, moderation: true });
    expect(factsOf(finance.panel).orders_paid_30d).toBe(1);
    expect(factsOf(finance.panel).reports_open).toBeUndefined();

    const moderation = await panelFor(
      await person({ role: 'support', grant: 'discussion.moderate' }),
    );
    expect(moderation.panel.restricted).toEqual({ finance: true, moderation: false });
    expect(factsOf(moderation.panel).reports_open).toBe(1);
    expect(factsOf(moderation.panel).orders_paid_30d).toBeUndefined();

    const admin = await panelFor(await person({ role: 'admin' }));
    expect(admin.panel.restricted).toEqual({ finance: false, moderation: false });
    expect(admin.panel.facts).toHaveLength(Object.keys(PANEL_FACTS).length);
  });

  it('a resposta não traz nome, e-mail nem id de pessoa', async () => {
    const { text } = await panelFor(await person({ role: 'admin' }));
    expect(text).not.toContain('@');
    expect(text).not.toMatch(/Nome u\d/);
    expect(text).not.toContain('painel-u');
  });
});

describe('volume', () => {
  it('10 mil inscrições sintéticas entram na conta certa, e o painel responde em tempo razoável', async () => {
    const before = await loadStaffPanel(tools.db, { finance: true, moderation: true });
    await tools.db.execute(sql`
      insert into "user" (id, name, email)
      select 'bulk-' || n, 'Bulk ' || n, 'bulk' || n || '@bulk.example.test' from generate_series(1, 10000) n`);
    await tools.db.execute(sql`
      insert into enrollment (user_id, course_id, anchor_at)
      select 'bulk-' || n, ${demo.courseId}::uuid, now() - interval '1 day' from generate_series(1, 10000) n`);
    await tools.db.execute(sql`
      insert into entitlement (user_id, course_id, source, source_ref, starts_at, expires_at)
      select 'bulk-' || n, ${demo.courseId}::uuid, 'admin_grant', 'bulk-' || n,
             now() - interval '1 day',
             now() + (case when n % 10 = 0 then interval '3 days' else interval '60 days' end)
        from generate_series(1, 10000) n`);

    const started = Date.now();
    const after = await loadStaffPanel(tools.db, { finance: true, moderation: true });
    const elapsed = Date.now() - started;

    expect(factsOf(after).access_now - factsOf(before).access_now).toBe(10_000);
    expect(factsOf(after).expiring_7d - factsOf(before).expiring_7d).toBe(1000);
    expect(elapsed).toBeLessThan(5000);
  }, 300_000);
});

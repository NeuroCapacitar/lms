import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import {
  LEARNING_DEFINITIONS,
  OFFER_DEFINITIONS,
  type CourseAnalyticsDto,
  type OfferAnalyticsDto,
} from '../../src/features/staff/analytics.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { loadCourseAnalytics } from '../../src/server/staff/analytics-store.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M9-02 em Postgres 18 real: as métricas de análise com um conjunto PEQUENO que dá para conferir à mão. Cada número esperado está
 * explicado no próprio teste (quem é cada pessoa e por que cai onde cai): acesso em vigor, limites de 14 e 30 dias, faixas de progresso,
 * conclusão por aula, posição de vídeo, quiz, funil das ofertas e conversão dos avisos. Também: visão por capacidade, nada de dado
 * pessoal, nenhuma tabela de eventos e 10 mil matrículas em tempo razoável.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const HOUR = 3_600_000;
const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms);
const ahead = (ms: number) => new Date(Date.now() + ms);

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let courseId: string;
let offerId: string;
const lessonId = {
  l1: crypto.randomUUID(),
  l2: crypto.randomUUID(),
  l3: crypto.randomUUID(), // opcional
  l4: crypto.randomUUID(), // vídeo
  l5: crypto.randomUUID(), // quiz
  l6: crypto.randomUUID(), // retirada
};
const people = {} as Record<string, string>;
let seq = 0;

async function enroll(
  label: string,
  options: { anchorAgo?: number; expired?: boolean; suspended?: boolean } = {},
) {
  const id = `an-${label}`;
  people[label] = id;
  await tools.db
    .insert(schema.user)
    .values({ id, name: `Nome ${label}`, email: `${label}@analise.example.test` });
  await tools.db.insert(schema.enrollment).values({
    userId: id,
    courseId,
    anchorAt: ago(options.anchorAgo ?? 100 * DAY),
    ...(options.suspended ? { suspendedAt: new Date(), suspendedReason: 'teste' } : {}),
  });
  seq += 1;
  await tools.db.insert(schema.entitlement).values({
    userId: id,
    courseId,
    source: 'admin_grant',
    sourceRef: `analise-${seq}`,
    startsAt: ago(100 * DAY),
    expiresAt: options.expired ? ago(DAY) : ahead(60 * DAY),
  });
  return id;
}

const done = (label: string, lesson: string, completedAgo: number) =>
  tools.db.insert(schema.lessonCompletion).values({
    userId: people[label]!,
    courseId,
    lessonId: lesson,
    completedAt: ago(completedAgo),
  });

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });

  const [course] = await tools.db
    .insert(schema.course)
    .values({
      slug: 'curso-analise',
      title: 'Curso de Análise',
      sequenceMode: 'free',
      status: 'published',
    })
    .returning({ id: schema.course.id });
  courseId = course!.id;
  const moduleId = crypto.randomUUID();
  await tools.db
    .insert(schema.courseModule)
    .values({ id: moduleId, courseId, title: 'Módulo 1', position: 1 });

  const connectionId = crypto.randomUUID();
  await tools.db
    .insert(schema.videoProviderConnection)
    .values({ id: connectionId, provider: 'youtube', label: 'público' });
  const [asset] = await tools.db
    .insert(schema.videoAsset)
    .values({
      connectionId,
      provider: 'youtube',
      externalId: 'v-analise',
      mode: 'referenced',
      state: 'ready',
      durationSeconds: 600,
    })
    .returning({ id: schema.videoAsset.id });

  const base = { courseId, moduleId };
  await tools.db.insert(schema.lesson).values([
    { ...base, id: lessonId.l1, title: 'Aula 1', position: 1 },
    { ...base, id: lessonId.l2, title: 'Aula 2', position: 2 },
    { ...base, id: lessonId.l3, title: 'Aula 3 (opcional)', position: 3, isOptional: true },
    {
      ...base,
      id: lessonId.l4,
      title: 'Aula 4 (vídeo)',
      position: 4,
      kind: 'video',
      videoAssetId: asset!.id,
    },
    {
      ...base,
      id: lessonId.l5,
      title: 'Aula 5 (quiz)',
      position: 5,
      kind: 'quiz',
      quiz: { questions: [] },
    },
    { ...base, id: lessonId.l6, title: 'Aula 6 (retirada)', position: 6, retiredAt: new Date() },
  ]);

  // Pessoas. Quem tem acesso em vigor: p1, p2, p3, p4, p5, p8 e p9 (7). p6 perdeu o acesso (expirou) e p7 está com a matrícula suspensa.
  await enroll('p1');
  await enroll('p2');
  await enroll('p3');
  await enroll('p4', { anchorAgo: 40 * DAY }); // nunca fez nada: conta desde a matrícula (40 dias)
  await enroll('p5');
  await enroll('p6', { expired: true });
  await enroll('p7', { suspended: true });
  await enroll('p8');
  await enroll('p9');

  // Conclusões (obrigatórias: L1, L2, L4, L5 = 4; L3 é opcional e L6 foi retirada).
  await done('p1', lessonId.l1, 5 * DAY);
  await done('p1', lessonId.l2, 4 * DAY);
  await done('p1', lessonId.l4, 2 * DAY);
  await done('p1', lessonId.l5, DAY); // última atividade de p1: 1 dia
  await done('p2', lessonId.l1, 30 * DAY);
  await done('p2', lessonId.l2, 30 * DAY);
  await done('p3', lessonId.l1, 20 * DAY); // última atividade de p3: 20 dias
  await done('p5', lessonId.l3, 14 * DAY - HOUR); // só a opcional: 14 dias menos 1 h (NÃO está parado há 14 dias)
  await done('p5', lessonId.l6, 15 * DAY); // retirada: não conta
  await done('p6', lessonId.l1, 50 * DAY);
  await done('p8', lessonId.l1, 14 * DAY + HOUR); // parado há 14 dias e 1 h
  await done('p9', lessonId.l1, 30 * DAY + HOUR); // parado há 30 dias e 1 h

  // Vídeo (600 s): p1 completou; p2 chegou a 75% (450 s); p3 a 50% (300 s); p5 a 25% (150 s); p4 a 100 s (<25%).
  const video = (label: string, position: number, updatedAgo: number, completed = false) =>
    tools.db.insert(schema.videoProgress).values({
      userId: people[label]!,
      lessonId: lessonId.l4,
      courseId,
      videoAssetId: asset!.id,
      maxPosition: position,
      durationSeconds: 600,
      updatedAt: ago(updatedAgo),
      ...(completed ? { completedAt: ago(updatedAgo), evidence: { percent: 100 } } : {}),
    });
  await video('p1', 600, 2 * DAY, true);
  await video('p2', 450, 35 * DAY);
  await video('p3', 300, 25 * DAY);
  await video('p4', 100, 40 * DAY);
  await video('p5', 150, 20 * DAY);

  // Quiz: p1 fez 2 tentativas (reprovou e passou); p2 1 (reprovou, há 10 dias: é a última atividade dele); p3 3 reprovadas (há 25 dias).
  const attempt = (label: string, number: number, passed: boolean, createdAgo: number) =>
    tools.db.insert(schema.quizAttempt).values({
      userId: people[label]!,
      courseId,
      lessonId: lessonId.l5,
      number,
      snapshot: {},
      answers: {},
      earnedPoints: passed ? 10 : 2,
      totalPoints: 10,
      scorePercent: passed ? 100 : 20,
      passed,
      createdAt: ago(createdAgo),
    });
  await attempt('p1', 1, false, 3 * DAY);
  await attempt('p1', 2, true, DAY);
  await attempt('p2', 1, false, 10 * DAY);
  await attempt('p3', 1, false, 25 * DAY);
  await attempt('p3', 2, false, 25 * DAY);
  await attempt('p3', 3, false, 25 * DAY);

  // Oferta paga e pedidos (janela de 90 dias).
  const [offer] = await tools.db
    .insert(schema.offer)
    .values({
      courseId,
      name: 'Oferta paga',
      kind: 'paid',
      priceCents: 5000,
      accessMonths: 3,
      maxInstallments: 1,
      status: 'draft',
    })
    .returning({ id: schema.offer.id });
  offerId = offer!.id;
  const order = async (status: string, createdAgo: number, checkout: boolean) => {
    const [row] = await tools.db
      .insert(schema.purchaseOrder)
      .values({
        userId: people.p1!,
        offerId,
        courseId,
        attemptId: crypto.randomUUID(),
        status,
        courseTitle: 'Curso de Análise',
        offerName: 'Oferta paga',
        priceCents: 5000,
        accessMonths: 3,
        maxInstallments: 1,
        paymentMethods: ['pix'],
        expiresAt: ahead(DAY),
        createdAt: ago(createdAgo),
      })
      .returning({ id: schema.purchaseOrder.id });
    if (checkout) {
      await tools.db
        .insert(schema.checkoutSession)
        .values({ orderId: row!.id, state: 'expired', expiresAt: ahead(DAY) });
    }
  };
  await order('paid', 10 * DAY, true);
  await order('refunded', 20 * DAY, true);
  await order('expired', 5 * DAY, true);
  await order('canceled', 3 * DAY, false);
  await order('pending', DAY, true);
  await order('paid', 100 * DAY, true); // fora da janela de 90 dias
  await order('refund_requested', 15 * DAY, true);
  await order('disputed', 2 * DAY, false);
  await order('review', DAY, false);

  // Avisos de curso: 2 ativos, 1 retirado, 2 convertidos.
  await tools.db.insert(schema.courseInterest).values(
    (
      [
        ['p1', 'active'],
        ['p2', 'active'],
        ['p3', 'withdrawn'],
        ['p4', 'converted'],
        ['p5', 'converted'],
      ] as const
    ).map(([label, status]) => ({ userId: people[label]!, courseId, status })),
  );
}, 240_000);
afterAll(async () => {
  await tools.close();
  await database.drop();
});

describe('aprendizagem de um curso (números conferidos à mão)', () => {
  it('matriculados, com acesso, parados há 14 e 30 dias (limites de 14 d 1 h, 14 d menos 1 h e 30 d 1 h)', async () => {
    const analytics = (await loadCourseAnalytics(tools.db, courseId))!;
    expect(analytics.course).toEqual({ id: courseId, title: 'Curso de Análise' });
    expect(analytics.enrolled).toBe(9);
    expect(analytics.withAccess).toBe(7); // fora: p6 (expirou) e p7 (matrícula suspensa)
    // Parados há 14 dias ou mais: p3 (20 d), p4 (nunca fez nada, 40 d desde a matrícula), p8 (14 d 1 h) e p9 (30 d 1 h).
    // NÃO: p1 (1 d), p2 (10 d, pela tentativa de quiz) e p5 (14 d menos 1 h).
    expect(analytics.inactive).toEqual({ days14: 4, days30: 2 }); // 30 dias: p4 e p9
  });

  it('faixas de progresso das aulas obrigatórias (4: L1, L2, L4, L5; a opcional e a retirada não contam)', async () => {
    const analytics = (await loadCourseAnalytics(tools.db, courseId))!;
    expect(analytics.requiredLessons).toBe(4);
    // 0%: p4 e p5 (só a opcional e a retirada). 1% a 49%: p3, p8, p9 (1 de 4). 50% a 99%: p2 (2 de 4). 100%: p1.
    expect(analytics.progressBands).toEqual([2, 3, 1, 1]);
    expect(analytics.progressBands!.reduce((a, b) => a + b, 0)).toBe(analytics.withAccess);
  });

  it('conclusão por aula sobre todos os matriculados (inclui quem perdeu o acesso); aula retirada não aparece; ordem do currículo', async () => {
    const { lessons } = (await loadCourseAnalytics(tools.db, courseId))!;
    expect(lessons.map((lesson) => [lesson.title, lesson.completions])).toEqual([
      ['Aula 1', 6], // p1, p2, p3, p6, p8, p9
      ['Aula 2', 2], // p1, p2
      ['Aula 3 (opcional)', 1], // p5
      ['Aula 4 (vídeo)', 1], // p1
      ['Aula 5 (quiz)', 1], // p1
    ]);
    expect(lessons.find((lesson) => lesson.isOptional)?.title).toBe('Aula 3 (opcional)');
    expect(lessons[0]).toMatchObject({ kind: 'text', video: null, quiz: null });
  });

  it('vídeo: quem começou e a distribuição da maior posição em 4 faixas (limites exatos 25%, 50% e 75%)', async () => {
    const { lessons } = (await loadCourseAnalytics(tools.db, courseId))!;
    const video = lessons.find((lesson) => lesson.kind === 'video')!;
    // p4 100 s (<25%), p5 150 s (=25% entra em "de 25% a 50%"), p3 300 s (=50% entra em "de 50% a 75%"), p2 450 s (=75% entra em "75% ou mais"), p1 600 s.
    expect(video.video).toEqual({ started: 5, completed: 1, bands: [1, 1, 1, 2] });
  });

  it('quiz: pessoas que tentaram, tentativas e pessoas que passaram em ao menos uma', async () => {
    const { lessons } = (await loadCourseAnalytics(tools.db, courseId))!;
    const quiz = lessons.find((lesson) => lesson.kind === 'quiz')!;
    expect(quiz.quiz).toEqual({ attemptedPeople: 3, attempts: 6, passedPeople: 1 });
  });

  it('curso sem aula obrigatória não tem faixas; curso inexistente dá null', async () => {
    const [empty] = await tools.db
      .insert(schema.course)
      .values({ slug: 'curso-vazio-analise', title: 'Vazio', sequenceMode: 'free' })
      .returning({ id: schema.course.id });
    const analytics = (await loadCourseAnalytics(tools.db, empty!.id))!;
    expect(analytics).toMatchObject({
      enrolled: 0,
      withAccess: 0,
      requiredLessons: 0,
      progressBands: null,
    });
    expect(await loadCourseAnalytics(tools.db, crypto.randomUUID())).toBeNull();
  });

  it('traz as definições escritas e nenhum nome, e-mail nem id de pessoa', async () => {
    const analytics = (await loadCourseAnalytics(tools.db, courseId))!;
    expect(analytics.definitions).toEqual(LEARNING_DEFINITIONS);
    const text = JSON.stringify(analytics);
    expect(text).not.toContain('@');
    expect(text).not.toMatch(/Nome p\d/);
    expect(text).not.toContain('an-p');
  });
});

describe('os endpoints', () => {
  const application = () =>
    apiApp({ emailSender: createFakeEmailSender(), isStaffEmail: async () => true });
  const env = () =>
    ({
      HYPERDRIVE: { connectionString: database.connectionString },
      APP_BASE_URL: BASE_URL,
      BETTER_AUTH_SECRET: SECRET,
      TURNSTILE_SECRET_KEY: 'x',
    }) as unknown as Env;

  async function person(role: 'support' | 'admin', grant?: 'finance.view') {
    seq += 1;
    const user = tools.test.createUser({
      email: `via${seq}@analise.example.test`,
      name: `Via ${seq}`,
    });
    await tools.test.saveUser(user);
    await grantRole(tools.db, { actorId: null, targetId: user.id, role });
    if (grant) {
      await tools.db
        .insert(schema.staffGrant)
        .values({ userId: user.id, capability: grant, grantedBy: user.id });
    }
    return (await tools.test.login({ userId: user.id })).headers;
  }
  const get = (path: string, headers: Headers) =>
    application().request(`/api/staff/analytics${path}`, { headers }, env());

  it('aprendizagem: toda a Staff lê (staff.read); id inválido dá 400; curso inexistente 404; sem cache', async () => {
    const support = await person('support');
    const ok = await get(`/courses/${courseId}`, support);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(((await ok.json()) as CourseAnalyticsDto).withAccess).toBe(7);
    expect((await get('/courses/nao-e-uuid', support)).status).toBe(400);
    expect((await get(`/courses/${crypto.randomUUID()}`, support)).status).toBe(404);
  });

  it('funil das ofertas: só com finance.view (o Suporte sem o grant recebe 403; o Admin e quem tem o grant leem)', async () => {
    expect((await get('/offers', await person('support'))).status).toBe(403);
    expect((await get('/offers', await person('support', 'finance.view'))).status).toBe(200);
    expect((await get('/offers', await person('admin'))).status).toBe(200);
    expect((await application().request('/api/staff/analytics/offers', {}, env())).status).toBe(
      401,
    );
  });

  it('funil: pedidos criados na janela de 90 dias e conversão dos avisos, conferidos à mão', async () => {
    const response = await get('/offers', await person('admin'));
    const data = (await response.json()) as OfferAnalyticsDto;
    expect(data.windowDays).toBe(90);
    expect(data.definitions).toEqual(OFFER_DEFINITIONS);
    expect(data.offers).toHaveLength(1);
    // Criados na janela: paid(10 d), refunded(20 d), expired, canceled, pending, refund_requested, disputed, review = 8 (o de 100 d fica fora).
    // Com checkout: paid, refunded, expired, pending, refund_requested = 5. Pagos em algum momento: paid, refunded, refund_requested, disputed = 4.
    expect(data.offers[0]).toMatchObject({
      offerId,
      offerName: 'Oferta paga',
      courseTitle: 'Curso de Análise',
      kind: 'paid',
      ordersCreated: 8,
      checkoutsOpened: 5,
      paid: 4,
      expired: 1,
      canceled: 1,
      pending: 1,
      refunded: 1,
    });
    expect(data.interests).toEqual([
      {
        courseId,
        courseTitle: 'Curso de Análise',
        total: 5,
        active: 2,
        withdrawn: 1,
        converted: 2,
      },
    ]);
    const text = JSON.stringify(data);
    expect(text).not.toContain('@');
    expect(text).not.toContain('an-p');
  });

  it('não criou nenhuma tabela de eventos brutos nem de rastreio', async () => {
    const result = await tools.db.execute(
      sql`select table_name from information_schema.tables where table_schema = current_schema()`,
    );
    const names = (result as unknown as { rows: { table_name: string }[] }).rows.map(
      (row) => row.table_name,
    );
    expect(
      names.filter((name) => /analytic|pageview|page_view|click|tracking|telemetry/i.test(name)),
    ).toEqual([]);
  });
});

describe('volume', () => {
  it('10 mil matrículas com conclusões entram na conta certa e a análise responde em tempo razoável', async () => {
    const before = (await loadCourseAnalytics(tools.db, courseId))!;
    await tools.db.execute(sql`
      insert into "user" (id, name, email)
      select 'bulk-' || n, 'Bulk ' || n, 'bulk' || n || '@bulk.example.test' from generate_series(1, 10000) n`);
    await tools.db.execute(sql`
      insert into enrollment (user_id, course_id, anchor_at)
      select 'bulk-' || n, ${courseId}::uuid, now() - interval '100 days' from generate_series(1, 10000) n`);
    await tools.db.execute(sql`
      insert into entitlement (user_id, course_id, source, source_ref, starts_at, expires_at)
      select 'bulk-' || n, ${courseId}::uuid, 'admin_grant', 'bulk-' || n, now() - interval '100 days', now() + interval '60 days'
        from generate_series(1, 10000) n`);
    await tools.db.execute(sql`
      insert into lesson_completion (user_id, course_id, lesson_id, completed_at)
      select 'bulk-' || n, ${courseId}::uuid, ${lessonId.l1}::uuid, now() - interval '2 days' from generate_series(1, 10000) n`);

    const started = Date.now();
    const after = (await loadCourseAnalytics(tools.db, courseId))!;
    const elapsed = Date.now() - started;

    expect(after.enrolled - before.enrolled).toBe(10_000);
    expect(after.withAccess - before.withAccess).toBe(10_000);
    // As 10 mil fizeram só L1 (1 de 4): entram na faixa "de 1% a 49%" e ninguém fica parado.
    expect(after.progressBands![1] - before.progressBands![1]).toBe(10_000);
    expect(after.inactive).toEqual(before.inactive);
    expect(after.lessons[0]!.completions - before.lessons[0]!.completions).toBe(10_000);
    expect(elapsed).toBeLessThan(5000);
  }, 300_000);
});

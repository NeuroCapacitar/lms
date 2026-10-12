import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { grantEntitlement } from '../../src/server/access/entitlement-store.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import {
  getDraft,
  publishCurriculum,
  saveDraft,
} from '../../src/server/catalog/curriculum-store.ts';
import { richTextFromParagraph } from '../../src/features/content/rich-text.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createDemoCourse } from '../helpers/demo-course.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M3-04 em Postgres 18 real: conclusão manual da aula de texto e do curso. A conclusão do curso nasce
 * UMA vez, na transação da última obrigatória, com a matrícula travada; é histórica (não some se o
 * currículo mudar) e a aula só conclui se ABRE para a pessoa (acesso, drip e sequência).
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const T0 = new Date('2026-10-11T12:00:00.000Z');
/** Todos os módulos do demonstrativo (D+0, D+7, D+14) já liberados pelo drip. */
const LATE = new Date('2026-10-30T12:00:00.000Z');

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let seq = 0;
let clockNow = LATE;

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
});
afterAll(async () => {
  await tools.close();
  await database.drop();
});
beforeEach(async () => {
  clockNow = LATE;
  await tools.db.execute(
    sql`truncate table course_completion, lesson_completion, entitlement, enrollment, lesson, module, lesson_draft, module_draft, course_content, course_draft, curriculum_state, offer, course cascade`,
  );
  await tools.db.delete(schema.userSuspension);
  await tools.db.delete(schema.session);
  await tools.db.delete(schema.userRole);
  await tools.db.delete(schema.user);
});

const env = () =>
  ({
    HYPERDRIVE: { connectionString: database.connectionString },
    APP_BASE_URL: BASE_URL,
    BETTER_AUTH_SECRET: SECRET,
    TURNSTILE_SECRET_KEY: 'x',
  }) as unknown as Env;
const app = () =>
  apiApp({
    emailSender: createFakeEmailSender(),
    isStaffEmail: async () => false,
    clock: () => clockNow,
  });

async function newStudent() {
  seq += 1;
  const user = tools.test.createUser({ email: `aluno${seq}@example.test`, name: `Aluno ${seq}` });
  await tools.test.saveUser(user);
  return { id: user.id, headers: (await tools.test.login({ userId: user.id })).headers };
}
function call(method: string, path: string, headers?: Headers) {
  const merged = new Headers(headers);
  merged.set('origin', BASE_URL);
  merged.set('content-type', 'application/json');
  return app().request(
    `/api${path}`,
    { method, headers: merged, ...(method === 'POST' ? { body: '{}' } : {}) },
    env(),
  );
}
const complete = (headers: Headers | undefined, lessonId: string) =>
  call('POST', `/lessons/${lessonId}/complete`, headers);
const outline = async (headers: Headers, courseId: string) =>
  (await (await call('GET', `/courses/${courseId}/outline`, headers)).json()) as Record<
    string,
    any
  >;
const json = async (response: Response) => (await response.json()) as Record<string, any>;

async function demo() {
  const fixture = await createDemoCourse(tools.db);
  const rows = await tools.db
    .select({ id: schema.lesson.id, title: schema.lesson.title })
    .from(schema.lesson)
    .where(eq(schema.lesson.courseId, fixture.courseId));
  const lesson = Object.fromEntries(rows.map((row) => [row.title, row.id])) as Record<
    string,
    string
  >;
  return { ...fixture, lesson };
}
async function enrolled(courseId: string, offerId: string) {
  const student = await newStudent();
  await grantEntitlement(tools.db, {
    userId: student.id,
    courseId,
    offerId,
    source: 'free_offer',
    sourceRef: `free:${student.id}:${offerId}:0`,
    accessMonths: 12,
    startsAt: T0,
    grantedBy: student.id,
  });
  return student;
}
/** As 5 obrigatórias do demonstrativo, na ordem do curso. */
const REQUIRED = [
  'Boas-vindas',
  'Como estudar aqui',
  'Conceito central',
  'Revisão',
  'Próximos passos',
];
const completionsOf = (userId: string) =>
  tools.db.select().from(schema.lessonCompletion).where(eq(schema.lessonCompletion.userId, userId));
const courseCompletionsOf = (userId: string) =>
  tools.db.select().from(schema.courseCompletion).where(eq(schema.courseCompletion.userId, userId));

describe('autorização', () => {
  it('sem sessão: 401; id malformado ou aula inexistente: 404; Origin errada: 403 (CSRF)', async () => {
    const { lesson } = await demo();
    expect((await complete(undefined, lesson['Boas-vindas']!)).status).toBe(401);
    const student = await newStudent();
    expect((await complete(student.headers, 'xyz')).status).toBe(404);
    expect((await complete(student.headers, crypto.randomUUID())).status).toBe(404);
    const noOrigin = await app().request(
      `/api/lessons/${lesson['Boas-vindas']}/complete`,
      {
        method: 'POST',
        headers: { ...Object.fromEntries(student.headers), 'content-type': 'application/json' },
        body: '{}',
      },
      env(),
    );
    expect(noOrigin.status).toBe(403);
  });

  it('termos vigentes não aceitos: 403 terms_required', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    await tools.db.insert(schema.legalDocumentVersion).values({
      kind: 'terms',
      version: 'teste-m3-04',
      body: 'TEXTO PROVISÓRIO de teste',
      effectiveFrom: new Date(Date.now() - 86_400_000),
    });
    try {
      const response = await complete(student.headers, lesson['Boas-vindas']!);
      expect(response.status).toBe(403);
      expect(await json(response)).toEqual({ error: { code: 'terms_required' } });
    } finally {
      await tools.db.delete(schema.legalDocumentVersion);
    }
    expect(await completionsOf(student.id)).toHaveLength(0);
  });

  it('pessoa NÃO inscrita: 403 no_access e nada gravado (inclusive Staff sem matrícula)', async () => {
    const { lesson } = await demo();
    const stranger = await newStudent();
    const response = await complete(stranger.headers, lesson['Boas-vindas']!);
    expect(response.status).toBe(403);
    expect(await json(response)).toEqual({ error: { code: 'access_denied', reason: 'no_access' } });

    const staff = await newStudent();
    await grantRole(tools.db, { actorId: null, targetId: staff.id, role: 'admin' });
    // dar o papel encerra as sessões antigas: entra de novo, já como Staff
    const staffHeaders = (await tools.test.login({ userId: staff.id })).headers;
    expect((await complete(staffHeaders, lesson['Boas-vindas']!)).status).toBe(403);
    expect(await tools.db.select().from(schema.lessonCompletion)).toHaveLength(0);
    expect(await tools.db.select().from(schema.enrollment)).toHaveLength(0);
  });

  it('acesso expirado ou conta suspensa: 403 e nada gravado', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId); // 12 meses a partir de 11/out/2026
    clockNow = new Date('2028-01-01T00:00:00.000Z');
    expect(await json(await complete(student.headers, lesson['Boas-vindas']!))).toEqual({
      error: { code: 'access_denied', reason: 'expired' },
    });
    clockNow = LATE;
    await tools.db.insert(schema.userSuspension).values({ userId: student.id, reason: 'teste' });
    expect(await json(await complete(student.headers, lesson['Boas-vindas']!))).toEqual({
      error: { code: 'access_denied', reason: 'suspended' },
    });
    expect(await completionsOf(student.id)).toHaveLength(0);
  });

  it('a conclusão é de quem pede: a de uma pessoa não conta para a outra', async () => {
    const { courseId, offerId, lesson } = await demo();
    const one = await enrolled(courseId, offerId);
    const two = await enrolled(courseId, offerId);
    await complete(one.headers, lesson['Boas-vindas']!);
    expect((await outline(two.headers, courseId)).progress.completed).toBe(0);
    expect((await outline(one.headers, courseId)).progress.completed).toBe(1);
  });
});

describe('concluir a aula', () => {
  it('cria a conclusão (201) com o progresso das obrigatórias', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    const response = await complete(student.headers, lesson['Boas-vindas']!);
    expect(response.status).toBe(201);
    expect(await json(response)).toMatchObject({
      status: 'completed',
      progress: { completed: 1, total: 5, percent: 20 },
      courseCompleted: false,
      courseJustCompleted: false,
      courseCompletedAt: null,
    });
    const [row] = await completionsOf(student.id);
    expect(row).toMatchObject({ lessonId: lesson['Boas-vindas'], courseId, method: 'manual' });
  });

  it('repetir é no-op: 200 already_completed, sem nova linha', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    await complete(student.headers, lesson['Boas-vindas']!);
    const again = await complete(student.headers, lesson['Boas-vindas']!);
    expect(again.status).toBe(200);
    expect((await json(again)).status).toBe('already_completed');
    expect(await completionsOf(student.id)).toHaveLength(1);
  });

  it('aula que não ABRE é recusada: sequência e drip, e nada é gravado', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    const bySequence = await complete(student.headers, lesson['Como estudar aqui']!);
    expect(bySequence.status).toBe(403);
    expect((await json(bySequence)).error).toMatchObject({
      code: 'lesson_locked',
      reason: 'sequence_locked',
    });

    clockNow = T0; // só o módulo 1 liberado
    await complete(student.headers, lesson['Boas-vindas']!);
    await complete(student.headers, lesson['Como estudar aqui']!);
    const byDrip = await complete(student.headers, lesson['Conceito central']!);
    expect(byDrip.status).toBe(403);
    expect(await json(byDrip)).toEqual({
      error: {
        code: 'lesson_locked',
        reason: 'drip_locked',
        releasesAt: '2026-10-18T03:00:00.000Z',
      },
    });
    expect((await completionsOf(student.id)).map((row) => row.lessonId).sort()).toEqual(
      [lesson['Boas-vindas']!, lesson['Como estudar aqui']!].sort(),
    );
  });

  it('a aula OPCIONAL pode ser concluída e NÃO muda o percentual', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    for (const title of ['Boas-vindas', 'Como estudar aqui', 'Conceito central']) {
      await complete(student.headers, lesson[title]!);
    }
    const before = (await outline(student.headers, courseId)).progress;
    const optional = await complete(student.headers, lesson['Leitura complementar']!);
    expect(optional.status).toBe(201);
    expect((await json(optional)).progress).toEqual(before);
    expect(before).toEqual({ completed: 3, total: 5, percent: 60 });
  });
});

describe('conclusão do curso', () => {
  async function finishAll(student: { headers: Headers }, lesson: Record<string, string>) {
    const results = [];
    for (const title of REQUIRED)
      results.push(await json(await complete(student.headers, lesson[title]!)));
    return results;
  }

  it('nasce na última obrigatória, UMA vez, com o total do momento e auditoria; opcional pendente não bloqueia', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    const results = await finishAll(student, lesson);
    expect(results.map((r) => r.courseCompleted)).toEqual([false, false, false, false, true]);
    expect(results.map((r) => r.courseJustCompleted)).toEqual([false, false, false, false, true]);
    expect(results.at(-1)!.progress).toEqual({ completed: 5, total: 5, percent: 100 });
    // a opcional ("Leitura complementar") nunca foi concluída e o curso concluiu assim mesmo
    const [row] = await courseCompletionsOf(student.id);
    expect(row).toMatchObject({ courseId, requiredTotal: 5 });
    const audit = (await tools.db.select().from(schema.auditLog)).filter(
      (a) => a.targetId === courseId && a.action === 'course.completed',
    );
    expect(audit).toHaveLength(1);
    // repetir a última não cria outra conclusão do curso
    const again = await json(await complete(student.headers, lesson['Próximos passos']!));
    expect(again).toMatchObject({
      status: 'already_completed',
      courseCompleted: true,
      courseJustCompleted: false,
    });
    expect(await courseCompletionsOf(student.id)).toHaveLength(1);
  });

  it('o mapa mostra o progresso e a data da conclusão', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    expect((await outline(student.headers, courseId)).completedAt).toBeNull();
    await finishAll(student, lesson);
    const body = await outline(student.headers, courseId);
    expect(body.progress).toEqual({ completed: 5, total: 5, percent: 100 });
    expect(body.completedAt).toBe(LATE.toISOString());
    expect(
      body.modules.flatMap((m: any) => m.lessons).filter((l: any) => l.completed),
    ).toHaveLength(5);
  });

  it('DUAS conclusões simultâneas da última aula: um só course_completion', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    for (const title of REQUIRED.slice(0, 4)) await complete(student.headers, lesson[title]!);
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => complete(student.headers, lesson['Próximos passos']!)),
    );
    const bodies = await Promise.all(responses.map(json));
    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 201]);
    expect(bodies.filter((b) => b.courseJustCompleted)).toHaveLength(1);
    expect(bodies.every((b) => b.courseCompleted)).toBe(true);
    expect(await courseCompletionsOf(student.id)).toHaveLength(1);
    expect(await completionsOf(student.id)).toHaveLength(5);
  }, 120_000);

  it('conclusões simultâneas de aulas DIFERENTES (curso livre): só uma cria a conclusão do curso', async () => {
    const { courseId, offerId, lesson } = await demo();
    await tools.db
      .update(schema.course)
      .set({ sequenceMode: 'free' })
      .where(eq(schema.course.id, courseId));
    const student = await enrolled(courseId, offerId);
    const responses = await Promise.all(
      REQUIRED.map((title) => complete(student.headers, lesson[title]!)),
    );
    const bodies = await Promise.all(responses.map(json));
    expect(responses.every((r) => r.status === 201)).toBe(true);
    expect(bodies.filter((b) => b.courseJustCompleted)).toHaveLength(1);
    expect(await courseCompletionsOf(student.id)).toHaveLength(1);
  }, 120_000);

  it('publicar nova obrigatória DEPOIS da conclusão: a conclusão fica (não duplica) e o percentual cai', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    await finishAll(student, lesson);
    const draft = await getDraft(tools.db, courseId);
    await saveDraft(tools.db, {
      courseId,
      expectedRev: draft!.rev,
      details: draft!.details,
      modules: draft!.modules.map((module, index) =>
        index === 2
          ? {
              ...module,
              lessons: [
                ...module.lessons,
                { title: 'Aula nova', isOptional: false, body: richTextFromParagraph('Nova.') },
              ],
            }
          : module,
      ),
    });
    await publishCurriculum(tools.db, { actorId: null, courseId });
    const body = await outline(student.headers, courseId);
    expect(body.progress).toEqual({ completed: 5, total: 6, percent: 83 });
    expect(body.completedAt).toBe(LATE.toISOString());
    const [row] = await courseCompletionsOf(student.id);
    expect(row!.requiredTotal).toBe(5); // o total NO MOMENTO da conclusão
    // concluir a aula nova não cria uma segunda conclusão do curso
    const fresh = await tools.db
      .select()
      .from(schema.lesson)
      .where(eq(schema.lesson.title, 'Aula nova'));
    const result = await json(await complete(student.headers, fresh[0]!.id));
    expect(result).toMatchObject({
      status: 'completed',
      courseCompleted: true,
      courseJustCompleted: false,
    });
    expect(await courseCompletionsOf(student.id)).toHaveLength(1);
  });

  it('aula retirada sai dos totais e vira 404 na conclusão', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    await complete(student.headers, lesson['Boas-vindas']!);
    const draft = await getDraft(tools.db, courseId);
    await saveDraft(tools.db, {
      courseId,
      expectedRev: draft!.rev,
      details: draft!.details,
      modules: draft!.modules.map((module) => ({
        ...module,
        lessons: module.lessons.filter((item) => item.title !== 'Como estudar aqui'),
      })),
    });
    await publishCurriculum(tools.db, { actorId: null, courseId });
    expect((await outline(student.headers, courseId)).progress).toEqual({
      completed: 1,
      total: 4,
      percent: 25,
    });
    expect((await complete(student.headers, lesson['Como estudar aqui']!)).status).toBe(404);
  });
});

describe('restrições do banco (course_completion)', () => {
  async function violation(work: PromiseLike<unknown>, pattern: RegExp) {
    let caught: unknown;
    try {
      await work;
    } catch (error) {
      caught = error;
    }
    expect(caught, 'esperava uma violação').toBeDefined();
    const text = [caught, (caught as { cause?: unknown }).cause]
      .map((item) => (item as Error | undefined)?.message ?? '')
      .join(' | ');
    expect(text).toMatch(pattern);
  }

  it('só com matrícula; total positivo; única; append-only', async () => {
    const { courseId, offerId } = await demo();
    const stranger = await newStudent();
    await violation(
      tools.db
        .insert(schema.courseCompletion)
        .values({ userId: stranger.id, courseId, requiredTotal: 3 }),
      /course_completion_enrollment_fk/,
    );
    const student = await enrolled(courseId, offerId);
    await violation(
      tools.db
        .insert(schema.courseCompletion)
        .values({ userId: student.id, courseId, requiredTotal: 0 }),
      /course_completion_total_check/,
    );
    await tools.db
      .insert(schema.courseCompletion)
      .values({ userId: student.id, courseId, requiredTotal: 5 });
    await violation(
      tools.db
        .insert(schema.courseCompletion)
        .values({ userId: student.id, courseId, requiredTotal: 5 }),
      /course_completion_pk|duplicate key/,
    );
    await violation(
      tools.db.execute(
        sql`update course_completion set required_total = 9 where user_id = ${student.id}`,
      ),
      /course_completion_immutable/,
    );
    await violation(
      tools.db.execute(sql`delete from course_completion where user_id = ${student.id}`),
      /course_completion_not_deletable/,
    );
  });
});

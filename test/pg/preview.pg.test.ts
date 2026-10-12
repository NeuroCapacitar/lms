import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { grantEntitlement } from '../../src/server/access/entitlement-store.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { createCourse, setCourseStatus } from '../../src/server/catalog/catalog-store.ts';
import { getDraft, saveDraft } from '../../src/server/catalog/curriculum-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createDemoCourse } from '../helpers/demo-course.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M3-07 em Postgres 18 real: a prévia de aluno da Staff. Só leitura, mesmo formato do aluno com
 * `preview: true`, ignora direito, drip e sequência e NÃO deixa nenhuma linha em entitlement,
 * enrollment, lesson_completion nem course_completion.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
/** Dia da âncora: com o curso real, só o módulo 1 estaria liberado. */
const T0 = new Date('2026-10-11T12:00:00.000Z');

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let seq = 0;

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
});
afterAll(async () => {
  await tools.close();
  await database.drop();
});
beforeEach(async () => {
  await tools.db.execute(
    sql`truncate table course_completion, lesson_completion, entitlement, enrollment, lesson, module, lesson_draft, module_draft, course_content, course_draft, curriculum_state, offer, course cascade`,
  );
  await tools.db.delete(schema.userSuspension);
  await tools.db.delete(schema.session);
  await tools.db.delete(schema.staffGrant);
  await tools.db.delete(schema.userRole);
  await tools.db.delete(schema.user);
});

const app = () =>
  apiApp({ emailSender: createFakeEmailSender(), isStaffEmail: async () => true, clock: () => T0 });
const env = () =>
  ({
    HYPERDRIVE: { connectionString: database.connectionString },
    APP_BASE_URL: BASE_URL,
    BETTER_AUTH_SECRET: SECRET,
    TURNSTILE_SECRET_KEY: 'x',
  }) as unknown as Env;

async function newUser() {
  seq += 1;
  const user = tools.test.createUser({ email: `pessoa${seq}@example.test`, name: `Pessoa ${seq}` });
  await tools.test.saveUser(user);
  return { id: user.id, headers: (await tools.test.login({ userId: user.id })).headers };
}
/** Staff entra DEPOIS de receber o papel (dar papel encerra as sessões antigas). */
async function newStaff(role: 'support' | 'admin' = 'support') {
  const person = await newUser();
  await grantRole(tools.db, { actorId: null, targetId: person.id, role });
  return { id: person.id, headers: (await tools.test.login({ userId: person.id })).headers };
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
  return { ...fixture, lesson, lessonIds: rows.map((row) => row.id) };
}
const previewOutline = (headers: Headers | undefined, courseId: string) =>
  call('GET', `/staff/preview/courses/${courseId}/outline`, headers);
const previewLesson = (headers: Headers | undefined, courseId: string, lessonId: string) =>
  call('GET', `/staff/preview/courses/${courseId}/lessons/${lessonId}`, headers);

const counts = async () => ({
  entitlement: (await tools.db.select().from(schema.entitlement)).length,
  enrollment: (await tools.db.select().from(schema.enrollment)).length,
  lessonCompletion: (await tools.db.select().from(schema.lessonCompletion)).length,
  courseCompletion: (await tools.db.select().from(schema.courseCompletion)).length,
  audit: (await tools.db.select().from(schema.auditLog)).length,
});

describe('autorização', () => {
  it('sem sessão 401; aluno comum 403 (mapa e aula); Suporte SEM grant 200', async () => {
    const { courseId, lesson } = await demo();
    const student = await newUser();
    const support = await newStaff('support');
    expect((await previewOutline(undefined, courseId)).status).toBe(401);
    expect((await previewLesson(undefined, courseId, lesson['Boas-vindas']!)).status).toBe(401);
    expect((await previewOutline(student.headers, courseId)).status).toBe(403);
    expect((await previewLesson(student.headers, courseId, lesson['Boas-vindas']!)).status).toBe(
      403,
    );
    expect((await previewOutline(support.headers, courseId)).status).toBe(200);
    expect((await previewLesson(support.headers, courseId, lesson['Boas-vindas']!)).status).toBe(
      200,
    );
  });

  it('aluno MATRICULADO também não usa a prévia (o papel de Staff é que vale)', async () => {
    const { courseId, offerId } = await demo();
    const student = await newUser();
    await grantEntitlement(tools.db, {
      userId: student.id,
      courseId,
      offerId,
      source: 'free_offer',
      sourceRef: `free:${student.id}:0`,
      accessMonths: 3,
      startsAt: T0,
      grantedBy: student.id,
    });
    expect((await previewOutline(student.headers, courseId)).status).toBe(403);
  });

  it('id malformado, curso inexistente e aula de OUTRO curso: 404', async () => {
    const { courseId, lesson } = await demo();
    const support = await newStaff();
    expect((await previewOutline(support.headers, 'xyz')).status).toBe(404);
    expect((await previewOutline(support.headers, crypto.randomUUID())).status).toBe(404);
    expect((await previewLesson(support.headers, courseId, 'xyz')).status).toBe(404);
    expect((await previewLesson(support.headers, courseId, crypto.randomUUID())).status).toBe(404);
    const other = await createCourse(tools.db, {
      actorId: null,
      slug: 'outro-curso',
      title: 'Outro',
      sequenceMode: 'free',
    });
    // curso sem currículo publicado: nada a mostrar
    expect((await previewOutline(support.headers, other)).status).toBe(404);
    expect((await previewLesson(support.headers, other, lesson['Boas-vindas']!)).status).toBe(404);
  });
});

describe('o que a prévia mostra', () => {
  it('mesmo formato do aluno, com preview: true, tudo liberado (drip e sequência ignorados) e sem direito', async () => {
    const { courseId, offerId } = await demo();
    const support = await newStaff();
    const body = await json(await previewOutline(support.headers, courseId));
    expect(body.preview).toBe(true);
    expect(body.course).toMatchObject({
      id: courseId,
      title: 'Curso Demonstrativo',
      sequenceMode: 'guided',
    });
    expect(body.access).toEqual({ hasAccess: true, reason: 'ok', expiresAt: null });
    expect(body.progress).toEqual({ completed: 0, total: 5, percent: 0 });
    expect(body.completedAt).toBeNull();
    const lessons = body.modules.flatMap((m: any) => m.lessons);
    expect(lessons).toHaveLength(6);
    // o curso é GUIADO e o módulo 3 só abriria em D+14: na prévia tudo está liberado
    expect(
      lessons.every(
        (l: any) => l.locked === null && l.releasesAt === null && l.completed === false,
      ),
    ).toBe(true);

    // mesmas chaves do mapa do aluno (mais `preview`)
    const student = await newUser();
    await grantEntitlement(tools.db, {
      userId: student.id,
      courseId,
      offerId,
      source: 'free_offer',
      sourceRef: `free:${student.id}:0`,
      accessMonths: 3,
      startsAt: T0,
      grantedBy: student.id,
    });
    const real = await json(await call('GET', `/courses/${courseId}/outline`, student.headers));
    expect(Object.keys(body).sort()).toEqual([...Object.keys(real), 'preview'].sort());
    expect(Object.keys(body.modules[0]).sort()).toEqual(Object.keys(real.modules[0]).sort());
    expect(Object.keys(lessons[0]).sort()).toEqual(Object.keys(real.modules[0].lessons[0]).sort());
  });

  it('a aula traz o corpo e as vizinhas, com preview: true, e o mesmo formato da aula do aluno', async () => {
    const { courseId, offerId, lesson } = await demo();
    const support = await newStaff();
    const view = await json(await previewLesson(support.headers, courseId, lesson['Revisão']!));
    expect(view.preview).toBe(true);
    expect(view.lesson).toMatchObject({ title: 'Revisão', isOptional: false });
    expect(view.lesson.body.type).toBe('doc');
    expect(view.completed).toBe(false);
    expect(view.previous).toEqual({
      id: lesson['Leitura complementar'],
      title: 'Leitura complementar',
    });
    expect(view.next).toEqual({ id: lesson['Próximos passos'], title: 'Próximos passos' });

    const student = await newUser();
    await grantEntitlement(tools.db, {
      userId: student.id,
      courseId,
      offerId,
      source: 'free_offer',
      sourceRef: `free:${student.id}:0`,
      accessMonths: 3,
      startsAt: T0,
      grantedBy: student.id,
    });
    const real = await json(
      await call('GET', `/lessons/${lesson['Boas-vindas']}`, student.headers),
    );
    const first = await json(
      await previewLesson(support.headers, courseId, lesson['Boas-vindas']!),
    );
    expect(Object.keys(first).sort()).toEqual([...Object.keys(real), 'preview'].sort());
  });

  it('mostra o PUBLICADO: rascunho não publicado e status do curso não aparecem nem bloqueiam', async () => {
    const { courseId } = await demo();
    const support = await newStaff();
    const draft = await getDraft(tools.db, courseId);
    await saveDraft(tools.db, {
      courseId,
      expectedRev: draft!.rev,
      details: { ...draft!.details, displayTitle: 'TÍTULO SÓ NO RASCUNHO' },
      modules: draft!.modules,
    });
    await setCourseStatus(tools.db, { actorId: null, id: courseId, status: 'archived' });
    const body = await json(await previewOutline(support.headers, courseId));
    expect(body.course.title).toBe('Curso Demonstrativo');
    expect(JSON.stringify(body)).not.toContain('SÓ NO RASCUNHO');
  });
});

describe('sem efeito colateral', () => {
  it('percorrer o curso inteiro na prévia não cria linha em entitlement, enrollment, lesson_completion nem course_completion (nem auditoria)', async () => {
    const { courseId, lessonIds } = await demo();
    const support = await newStaff('admin');
    const before = await counts();
    expect((await previewOutline(support.headers, courseId)).status).toBe(200);
    for (const lessonId of lessonIds) {
      expect((await previewLesson(support.headers, courseId, lessonId)).status).toBe(200);
    }
    const after = await counts();
    expect(after).toEqual(before);
    expect(after).toMatchObject({
      entitlement: 0,
      enrollment: 0,
      lessonCompletion: 0,
      courseCompletion: 0,
    });
  });

  it('a prévia é só leitura: POST, PUT, PATCH e DELETE nas rotas de prévia não existem (404)', async () => {
    const { courseId, lesson } = await demo();
    const support = await newStaff('admin');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const path of [
        `/staff/preview/courses/${courseId}/outline`,
        `/staff/preview/courses/${courseId}/lessons/${lesson['Boas-vindas']}`,
        `/staff/preview/courses/${courseId}/lessons/${lesson['Boas-vindas']}/complete`,
      ]) {
        const response = await call(method, path, support.headers);
        expect(response.status, `${method} ${path}`).toBe(404);
      }
    }
    expect(await counts()).toMatchObject({
      lessonCompletion: 0,
      courseCompletion: 0,
      enrollment: 0,
    });
  });
});

describe('Staff pelas rotas do aluno', () => {
  it('Staff SEM matrícula não conclui aula, não vê o mapa do aluno e nada é gravado', async () => {
    const { courseId, lesson } = await demo();
    const admin = await newStaff('admin');
    const complete = await call(
      'POST',
      `/lessons/${lesson['Boas-vindas']}/complete`,
      admin.headers,
    );
    expect(complete.status).toBe(403);
    expect(await json(complete)).toEqual({ error: { code: 'access_denied', reason: 'no_access' } });
    expect((await call('GET', `/courses/${courseId}/outline`, admin.headers)).status).toBe(403);
    expect((await call('GET', `/lessons/${lesson['Boas-vindas']}`, admin.headers)).status).toBe(
      403,
    );
    expect(await counts()).toMatchObject({ entitlement: 0, enrollment: 0, lessonCompletion: 0 });
  });

  it('Staff que TAMBÉM está matriculada estuda normalmente; a prévia não lê nem muda o progresso dela', async () => {
    const { courseId, offerId, lesson } = await demo();
    const staff = await newStaff('support');
    await grantEntitlement(tools.db, {
      userId: staff.id,
      courseId,
      offerId,
      source: 'free_offer',
      sourceRef: `free:${staff.id}:0`,
      accessMonths: 3,
      startsAt: T0,
      grantedBy: staff.id,
    });
    // como aluna: conclui a primeira aula
    const done = await call('POST', `/lessons/${lesson['Boas-vindas']}/complete`, staff.headers);
    expect(done.status).toBe(201);
    const student = await json(await call('GET', `/courses/${courseId}/outline`, staff.headers));
    expect(student.progress).toEqual({ completed: 1, total: 5, percent: 20 });
    // a prévia continua sem progresso e sem concluídas
    const preview = await json(await previewOutline(staff.headers, courseId));
    expect(preview.progress).toEqual({ completed: 0, total: 5, percent: 0 });
    expect(preview.modules.flatMap((m: any) => m.lessons).some((l: any) => l.completed)).toBe(
      false,
    );
    // percorrer a prévia não mudou a conclusão real
    for (const lessonId of Object.values(lesson))
      await previewLesson(staff.headers, courseId, lessonId);
    expect(
      (await json(await call('GET', `/courses/${courseId}/outline`, staff.headers))).progress
        .completed,
    ).toBe(1);
    expect(await counts()).toMatchObject({ entitlement: 1, enrollment: 1, lessonCompletion: 1 });
  });
});

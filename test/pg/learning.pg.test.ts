import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { grantEntitlement } from '../../src/server/access/entitlement-store.ts';
import {
  createCourse,
  createOffer,
  setCourseStatus,
  setOfferStatus,
} from '../../src/server/catalog/catalog-store.ts';
import {
  getDraft,
  publishCurriculum,
  saveDraft,
} from '../../src/server/catalog/curriculum-store.ts';
import { seedDemoCourse } from '../../src/server/catalog/demo-seed.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createDemoCourse } from '../helpers/demo-course.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M3-03 em Postgres 18 real: o mapa do curso e a aula. O servidor decide drip (dias civis de São
 * Paulo, a partir da âncora), sequência guiada ou livre e acesso; a resposta de aula bloqueada nunca
 * traz o conteúdo. O relógio é injetado, então "daqui a 8 dias" é uma linha, não uma espera.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
/** A âncora de quase todos os testes: 11/out/2026 12:00 UTC (09:00 em São Paulo). */
const T0 = new Date('2026-10-11T12:00:00.000Z');
const day = (n: number, hours = 12) =>
  new Date(T0.getTime() + n * 86_400_000 + (hours - 12) * 3_600_000);

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let seq = 0;
let clockNow = T0;

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
});
afterAll(async () => {
  await tools.close();
  await database.drop();
});
beforeEach(async () => {
  clockNow = T0;
  await tools.db.execute(
    sql`truncate table lesson_completion, entitlement, enrollment, lesson, module, lesson_draft, module_draft, course_content, course_draft, curriculum_state, offer, course cascade`,
  );
  await tools.db.delete(schema.userSuspension);
  await tools.db.delete(schema.session);
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
const get = (path: string, headers?: Headers) => app().request(`/api${path}`, { headers }, env());
const json = async (response: Response) => (await response.json()) as Record<string, any>;

/** O curso demonstrativo (guiado; D+0, D+7, D+14; uma aula opcional) e a lista de aulas em ordem. */
async function demo() {
  const fixture = await createDemoCourse(tools.db);
  const rows = await tools.db
    .select({ id: schema.lesson.id, title: schema.lesson.title, moduleId: schema.lesson.moduleId })
    .from(schema.lesson)
    .where(eq(schema.lesson.courseId, fixture.courseId));
  const byTitle = Object.fromEntries(rows.map((row) => [row.title, row.id])) as Record<
    string,
    string
  >;
  return { ...fixture, lesson: byTitle };
}

/** Matricula com a âncora em `at` (3 meses), como a inscrição gratuita faria. */
async function enrolled(courseId: string, offerId: string, at = T0, months = 3) {
  const student = await newStudent();
  await grantEntitlement(tools.db, {
    userId: student.id,
    courseId,
    offerId,
    source: 'free_offer',
    sourceRef: `free:${student.id}:${offerId}:0`,
    accessMonths: months,
    startsAt: at,
    grantedBy: student.id,
  });
  return student;
}
const complete = (userId: string, courseId: string, lessonId: string) =>
  tools.db.insert(schema.lessonCompletion).values({ userId, courseId, lessonId });

describe('autorização', () => {
  it('sem sessão: 401; id malformado: 404; aula inexistente: 404', async () => {
    const { courseId } = await demo();
    expect((await get(`/courses/${courseId}/outline`)).status).toBe(401);
    expect((await get(`/lessons/${crypto.randomUUID()}`)).status).toBe(401);
    const student = await newStudent();
    expect((await get('/courses/xyz/outline', student.headers)).status).toBe(404);
    expect((await get('/lessons/xyz', student.headers)).status).toBe(404);
    expect((await get(`/lessons/${crypto.randomUUID()}`, student.headers)).status).toBe(404);
  });

  it('termos vigentes não aceitos: 403 terms_required', async () => {
    const { courseId, offerId } = await demo();
    const student = await enrolled(courseId, offerId);
    await tools.db.insert(schema.legalDocumentVersion).values({
      kind: 'terms',
      version: 'teste-m3-03',
      body: 'TEXTO PROVISÓRIO de teste',
      effectiveFrom: new Date(Date.now() - 86_400_000),
    });
    try {
      const response = await get(`/courses/${courseId}/outline`, student.headers);
      expect(response.status).toBe(403);
      expect(await json(response)).toEqual({ error: { code: 'terms_required' } });
    } finally {
      await tools.db.delete(schema.legalDocumentVersion);
    }
  });

  it('pessoa NÃO inscrita: 403 access_denied no mapa e na aula, sem nenhum dado do curso', async () => {
    const { courseId, lesson } = await demo();
    const stranger = await newStudent();
    const outline = await get(`/courses/${courseId}/outline`, stranger.headers);
    expect(outline.status).toBe(403);
    expect(await json(outline)).toEqual({ error: { code: 'access_denied', reason: 'no_access' } });
    const lessonResponse = await get(`/lessons/${lesson['Boas-vindas']}`, stranger.headers);
    expect(lessonResponse.status).toBe(403);
    const text = await lessonResponse.text();
    expect(text).toBe('{"error":{"code":"access_denied","reason":"no_access"}}');
    expect(text).not.toContain('Boas-vindas');
  });

  it('inscrita em OUTRO curso: não abre este (403)', async () => {
    const first = await demo();
    const secondCourse = await createCourse(tools.db, {
      actorId: null,
      slug: 'outro-curso',
      title: 'Outro',
      sequenceMode: 'free',
    });
    const secondOffer = await createOffer(tools.db, {
      actorId: null,
      courseId: secondCourse,
      name: 'Gratuita',
      kind: 'free',
      priceCents: 0,
      accessMonths: 3,
      maxInstallments: 1,
    });
    await setOfferStatus(tools.db, {
      actorId: null,
      courseId: secondCourse,
      offerId: secondOffer,
      status: 'active',
    });
    await setCourseStatus(tools.db, { actorId: null, id: secondCourse, status: 'published' });
    const student = await enrolled(secondCourse, secondOffer);
    expect((await get(`/courses/${first.courseId}/outline`, student.headers)).status).toBe(403);
    expect((await get(`/lessons/${first.lesson['Boas-vindas']}`, student.headers)).status).toBe(
      403,
    );
  });
});

describe('mapa do curso e drip', () => {
  it('no dia da âncora: D+0 aberto, D+7 e D+14 com a data; nenhum conteúdo no mapa', async () => {
    const { courseId, offerId } = await demo();
    const student = await enrolled(courseId, offerId);
    const response = await get(`/courses/${courseId}/outline`, student.headers);
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text);
    expect(body.course).toMatchObject({
      id: courseId,
      title: 'Curso Demonstrativo',
      sequenceMode: 'guided',
    });
    expect(body.access).toMatchObject({ hasAccess: true, reason: 'ok' });
    // âncora 11/out 09:00 em São Paulo: D+7 libera em 18/out 00:00 (03:00Z), D+14 em 25/out
    expect(body.modules.map((m: any) => m.releasesAt)).toEqual([
      '2026-10-11T03:00:00.000Z',
      '2026-10-18T03:00:00.000Z',
      '2026-10-25T03:00:00.000Z',
    ]);
    const [m1, m2, m3] = body.modules;
    expect(m1.lessons.map((l: any) => [l.title, l.locked])).toEqual([
      ['Boas-vindas', null],
      ['Como estudar aqui', 'sequence_locked'],
    ]);
    expect(m2.lessons.map((l: any) => l.locked)).toEqual(['drip_locked', 'drip_locked']);
    expect(m2.lessons[0].releasesAt).toBe('2026-10-18T03:00:00.000Z');
    expect(m3.lessons.map((l: any) => l.locked)).toEqual(['drip_locked', 'drip_locked']);
    // nunca o conteúdo: sem campo `body` e sem o texto das aulas
    expect(text).not.toContain('"body"');
    expect(text).not.toContain('Texto de exemplo');
  });

  it('a fronteira do dia civil de São Paulo: 1 ms antes bloqueia, no instante abre', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    // o módulo 2 só abre a sequência depois do módulo 1; conclui o módulo 1 para isolar o drip
    await complete(student.id, courseId, lesson['Boas-vindas']!);
    await complete(student.id, courseId, lesson['Como estudar aqui']!);
    clockNow = new Date('2026-10-18T02:59:59.999Z');
    const before = await get(`/lessons/${lesson['Conceito central']}`, student.headers);
    expect(before.status).toBe(403);
    expect(await json(before)).toEqual({
      error: {
        code: 'lesson_locked',
        reason: 'drip_locked',
        releasesAt: '2026-10-18T03:00:00.000Z',
      },
    });
    clockNow = new Date('2026-10-18T03:00:00.000Z');
    expect((await get(`/lessons/${lesson['Conceito central']}`, student.headers)).status).toBe(200);
  });

  it('aula de módulo futuro: 403 SEM título nem corpo (nenhum vazamento)', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    const response = await get(`/lessons/${lesson['Revisão']}`, student.headers);
    expect(response.status).toBe(403);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      error: {
        code: 'lesson_locked',
        reason: 'drip_locked',
        releasesAt: '2026-10-25T03:00:00.000Z',
      },
    });
    for (const secret of ['Revisão', 'Texto de exemplo', 'body', 'title']) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('a hora da âncora não importa: inscrever às 23h libera o D+7 à meia-noite do 7º dia civil', async () => {
    const { courseId, offerId } = await demo();
    // 11/out 23:30 em São Paulo = 12/out 02:30Z: o dia civil é 11/out
    const late = new Date('2026-10-12T02:30:00.000Z');
    const student = await enrolled(courseId, offerId, late);
    clockNow = late;
    const body = await json(await get(`/courses/${courseId}/outline`, student.headers));
    expect(body.modules[1].releasesAt).toBe('2026-10-18T03:00:00.000Z');
  });
});

describe('sequência guiada e livre', () => {
  it('guiada: concluir a obrigatória libera a próxima; a opcional não bloqueia a seguinte', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    clockNow = day(15); // todos os módulos liberados pelo drip
    const locked = (title: string) => get(`/lessons/${lesson[title]}`, student.headers);

    expect((await locked('Boas-vindas')).status).toBe(200);
    const second = await locked('Como estudar aqui');
    expect(second.status).toBe(403);
    expect((await json(second)).error).toMatchObject({
      code: 'lesson_locked',
      reason: 'sequence_locked',
    });

    await complete(student.id, courseId, lesson['Boas-vindas']!);
    expect((await locked('Como estudar aqui')).status).toBe(200);
    await complete(student.id, courseId, lesson['Como estudar aqui']!);
    expect((await locked('Conceito central')).status).toBe(200);
    // "Leitura complementar" é opcional e NÃO foi concluída; "Revisão" abre assim mesmo
    await complete(student.id, courseId, lesson['Conceito central']!);
    expect((await locked('Revisão')).status).toBe(200);
    expect((await locked('Leitura complementar')).status).toBe(200);
    // mas "Próximos passos" (obrigatória) espera "Revisão"
    expect((await json(await locked('Próximos passos'))).error.reason).toBe('sequence_locked');
  });

  it('livre: qualquer aula liberada abre, sem concluir nada', async () => {
    const { courseId, offerId, lesson } = await demo();
    await tools.db
      .update(schema.course)
      .set({ sequenceMode: 'free' })
      .where(eq(schema.course.id, courseId));
    const student = await enrolled(courseId, offerId);
    expect((await get(`/lessons/${lesson['Como estudar aqui']}`, student.headers)).status).toBe(
      200,
    );
    // o drip continua valendo no curso livre
    expect((await get(`/lessons/${lesson['Conceito central']}`, student.headers)).status).toBe(403);
  });
});

describe('aula liberada: conteúdo e vizinhas', () => {
  it('traz o corpo, as aulas vizinhas na ordem do curso e se já foi concluída', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    await complete(student.id, courseId, lesson['Boas-vindas']!);
    const view = await json(await get(`/lessons/${lesson['Como estudar aqui']}`, student.headers));
    expect(view.course).toEqual({ id: courseId, title: 'Curso Demonstrativo' });
    expect(view.lesson).toMatchObject({ title: 'Como estudar aqui', isOptional: false });
    expect(view.lesson.body.type).toBe('doc');
    expect(view.completed).toBe(false);
    expect(view.previous).toEqual({ id: lesson['Boas-vindas'], title: 'Boas-vindas' });
    expect(view.next).toEqual({ id: lesson['Conceito central'], title: 'Conceito central' });
    const first = await json(await get(`/lessons/${lesson['Boas-vindas']}`, student.headers));
    expect(first.previous).toBeNull();
    expect(first.completed).toBe(true);
  });
});

describe('acesso ao curso', () => {
  it('expirado: tudo bloqueado, mesmo com o módulo liberado pelo drip', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId); // 3 meses a partir de 11/out
    clockNow = new Date('2027-02-01T12:00:00.000Z');
    const outline = await get(`/courses/${courseId}/outline`, student.headers);
    expect(outline.status).toBe(403);
    expect(await json(outline)).toEqual({ error: { code: 'access_denied', reason: 'expired' } });
    const aula = await get(`/lessons/${lesson['Boas-vindas']}`, student.headers);
    expect(aula.status).toBe(403);
    expect(await aula.text()).toBe('{"error":{"code":"access_denied","reason":"expired"}}');
  });

  it('conta suspensa: access_denied suspended', async () => {
    const { courseId, offerId } = await demo();
    const student = await enrolled(courseId, offerId);
    await tools.db.insert(schema.userSuspension).values({ userId: student.id, reason: 'teste' });
    expect(await json(await get(`/courses/${courseId}/outline`, student.headers))).toEqual({
      error: { code: 'access_denied', reason: 'suspended' },
    });
  });

  it('reinscrever depois de expirar NÃO reinicia o drip (a âncora é a original)', async () => {
    const { courseId, offerId } = await demo();
    const student = await enrolled(courseId, offerId); // âncora 11/out, expira 11/jan
    clockNow = new Date('2027-02-01T12:00:00.000Z');
    expect((await get(`/courses/${courseId}/outline`, student.headers)).status).toBe(403);
    // nova inscrição em 1/fev: novo direito, mesma âncora
    await grantEntitlement(tools.db, {
      userId: student.id,
      courseId,
      offerId,
      source: 'free_offer',
      sourceRef: `free:${student.id}:${offerId}:1`,
      accessMonths: 3,
      startsAt: clockNow,
      grantedBy: student.id,
    });
    const body = await json(await get(`/courses/${courseId}/outline`, student.headers));
    // se o drip tivesse reiniciado em 1/fev, o módulo 2 só abriria em 8/fev
    expect(body.modules[0].releasesAt).toBe('2026-10-11T03:00:00.000Z');
    expect(body.modules[1].lessons.map((l: any) => l.locked)).not.toContain('drip_locked');
    expect(body.modules[2].lessons.map((l: any) => l.locked)).not.toContain('drip_locked');
  });
});

describe('currículo que muda depois', () => {
  it('aula retirada na publicação sai do mapa e a aula vira 404; as outras seguem', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
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
    const body = await json(await get(`/courses/${courseId}/outline`, student.headers));
    const titles = body.modules.flatMap((m: any) => m.lessons.map((l: any) => l.title));
    expect(titles).not.toContain('Como estudar aqui');
    expect((await get(`/lessons/${lesson['Como estudar aqui']}`, student.headers)).status).toBe(
      404,
    );
    // sem a aula retirada, a próxima obrigatória do módulo 2 depende só da primeira
    expect(body.modules[0].lessons.map((l: any) => l.locked)).toEqual([null]);
  });
});

describe('o seed não muda de forma', () => {
  it('o curso demonstrativo continua guiado com D+0, D+7 e D+14', async () => {
    const seeded = await seedDemoCourse(tools.db);
    const modules = await tools.db
      .select()
      .from(schema.courseModule)
      .where(eq(schema.courseModule.courseId, seeded.courseId));
    expect(modules.map((m) => m.dripDays).sort((a, b) => a - b)).toEqual([0, 7, 14]);
  });
});

describe('lesson_completion (restrições do banco)', () => {
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

  it('só existe para quem tem matrícula no curso da aula (FK composta)', async () => {
    const { courseId, lesson } = await demo();
    const stranger = await newStudent();
    await violation(
      complete(stranger.id, courseId, lesson['Boas-vindas']!),
      /lesson_completion_enrollment_fk/,
    );
  });

  it('a aula tem de ser do curso informado (FK composta)', async () => {
    const first = await demo();
    const student = await enrolled(first.courseId, first.offerId);
    await violation(
      complete(student.id, crypto.randomUUID(), first.lesson['Boas-vindas']!),
      /lesson_completion_(enrollment|lesson)_fk/,
    );
  });

  it('única por pessoa e aula; append-only: não se reescreve nem se apaga', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    await complete(student.id, courseId, lesson['Boas-vindas']!);
    await violation(
      complete(student.id, courseId, lesson['Boas-vindas']!),
      /lesson_completion_pk|duplicate key/,
    );
    await violation(
      tools.db.execute(
        sql`update lesson_completion set completed_at = now() where user_id = ${student.id}`,
      ),
      /completion_immutable/,
    );
    await violation(
      tools.db.execute(sql`delete from lesson_completion where user_id = ${student.id}`),
      /completion_not_deletable/,
    );
    await violation(
      tools.db.execute(
        sql`insert into lesson_completion (user_id, course_id, lesson_id, method) values (${student.id}, ${courseId}, ${lesson['Como estudar aqui']!}, 'certificate')`,
      ),
      /lesson_completion_method_check/,
    );
  });
});

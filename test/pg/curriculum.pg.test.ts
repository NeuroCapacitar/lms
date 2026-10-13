import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';
import { richTextFromParagraph, type RichText } from '../../src/features/content/rich-text.ts';
import type { Quiz } from '../../src/features/quiz/quiz.ts';
import { grantCapability, grantRole } from '../../src/server/auth/access-store.ts';
import {
  CurriculumInvalidError,
  DraftConflictError,
  getDraft,
  getPublishedCurriculum,
  publishCurriculum,
  saveDraft,
  VideoProviderNotVerifiedError,
} from '../../src/server/catalog/curriculum-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M2-02 em Postgres 18 real: currículo vivo. Rascunho com concorrência otimista, ids estáveis,
 * publicação atômica (tudo ou nada, serializada), o que sai é aposentado e não apagado, e nenhum
 * leitor vê estado misto.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';

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
  // TRUNCATE não dispara os gatilhos de linha que protegem o publicado (a role de runtime não o tem).
  await tools.db.execute(
    sql`truncate table lesson, module, lesson_draft, module_draft, course_content, course_draft, curriculum_state, offer, course cascade`,
  );
  await tools.db.delete(schema.session);
  await tools.db.delete(schema.staffGrant);
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

const app = () => apiApp({ emailSender: createFakeEmailSender(), isStaffEmail: async () => false });

async function newUser() {
  seq += 1;
  const user = tools.test.createUser({ email: `pessoa${seq}@example.test`, name: `Pessoa ${seq}` });
  await tools.test.saveUser(user);
  return user.id;
}
async function actor(role: 'admin' | 'support', grants: string[] = []) {
  const id = await newUser();
  await grantRole(tools.db, { actorId: null, targetId: id, role });
  for (const capability of grants) {
    await grantCapability(tools.db, { actorId: null, targetId: id, capability });
  }
  return { id, headers: (await tools.test.login({ userId: id })).headers };
}

function call(method: string, path: string, headers: Headers | undefined, body?: unknown) {
  const merged = new Headers(headers);
  merged.set('origin', BASE_URL);
  if (body !== undefined) merged.set('content-type', 'application/json');
  return app().request(
    `/api/staff${path}`,
    { method, headers: merged, body: body === undefined ? undefined : JSON.stringify(body) },
    env(),
  );
}
const json = async (response: Response) => (await response.json()) as Record<string, any>;

type L = {
  id?: string;
  title: string;
  isOptional?: boolean;
  body?: RichText | null;
  kind?: 'text' | 'video' | 'quiz';
  videoAssetId?: string | null;
  quiz?: Quiz | null;
};
type M = { id?: string; title: string; dripDays?: number; lessons: L[] };
const details = {
  displayTitle: 'Título público',
  description: richTextFromParagraph('Descrição'),
  workloadHours: 12,
};
const payload = (expectedRev: number, modules: M[], d = details) => ({
  expectedRev,
  details: d,
  modules: modules.map((module) => ({
    ...module,
    dripDays: module.dripDays ?? 0,
    lessons: module.lessons.map((lessonItem) => ({
      isOptional: false,
      body: null,
      ...lessonItem,
    })),
  })),
});
const BASIC: M[] = [
  { title: 'Módulo A', lessons: [{ title: 'A1' }, { title: 'A2', isOptional: true }] },
  {
    title: 'Módulo B',
    dripDays: 7,
    lessons: [{ title: 'B1', body: richTextFromParagraph('Corpo de B1') }],
  },
];

async function newCourse(slug = 'curso-teste') {
  const [row] = await tools.db
    .insert(schema.course)
    .values({ slug, title: 'Título interno', sequenceMode: 'guided' })
    .returning();
  return row!.id;
}
async function save(
  admin: { headers: Headers },
  courseId: string,
  rev: number,
  modules: M[],
  d = details,
) {
  const response = await call(
    'PUT',
    `/courses/${courseId}/draft`,
    admin.headers,
    payload(rev, modules, d),
  );
  return { response, body: await json(response) };
}
const publish = (admin: { headers: Headers }, courseId: string) =>
  call('POST', `/courses/${courseId}/publish`, admin.headers, {});
const ids = (modules: { id: string; lessons: { id: string }[] }[]) => ({
  modules: modules.map((m) => m.id),
  lessons: modules.flatMap((m) => m.lessons.map((l) => l.id)),
});
const shape = (
  modules: { title: string; dripDays: number; lessons: { title: string; isOptional: boolean }[] }[],
) =>
  modules.map(
    (m) =>
      `${m.title}(${m.dripDays})[${m.lessons.map((l) => l.title + (l.isOptional ? '?' : '')).join(',')}]`,
  );

async function expectViolation(work: PromiseLike<unknown>, pattern: RegExp) {
  const error = (await work.then(
    () => null,
    (reason: unknown) => reason,
  )) as { message?: string; cause?: { message?: string } } | null;
  expect(error, 'a escrita deveria ser recusada').not.toBeNull();
  expect(`${error?.message} ${error?.cause?.message}`).toMatch(pattern);
}

describe('rascunho', () => {
  it('um curso novo tem rascunho vazio, contador 0 e parte do título interno', async () => {
    const admin = await actor('admin');
    const courseId = await newCourse();
    const draft = await json(await call('GET', `/courses/${courseId}/draft`, admin.headers));
    expect(draft).toMatchObject({ rev: 0, publishedVersion: 0, modules: [] });
    expect(draft.details).toEqual({
      displayTitle: 'Título interno',
      description: null,
      workloadHours: null,
      coverMediaId: null,
      bannerMediaId: null,
    });
    expect(
      (await call('GET', '/courses/00000000-0000-4000-8000-000000000000/draft', admin.headers))
        .status,
    ).toBe(404);
  });

  it('salvar grava a árvore inteira em ordem, sobe o contador e devolve os ids', async () => {
    const admin = await actor('admin');
    const courseId = await newCourse();
    const { response, body } = await save(admin, courseId, 0, BASIC);
    expect(response.status).toBe(200);
    expect(body.rev).toBe(1);
    expect(shape(body.modules)).toEqual(['Módulo A(0)[A1,A2?]', 'Módulo B(7)[B1]']);
    expect(body.modules[1].lessons[0].body).toEqual(richTextFromParagraph('Corpo de B1'));
    expect(new Set([...ids(body.modules).modules, ...ids(body.modules).lessons]).size).toBe(5);
    expect(await json(await call('GET', `/courses/${courseId}/draft`, admin.headers))).toEqual(
      body,
    );
  });

  it('o rascunho aceita trabalho incompleto (títulos vazios); corpo inválido é 400', async () => {
    const admin = await actor('admin');
    const courseId = await newCourse();
    expect(
      (
        await save(admin, courseId, 0, [{ title: '', lessons: [{ title: '' }] }], {
          ...details,
          displayTitle: '',
        })
      ).response.status,
    ).toBe(200);
    for (const body of [
      { ...payload(1, BASIC), modules: [{ title: 'x', dripDays: -1, lessons: [] }] },
      { ...payload(1, BASIC), expectedRev: -1 },
      { ...payload(1, BASIC), extra: true },
      payload(1, [
        { title: 'x', lessons: [{ title: 'y', body: { a: 'x'.repeat(200_001) } as never }] },
      ]),
      // M5-02 e M5-04: video e quiz existem; tipo desconhecido segue recusado.
      payload(1, [{ title: 'x', lessons: [{ title: 'y', kind: 'enquete' } as never] }]),
    ]) {
      expect(
        (await call('PUT', `/courses/${courseId}/draft`, admin.headers, body)).status,
        JSON.stringify(body).slice(0, 80),
      ).toBe(400);
    }
    expect((await getDraft(tools.db, courseId))!.rev).toBe(1);
  });

  it('concorrência otimista: salvar com contador vencido dá 409 e NÃO aplica nada', async () => {
    const admin = await actor('admin');
    const courseId = await newCourse();
    const first = await save(admin, courseId, 0, BASIC);
    const stale = await save(admin, courseId, 0, [{ title: 'Intruso', lessons: [{ title: 'X' }] }]);
    expect(stale.response.status).toBe(409);
    expect(stale.body).toEqual({ error: { code: 'draft_conflict', currentRev: 1 } });
    expect(shape((await getDraft(tools.db, courseId))!.modules)).toEqual(shape(first.body.modules));
  });

  it('duas edições simultâneas com o mesmo contador (conexões separadas): exatamente uma vence', async () => {
    const courseId = await newCourse();
    const [a, b] = await Promise.all([
      openDatabase(database.connectionString),
      openDatabase(database.connectionString),
    ]);
    try {
      const input = (title: string) => ({
        courseId,
        expectedRev: 0,
        details,
        modules: [{ title, dripDays: 0, lessons: [{ title: 'L', isOptional: false, body: null }] }],
      });
      const results = await Promise.allSettled([
        saveDraft(a.db, input('Um')),
        saveDraft(b.db, input('Dois')),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(DraftConflictError);
      expect((await getDraft(tools.db, courseId))!.modules).toHaveLength(1);
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  });

  it('ids estáveis: editar, reordenar e MOVER aula de módulo mantém os ids; o que sai do corpo sai do rascunho', async () => {
    const admin = await actor('admin');
    const courseId = await newCourse();
    const { body: v1 } = await save(admin, courseId, 0, BASIC);
    const [a, b] = v1.modules;
    const [a1, a2] = a.lessons;
    const b1 = b.lessons[0];
    // reordena os módulos, move A1 para B (no meio) e renomeia
    const { response, body: v2 } = await save(admin, courseId, 1, [
      {
        id: b.id,
        title: 'B renomeado',
        dripDays: 14,
        lessons: [
          { id: b1.id, title: 'B1' },
          { id: a1.id, title: 'A1 movida' },
        ],
      },
      { id: a.id, title: 'A', lessons: [{ id: a2.id, title: 'A2', isOptional: true }] },
    ]);
    expect(response.status).toBe(200);
    expect(shape(v2.modules)).toEqual(['B renomeado(14)[B1,A1 movida]', 'A(0)[A2?]']);
    expect(v2.modules.map((m: { id: string }) => m.id)).toEqual([b.id, a.id]);
    expect(v2.modules[0].lessons.map((l: { id: string }) => l.id)).toEqual([b1.id, a1.id]);
    // remover: só o que sumiu do corpo some do rascunho
    const { body: v3 } = await save(admin, courseId, 2, [
      { id: a.id, title: 'A', lessons: [{ id: a2.id, title: 'A2' }] },
    ]);
    expect(ids(v3.modules)).toEqual({ modules: [a.id], lessons: [a2.id] });
    expect(await tools.db.select().from(schema.lessonDraft)).toHaveLength(1);
    expect(await tools.db.select().from(schema.moduleDraft)).toHaveLength(1);
  });

  it('ids de outro curso, desconhecidos ou repetidos são recusados e nada é salvo', async () => {
    const admin = await actor('admin');
    const one = await newCourse('curso-um');
    const two = await newCourse('curso-dois');
    const { body: other } = await save(admin, two, 0, BASIC);
    const { body: mine } = await save(admin, one, 0, BASIC);
    const foreignModule = other.modules[0].id;
    const foreignLesson = other.modules[0].lessons[0].id;
    for (const modules of [
      [{ id: foreignModule, title: 'X', lessons: [{ title: 'y' }] }],
      [{ title: 'X', lessons: [{ id: foreignLesson, title: 'y' }] }],
      [{ id: '00000000-0000-4000-8000-000000000000', title: 'X', lessons: [{ title: 'y' }] }],
      [
        { id: mine.modules[0].id, title: 'X', lessons: [] },
        { id: mine.modules[0].id, title: 'Y', lessons: [] },
      ],
    ] as M[][]) {
      const response = await call(
        'PUT',
        `/courses/${one}/draft`,
        admin.headers,
        payload(1, modules),
      );
      expect(response.status).toBe(400);
      expect(await json(response)).toEqual({ error: { code: 'unknown_id' } });
    }
    expect(shape((await getDraft(tools.db, one))!.modules)).toEqual(shape(mine.modules));
    expect((await getDraft(tools.db, one))!.rev).toBe(1);
    expect((await getDraft(tools.db, two))!.modules).toHaveLength(2);
  });
});

describe('autorização', () => {
  it('Suporte sem grant lê o rascunho mas não edita nem publica; com course.edit faz as duas; aluno nada', async () => {
    const admin = await actor('admin');
    const courseId = await newCourse();
    await save(admin, courseId, 0, BASIC);
    const student = { headers: (await tools.test.login({ userId: await newUser() })).headers };
    const plain = await actor('support');
    const editor = await actor('support', ['course.edit']);
    expect((await call('GET', `/courses/${courseId}/draft`, undefined)).status).toBe(401);
    expect((await call('GET', `/courses/${courseId}/draft`, student.headers)).status).toBe(403);
    expect((await call('GET', `/courses/${courseId}/draft`, plain.headers)).status).toBe(200);
    for (const who of [student, plain]) {
      expect(
        (await call('PUT', `/courses/${courseId}/draft`, who.headers, payload(1, BASIC))).status,
      ).toBe(403);
      expect((await publish(who, courseId)).status).toBe(403);
    }
    expect(
      (await call('PUT', `/courses/${courseId}/draft`, undefined, payload(1, BASIC))).status,
    ).toBe(401);
    expect(
      (await call('PUT', `/courses/${courseId}/draft`, editor.headers, payload(1, BASIC))).status,
    ).toBe(200);
    expect((await publish(editor, courseId)).status).toBe(200);
  });
});

describe('publicação', () => {
  it('valida o rascunho e devolve TODOS os problemas; o publicado não muda', async () => {
    const admin = await actor('admin');
    const courseId = await newCourse();
    const empty = await publish(admin, courseId);
    expect(empty.status).toBe(422);
    expect((await json(empty)).error.problems.map((p: { code: string }) => p.code)).toEqual([
      'no_modules',
    ]);

    await save(
      admin,
      courseId,
      0,
      [
        { title: '', lessons: [] },
        { title: 'Só opcionais', lessons: [{ title: 'o', isOptional: true }, { title: '' }] },
      ],
      { ...details, displayTitle: '  ' },
    );
    const response = await publish(admin, courseId);
    expect(response.status).toBe(422);
    const problems = (await json(response)).error.problems as { code: string; path: string }[];
    expect(problems).toEqual(
      expect.arrayContaining([
        { code: 'course_title_empty', path: 'details.displayTitle' },
        { code: 'module_title_empty', path: 'modules[0].title' },
        { code: 'module_no_lessons', path: 'modules[0].lessons' },
        { code: 'lesson_title_empty', path: 'modules[1].lessons[1].title' },
      ]),
    );
    expect(problems.map((p) => p.code)).not.toContain('no_required_lesson');
    await save(admin, courseId, 1, [
      { title: 'M', lessons: [{ title: 'só opcional', isOptional: true }] },
    ]);
    const noRequired = await publish(admin, courseId);
    expect((await json(noRequired)).error.problems).toEqual([
      { code: 'no_required_lesson', path: 'modules' },
    ]);

    expect(await tools.db.select().from(schema.courseModule)).toHaveLength(0);
    expect(await tools.db.select().from(schema.lesson)).toHaveLength(0);
    expect(await tools.db.select().from(schema.courseContent)).toHaveLength(0);
    expect(await getPublishedCurriculum(tools.db, courseId)).toBeNull();
    await expect(
      publishCurriculum(tools.db, { actorId: admin.id, courseId }),
    ).rejects.toBeInstanceOf(CurriculumInvalidError);
  });

  it('publica com os MESMOS ids do rascunho, audita e o aluno só vê o publicado', async () => {
    const admin = await actor('admin');
    const courseId = await newCourse();
    const { body: draft } = await save(admin, courseId, 0, BASIC);
    const response = await publish(admin, courseId);
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ status: 'published', version: 1 });

    const published = (await getPublishedCurriculum(tools.db, courseId))!;
    expect(published.version).toBe(1);
    expect(ids(published.modules)).toEqual(ids(draft.modules));
    expect(shape(published.modules)).toEqual(shape(draft.modules));
    expect(published.details).toMatchObject(details);
    const entry = (await tools.db.select().from(schema.auditLog)).find(
      (row) => row.action === 'curriculum.publish' && row.targetId === courseId,
    )!;
    expect(entry.actorId).toBe(admin.id);
    expect(entry.details).toMatchObject({
      version: 1,
      modules: 2,
      lessons: 3,
      added: 5,
      retiredModules: 0,
      retiredLessons: 0,
    });

    // editar o rascunho NÃO muda o que o aluno vê
    await save(admin, courseId, 1, [
      { id: draft.modules[0].id, title: 'Só rascunho', lessons: [{ title: 'novo' }] },
    ]);
    expect(shape((await getPublishedCurriculum(tools.db, courseId))!.modules)).toEqual(
      shape(draft.modules),
    );
  });

  it('publicar sem mudanças é um no-op explícito (sem versão nova nem auditoria)', async () => {
    const admin = await actor('admin');
    const courseId = await newCourse();
    await save(admin, courseId, 0, BASIC);
    await publish(admin, courseId);
    const again = await publish(admin, courseId);
    expect(await json(again)).toEqual({ status: 'unchanged', version: 1 });
    // salvar de novo o mesmo conteúdo também não muda o publicado
    const draft = (await getDraft(tools.db, courseId))!;
    await save(admin, courseId, draft.rev, draft.modules as unknown as M[]);
    expect(await json(await publish(admin, courseId))).toEqual({ status: 'unchanged', version: 1 });
    const entries = (await tools.db.select().from(schema.auditLog)).filter(
      (row) => row.action === 'curriculum.publish' && row.targetId === courseId,
    );
    expect(entries).toHaveLength(1);
  });

  it('republicar APOSENTA o que saiu (mesmo id, some do aluno), mantém ids e preserva o movimento de aula', async () => {
    const admin = await actor('admin');
    const courseId = await newCourse();
    const { body: v1 } = await save(admin, courseId, 0, BASIC);
    await publish(admin, courseId);
    const [a, b] = v1.modules;
    const [a1, a2] = a.lessons;
    const b1 = b.lessons[0];

    // A1 vai para o módulo B, A2 sai, o módulo A sai, entra um módulo novo
    await save(admin, courseId, 1, [
      {
        id: b.id,
        title: 'B',
        dripDays: 7,
        lessons: [
          { id: b1.id, title: 'B1', body: richTextFromParagraph('Corpo de B1') },
          { id: a1.id, title: 'A1' },
        ],
      },
      { title: 'Módulo novo', lessons: [{ title: 'N1' }] },
    ]);
    expect(await json(await publish(admin, courseId))).toEqual({ status: 'published', version: 2 });

    const published = (await getPublishedCurriculum(tools.db, courseId))!;
    expect(published.version).toBe(2);
    expect(shape(published.modules)).toEqual(['B(7)[B1,A1]', 'Módulo novo(0)[N1]']);
    expect(published.modules[0]!.lessons.map((l) => l.id)).toEqual([b1.id, a1.id]);
    const allModules = await tools.db.select().from(schema.courseModule);
    const allLessons = await tools.db.select().from(schema.lesson);
    expect(allModules).toHaveLength(3);
    expect(allLessons).toHaveLength(4);
    expect(allModules.find((m) => m.id === a.id)!.retiredAt).toBeInstanceOf(Date);
    expect(allLessons.find((l) => l.id === a2.id)!.retiredAt).toBeInstanceOf(Date);
    expect(allLessons.find((l) => l.id === a1.id)!.retiredAt).toBeNull();
    expect(allLessons.find((l) => l.id === a1.id)!.moduleId).toBe(b.id);
    const entry = (await tools.db.select().from(schema.auditLog)).filter(
      (row) => row.action === 'curriculum.publish' && row.targetId === courseId,
    )[1]!;
    expect(entry.details).toMatchObject({
      version: 2,
      retiredModules: 1,
      retiredLessons: 1,
      added: 2,
    });
  });

  it('o publicado nunca é apagado e o aposentado é definitivo (gatilhos do banco)', async () => {
    const admin = await actor('admin');
    const courseId = await newCourse();
    const { body: v1 } = await save(admin, courseId, 0, BASIC);
    await publish(admin, courseId);
    await save(admin, courseId, 1, [
      {
        id: v1.modules[0].id,
        title: 'A',
        lessons: [{ id: v1.modules[0].lessons[0].id, title: 'A1' }],
      },
    ]);
    await publish(admin, courseId);
    const retiredLesson = (
      await tools.db.select().from(schema.lesson).where(isNotNull(schema.lesson.retiredAt))
    )[0]!;
    const retiredModule = (
      await tools.db
        .select()
        .from(schema.courseModule)
        .where(isNotNull(schema.courseModule.retiredAt))
    )[0]!;
    await expectViolation(
      tools.db
        .update(schema.lesson)
        .set({ retiredAt: null })
        .where(eq(schema.lesson.id, retiredLesson.id)),
      /retired_is_final/,
    );
    await expectViolation(
      tools.db
        .update(schema.courseModule)
        .set({ title: 'Ressuscitado', retiredAt: null })
        .where(eq(schema.courseModule.id, retiredModule.id)),
      /retired_is_final/,
    );
    await expectViolation(tools.db.delete(schema.lesson), /published_not_deletable/);
    await expectViolation(tools.db.delete(schema.courseModule), /published_not_deletable/);
    await expectViolation(
      tools.db
        .update(schema.lesson)
        .set({ id: '00000000-0000-4000-8000-000000000001' })
        .where(and(eq(schema.lesson.courseId, courseId), eq(schema.lesson.title, 'A1'))),
      /id_locked/,
    );
  });

  it('a aula só pertence a módulo do MESMO curso (FK composta)', async () => {
    const admin = await actor('admin');
    const one = await newCourse('curso-um');
    const two = await newCourse('curso-dois');
    await save(admin, one, 0, BASIC);
    await save(admin, two, 0, BASIC);
    await publish(admin, one);
    await publish(admin, two);
    const [moduleOfTwo] = await tools.db
      .select()
      .from(schema.courseModule)
      .where(eq(schema.courseModule.courseId, two));
    await expectViolation(
      tools.db.insert(schema.lesson).values({
        id: crypto.randomUUID(),
        courseId: one,
        moduleId: moduleOfTwo!.id,
        title: 'x',
        position: 0,
      }),
      /lesson_module_fk|foreign key/,
    );
    const [draftModuleOfTwo] = await tools.db
      .select()
      .from(schema.moduleDraft)
      .where(eq(schema.moduleDraft.courseId, two));
    await expectViolation(
      tools.db
        .insert(schema.lessonDraft)
        .values({ courseId: one, moduleId: draftModuleOfTwo!.id, title: 'x', position: 0 }),
      /lesson_draft_module_fk|foreign key/,
    );
  });
});

describe('atomicidade e concorrência da publicação', () => {
  it('duas publicações simultâneas se serializam: uma publica, a outra é no-op, versão 1 e uma só auditoria', async () => {
    const admin = await actor('admin');
    const courseId = await newCourse();
    await save(admin, courseId, 0, BASIC);
    const [a, b] = await Promise.all([
      openDatabase(database.connectionString),
      openDatabase(database.connectionString),
    ]);
    try {
      const results = await Promise.all([
        publishCurriculum(a.db, { actorId: admin.id, courseId }),
        publishCurriculum(b.db, { actorId: admin.id, courseId }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(['published', 'unchanged']);
      expect(results.every((r) => r.version === 1)).toBe(true);
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
    const published = (await getPublishedCurriculum(tools.db, courseId))!;
    expect(shape(published.modules)).toEqual(['Módulo A(0)[A1,A2?]', 'Módulo B(7)[B1]']);
    expect(await tools.db.select().from(schema.courseModule)).toHaveLength(2);
    expect(
      (await tools.db.select().from(schema.auditLog)).filter(
        (row) => row.action === 'curriculum.publish' && row.targetId === courseId,
      ),
    ).toHaveLength(1);
  });

  it('falha no meio da publicação desfaz TUDO: o publicado fica idêntico ao anterior', async () => {
    const admin = await actor('admin');
    const courseId = await newCourse();
    const { body: v1 } = await save(admin, courseId, 0, BASIC);
    await publish(admin, courseId);
    const before = await getPublishedCurriculum(tools.db, courseId);

    // falha injetada: inserir uma aula chamada FALHA estoura DENTRO da transação, depois de módulos já aplicados
    const client = await database.client();
    await client.query(`create function test_explode() returns trigger as $$ begin
      if new.title = 'FALHA' then raise exception 'falha injetada'; end if; return new; end; $$ language plpgsql`);
    await client.query(
      'create trigger test_explode before insert on lesson for each row execute function test_explode()',
    );
    try {
      await save(
        admin,
        courseId,
        1,
        [
          {
            id: v1.modules[1].id,
            title: 'B mudou',
            dripDays: 30,
            lessons: [{ id: v1.modules[1].lessons[0].id, title: 'B1 mudou' }],
          },
          { title: 'Novo', lessons: [{ title: 'FALHA' }] },
        ],
        { ...details, displayTitle: 'Mudou o título' },
      );
      await expect(publishCurriculum(tools.db, { actorId: admin.id, courseId })).rejects.toThrow();
    } finally {
      await client.query('drop trigger test_explode on lesson');
      await client.query('drop function test_explode()');
    }
    expect(await getPublishedCurriculum(tools.db, courseId)).toEqual(before);
    expect(await tools.db.select().from(schema.courseModule)).toHaveLength(2);
    expect(
      await tools.db
        .select()
        .from(schema.courseModule)
        .where(isNotNull(schema.courseModule.retiredAt)),
    ).toHaveLength(0);
    expect((await tools.db.select().from(schema.courseContent))[0]!.displayTitle).toBe(
      details.displayTitle,
    );
    expect(
      (await tools.db.select().from(schema.auditLog)).filter(
        (row) => row.action === 'curriculum.publish' && row.targetId === courseId,
      ),
    ).toHaveLength(1);
  });

  it('leitura durante a publicação aberta vê só a versão ANTIGA; depois, só a nova (nunca um estado misto)', async () => {
    const admin = await actor('admin');
    const courseId = await newCourse();
    const { body: v1 } = await save(admin, courseId, 0, BASIC);
    await publish(admin, courseId);
    const old = await getPublishedCurriculum(tools.db, courseId);

    // a publicação trava no meio (gatilho espera um advisory lock que o teste segura) e a leitura passa por ela
    const holder = await database.client();
    const client = await database.client();
    await client.query(`create function test_block() returns trigger as $$ begin
      perform pg_advisory_xact_lock_shared(4242); return new; end; $$ language plpgsql`);
    await client.query(
      'create trigger test_block before update on lesson for each row execute function test_block()',
    );
    await holder.query('select pg_advisory_lock(4242)');
    let publishing: Promise<unknown> | undefined;
    try {
      await save(
        admin,
        courseId,
        1,
        [
          {
            id: v1.modules[0].id,
            title: 'A nova',
            lessons: [{ id: v1.modules[0].lessons[0].id, title: 'A1 nova' }],
          },
        ],
        { ...details, displayTitle: 'Título novo' },
      );
      const writer = await openDatabase(database.connectionString);
      let done = false;
      publishing = publishCurriculum(writer.db, { actorId: admin.id, courseId }).finally(
        async () => {
          done = true;
          await writer.close();
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(done, 'a publicação está presa no meio').toBe(false);
      const during = await getPublishedCurriculum(tools.db, courseId);
      expect(during).toEqual(old);
      expect(during!.version).toBe(1);
      const duringHttp = await json(await call('GET', `/courses/${courseId}`, admin.headers));
      expect(duringHttp.publishedVersion).toBe(1);
    } finally {
      await holder.query('select pg_advisory_unlock(4242)');
      await publishing;
      await client.query('drop trigger test_block on lesson');
      await client.query('drop function test_block()');
    }
    const after = (await getPublishedCurriculum(tools.db, courseId))!;
    expect(after.version).toBe(2);
    expect(after.details.displayTitle).toBe('Título novo');
    expect(shape(after.modules)).toEqual(['A nova(0)[A1 nova]']);
  });
});

describe('pré-publicação (resumo do que muda)', () => {
  it('mostra problemas e o resumo sem mudar nada; ler só exige staff.read', async () => {
    const admin = await actor('admin');
    const reader = await actor('support');
    const courseId = await newCourse();
    const preview = async () =>
      json(await call('GET', `/courses/${courseId}/publish-preview`, reader.headers));
    expect((await call('GET', `/courses/${courseId}/publish-preview`, undefined)).status).toBe(401);
    expect(
      (
        await call(
          'GET',
          '/courses/00000000-0000-4000-8000-000000000000/publish-preview',
          reader.headers,
        )
      ).status,
    ).toBe(404);

    const empty = await preview();
    expect(empty).toMatchObject({ rev: 0, publishedVersion: 0, hasChanges: true });
    expect(empty.problems.map((p: { code: string }) => p.code)).toEqual(['no_modules']);

    const { body: v1 } = await save(admin, courseId, 0, BASIC);
    const ready = await preview();
    expect(ready.problems).toEqual([]);
    expect(ready.diff.added).toHaveLength(5);
    expect(ready.diff.retired).toEqual([]);
    expect(await getPublishedCurriculum(tools.db, courseId)).toBeNull();

    await publish(admin, courseId);
    expect(await preview()).toMatchObject({
      publishedVersion: 1,
      hasChanges: false,
      diff: { details: false, added: [], changed: [], retired: [] },
    });

    // renomeia uma aula, remove outra e acrescenta uma nova
    const [a, b] = v1.modules;
    await save(admin, courseId, 1, [
      {
        id: a.id,
        title: 'Módulo A',
        lessons: [{ id: a.lessons[0].id, title: 'A1 renomeada' }, { title: 'A3 nova' }],
      },
      { id: b.id, title: 'Módulo B', dripDays: 7, lessons: [] },
    ]);
    const after = await preview();
    expect(after.hasChanges).toBe(true);
    expect(after.diff.added.map((i: { title: string }) => i.title)).toEqual(['A3 nova']);
    expect(after.diff.retired.map((i: { title: string }) => i.title).sort()).toEqual(['A2', 'B1']);
    expect(after.diff.changed.map((i: { title: string }) => i.title)).toEqual(['A1 renomeada']);
    expect(after.problems.map((p: { code: string }) => p.code)).toContain('module_no_lessons');
    // pré-visualizar nunca altera o publicado
    expect((await getPublishedCurriculum(tools.db, courseId))!.version).toBe(1);
  });
});

describe('aula de vídeo no currículo (M5-02)', () => {
  async function newAsset() {
    const connectionId = crypto.randomUUID();
    await tools.db.insert(schema.videoProviderConnection).values({
      id: connectionId,
      provider: 'youtube',
      label: `público ${crypto.randomUUID().slice(0, 6)}`,
    });
    const [asset] = await tools.db
      .insert(schema.videoAsset)
      .values({
        connectionId,
        provider: 'youtube',
        externalId: `v-${crypto.randomUUID().slice(0, 8)}`,
        mode: 'referenced',
        state: 'ready',
        durationSeconds: 600,
      })
      .returning();
    return asset!.id;
  }
  const video = (assetId: string | null, extra: Partial<L> = {}) => ({
    title: 'Aula em vídeo',
    kind: 'video' as const,
    videoAssetId: assetId,
    ...extra,
  });

  it('salva a aula de vídeo com o vídeo, devolve kind e videoAssetId e publica copiando os dois', async () => {
    const admin = await actor('admin');
    const courseId = await newCourse();
    const assetId = await newAsset();
    const { response, body } = await save(admin, courseId, 0, [
      { title: 'Módulo A', lessons: [video(assetId) as L, { title: 'Texto' }] },
    ]);
    expect(response.status).toBe(200);
    expect(body.modules[0].lessons[0]).toMatchObject({ kind: 'video', videoAssetId: assetId });
    expect(body.modules[0].lessons[1]).toMatchObject({ kind: 'text', videoAssetId: null });

    expect((await publish(admin, courseId)).status).toBe(200);
    const [live] = await tools.db
      .select()
      .from(schema.lesson)
      .where(eq(schema.lesson.title, 'Aula em vídeo'));
    expect(live).toMatchObject({ kind: 'video', videoAssetId: assetId });
    const published = (await getPublishedCurriculum(tools.db, courseId))!;
    expect(published.modules[0]!.lessons[0]).toMatchObject({
      kind: 'video',
      videoAssetId: assetId,
    });
  });

  it('o rascunho aceita o vídeo ainda não escolhido, mas a PUBLICAÇÃO exige (video_asset_missing)', async () => {
    const admin = await actor('admin');
    const courseId = await newCourse();
    const { response } = await save(admin, courseId, 0, [
      { title: 'Módulo A', lessons: [video(null) as L] },
    ]);
    expect(response.status).toBe(200);
    const result = await publish(admin, courseId);
    expect(result.status).toBe(422);
    expect((await json(result)).error.problems).toEqual(
      expect.arrayContaining([
        { code: 'video_asset_missing', path: 'modules[0].lessons[0].videoAssetId' },
      ]),
    );
    expect(await getPublishedCurriculum(tools.db, courseId)).toBeNull();
  });

  it('trava de ativação (M5-03): em Production o vídeo de provider NÃO verificado não é anexado; em Staging é', async () => {
    const courseId = await newCourse();
    const assetId = await newAsset();
    const input = (environment: string, expectedRev: number) => ({
      courseId,
      expectedRev,
      environment,
      details,
      modules: [
        {
          title: 'Módulo A',
          dripDays: 0,
          lessons: [
            {
              title: 'Em vídeo',
              kind: 'video' as const,
              videoAssetId: assetId,
              isOptional: false,
              body: null,
            },
          ],
        },
      ],
    });
    await expect(saveDraft(tools.db, input('production', 0))).rejects.toBeInstanceOf(
      VideoProviderNotVerifiedError,
    );
    expect(await tools.db.select().from(schema.lessonDraft)).toHaveLength(0);
    // ambiente desconhecido também é Production (falha fechada)
    await expect(saveDraft(tools.db, input('', 0))).rejects.toBeInstanceOf(
      VideoProviderNotVerifiedError,
    );
    const saved = await saveDraft(tools.db, input('staging', 0));
    expect(saved.modules[0]!.lessons[0]).toMatchObject({ kind: 'video', videoAssetId: assetId });
  });

  it('vídeo inexistente: 400 video_asset_not_found e nada é gravado', async () => {
    const admin = await actor('admin');
    const courseId = await newCourse();
    const { response, body } = await save(admin, courseId, 0, [
      { title: 'Módulo A', lessons: [video(crypto.randomUUID()) as L] },
    ]);
    expect(response.status).toBe(400);
    expect(body.error).toEqual({ code: 'video_asset_not_found' });
    const draft = await json(await call('GET', `/courses/${courseId}/draft`, admin.headers));
    expect(draft).toMatchObject({ rev: 0, modules: [] });
  });

  it('aula de TEXTO com videoAssetId é recusada (400), com ou sem kind no corpo', async () => {
    const admin = await actor('admin');
    const courseId = await newCourse();
    const assetId = await newAsset();
    const bad = await save(admin, courseId, 0, [
      {
        title: 'Módulo A',
        lessons: [{ title: 'Texto', kind: 'text', videoAssetId: assetId } as L],
      },
    ]);
    expect(bad.response.status).toBe(400);
    const noKind = await save(admin, courseId, 0, [
      { title: 'Módulo A', lessons: [{ title: 'Texto', videoAssetId: assetId } as L] },
    ]);
    expect(noKind.response.status).toBe(400);
  });

  it('a tela antiga (que não manda kind) NÃO converte a aula de vídeo em texto: tipo e vídeo são mantidos', async () => {
    const admin = await actor('admin');
    const courseId = await newCourse();
    const assetId = await newAsset();
    const first = await save(admin, courseId, 0, [
      { title: 'Módulo A', lessons: [video(assetId) as L, { title: 'Texto' }] },
    ]);
    const moduleId = first.body.modules[0].id as string;
    const videoLessonId = first.body.modules[0].lessons[0].id as string;
    const textLessonId = first.body.modules[0].lessons[1].id as string;
    // Sem kind nem videoAssetId: só o título muda.
    const edited = await save(admin, courseId, first.body.rev, [
      {
        id: moduleId,
        title: 'Módulo A',
        lessons: [
          { id: videoLessonId, title: 'Aula em vídeo (editada)' },
          { id: textLessonId, title: 'Texto' },
        ],
      },
    ]);
    expect(edited.body.modules[0].lessons[0]).toMatchObject({
      title: 'Aula em vídeo (editada)',
      kind: 'video',
      videoAssetId: assetId,
    });
    expect(edited.body.modules[0].lessons[1]).toMatchObject({ kind: 'text', videoAssetId: null });
  });

  it('trocar o vídeo e converter a aula para texto (kind text) limpa o vídeo', async () => {
    const admin = await actor('admin');
    const courseId = await newCourse();
    const assetId = await newAsset();
    const other = await newAsset();
    const first = await save(admin, courseId, 0, [
      { title: 'Módulo A', lessons: [video(assetId) as L, { title: 'Texto' }] },
    ]);
    const moduleId = first.body.modules[0].id as string;
    const lessonId = first.body.modules[0].lessons[0].id as string;
    const textId = first.body.modules[0].lessons[1].id as string;
    const swapped = await save(admin, courseId, first.body.rev, [
      {
        id: moduleId,
        title: 'Módulo A',
        lessons: [{ id: lessonId, ...video(other) } as L, { id: textId, title: 'Texto' }],
      },
    ]);
    expect(swapped.body.modules[0].lessons[0].videoAssetId).toBe(other);
    const toText = await save(admin, courseId, swapped.body.rev, [
      {
        id: moduleId,
        title: 'Módulo A',
        lessons: [
          { id: lessonId, title: 'Agora texto', kind: 'text' } as L,
          { id: textId, title: 'Texto' },
        ],
      },
    ]);
    expect(toText.body.modules[0].lessons[0]).toMatchObject({ kind: 'text', videoAssetId: null });
  });

  it('o vídeo de uma aula não pode ser apagado do banco enquanto a aula o usa, e kind e vídeo são coerentes', async () => {
    const admin = await actor('admin');
    const courseId = await newCourse();
    const assetId = await newAsset();
    await save(admin, courseId, 0, [{ title: 'Módulo A', lessons: [video(assetId) as L] }]);
    await expectViolation(
      tools.db.delete(schema.videoAsset).where(eq(schema.videoAsset.id, assetId)),
      /foreign key|violates|restrict/i,
    );
    await expectViolation(
      tools.db.execute(sql`update lesson_draft set kind = 'text' where kind = 'video'`),
      /lesson_draft_video_asset_check/i,
    );
  });
});

describe('aula de quiz no currículo (M5-04)', () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const goodQuiz = (): Quiz => ({
    minScorePercent: 70,
    maxAttempts: 3,
    feedback: 'immediate',
    shuffle: true,
    questions: [
      {
        id: id(1),
        prompt: 'Pergunta',
        kind: 'single',
        points: 1,
        options: [
          { id: id(11), text: 'Sim', correct: true },
          { id: id(12), text: 'Não', correct: false },
        ],
      },
    ],
  });
  const quizLesson = (quiz: Quiz | null | undefined, extra: Partial<L> = {}) =>
    ({
      title: 'Quiz',
      kind: 'quiz' as const,
      ...(quiz === undefined ? {} : { quiz }),
      ...extra,
    }) as L;

  it('salva o quiz no rascunho, devolve kind e quiz e publica copiando o documento inteiro', async () => {
    const admin = await actor('admin');
    const courseId = await newCourse();
    const { response, body } = await save(admin, courseId, 0, [
      { title: 'Módulo A', lessons: [quizLesson(goodQuiz()), { title: 'Texto' }] },
    ]);
    expect(response.status).toBe(200);
    expect(body.modules[0].lessons[0]).toMatchObject({ kind: 'quiz', quiz: goodQuiz() });
    expect(body.modules[0].lessons[1]).toMatchObject({ kind: 'text', quiz: null });

    expect((await publish(admin, courseId)).status).toBe(200);
    const [live] = await tools.db
      .select()
      .from(schema.lesson)
      .where(eq(schema.lesson.title, 'Quiz'));
    expect(live).toMatchObject({ kind: 'quiz', quiz: goodQuiz() });
    const published = (await getPublishedCurriculum(tools.db, courseId))!;
    expect(published.modules[0]!.lessons[0]).toMatchObject({ kind: 'quiz', quiz: goodQuiz() });
  });

  it('o rascunho aceita quiz incompleto, mas a PUBLICAÇÃO exige coerência e lista onde está o problema', async () => {
    const admin = await actor('admin');
    const courseId = await newCourse();
    const broken = goodQuiz();
    broken.questions[0]!.options[0]!.correct = false; // escolha única sem a certa
    broken.questions.push({ id: id(2), prompt: '', kind: 'multiple', points: 1, options: [] });
    expect(
      (
        await save(admin, courseId, 0, [
          {
            title: 'Módulo A',
            lessons: [quizLesson(broken), quizLesson(null, { title: 'Sem quiz' })],
          },
        ])
      ).response.status,
    ).toBe(200);
    const result = await publish(admin, courseId);
    expect(result.status).toBe(422);
    const problems = (await json(result)).error.problems as { code: string; path: string }[];
    expect(problems).toEqual(
      expect.arrayContaining([
        { code: 'quiz_incomplete', path: 'modules[0].lessons[0].quiz.questions[0].options' },
        { code: 'quiz_incomplete', path: 'modules[0].lessons[0].quiz.questions[1].prompt' },
        { code: 'quiz_incomplete', path: 'modules[0].lessons[0].quiz.questions[1].options' },
        { code: 'quiz_missing', path: 'modules[0].lessons[1].quiz' },
      ]),
    );
    expect(await getPublishedCurriculum(tools.db, courseId)).toBeNull();
  });

  it('sem quiz no corpo mantém o do rascunho; kind text apaga o quiz; quiz em aula que não é de quiz é 400', async () => {
    const admin = await actor('admin');
    const courseId = await newCourse();
    const first = await save(admin, courseId, 0, [
      { title: 'Módulo A', lessons: [quizLesson(goodQuiz())] },
    ]);
    const lessonId = first.body.modules[0].lessons[0].id as string;
    const moduleId = first.body.modules[0].id as string;
    // corpo SEM kind nem quiz (a tela antiga): mantém o quiz
    const kept = await save(admin, courseId, 1, [
      { id: moduleId, title: 'Módulo A', lessons: [{ id: lessonId, title: 'Renomeada' }] },
    ]);
    expect(kept.body.modules[0].lessons[0]).toMatchObject({ kind: 'quiz', quiz: goodQuiz() });
    // kind quiz sem o campo quiz: mantém também
    const sameKind = await save(admin, courseId, 2, [
      {
        id: moduleId,
        title: 'Módulo A',
        lessons: [{ id: lessonId, title: 'Renomeada', kind: 'quiz' }],
      },
    ]);
    expect(sameKind.body.modules[0].lessons[0].quiz).toEqual(goodQuiz());
    // quiz numa aula de texto ou de vídeo: recusado
    for (const lessons of [
      [{ title: 'T', kind: 'text', quiz: goodQuiz() }],
      [{ title: 'T', quiz: goodQuiz() }],
    ]) {
      const bad = await save(admin, courseId, 3, [{ title: 'M', lessons: lessons as L[] }]);
      expect(bad.response.status).toBe(400);
    }
    // converter em texto apaga o quiz
    const toText = await save(admin, courseId, 3, [
      {
        id: moduleId,
        title: 'Módulo A',
        lessons: [{ id: lessonId, title: 'Renomeada', kind: 'text' }],
      },
    ]);
    expect(toText.body.modules[0].lessons[0]).toMatchObject({ kind: 'text', quiz: null });
  });

  it('o quiz do rascunho tem teto de tamanho e o banco guarda o tipo coerente com o documento', async () => {
    const admin = await actor('admin');
    const courseId = await newCourse();
    await save(admin, courseId, 0, [{ title: 'Módulo A', lessons: [quizLesson(goodQuiz())] }]);
    await expectViolation(
      tools.db.execute(sql`update lesson_draft set kind = 'text' where kind = 'quiz'`),
      /lesson_draft_quiz_check/i,
    );
    await expectViolation(
      tools.db.execute(
        sql`update lesson_draft set quiz = ('{"x":"' || repeat('a', 210000) || '"}')::jsonb where kind = 'quiz'`,
      ),
      /lesson_draft_quiz_size_check/i,
    );
  });
});

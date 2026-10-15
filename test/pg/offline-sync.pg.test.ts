import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { grantEntitlement } from '../../src/server/access/entitlement-store.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createDemoCourse } from '../helpers/demo-course.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M8-03 em Postgres 18 real: `POST /api/offline/sync`. O lote passa, item a item e EM ORDEM, pelo MESMO caso de uso do online
 * (acesso, expiração, drip, sequência); é idempotente por (pessoa, clientOperationId); a pessoa vem da sessão; a hora do fato é a
 * do servidor; comandos fora da allowlist e corpos ruins são recusados por item, sem derrubar os outros.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const T0 = new Date('2026-10-11T12:00:00.000Z');
/** Todos os módulos do demonstrativo (D+0, D+7, D+14) já liberados pelo drip. */
const LATE = new Date('2026-10-30T12:00:00.000Z');
const DAY = 86_400_000;

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
    sql`truncate table offline_operation, certificate, course_completion, lesson_completion, entitlement, enrollment, lesson, module, lesson_draft, module_draft, course_content, course_draft, curriculum_state, offer, course cascade`,
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

async function newPerson() {
  seq += 1;
  const user = tools.test.createUser({ email: `pessoa${seq}@example.test`, name: `Pessoa ${seq}` });
  await tools.test.saveUser(user);
  return { id: user.id, headers: (await tools.test.login({ userId: user.id })).headers };
}

function sync(headers: Headers | undefined, body: unknown, origin: string | null = BASE_URL) {
  const merged = new Headers(headers);
  if (origin) merged.set('origin', origin);
  merged.set('content-type', 'application/json');
  return app().request(
    '/api/offline/sync',
    {
      method: 'POST',
      headers: merged,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
    env(),
  );
}
const json = async (response: Response) => (await response.json()) as Record<string, any>;

let opSeq = 0;
const opId = () => {
  opSeq += 1;
  return `00000000-0000-4000-8000-${String(opSeq).padStart(12, '0')}`;
};
const complete = (lessonId: string, id = opId(), extra: Record<string, unknown> = {}) => ({
  clientOperationId: id,
  command: 'lesson.complete',
  lessonId,
  clientCreatedAt: '2020-01-01T00:00:00.000Z',
  ...extra,
});

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
async function enrolled(courseId: string, offerId: string, months = 12) {
  const student = await newPerson();
  await grantEntitlement(tools.db, {
    userId: student.id,
    courseId,
    offerId,
    source: 'free_offer',
    sourceRef: `free:${student.id}:${offerId}:0`,
    accessMonths: months,
    startsAt: T0,
    grantedBy: student.id,
  });
  return student;
}
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
const operationsOf = (userId: string) =>
  tools.db.select().from(schema.offlineOperation).where(eq(schema.offlineOperation.userId, userId));

describe('aplicar o lote', () => {
  it('aplica em ORDEM: a hora do fato é a do SERVIDOR; a do aparelho fica só como metadado', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    const response = await sync(student.headers, {
      operations: [complete(lesson['Boas-vindas']!), complete(lesson['Como estudar aqui']!)],
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await json(response);
    expect(body.results).toEqual([
      expect.objectContaining({ index: 0, status: 'applied', effect: 'completed' }),
      expect.objectContaining({ index: 1, status: 'applied', effect: 'completed' }),
    ]);
    const done = await completionsOf(student.id);
    expect(done).toHaveLength(2);
    for (const row of done) expect(row.completedAt.toISOString()).toBe(LATE.toISOString());
    for (const row of await operationsOf(student.id)) {
      expect(row.clientCreatedAt?.toISOString()).toBe('2020-01-01T00:00:00.000Z');
      expect(row.processedAt.getTime()).toBeGreaterThan(Date.parse('2024-01-01'));
      expect(row.outcome).toBe('applied');
    }
  });

  it('fora de ordem na sequência guiada: a segunda aula é recusada (lesson_locked) e a primeira vale', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    const body = await json(
      await sync(student.headers, {
        operations: [complete(lesson['Como estudar aqui']!), complete(lesson['Boas-vindas']!)],
      }),
    );
    expect(body.results[0]).toMatchObject({ status: 'rejected', reason: 'lesson_locked' });
    expect(body.results[1]).toMatchObject({ status: 'applied' });
    expect((await completionsOf(student.id)).map((row) => row.lessonId)).toEqual([
      lesson['Boas-vindas'],
    ]);
  });

  it('repetir o MESMO id devolve duplicate e não refaz nada; a recusa também é definitiva', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    const ok = complete(lesson['Boas-vindas']!);
    const locked = complete(lesson['Revisão']!); // fora de ordem: recusada
    const first = await json(await sync(student.headers, { operations: [ok, locked] }));
    expect(first.results.map((item: any) => item.status)).toEqual(['applied', 'rejected']);
    const again = await json(await sync(student.headers, { operations: [ok, locked] }));
    expect(again.results).toEqual([
      expect.objectContaining({
        status: 'duplicate',
        original: 'applied',
        clientOperationId: ok.clientOperationId,
      }),
      expect.objectContaining({
        status: 'duplicate',
        original: 'rejected',
        reason: 'lesson_locked',
        clientOperationId: locked.clientOperationId,
      }),
    ]);
    expect(await completionsOf(student.id)).toHaveLength(1);
    expect(await operationsOf(student.id)).toHaveLength(2);
  });

  it('SEIS envios simultâneos do mesmo id: um aplica, cinco são duplicate e há UMA conclusão', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    const op = complete(lesson['Boas-vindas']!);
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => sync(student.headers, { operations: [op] })),
    );
    const statuses = (await Promise.all(responses.map(json))).map((body) => body.results[0].status);
    expect(statuses.filter((status) => status === 'applied')).toHaveLength(1);
    expect(statuses.filter((status) => status === 'duplicate')).toHaveLength(5);
    expect(await completionsOf(student.id)).toHaveLength(1);
    expect(await operationsOf(student.id)).toHaveLength(1);
  }, 120_000);

  it('a mesma aula com OUTRO id (já concluída online): applied/already_completed, sem segunda conclusão', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    await sync(student.headers, { operations: [complete(lesson['Boas-vindas']!)] });
    const body = await json(
      await sync(student.headers, { operations: [complete(lesson['Boas-vindas']!)] }),
    );
    expect(body.results[0]).toMatchObject({ status: 'applied', effect: 'already_completed' });
    expect(await completionsOf(student.id)).toHaveLength(1);
  });

  it('o mesmo clientOperationId de DUAS pessoas não colide (a chave é por pessoa)', async () => {
    const { courseId, offerId, lesson } = await demo();
    const a = await enrolled(courseId, offerId);
    const b = await enrolled(courseId, offerId);
    const op = complete(lesson['Boas-vindas']!);
    const [ra, rb] = await Promise.all([
      json(await sync(a.headers, { operations: [op] })),
      json(await sync(b.headers, { operations: [op] })),
    ]);
    expect(ra.results[0].status).toBe('applied');
    expect(rb.results[0].status).toBe('applied');
  });

  it('o curso inteiro offline: a última aula conclui o curso UMA vez; reenviar o lote todo não duplica nada', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    const operations = REQUIRED.map((title) => complete(lesson[title]!));
    const body = await json(await sync(student.headers, { operations }));
    expect(body.results.map((item: any) => item.status)).toEqual(Array(5).fill('applied'));
    expect(body.results.filter((item: any) => item.courseJustCompleted)).toHaveLength(1);
    expect(body.results[4].courseJustCompleted).toBe(true);
    expect(await completionsOf(student.id)).toHaveLength(5);
    expect(await courseCompletionsOf(student.id)).toHaveLength(1);
    const again = await json(await sync(student.headers, { operations }));
    expect(again.results.map((item: any) => item.status)).toEqual(Array(5).fill('duplicate'));
    expect(await completionsOf(student.id)).toHaveLength(5);
    expect(await courseCompletionsOf(student.id)).toHaveLength(1);
  });
});

describe('o servidor revalida tudo na hora do sync', () => {
  it('drip ainda fechado: recusada (lesson_locked), sem conclusão', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    clockNow = new Date(T0.getTime() + DAY); // o módulo 2 abre só em D+7
    const body = await json(
      await sync(student.headers, {
        operations: [
          complete(lesson['Boas-vindas']!),
          complete(lesson['Como estudar aqui']!),
          complete(lesson['Conceito central']!),
        ],
      }),
    );
    expect(body.results.map((item: any) => item.status)).toEqual([
      'applied',
      'applied',
      'rejected',
    ]);
    expect(body.results[2].reason).toBe('lesson_locked');
    expect(await completionsOf(student.id)).toHaveLength(2);
  });

  it('acesso EXPIRADO enquanto estava offline: recusada (access_expired)', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId, 1);
    clockNow = new Date(T0.getTime() + 60 * DAY);
    const body = await json(
      await sync(student.headers, { operations: [complete(lesson['Boas-vindas']!)] }),
    );
    expect(body.results[0]).toMatchObject({ status: 'rejected', reason: 'access_expired' });
    expect(await completionsOf(student.id)).toHaveLength(0);
  });

  it('conta SUSPENSA: recusada (access_suspended)', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    await tools.db.insert(schema.userSuspension).values({ userId: student.id, reason: 'teste' });
    const body = await json(
      await sync(student.headers, { operations: [complete(lesson['Boas-vindas']!)] }),
    );
    expect(body.results[0]).toMatchObject({ status: 'rejected', reason: 'access_suspended' });
  });

  it('sem matrícula (e Staff sem matrícula): recusada (access_no_access)', async () => {
    const { lesson } = await demo();
    const stranger = await newPerson();
    const person = await newPerson();
    await grantRole(tools.db, { actorId: null, targetId: person.id, role: 'support' });
    const staff = { headers: (await tools.test.login({ userId: person.id })).headers };
    for (const who of [stranger, staff]) {
      const body = await json(
        await sync(who.headers, { operations: [complete(lesson['Boas-vindas']!)] }),
      );
      expect(body.results[0]).toMatchObject({ status: 'rejected', reason: 'access_no_access' });
    }
  });

  it('aula RETIRADA do currículo e aula que não existe: recusada (lesson_not_found)', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    await tools.db
      .update(schema.lesson)
      .set({ retiredAt: LATE })
      .where(eq(schema.lesson.id, lesson['Leitura complementar']!));
    const body = await json(
      await sync(student.headers, {
        operations: [complete(lesson['Leitura complementar']!), complete(crypto.randomUUID())],
      }),
    );
    expect(body.results.map((item: any) => item.reason)).toEqual([
      'lesson_not_found',
      'lesson_not_found',
    ]);
  });
});

describe('allowlist e corpo malformado', () => {
  it('comando FORA da allowlist (quiz, vídeo, qualquer outro) é recusado por item e não derruba os outros', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    const quiz = {
      clientOperationId: opId(),
      command: 'quiz.submit',
      lessonId: lesson['Revisão'],
      answers: [],
    };
    const video = {
      clientOperationId: opId(),
      command: 'video.progress',
      lessonId: lesson['Revisão'],
      position: 99,
    };
    const body = await json(
      await sync(student.headers, { operations: [quiz, complete(lesson['Boas-vindas']!), video] }),
    );
    expect(body.results.map((item: any) => item.status)).toEqual([
      'rejected',
      'applied',
      'rejected',
    ]);
    expect(body.results[0].reason).toBe('command_not_allowed');
    expect(body.results[2].reason).toBe('command_not_allowed');
    // O rótulo da recusa fica guardado (e repetir é duplicate), mas nada do comando foi executado.
    const again = await json(await sync(student.headers, { operations: [quiz] }));
    expect(again.results[0]).toMatchObject({
      status: 'duplicate',
      original: 'rejected',
      reason: 'command_not_allowed',
    });
    expect(await completionsOf(student.id)).toHaveLength(1);
  });

  it('item malformado (sem id, nulo, aula que não é UUID, comando ausente): recusado como invalid_payload', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    const body = await json(
      await sync(student.headers, {
        operations: [
          { command: 'lesson.complete', lessonId: lesson['Boas-vindas'] },
          null,
          complete('nao-e-uuid'),
          { clientOperationId: opId(), lessonId: lesson['Boas-vindas'] },
          'texto',
        ],
      }),
    );
    expect(body.results.map((item: any) => item.reason)).toEqual(Array(5).fill('invalid_payload'));
    expect(body.results[0].clientOperationId).toBeNull();
    expect(await completionsOf(student.id)).toHaveLength(0);
  });

  it('aulas que NÃO são de texto (quiz) não concluem por este caminho', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    await sync(student.headers, {
      operations: [complete(lesson['Boas-vindas']!), complete(lesson['Como estudar aqui']!)],
    });
    // O banco só aceita 'quiz' com documento: um mínimo basta (a aula só precisa DEIXAR de ser de texto).
    await tools.db.execute(
      sql`update lesson set kind = 'quiz', quiz = '{"x":1}'::jsonb where id = ${lesson['Conceito central']!}`,
    );
    await tools.db.execute(
      sql`update lesson set kind = 'quiz', quiz = '{"x":1}'::jsonb where id = ${lesson['Revisão']!}`,
    );
    const kinds = await tools.db
      .select({ title: schema.lesson.title, kind: schema.lesson.kind })
      .from(schema.lesson)
      .where(eq(schema.lesson.courseId, courseId));
    expect(kinds.find((row) => row.title === 'Conceito central')?.kind).toBe('quiz');
    expect(kinds.find((row) => row.title === 'Revisão')?.kind).toBe('quiz');
    const body = await json(
      await sync(student.headers, {
        operations: [complete(lesson['Conceito central']!), complete(lesson['Revisão']!)],
      }),
    );
    expect(body.results.map((item: any) => item.reason)).toEqual([
      'lesson_not_found',
      'lesson_not_found',
    ]);
    expect(await completionsOf(student.id)).toHaveLength(2);
  });

  it('userId e courseId forjados dentro do comando são IGNORADOS: vale a pessoa da sessão', async () => {
    const { courseId, offerId, lesson } = await demo();
    const owner = await enrolled(courseId, offerId);
    const intruder = await newPerson();
    const body = await json(
      await sync(intruder.headers, {
        operations: [complete(lesson['Boas-vindas']!, opId(), { userId: owner.id, courseId })],
      }),
    );
    expect(body.results[0]).toMatchObject({ status: 'rejected', reason: 'access_no_access' });
    expect(await completionsOf(owner.id)).toHaveLength(0);
    expect(await completionsOf(intruder.id)).toHaveLength(0);
  });
});

describe('sessão, trava de conta e limites', () => {
  it('expectedUserId de OUTRA pessoa: 409 wrong_account e NADA é aplicado; o da própria passa', async () => {
    const { courseId, offerId, lesson } = await demo();
    const student = await enrolled(courseId, offerId);
    const other = await newPerson();
    const operations = [complete(lesson['Boas-vindas']!)];
    const wrong = await sync(student.headers, { expectedUserId: other.id, operations });
    expect(wrong.status).toBe(409);
    expect(await json(wrong)).toEqual({ error: { code: 'wrong_account' } });
    expect(await completionsOf(student.id)).toHaveLength(0);
    expect(await operationsOf(student.id)).toHaveLength(0);
    const right = await sync(student.headers, { expectedUserId: student.id, operations });
    expect(right.status).toBe(200);
    expect(await completionsOf(student.id)).toHaveLength(1);
  });

  it('sem sessão: 401; sem Origin (CSRF): 403; termos vigentes não aceitos: 403 terms_required', async () => {
    const { lesson } = await demo();
    const student = await newPerson();
    const operations = [complete(lesson['Boas-vindas']!)];
    expect((await sync(undefined, { operations })).status).toBe(401);
    expect((await sync(student.headers, { operations }, null)).status).toBe(403);
    await tools.db.insert(schema.legalDocumentVersion).values({
      kind: 'terms',
      version: 'teste-m8-03',
      body: 'TEXTO PROVISÓRIO de teste',
      effectiveFrom: new Date(T0.getTime() - DAY),
    });
    try {
      const response = await sync(student.headers, { operations });
      expect(response.status).toBe(403);
      expect(await json(response)).toEqual({ error: { code: 'terms_required' } });
    } finally {
      await tools.db.delete(schema.legalDocumentVersion);
    }
  });

  it('corpo inválido: 400; lista vazia e lote de mais de 50: 400; 50 itens passam', async () => {
    const { lesson } = await demo();
    const student = await newPerson();
    expect((await sync(student.headers, 'isto não é json')).status).toBe(400);
    expect((await sync(student.headers, { operations: [] })).status).toBe(400);
    expect((await sync(student.headers, { operations: 'x' })).status).toBe(400);
    const many = (n: number) => Array.from({ length: n }, () => complete(lesson['Boas-vindas']!));
    expect((await sync(student.headers, { operations: many(51) })).status).toBe(400);
    expect((await sync(student.headers, { operations: many(50) })).status).toBe(200);
  });
});

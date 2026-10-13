import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../../src/db/client.ts';

import { openDatabase } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';
import { grantEntitlement } from '../../src/server/access/entitlement-store.ts';
import { DeferError } from '../../src/server/async/handler-types.ts';
import {
  setOfferStatus,
  createOffer,
  setCourseStatus,
} from '../../src/server/catalog/catalog-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { createInterestFanoutHandler } from '../../src/server/interest/fanout.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createDemoCourse } from '../helpers/demo-course.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M5-06 em Postgres 18 real: interesse em curso ainda não aberto e aviso de abertura. UM e-mail por (interesse,
 * ciclo), repetido a cada reabertura; oferta nova em curso já aberto não cria ciclo; o fan-out roda fora da
 * transação do comando, em lotes, e é seguro repetir e rodar em paralelo; converte ao ter direito efetivo; só
 * a pessoa autenticada mexe nos próprios interesses.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
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
    sql`truncate table course_interest_notification, course_interest, course_availability_cycle, email_message, outbox_message, quiz_attempt, discussion_report, discussion_post, video_progress, course_completion, lesson_completion, entitlement, enrollment, lesson, module, lesson_draft, module_draft, course_content, course_draft, curriculum_state, offer, course cascade`,
  );
  await tools.db.delete(schema.userSuspension);
  await tools.db.delete(schema.session);
  await tools.db.delete(schema.staffGrant);
  await tools.db.delete(schema.userRole);
  await tools.db.delete(schema.profile);
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
    clock: () => T0,
  });

interface Person {
  id: string;
  headers: Headers;
}
async function newPerson(role?: 'support' | 'admin'): Promise<Person> {
  seq += 1;
  const user = tools.test.createUser({
    email: `pessoa${seq}@example.test`,
    name: `Pessoa ${seq}`,
  });
  await tools.test.saveUser(user);
  if (role) await grantRole(tools.db, { actorId: null, targetId: user.id, role });
  return { id: user.id, headers: (await tools.test.login({ userId: user.id })).headers };
}
function call(method: string, path: string, headers?: Headers, body?: unknown) {
  const merged = new Headers(headers);
  merged.set('origin', BASE_URL);
  merged.set('content-type', 'application/json');
  return app().request(
    `/api${path}`,
    { method, headers: merged, ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }) },
    env(),
  );
}
const json = async (response: Response) => (await response.json()) as Record<string, any>;

/** O curso demonstrativo, FECHADO (a oferta pausada): não adquirível, mas publicado. */
async function closedCourse() {
  const fixture = await createDemoCourse(tools.db);
  await setOfferStatus(tools.db, {
    actorId: null,
    courseId: fixture.courseId,
    offerId: fixture.offerId,
    status: 'paused',
  });
  return fixture;
}
const open = (f: { courseId: string; offerId: string }) =>
  setOfferStatus(tools.db, {
    actorId: null,
    courseId: f.courseId,
    offerId: f.offerId,
    status: 'active',
  });
const close = (f: { courseId: string; offerId: string }) =>
  setOfferStatus(tools.db, {
    actorId: null,
    courseId: f.courseId,
    offerId: f.offerId,
    status: 'paused',
  });

const register = (who: Person, courseId: string) =>
  call('POST', '/me/course-interests', who.headers, { courseId });
const cycles = (courseId: string) =>
  tools.db
    .select()
    .from(schema.courseAvailabilityCycle)
    .where(eq(schema.courseAvailabilityCycle.courseId, courseId))
    .orderBy(schema.courseAvailabilityCycle.number);
const emails = () =>
  tools.db
    .select()
    .from(schema.emailMessage)
    .where(eq(schema.emailMessage.template, 'course-available'));
const interestOf = async (userId: string, courseId: string) =>
  (
    await tools.db
      .select()
      .from(schema.courseInterest)
      .where(
        and(eq(schema.courseInterest.userId, userId), eq(schema.courseInterest.courseId, courseId)),
      )
  )[0];

/** Executa o handler do fan-out para o ciclo (uma execução). */
function fanout(cycleId: string, db: Database = tools.db) {
  return createInterestFanoutHandler()({
    db,
    payload: { cycleId },
    intentId: crypto.randomUUID(),
    correlationId: 'teste',
    idempotencyKey: `interest-fanout:${cycleId}`,
    attempt: 1,
  });
}
/** Roda o fan-out até acabar (o handler se adia com `DeferError` enquanto o lote vem cheio). */
async function fanoutAll(cycleId: string, db: Database = tools.db) {
  let runs = 0;
  for (;;) {
    runs += 1;
    try {
      await fanout(cycleId, db);
      return runs;
    } catch (error) {
      if (!(error instanceof DeferError)) throw error;
    }
  }
}
const lastCycle = async (courseId: string) => (await cycles(courseId)).at(-1)!;

describe('o ciclo de disponibilidade', () => {
  it('abre na transição não-adquirível → adquirível e fecha na volta; oferta nova em curso aberto NÃO cria ciclo', async () => {
    const fixture = await createDemoCourse(tools.db);
    expect(await cycles(fixture.courseId)).toHaveLength(1); // o seed abriu as vendas
    expect((await cycles(fixture.courseId))[0]!.closedAt).toBeNull();

    // outra oferta, ativada com o curso JÁ aberto: nada muda
    const second = await createOffer(tools.db, {
      actorId: null,
      courseId: fixture.courseId,
      name: 'Segunda',
      kind: 'free',
      priceCents: 0,
      accessMonths: 6,
      maxInstallments: 1,
    });
    await setOfferStatus(tools.db, {
      actorId: null,
      courseId: fixture.courseId,
      offerId: second,
      status: 'active',
    });
    expect(await cycles(fixture.courseId)).toHaveLength(1);

    // pausar UMA das duas: o curso segue aberto, nada muda
    await close(fixture);
    expect((await cycles(fixture.courseId))[0]!.closedAt).toBeNull();
    // pausar a última: fecha
    await setOfferStatus(tools.db, {
      actorId: null,
      courseId: fixture.courseId,
      offerId: second,
      status: 'paused',
    });
    expect((await cycles(fixture.courseId))[0]!.closedAt).not.toBeNull();
    // reabrir: ciclo 2
    await open(fixture);
    const all = await cycles(fixture.courseId);
    expect(all.map((row) => row.number)).toEqual([1, 2]);
    expect(all.map((row) => row.closedAt === null)).toEqual([false, true]);
  });

  it('arquivar o curso fecha o ciclo; publicar de novo (se vale) abre outro', async () => {
    const fixture = await createDemoCourse(tools.db);
    await setCourseStatus(tools.db, { actorId: null, id: fixture.courseId, status: 'archived' });
    expect((await cycles(fixture.courseId))[0]!.closedAt).not.toBeNull();
  });

  it('duas ativações SIMULTÂNEAS de ofertas num curso fechado abrem UM só ciclo', async () => {
    const fixture = await closedCourse();
    const make = (name: string) =>
      createOffer(tools.db, {
        actorId: null,
        courseId: fixture.courseId,
        name,
        kind: 'free',
        priceCents: 0,
        accessMonths: 3,
        maxInstallments: 1,
      });
    const [a, b] = [await make('A'), await make('B')];
    const [one, two] = await Promise.all([
      openDatabase(database.connectionString),
      openDatabase(database.connectionString),
    ]);
    await Promise.all(
      [a, b].map((offerId, index) =>
        setOfferStatus([one, two][index]!.db, {
          actorId: null,
          courseId: fixture.courseId,
          offerId,
          status: 'active',
        }),
      ),
    );
    const all = await cycles(fixture.courseId);
    expect(all.filter((row) => row.closedAt === null)).toHaveLength(1);
    expect(all).toHaveLength(2); // o do seed (fechado) e este
  });
});

describe('registrar e retirar o interesse', () => {
  it('registra num curso publicado e ainda não aberto; repetir é idempotente; lista só os da pessoa', async () => {
    const fixture = await closedCourse();
    const ana = await newPerson();
    const bia = await newPerson();
    const first = await register(ana, fixture.courseId);
    expect(first.status).toBe(201);
    expect(await json(first)).toEqual({ status: 'active' });
    expect((await register(ana, fixture.courseId)).status).toBe(201);
    expect(await tools.db.select().from(schema.courseInterest)).toHaveLength(1);
    await register(bia, fixture.courseId);
    const mine = await json(await call('GET', '/me/course-interests', ana.headers));
    expect(mine.interests).toHaveLength(1);
    expect(mine.interests[0]).toMatchObject({ courseId: fixture.courseId, status: 'active' });
    expect(JSON.stringify(mine)).not.toContain('@example.test');
  });

  it('recusas: sem sessão 401; corpo inválido 400; curso inexistente ou rascunho 404; curso ABERTO 409; já inscrita 409', async () => {
    const closed = await closedCourse();
    const ana = await newPerson();
    expect(
      (await call('POST', '/me/course-interests', undefined, { courseId: closed.courseId })).status,
    ).toBe(401);
    expect((await call('GET', '/me/course-interests', undefined)).status).toBe(401);
    for (const body of [{}, { courseId: 'x' }, { courseId: closed.courseId, extra: 1 }]) {
      expect((await call('POST', '/me/course-interests', ana.headers, body)).status).toBe(400);
    }
    expect((await register(ana, crypto.randomUUID())).status).toBe(404);
    const [draft] = await tools.db
      .insert(schema.course)
      .values({ slug: 'rascunho', title: 'Rascunho', sequenceMode: 'guided' })
      .returning();
    expect((await register(ana, draft!.id)).status).toBe(404);
    expect(await tools.db.select().from(schema.courseInterest)).toHaveLength(0);

    await open(closed);
    const openResponse = await register(ana, closed.courseId);
    expect(openResponse.status).toBe(409);
    expect((await json(openResponse)).error.code).toBe('course_already_open');

    await close(closed);
    await grantEntitlement(tools.db, {
      userId: ana.id,
      courseId: closed.courseId,
      offerId: closed.offerId,
      source: 'free_offer',
      sourceRef: `free:${ana.id}:${closed.offerId}:0`,
      accessMonths: 12,
      startsAt: T0,
      grantedBy: ana.id,
    });
    const enrolled = await register(ana, closed.courseId);
    expect(enrolled.status).toBe(409);
    expect((await json(enrolled)).error.code).toBe('already_enrolled');
  });

  it('retirar: idempotente, 404 sem interesse, e a pessoa pode voltar a registrar', async () => {
    const fixture = await closedCourse();
    const ana = await newPerson();
    const path = `/me/course-interests/${fixture.courseId}/withdraw`;
    expect((await call('POST', path, ana.headers, {})).status).toBe(404);
    await register(ana, fixture.courseId);
    expect((await call('POST', path, ana.headers, {})).status).toBe(200);
    expect((await call('POST', path, ana.headers, {})).status).toBe(200);
    expect((await interestOf(ana.id, fixture.courseId))!.status).toBe('withdrawn');
    expect((await call('POST', '/me/course-interests/xyz/withdraw', ana.headers, {})).status).toBe(
      404,
    );
    expect((await register(ana, fixture.courseId)).status).toBe(201);
    expect((await interestOf(ana.id, fixture.courseId))!.status).toBe('active');
  });

  it('só mexe nos PRÓPRIOS interesses: a outra pessoa não retira o meu', async () => {
    const fixture = await closedCourse();
    const ana = await newPerson();
    const bia = await newPerson();
    await register(ana, fixture.courseId);
    expect(
      (await call('POST', `/me/course-interests/${fixture.courseId}/withdraw`, bia.headers, {}))
        .status,
    ).toBe(404);
    expect((await interestOf(ana.id, fixture.courseId))!.status).toBe('active');
  });
});

describe('o aviso de abertura', () => {
  it('um e-mail por (interesse, ciclo) com o título público; repetir o fan-out não duplica; reabrir envia de novo', async () => {
    const fixture = await closedCourse();
    const people = [await newPerson(), await newPerson(), await newPerson()];
    for (const person of people) await register(person, fixture.courseId);

    await open(fixture);
    const cycle = await lastCycle(fixture.courseId);
    const intents = await tools.db.select().from(schema.outboxMessage);
    expect(intents.filter((row) => row.kind === 'interest.fanout')).toHaveLength(1);

    await fanoutAll(cycle.id);
    const sent = await emails();
    expect(sent).toHaveLength(3);
    expect(sent.map((row) => row.recipientUserId).sort()).toEqual(people.map((p) => p.id).sort());
    expect(sent[0]!.variables).toEqual({ COURSE_TITLE: expect.any(String) });
    expect(sent.every((row) => row.dedupeKey.endsWith(`:${cycle.id}`))).toBe(true);
    expect(await tools.db.select().from(schema.courseInterestNotification)).toHaveLength(3);

    // repetir (at-least-once) e rodar em PARALELO não duplica nada
    const extra = await Promise.all([1, 2, 3].map(() => openDatabase(database.connectionString)));
    await Promise.all(extra.map((connection) => fanoutAll(cycle.id, connection.db)));
    await Promise.all(extra.map((connection) => connection.close()));
    expect(await emails()).toHaveLength(3);

    // fechar e reabrir: UM aviso novo por interessada
    await close(fixture);
    await open(fixture);
    const second = await lastCycle(fixture.courseId);
    expect(second.id).not.toBe(cycle.id);
    await fanoutAll(second.id);
    expect(await emails()).toHaveLength(6);
    const stats = await json(
      await call(
        'GET',
        `/staff/courses/${fixture.courseId}/interests`,
        (await newPerson('admin')).headers,
      ),
    );
    expect(stats).toMatchObject({ active: 3, withdrawn: 0, converted: 0 });
    expect(stats.cycles.map((row: any) => row.notified)).toEqual([0, 3, 3]);
    expect(JSON.stringify(stats)).not.toContain('@example.test');
  });

  it('retirar o interesse ANTES do envio: nada é enviado para essa pessoa', async () => {
    const fixture = await closedCourse();
    const ana = await newPerson();
    const bia = await newPerson();
    await register(ana, fixture.courseId);
    await register(bia, fixture.courseId);
    await open(fixture);
    await call('POST', `/me/course-interests/${fixture.courseId}/withdraw`, ana.headers, {});
    await fanoutAll((await lastCycle(fixture.courseId)).id);
    expect((await emails()).map((row) => row.recipientUserId)).toEqual([bia.id]);
  });

  it('quem já tem direito efetivo vira `converted` e não recebe; o direito criado converte na hora', async () => {
    const fixture = await closedCourse();
    const ana = await newPerson();
    const bia = await newPerson();
    const carla = await newPerson();
    for (const person of [ana, bia, carla]) await register(person, fixture.courseId);
    // Ana ganha o direito (conversão no ato, na mesma transação)
    await grantEntitlement(tools.db, {
      userId: ana.id,
      courseId: fixture.courseId,
      offerId: fixture.offerId,
      source: 'free_offer',
      sourceRef: `free:${ana.id}:${fixture.offerId}:0`,
      accessMonths: 12,
      startsAt: new Date(),
      grantedBy: ana.id,
    });
    expect((await interestOf(ana.id, fixture.courseId))!.status).toBe('converted');
    // Bia ganhou o direito e, por uma corrida, o interesse seguiu `active`: o fan-out a converte e não envia
    await grantEntitlement(tools.db, {
      userId: bia.id,
      courseId: fixture.courseId,
      offerId: fixture.offerId,
      source: 'free_offer',
      sourceRef: `free:${bia.id}:${fixture.offerId}:0`,
      accessMonths: 12,
      startsAt: new Date(),
      grantedBy: bia.id,
    });
    await tools.db
      .update(schema.courseInterest)
      .set({ status: 'active' })
      .where(eq(schema.courseInterest.userId, bia.id));
    await open(fixture);
    await fanoutAll((await lastCycle(fixture.courseId)).id);
    expect((await emails()).map((row) => row.recipientUserId)).toEqual([carla.id]);
    expect((await interestOf(bia.id, fixture.courseId))!.status).toBe('converted');
  });

  it('ciclo já FECHADO quando o fan-out roda (vendas fecharam antes): ninguém é avisado', async () => {
    const fixture = await closedCourse();
    const ana = await newPerson();
    await register(ana, fixture.courseId);
    await open(fixture);
    const cycle = await lastCycle(fixture.courseId);
    await close(fixture);
    await fanoutAll(cycle.id);
    expect(await emails()).toHaveLength(0);
    expect((await interestOf(ana.id, fixture.courseId))!.status).toBe('active');
  });

  it('lote cheio: o handler se ADIA (sem falhar) até acabar; 60 interessadas, nenhuma perdida e nenhuma repetida', async () => {
    const fixture = await closedCourse();
    const users = Array.from({ length: 60 }, (_, index) =>
      tools.test.createUser({ email: `massa${index}@example.test`, name: `Massa ${index}` }),
    );
    await tools.db.insert(schema.user).values(users);
    await tools.db
      .insert(schema.courseInterest)
      .values(users.map((row) => ({ userId: row.id, courseId: fixture.courseId })));
    await open(fixture);
    const cycle = await lastCycle(fixture.courseId);
    // a 1ª execução já se adia (lote de 50 cheio)
    await expect(fanout(cycle.id)).rejects.toBeInstanceOf(DeferError);
    const runs = await fanoutAll(cycle.id);
    expect(runs).toBeGreaterThanOrEqual(1);
    const sent = await emails();
    expect(sent).toHaveLength(60);
    expect(new Set(sent.map((row) => row.recipientUserId)).size).toBe(60);
    expect(new Set(sent.map((row) => row.dedupeKey)).size).toBe(60);
    // 60 intenções de e-mail na outbox, na prioridade de "novo curso" (classe 4)
    const outbox = (await tools.db.select().from(schema.outboxMessage)).filter(
      (row) => row.kind === 'email.send',
    );
    expect(outbox).toHaveLength(60);
    expect(new Set(outbox.map((row) => row.priority))).toEqual(new Set([200]));
  }, 180_000);

  it('o ciclo desconhecido falha de forma PERMANENTE (não adianta repetir)', async () => {
    await expect(fanout(crypto.randomUUID())).rejects.toMatchObject({ code: 'cycle_not_found' });
  });
});

describe('contagens da Staff e o banco', () => {
  it('as contagens exigem staff.read (aluno 403, sem sessão 401) e nunca trazem pessoas', async () => {
    const fixture = await closedCourse();
    const ana = await newPerson();
    await register(ana, fixture.courseId);
    expect(
      (await call('GET', `/staff/courses/${fixture.courseId}/interests`, undefined)).status,
    ).toBe(401);
    expect(
      (await call('GET', `/staff/courses/${fixture.courseId}/interests`, ana.headers)).status,
    ).toBe(403);
    const support = await newPerson('support');
    const response = await call(
      'GET',
      `/staff/courses/${fixture.courseId}/interests`,
      support.headers,
    );
    expect(response.status).toBe(200);
    expect(Object.keys(await json(response)).sort()).toEqual([
      'active',
      'converted',
      'cycles',
      'withdrawn',
    ]);
  });

  it('um ciclo aberto por curso, número sequencial único, estado válido e o aviso único por interesse e ciclo', async () => {
    const fixture = await createDemoCourse(tools.db); // com 1 ciclo aberto
    const ana = await newPerson();
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
    await violation(
      tools.db
        .insert(schema.courseAvailabilityCycle)
        .values({ courseId: fixture.courseId, number: 9 }),
      /course_availability_cycle_open_idx/,
    );
    await violation(
      tools.db.insert(schema.courseAvailabilityCycle).values({
        courseId: fixture.courseId,
        number: 1,
        closedAt: new Date(),
      }),
      /course_availability_cycle_number_unique/,
    );
    await violation(
      tools.db.insert(schema.courseInterest).values({
        userId: ana.id,
        courseId: fixture.courseId,
        status: 'talvez',
      }),
      /course_interest_status_check/,
    );
    const [interest] = await tools.db
      .insert(schema.courseInterest)
      .values({ userId: ana.id, courseId: fixture.courseId })
      .returning();
    await violation(
      tools.db.insert(schema.courseInterest).values({ userId: ana.id, courseId: fixture.courseId }),
      /course_interest_course_user_unique/,
    );
    const [cycle] = await cycles(fixture.courseId);
    await tools.db
      .insert(schema.courseInterestNotification)
      .values({ interestId: interest!.id, cycleId: cycle!.id });
    await violation(
      tools.db
        .insert(schema.courseInterestNotification)
        .values({ interestId: interest!.id, cycleId: cycle!.id }),
      /course_interest_notification_pk/,
    );
  });
});

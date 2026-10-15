import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { grantEntitlement, revokeEntitlement } from '../../src/server/access/entitlement-store.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { createCourse } from '../../src/server/catalog/catalog-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createDemoCourse } from '../helpers/demo-course.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M8-02 em Postgres 18 real: `POST /api/offline/lease`. O lease é `min(expiração do direito, agora + 72 h)` por curso em
 * que a pessoa TEM acesso agora (a mesma decisão do estudo); suspensa, expirada, revogada ou sem matrícula não recebe; Staff
 * é recusada; o usuário vem da sessão. O relógio é injetado.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const T0 = new Date('2026-10-15T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

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
  await tools.db.delete(schema.userRole);
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

async function newUser() {
  seq += 1;
  const user = tools.test.createUser({ email: `pessoa${seq}@example.test`, name: `Pessoa ${seq}` });
  await tools.test.saveUser(user);
  return { id: user.id, headers: (await tools.test.login({ userId: user.id })).headers };
}

function lease(headers?: Headers, body: unknown = {}, origin: string | null = BASE_URL) {
  const merged = new Headers(headers);
  if (origin) merged.set('origin', origin);
  merged.set('content-type', 'application/json');
  return app().request(
    '/api/offline/lease',
    { method: 'POST', headers: merged, body: JSON.stringify(body) },
    env(),
  );
}
const json = async (response: Response) => (await response.json()) as Record<string, any>;

async function grant(userId: string, courseId: string, offerId: string | null, months = 3) {
  return grantEntitlement(tools.db, {
    userId,
    courseId,
    offerId,
    source: offerId ? 'free_offer' : 'admin_grant',
    sourceRef: offerId ? `free:${userId}:${offerId}:0` : `manual:${userId}:${courseId}:${seq}`,
    accessMonths: months,
    startsAt: T0,
    grantedBy: offerId ? userId : null,
    ...(offerId ? {} : { reason: 'teste do lease' }),
  });
}

describe('lease do acesso offline', () => {
  it('curso com acesso longo: lease de 72 h a partir do relógio do servidor', async () => {
    const { courseId, offerId } = await createDemoCourse(tools.db);
    const student = await newUser();
    await grant(student.id, courseId, offerId);
    const response = await lease(student.headers);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await json(response)).toEqual({
      serverNow: T0.toISOString(),
      courses: [{ courseId, leaseUntil: new Date(T0.getTime() + 3 * DAY).toISOString() }],
    });
  });

  it('o lease nunca passa da expiração do direito', async () => {
    const { courseId, offerId } = await createDemoCourse(tools.db);
    const student = await newUser();
    await grant(student.id, courseId, offerId, 1);
    // 1 mês a partir de T0 = 15/nov; faltando 5 h o lease é só até a expiração.
    clockNow = new Date(new Date('2026-11-15T12:00:00.000Z').getTime() - 5 * HOUR);
    const body = await json(await lease(student.headers));
    expect(body.courses).toEqual([{ courseId, leaseUntil: '2026-11-15T12:00:00.000Z' }]);
  });

  it('cada verificação renova: o lease anda com o relógio do servidor', async () => {
    const { courseId, offerId } = await createDemoCourse(tools.db);
    const student = await newUser();
    await grant(student.id, courseId, offerId);
    const first = await json(await lease(student.headers));
    clockNow = new Date(T0.getTime() + 2 * DAY);
    const second = await json(await lease(student.headers));
    expect(Date.parse(second.courses[0].leaseUntil)).toBe(
      Date.parse(first.courses[0].leaseUntil) + 2 * DAY,
    );
  });

  it('só os cursos COM acesso entram: expirado, revogado e suspenso ficam de fora', async () => {
    const demo = await createDemoCourse(tools.db);
    const student = await newUser();
    await grant(student.id, demo.courseId, demo.offerId);
    const revokedCourse = await createCourse(tools.db, {
      actorId: null,
      slug: 'curso-revogado',
      title: 'Curso revogado',
      sequenceMode: 'free',
    });
    const granted = await grant(student.id, revokedCourse, null);
    await revokeEntitlement(tools.db, {
      entitlementId: granted.entitlementId,
      reason: 'teste',
      actorId: null,
      now: T0,
    });
    const body = await json(await lease(student.headers));
    expect(body.courses.map((item: { courseId: string }) => item.courseId)).toEqual([
      demo.courseId,
    ]);

    // Expirou: o relógio do servidor passa dos 3 meses.
    clockNow = new Date(T0.getTime() + 120 * DAY);
    expect((await json(await lease(student.headers))).courses).toEqual([]);
  });

  it('conta suspensa não recebe lease; sem matrícula, lista vazia', async () => {
    const { courseId, offerId } = await createDemoCourse(tools.db);
    const student = await newUser();
    await grant(student.id, courseId, offerId);
    await tools.db.insert(schema.userSuspension).values({ userId: student.id, reason: 'teste' });
    expect((await json(await lease(student.headers))).courses).toEqual([]);
    const stranger = await newUser();
    expect((await json(await lease(stranger.headers))).courses).toEqual([]);
  });

  it('Staff é recusada: 403 offline_not_available, sem nenhum lease', async () => {
    const { courseId, offerId } = await createDemoCourse(tools.db);
    const person = await newUser();
    await grant(person.id, courseId, offerId);
    await grantRole(tools.db, { actorId: null, targetId: person.id, role: 'support' });
    const staff = { headers: (await tools.test.login({ userId: person.id })).headers };
    const response = await lease(staff.headers);
    expect(response.status).toBe(403);
    expect(await json(response)).toEqual({ error: { code: 'offline_not_available' } });
  });

  it('o usuário vem da sessão: userId e courseId forjados no corpo são ignorados', async () => {
    const demo = await createDemoCourse(tools.db);
    const owner = await newUser();
    await grant(owner.id, demo.courseId, demo.offerId);
    const intruder = await newUser();
    const body = await json(
      await lease(intruder.headers, { userId: owner.id, courseIds: [demo.courseId] }),
    );
    expect(body.courses).toEqual([]);
  });

  it('sem sessão: 401; sem origem (CSRF): 403; termos vigentes não aceitos: 403 terms_required', async () => {
    const student = await newUser();
    expect((await lease(undefined)).status).toBe(401);
    expect((await lease(student.headers, {}, null)).status).toBe(403);
    await tools.db.insert(schema.legalDocumentVersion).values({
      kind: 'terms',
      version: 'teste-m8-02',
      body: 'TEXTO PROVISÓRIO de teste',
      effectiveFrom: new Date(T0.getTime() - DAY),
    });
    try {
      const response = await lease(student.headers);
      expect(response.status).toBe(403);
      expect(await json(response)).toEqual({ error: { code: 'terms_required' } });
    } finally {
      await tools.db.delete(schema.legalDocumentVersion);
    }
  });

  it('o lease não grava nada (nem conclusão, nem direito, nem matrícula)', async () => {
    const { courseId, offerId } = await createDemoCourse(tools.db);
    const student = await newUser();
    await grant(student.id, courseId, offerId);
    const before = await tools.db
      .select()
      .from(schema.entitlement)
      .where(eq(schema.entitlement.userId, student.id));
    await lease(student.headers);
    await lease(student.headers);
    const after = await tools.db
      .select()
      .from(schema.entitlement)
      .where(eq(schema.entitlement.userId, student.id));
    expect(after).toEqual(before);
    expect(await tools.db.select().from(schema.lessonCompletion)).toEqual([]);
  });
});

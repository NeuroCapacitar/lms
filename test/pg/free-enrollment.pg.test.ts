import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';
import { enrollInFreeOffer } from '../../src/server/access/free-enrollment.ts';
import { grantEntitlement } from '../../src/server/access/entitlement-store.ts';
import {
  createCourse,
  createOffer,
  setCourseStatus,
  setOfferStatus,
} from '../../src/server/catalog/catalog-store.ts';
import { seedDemoCourse } from '../../src/server/catalog/demo-seed.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M3-02 em Postgres 18 real: a inscrição gratuita. Sem Order, Payment nem Asaas: a oferta gratuita
 * gera o Entitlement na própria transação. Cliques simultâneos geram exatamente um direito; oferta
 * pausada, paga ou de outro curso é recusada; expirar e reinscrever mantém a âncora.
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
  await tools.db.execute(
    sql`truncate table entitlement, enrollment, lesson, module, lesson_draft, module_draft, course_content, course_draft, curriculum_state, offer, course cascade`,
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
const app = () => apiApp({ emailSender: createFakeEmailSender(), isStaffEmail: async () => false });

async function newStudent() {
  seq += 1;
  const user = tools.test.createUser({ email: `aluno${seq}@example.test`, name: `Aluno ${seq}` });
  await tools.test.saveUser(user);
  return { id: user.id, headers: (await tools.test.login({ userId: user.id })).headers };
}

function call(method: string, path: string, headers?: Headers, body?: unknown) {
  const merged = new Headers(headers);
  merged.set('origin', BASE_URL);
  if (body !== undefined) merged.set('content-type', 'application/json');
  return app().request(
    `/api${path}`,
    { method, headers: merged, body: body === undefined ? undefined : JSON.stringify(body) },
    env(),
  );
}
const json = async (response: Response) => (await response.json()) as Record<string, any>;

/** O curso demonstrativo (gratuito, 3 meses, publicado) com os ids que as rotas pedem. */
async function demo() {
  const seeded = await seedDemoCourse(tools.db);
  return { courseId: seeded.courseId, offerId: seeded.offerId };
}
const enroll = (headers: Headers | undefined, courseId: string, offerId: string) =>
  call('POST', `/courses/${courseId}/enroll`, headers, { offerId });
const entitlementsOf = (userId: string) =>
  tools.db.select().from(schema.entitlement).where(eq(schema.entitlement.userId, userId));

describe('autorização', () => {
  it('sem sessão: 401 nas duas rotas', async () => {
    const { courseId, offerId } = await demo();
    expect((await enroll(undefined, courseId, offerId)).status).toBe(401);
    expect((await call('GET', `/courses/${courseId}/access`)).status).toBe(401);
  });

  it('termos vigentes não aceitos: 403 terms_required e nada é gravado', async () => {
    const { courseId, offerId } = await demo();
    const student = await newStudent();
    await tools.db.insert(schema.legalDocumentVersion).values({
      kind: 'terms',
      version: 'teste-m3-02',
      body: 'TEXTO PROVISÓRIO de teste',
      effectiveFrom: new Date(Date.now() - 86_400_000),
    });
    try {
      const response = await enroll(student.headers, courseId, offerId);
      expect(response.status).toBe(403);
      expect(await json(response)).toEqual({ error: { code: 'terms_required' } });
    } finally {
      await tools.db.delete(schema.legalDocumentVersion);
    }
    expect(await entitlementsOf(student.id)).toHaveLength(0);
  });

  it('conta suspensa: 403 account_suspended e nada é gravado', async () => {
    const { courseId, offerId } = await demo();
    const student = await newStudent();
    await tools.db.insert(schema.userSuspension).values({ userId: student.id, reason: 'teste' });
    const response = await enroll(student.headers, courseId, offerId);
    expect(response.status).toBe(403);
    expect(await json(response)).toEqual({ error: { code: 'account_suspended' } });
    expect(await entitlementsOf(student.id)).toHaveLength(0);
  });

  it('corpo inválido: 400; id de curso malformado: 404; sem Origin: 403 (CSRF)', async () => {
    const { courseId, offerId } = await demo();
    const student = await newStudent();
    expect((await call('POST', `/courses/${courseId}/enroll`, student.headers, {})).status).toBe(
      400,
    );
    expect(
      (await call('POST', `/courses/${courseId}/enroll`, student.headers, { offerId: 'x' })).status,
    ).toBe(400);
    expect(
      (await call('POST', `/courses/${courseId}/enroll`, student.headers, { offerId, extra: 1 }))
        .status,
    ).toBe(400);
    expect((await enroll(student.headers, 'nao-e-uuid', offerId)).status).toBe(404);
    const noOrigin = await app().request(
      `/api/courses/${courseId}/enroll`,
      {
        method: 'POST',
        headers: { ...Object.fromEntries(student.headers), 'content-type': 'application/json' },
        body: JSON.stringify({ offerId }),
      },
      env(),
    );
    expect(noOrigin.status).toBe(403);
  });
});

describe('inscrição', () => {
  it('cria o acesso (201), sem Order nem Payment: só um Entitlement free_offer de 3 meses', async () => {
    const { courseId, offerId } = await demo();
    const student = await newStudent();
    const before = Date.now();
    const response = await enroll(student.headers, courseId, offerId);
    expect(response.status).toBe(201);
    const body = await json(response);
    expect(body.status).toBe('enrolled');
    expect(body.access).toMatchObject({ hasAccess: true, reason: 'ok' });
    const expires = new Date(body.access.expiresAt).getTime();
    expect(expires).toBeGreaterThan(before + 85 * 86_400_000);
    expect(expires).toBeLessThan(Date.now() + 94 * 86_400_000);

    const rows = await entitlementsOf(student.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'free_offer', offerId, grantedBy: student.id });
    // não existe nenhuma tabela de pagamento neste marco: nada além do direito e da matrícula
    const tables = await tools.db.execute(
      sql`select table_name from information_schema.tables where table_schema = current_schema() and table_name ~* '(order|payment|checkout)'`,
    );
    expect(tables.rows).toHaveLength(0);
  });

  it('repetir é seguro: 200 already_enrolled, sem novo direito', async () => {
    const { courseId, offerId } = await demo();
    const student = await newStudent();
    await enroll(student.headers, courseId, offerId);
    const again = await enroll(student.headers, courseId, offerId);
    expect(again.status).toBe(200);
    expect((await json(again)).status).toBe('already_enrolled');
    expect(await entitlementsOf(student.id)).toHaveLength(1);
  });

  it('10 requisições simultâneas: exatamente UM direito (um 201 e nove 200)', async () => {
    const { courseId, offerId } = await demo();
    const student = await newStudent();
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => enroll(student.headers, courseId, offerId)),
    );
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
    expect(await entitlementsOf(student.id)).toHaveLength(1);
    const enrollments = await tools.db
      .select()
      .from(schema.enrollment)
      .where(eq(schema.enrollment.userId, student.id));
    expect(enrollments).toHaveLength(1);
  }, 120_000);

  it('relógios diferentes entre pedidos simultâneos (o perdedor "está no passado") não criam um 2º direito', async () => {
    const { courseId, offerId } = await demo();
    const student = await newStudent();
    const base = Date.now();
    // O pedido B tem o relógio 5 s ATRÁS do A: o direito do vencedor começa "no futuro" para B.
    const clocks = [() => new Date(base), () => new Date(base - 5_000)];
    const connections = await Promise.all(
      clocks.map(() => openDatabase(database.connectionString)),
    );
    try {
      const results = await Promise.all(
        connections.map((connection, index) =>
          enrollInFreeOffer(connection.db, {
            userId: student.id,
            courseId,
            offerId,
            clock: clocks[index]!,
          }),
        ),
      );
      expect(results.map((result) => result.status).sort()).toEqual([
        'already_enrolled',
        'enrolled',
      ]);
      expect(await entitlementsOf(student.id)).toHaveLength(1);
    } finally {
      await Promise.all(connections.map((connection) => connection.close()));
    }
  }, 60_000);

  it('o acesso é por pessoa: inscrever uma não libera a outra', async () => {
    const { courseId, offerId } = await demo();
    const one = await newStudent();
    const two = await newStudent();
    await enroll(one.headers, courseId, offerId);
    expect(await json(await call('GET', `/courses/${courseId}/access`, two.headers))).toMatchObject(
      {
        hasAccess: false,
        reason: 'no_access',
      },
    );
    expect(await json(await call('GET', `/courses/${courseId}/access`, one.headers))).toMatchObject(
      {
        hasAccess: true,
      },
    );
  });

  it('GET access sem matrícula: no_access; curso inexistente também (sem vazamento)', async () => {
    const student = await newStudent();
    const response = await call('GET', `/courses/${crypto.randomUUID()}/access`, student.headers);
    expect(await json(response)).toEqual({
      hasAccess: false,
      reason: 'no_access',
      expiresAt: null,
    });
    expect((await call('GET', '/courses/xyz/access', student.headers)).status).toBe(404);
  });
});

describe('o que a oferta permite', () => {
  async function extraOffer(
    courseId: string,
    kind: 'free' | 'paid',
    status: 'active' | 'paused' | 'archived',
  ) {
    const id = await createOffer(tools.db, {
      actorId: null,
      courseId,
      name: `Extra ${(seq += 1)}`,
      kind,
      priceCents: kind === 'free' ? 0 : 9_900,
      accessMonths: 6,
      maxInstallments: kind === 'free' ? 1 : 3,
    });
    await setOfferStatus(tools.db, { actorId: null, courseId, offerId: id, status: 'active' });
    if (status !== 'active') {
      await setOfferStatus(tools.db, { actorId: null, courseId, offerId: id, status });
    }
    return id;
  }

  it('oferta pausada DEPOIS de a página ser carregada: 409 offer_unavailable, nada gravado', async () => {
    const { courseId, offerId } = await demo();
    const student = await newStudent();
    await setOfferStatus(tools.db, { actorId: null, courseId, offerId, status: 'paused' });
    const response = await enroll(student.headers, courseId, offerId);
    expect(response.status).toBe(409);
    expect(await json(response)).toEqual({ error: { code: 'offer_unavailable' } });
    expect(await entitlementsOf(student.id)).toHaveLength(0);
  });

  it('oferta arquivada, em rascunho, de outro curso ou inexistente: a MESMA resposta offer_unavailable', async () => {
    const { courseId } = await demo();
    const other = await demo2();
    const student = await newStudent();
    const archived = await extraOffer(courseId, 'free', 'archived');
    const draft = await createOffer(tools.db, {
      actorId: null,
      courseId,
      name: 'Rascunho',
      kind: 'free',
      priceCents: 0,
      accessMonths: 1,
      maxInstallments: 1,
    });
    const bodies = [];
    for (const offerId of [archived, draft, other.offerId, crypto.randomUUID()]) {
      const response = await enroll(student.headers, courseId, offerId);
      expect(response.status, offerId).toBe(409);
      bodies.push(await response.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toBe('{"error":{"code":"offer_unavailable"}}');
    expect(await entitlementsOf(student.id)).toHaveLength(0);
  });

  it('oferta PAGA nesta rota: recusada (offer_not_free), sem direito e sem pagamento', async () => {
    const { courseId } = await demo();
    const student = await newStudent();
    const paid = await extraOffer(courseId, 'paid', 'active');
    const response = await enroll(student.headers, courseId, paid);
    expect(response.status).toBe(409);
    expect(await json(response)).toEqual({ error: { code: 'offer_not_free' } });
    expect(await entitlementsOf(student.id)).toHaveLength(0);
  });

  it('curso em rascunho, arquivado ou sem currículo publicado: offer_unavailable', async () => {
    const student = await newStudent();
    for (const mode of ['draft', 'archived', 'bare'] as const) {
      const courseId = await createCourse(tools.db, {
        actorId: null,
        slug: `curso-${mode}-${(seq += 1)}`,
        title: 'Interno',
        sequenceMode: 'guided',
      });
      const offerId = await createOffer(tools.db, {
        actorId: null,
        courseId,
        name: 'Gratuita',
        kind: 'free',
        priceCents: 0,
        accessMonths: 3,
        maxInstallments: 1,
      });
      await setOfferStatus(tools.db, { actorId: null, courseId, offerId, status: 'active' });
      if (mode !== 'draft')
        await setCourseStatus(tools.db, { actorId: null, id: courseId, status: 'published' });
      if (mode === 'archived')
        await setCourseStatus(tools.db, { actorId: null, id: courseId, status: 'archived' });
      const response = await enroll(student.headers, courseId, offerId);
      expect(response.status, mode).toBe(409);
    }
    expect(await entitlementsOf(student.id)).toHaveLength(0);
  });

  async function demo2() {
    const courseId = await createCourse(tools.db, {
      actorId: null,
      slug: `outro-${(seq += 1)}`,
      title: 'Outro',
      sequenceMode: 'free',
    });
    const offerId = await createOffer(tools.db, {
      actorId: null,
      courseId,
      name: 'Gratuita',
      kind: 'free',
      priceCents: 0,
      accessMonths: 2,
      maxInstallments: 1,
    });
    await setOfferStatus(tools.db, { actorId: null, courseId, offerId, status: 'active' });
    return { courseId, offerId };
  }
});

describe('depois de expirar e matrícula suspensa', () => {
  it('reinscrever depois de expirar cria novo direito e MANTÉM a âncora', async () => {
    const { courseId, offerId } = await demo();
    const student = await newStudent();
    // um acesso gratuito antigo, já vencido (concedido há 5 meses por 3)
    const longAgo = new Date(Date.now() - 150 * 86_400_000);
    await grantEntitlement(tools.db, {
      userId: student.id,
      courseId,
      offerId,
      source: 'free_offer',
      sourceRef: `free:${student.id}:${offerId}:0`,
      accessMonths: 3,
      startsAt: longAgo,
      grantedBy: student.id,
    });
    const expired = await json(await call('GET', `/courses/${courseId}/access`, student.headers));
    expect(expired).toMatchObject({ hasAccess: false, reason: 'expired' });

    const response = await enroll(student.headers, courseId, offerId);
    expect(response.status).toBe(201);
    expect((await json(response)).access).toMatchObject({ hasAccess: true, reason: 'ok' });
    const [enrolment] = await tools.db
      .select()
      .from(schema.enrollment)
      .where(
        and(eq(schema.enrollment.userId, student.id), eq(schema.enrollment.courseId, courseId)),
      );
    expect(enrolment!.anchorAt.getTime()).toBe(longAgo.getTime());
    expect(await entitlementsOf(student.id)).toHaveLength(2);
  });

  it('matrícula suspensa pela Staff: 403 enrollment_suspended (inscrever não devolve o acesso)', async () => {
    const { courseId, offerId } = await demo();
    const student = await newStudent();
    await enroll(student.headers, courseId, offerId);
    await tools.db
      .update(schema.enrollment)
      .set({ suspendedAt: new Date(), suspendedReason: 'teste' })
      .where(eq(schema.enrollment.userId, student.id));
    const response = await enroll(student.headers, courseId, offerId);
    expect(response.status).toBe(403);
    expect(await json(response)).toEqual({ error: { code: 'enrollment_suspended' } });
    expect(await entitlementsOf(student.id)).toHaveLength(1);
  });
});

describe('catálogo com o acesso da pessoa', () => {
  it('cada curso traz o `access` de quem pergunta e o id do curso e da oferta', async () => {
    const { courseId, offerId } = await demo();
    const student = await newStudent();
    const before = await json(await call('GET', '/catalog/courses', student.headers));
    expect(before.courses[0]).toMatchObject({
      id: courseId,
      slug: 'curso-demonstrativo',
      offer: { id: offerId },
      access: { hasAccess: false, reason: 'no_access', expiresAt: null },
    });
    await enroll(student.headers, courseId, offerId);
    const after = await json(await call('GET', '/catalog/courses', student.headers));
    expect(after.courses[0].access).toMatchObject({ hasAccess: true, reason: 'ok' });
    const other = await newStudent();
    expect(
      (await json(await call('GET', '/catalog/courses', other.headers))).courses[0].access
        .hasAccess,
    ).toBe(false);
  });
});

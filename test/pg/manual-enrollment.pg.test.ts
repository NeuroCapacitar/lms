import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { grantEntitlement, resolveAccess } from '../../src/server/access/entitlement-store.ts';
import { grantCapability, grantRole } from '../../src/server/auth/access-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createDemoCourse } from '../helpers/demo-course.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M3-06 em Postgres 18 real: a Staff matricula manualmente (pessoa já cadastrada), suspende e reativa
 * o acesso, ajusta o prazo de matrícula manual e vê quem está inscrito. Cada rota confere a capability
 * no servidor; matrícula manual não cria usuário, Order nem Payment.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const NOW = new Date('2026-10-20T12:00:00.000Z');

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let seq = 0;
let clockNow = NOW;

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
});
afterAll(async () => {
  await tools.close();
  await database.drop();
});
beforeEach(async () => {
  clockNow = NOW;
  await tools.db.execute(
    sql`truncate table course_completion, lesson_completion, entitlement, enrollment, lesson, module, lesson_draft, module_draft, course_content, course_draft, curriculum_state, offer, course cascade`,
  );
  await tools.db.delete(schema.userSuspension);
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
const app = () =>
  apiApp({
    emailSender: createFakeEmailSender(),
    isStaffEmail: async () => true,
    clock: () => clockNow,
  });

async function newUser(name = `Pessoa ${(seq += 1)}`, email?: string) {
  seq += 1;
  const user = tools.test.createUser({ email: email ?? `pessoa${seq}@example.test`, name });
  await tools.test.saveUser(user);
  return {
    id: user.id,
    email: user.email,
    name,
    headers: (await tools.test.login({ userId: user.id })).headers,
  };
}
/** Staff entra DEPOIS de receber o papel (dar papel encerra as sessões antigas). */
async function newStaff(role: 'admin' | 'support', grants: string[] = []) {
  const person = await newUser();
  await grantRole(tools.db, { actorId: null, targetId: person.id, role });
  for (const capability of grants) {
    await grantCapability(tools.db, { actorId: null, targetId: person.id, capability });
  }
  return { ...person, headers: (await tools.test.login({ userId: person.id })).headers };
}

function call(method: string, path: string, headers?: Headers, body?: unknown) {
  const merged = new Headers(headers);
  merged.set('origin', BASE_URL);
  merged.set('content-type', 'application/json');
  return app().request(
    `/api${path}`,
    { method, headers: merged, ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}) },
    env(),
  );
}
const json = async (response: Response) => (await response.json()) as Record<string, any>;
const rid = () => `req-${(seq += 1)}-${Math.random().toString(36).slice(2, 10)}`;

const grantBody = (email: string, courseId: string, over: Record<string, unknown> = {}) => ({
  email,
  courseId,
  months: 6,
  reason: 'Cortesia da turma piloto',
  requestId: rid(),
  ...over,
});
const entitlementsOf = (userId: string) =>
  tools.db.select().from(schema.entitlement).where(eq(schema.entitlement.userId, userId));
const auditOf = async (action: string) =>
  (await tools.db.select().from(schema.auditLog)).filter((row) => row.action === action);

describe('autorização (direto pela API)', () => {
  it('sem sessão 401; aluno 403; Suporte SEM grant lê a lista mas não escreve nada', async () => {
    const { courseId } = await createDemoCourse(tools.db);
    const student = await newUser();
    const support = await newStaff('support');
    const target = await newUser();

    const writes: [string, string, unknown][] = [
      ['POST', '/staff/enrollments', grantBody(target.email, courseId)],
      [
        'POST',
        `/staff/courses/${courseId}/enrollments/${target.id}/suspend`,
        { reason: 'teste motivo' },
      ],
      ['POST', `/staff/courses/${courseId}/enrollments/${target.id}/reinstate`, {}],
      [
        'POST',
        `/staff/entitlements/${crypto.randomUUID()}/adjust`,
        { months: 3, reason: 'teste', requestId: rid() },
      ],
    ];
    for (const [method, path, body] of writes) {
      expect((await call(method, path, undefined, body)).status, `anônimo ${path}`).toBe(401);
      expect((await call(method, path, student.headers, body)).status, `aluno ${path}`).toBe(403);
      expect((await call(method, path, support.headers, body)).status, `suporte ${path}`).toBe(403);
    }
    expect((await call('GET', `/staff/courses/${courseId}/enrollments`)).status).toBe(401);
    expect(
      (await call('GET', `/staff/courses/${courseId}/enrollments`, student.headers)).status,
    ).toBe(403);
    expect(
      (await call('GET', `/staff/courses/${courseId}/enrollments`, support.headers)).status,
    ).toBe(200);
    expect(await entitlementsOf(target.id)).toHaveLength(0);
  });

  it('cada capability vale para a sua rota: access.grant não ajusta; support_edit não matricula', async () => {
    const { courseId } = await createDemoCourse(tools.db);
    const target = await newUser();
    const granter = await newStaff('support', ['access.grant']);
    const editor = await newStaff('support', ['enrollment.support_edit']);
    const created = await call(
      'POST',
      '/staff/enrollments',
      granter.headers,
      grantBody(target.email, courseId),
    );
    expect(created.status).toBe(201);
    expect(
      (await call('POST', '/staff/enrollments', editor.headers, grantBody(target.email, courseId)))
        .status,
    ).toBe(403);
    const [right] = await entitlementsOf(target.id);
    const adjust = { months: 12, reason: 'ampliação combinada', requestId: rid() };
    expect(
      (await call('POST', `/staff/entitlements/${right!.id}/adjust`, granter.headers, adjust))
        .status,
    ).toBe(403);
    expect(
      (await call('POST', `/staff/entitlements/${right!.id}/adjust`, editor.headers, adjust))
        .status,
    ).toBe(200);
  });
});

describe('matrícula manual', () => {
  it('Suporte com access.grant matricula: direito admin_grant sem oferta, âncora, auditoria e SEM pagamento', async () => {
    const { courseId } = await createDemoCourse(tools.db);
    const target = await newUser('Maria Souza');
    const staff = await newStaff('support', ['access.grant']);
    const response = await call(
      'POST',
      '/staff/enrollments',
      staff.headers,
      grantBody(target.email, courseId),
    );
    expect(response.status).toBe(201);
    const body = await json(response);
    expect(body).toMatchObject({
      status: 'enrolled',
      userId: target.id,
      expiresAt: '2027-04-20T12:00:00.000Z',
    });

    const [right] = await entitlementsOf(target.id);
    expect(right).toMatchObject({
      source: 'admin_grant',
      offerId: null,
      grantedBy: staff.id,
      courseId,
    });
    expect(right!.sourceRef.startsWith('manual:')).toBe(true);
    const [enrolment] = await tools.db
      .select()
      .from(schema.enrollment)
      .where(eq(schema.enrollment.userId, target.id));
    expect(enrolment!.anchorAt.toISOString()).toBe(NOW.toISOString());
    expect((await resolveAccess(tools.db, target.id, courseId, NOW)).hasAccess).toBe(true);

    const [audit] = (await auditOf('entitlement.grant')).filter(
      (row) => row.targetId === right!.id,
    );
    expect(audit).toMatchObject({ actorId: staff.id });
    expect(audit!.details).toMatchObject({
      userId: target.id,
      courseId,
      source: 'admin_grant',
      reason: 'Cortesia da turma piloto',
    });
    // o acesso gratuito/manual não cria pedido, sessão de checkout, pagamento nem fato financeiro (M6-01 criou as tabelas)
    const finance = await tools.db.execute(
      sql`select (select count(*) from purchase_order) + (select count(*) from checkout_session) + (select count(*) from payment) + (select count(*) from financial_event) as total`,
    );
    expect(Number(finance.rows[0]!.total)).toBe(0);
  });

  it('duplo envio com o MESMO requestId: um só direito; 8 envios simultâneos também', async () => {
    const { courseId } = await createDemoCourse(tools.db);
    const target = await newUser();
    const staff = await newStaff('admin');
    const body = grantBody(target.email, courseId);
    expect((await call('POST', '/staff/enrollments', staff.headers, body)).status).toBe(201);
    const again = await call('POST', '/staff/enrollments', staff.headers, body);
    expect(again.status).toBe(200);
    expect((await json(again)).status).toBe('already_enrolled');
    expect(await entitlementsOf(target.id)).toHaveLength(1);

    const parallel = grantBody(target.email, courseId);
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => call('POST', '/staff/enrollments', staff.headers, parallel)),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
    expect(await entitlementsOf(target.id)).toHaveLength(2);
  }, 120_000);

  it('o mesmo requestId para OUTRA pessoa é recusado (409), sem direito', async () => {
    const { courseId } = await createDemoCourse(tools.db);
    const one = await newUser();
    const two = await newUser();
    const staff = await newStaff('admin');
    const requestId = rid();
    expect(
      (
        await call(
          'POST',
          '/staff/enrollments',
          staff.headers,
          grantBody(one.email, courseId, { requestId }),
        )
      ).status,
    ).toBe(201);
    const clash = await call(
      'POST',
      '/staff/enrollments',
      staff.headers,
      grantBody(two.email, courseId, { requestId }),
    );
    expect(clash.status).toBe(409);
    expect(await json(clash)).toEqual({ error: { code: 'request_id_conflict' } });
    expect(await entitlementsOf(two.id)).toHaveLength(0);
  });

  it('pessoa inexistente: 404 claro, e NENHUM usuário é criado; curso inexistente: 404', async () => {
    const { courseId } = await createDemoCourse(tools.db);
    const staff = await newStaff('admin');
    const before = (await tools.db.select().from(schema.user)).length;
    const missing = await call(
      'POST',
      '/staff/enrollments',
      staff.headers,
      grantBody('ninguem@example.test', courseId),
    );
    expect(missing.status).toBe(404);
    expect(await json(missing)).toEqual({ error: { code: 'user_not_found' } });
    expect((await tools.db.select().from(schema.user)).length).toBe(before);
    const target = await newUser();
    const noCourse = await call(
      'POST',
      '/staff/enrollments',
      staff.headers,
      grantBody(target.email, crypto.randomUUID()),
    );
    expect(await json(noCourse)).toEqual({ error: { code: 'course_not_found' } });
    expect(await tools.db.select().from(schema.enrollment)).toHaveLength(0);
  });

  it('o e-mail é normalizado (caixa e espaços) e o corpo é validado (400)', async () => {
    const { courseId } = await createDemoCourse(tools.db);
    const target = await newUser('Ana', 'ana.silva@example.test');
    const staff = await newStaff('admin');
    expect(
      (
        await call(
          'POST',
          '/staff/enrollments',
          staff.headers,
          grantBody('  ANA.Silva@Example.TEST ', courseId),
        )
      ).status,
    ).toBe(201);
    for (const bad of [
      { months: 0 },
      { months: 601 },
      { months: 1.5 },
      { reason: 'ab' },
      { email: 'não-é-email' },
      { courseId: 'xyz' },
      { requestId: 'curto' },
      { requestId: 'tem espaço no id' },
      { extra: 'campo a mais' },
    ]) {
      const response = await call(
        'POST',
        '/staff/enrollments',
        staff.headers,
        grantBody(target.email, courseId, bad),
      );
      expect(response.status, JSON.stringify(bad)).toBe(400);
    }
    expect(await entitlementsOf(target.id)).toHaveLength(1);
  });
});

describe('suspender e reativar', () => {
  async function enrolledStudent() {
    const { courseId, offerId } = await createDemoCourse(tools.db);
    const student = await newUser();
    await grantEntitlement(tools.db, {
      userId: student.id,
      courseId,
      offerId,
      source: 'free_offer',
      sourceRef: `free:${student.id}:${offerId}:0`,
      accessMonths: 12,
      startsAt: new Date('2026-10-11T12:00:00.000Z'),
      grantedBy: student.id,
    });
    return { courseId, student };
  }
  const outline = (student: { headers: Headers }, courseId: string) =>
    call('GET', `/courses/${courseId}/outline`, student.headers);

  it('a suspensão vale na requisição SEGUINTE e reativar mantém a âncora, os direitos e o progresso', async () => {
    const { courseId, student } = await enrolledStudent();
    const staff = await newStaff('support', ['access.grant']);
    expect((await outline(student, courseId)).status).toBe(200);
    const before = (await tools.db.select().from(schema.enrollment))[0]!;
    const rightsBefore = await entitlementsOf(student.id);

    const suspend = await call(
      'POST',
      `/staff/courses/${courseId}/enrollments/${student.id}/suspend`,
      staff.headers,
      { reason: 'Uso indevido do material' },
    );
    expect(suspend.status).toBe(200);
    expect(await json(suspend)).toEqual({ status: 'suspended' });
    const blocked = await outline(student, courseId);
    expect(blocked.status).toBe(403);
    expect(await json(blocked)).toEqual({ error: { code: 'access_denied', reason: 'suspended' } });
    // os direitos e a âncora NÃO mudaram
    expect(await entitlementsOf(student.id)).toEqual(rightsBefore);
    const [during] = await tools.db.select().from(schema.enrollment);
    expect(during!.anchorAt.toISOString()).toBe(before.anchorAt.toISOString());
    expect(during).toMatchObject({
      suspendedReason: 'Uso indevido do material',
      suspendedBy: staff.id,
    });

    // repetir é no-op
    expect(
      await json(
        await call(
          'POST',
          `/staff/courses/${courseId}/enrollments/${student.id}/suspend`,
          staff.headers,
          { reason: 'de novo' },
        ),
      ),
    ).toEqual({ status: 'already_suspended' });

    const reinstate = await call(
      'POST',
      `/staff/courses/${courseId}/enrollments/${student.id}/reinstate`,
      staff.headers,
    );
    expect(await json(reinstate)).toEqual({ status: 'reinstated' });
    expect((await outline(student, courseId)).status).toBe(200);
    const [after] = await tools.db.select().from(schema.enrollment);
    expect(after!.anchorAt.toISOString()).toBe(before.anchorAt.toISOString());
    expect(after).toMatchObject({ suspendedAt: null, suspendedReason: null, suspendedBy: null });
    expect(
      await json(
        await call(
          'POST',
          `/staff/courses/${courseId}/enrollments/${student.id}/reinstate`,
          staff.headers,
        ),
      ),
    ).toEqual({ status: 'not_suspended' });

    expect(await auditOf('enrollment.suspend')).toHaveLength(1);
    expect(await auditOf('enrollment.reinstate')).toHaveLength(1);
    expect((await auditOf('enrollment.suspend'))[0]).toMatchObject({ actorId: staff.id });
    expect((await auditOf('enrollment.suspend'))[0]!.details).toMatchObject({
      userId: student.id,
      courseId,
      reason: 'Uso indevido do material',
    });
  });

  it('pessoa sem matrícula: 404 not_enrolled; motivo curto: 400', async () => {
    const { courseId } = await createDemoCourse(tools.db);
    const stranger = await newUser();
    const staff = await newStaff('admin');
    const response = await call(
      'POST',
      `/staff/courses/${courseId}/enrollments/${stranger.id}/suspend`,
      staff.headers,
      { reason: 'motivo ok' },
    );
    expect(response.status).toBe(404);
    expect(await json(response)).toEqual({ error: { code: 'not_enrolled' } });
    expect(
      (
        await call(
          'POST',
          `/staff/courses/${courseId}/enrollments/${stranger.id}/suspend`,
          staff.headers,
          { reason: 'x' },
        )
      ).status,
    ).toBe(400);
    const reinstate = await call(
      'POST',
      `/staff/courses/${courseId}/enrollments/${stranger.id}/reinstate`,
      staff.headers,
    );
    expect(reinstate.status).toBe(404);
  });
});

describe('ajustar o prazo (só matrícula manual)', () => {
  it('revoga o direito antigo e cria o novo com o mesmo início; histórico inteiro; idempotente', async () => {
    const { courseId } = await createDemoCourse(tools.db);
    const target = await newUser();
    const admin = await newStaff('admin');
    await call(
      'POST',
      '/staff/enrollments',
      admin.headers,
      grantBody(target.email, courseId, { months: 3 }),
    );
    const [old] = await entitlementsOf(target.id);
    expect(old!.expiresAt.toISOString()).toBe('2027-01-20T12:00:00.000Z');

    const editor = await newStaff('support', ['enrollment.support_edit']);
    const requestId = rid();
    const response = await call('POST', `/staff/entitlements/${old!.id}/adjust`, editor.headers, {
      months: 12,
      reason: 'Ampliação combinada com o cliente',
      requestId,
    });
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body).toMatchObject({ status: 'adjusted', expiresAt: '2027-10-20T12:00:00.000Z' });

    const rights = await entitlementsOf(target.id);
    expect(rights).toHaveLength(2);
    const revoked = rights.find((r) => r.id === old!.id)!;
    const fresh = rights.find((r) => r.id === body.entitlementId)!;
    expect(revoked.revokedAt).not.toBeNull();
    expect(revoked.revokedReason).toContain('adjusted: Ampliação combinada');
    expect(fresh).toMatchObject({ source: 'admin_grant', revokedAt: null, grantedBy: editor.id });
    expect(fresh.startsAt.toISOString()).toBe(old!.startsAt.toISOString());
    expect(fresh.expiresAt.toISOString()).toBe('2027-10-20T12:00:00.000Z');
    const [enrolment] = await tools.db
      .select()
      .from(schema.enrollment)
      .where(eq(schema.enrollment.userId, target.id));
    expect(enrolment!.effectiveExpiresAt!.toISOString()).toBe('2027-10-20T12:00:00.000Z');
    const access = await resolveAccess(
      tools.db,
      target.id,
      courseId,
      new Date('2027-06-01T00:00:00Z'),
    );
    expect(access.hasAccess).toBe(true);

    // mesmo requestId: nada muda
    const again = await call('POST', `/staff/entitlements/${fresh.id}/adjust`, editor.headers, {
      months: 12,
      reason: 'repetido',
      requestId,
    });
    expect(await json(again)).toMatchObject({ status: 'unchanged', entitlementId: fresh.id });
    expect(await entitlementsOf(target.id)).toHaveLength(2);
    const [audit] = (await auditOf('entitlement.adjust')).filter(
      (row) => row.targetId === fresh.id,
    );
    expect(audit!.details).toMatchObject({
      replaced: old!.id,
      months: 12,
      reason: 'Ampliação combinada com o cliente',
    });
  });

  it('encurtar o prazo pode encerrar o acesso agora', async () => {
    const { courseId } = await createDemoCourse(tools.db);
    const target = await newUser();
    const admin = await newStaff('admin');
    await call(
      'POST',
      '/staff/enrollments',
      admin.headers,
      grantBody(target.email, courseId, { months: 12 }),
    );
    const [right] = await entitlementsOf(target.id);
    clockNow = new Date('2026-12-01T00:00:00Z');
    await call('POST', `/staff/entitlements/${right!.id}/adjust`, admin.headers, {
      months: 1,
      reason: 'Pedido de cancelamento',
      requestId: rid(),
    });
    expect((await resolveAccess(tools.db, target.id, courseId, clockNow)).reason).toBe('expired');
  });

  it('compra, inscrição gratuita e direito já revogado NÃO se ajustam (409); id desconhecido 404', async () => {
    const { courseId, offerId } = await createDemoCourse(tools.db);
    const person = await newUser();
    const admin = await newStaff('admin');
    await grantEntitlement(tools.db, {
      userId: person.id,
      courseId,
      offerId,
      source: 'free_offer',
      sourceRef: `free:${person.id}:x`,
      accessMonths: 3,
      startsAt: NOW,
      grantedBy: person.id,
    });
    await grantEntitlement(tools.db, {
      userId: person.id,
      courseId,
      offerId,
      source: 'purchase',
      sourceRef: `pedido:${person.id}`,
      accessMonths: 3,
      startsAt: NOW,
      grantedBy: null,
    });
    for (const right of await entitlementsOf(person.id)) {
      const response = await call('POST', `/staff/entitlements/${right.id}/adjust`, admin.headers, {
        months: 24,
        reason: 'tentativa',
        requestId: rid(),
      });
      expect(response.status, right.source).toBe(409);
      expect(await json(response)).toEqual({ error: { code: 'not_adjustable' } });
    }
    expect(
      (await entitlementsOf(person.id)).every(
        (r) => r.expiresAt.toISOString() === '2027-01-20T12:00:00.000Z',
      ),
    ).toBe(true);

    const target = await newUser();
    await call('POST', '/staff/enrollments', admin.headers, grantBody(target.email, courseId));
    const [manual] = await entitlementsOf(target.id);
    await call('POST', `/staff/entitlements/${manual!.id}/adjust`, admin.headers, {
      months: 2,
      reason: 'primeiro ajuste',
      requestId: rid(),
    });
    const stale = await call('POST', `/staff/entitlements/${manual!.id}/adjust`, admin.headers, {
      months: 9,
      reason: 'sobre o revogado',
      requestId: rid(),
    });
    expect(stale.status).toBe(409);
    expect(
      (
        await call('POST', `/staff/entitlements/${crypto.randomUUID()}/adjust`, admin.headers, {
          months: 2,
          reason: 'qualquer',
          requestId: rid(),
        })
      ).status,
    ).toBe(404);
  });
});

describe('lista de inscritos', () => {
  it('mostra nome, e-mail, situação, expiração e progresso; qualquer Staff lê; paginada', async () => {
    const { courseId, offerId } = await createDemoCourse(tools.db);
    const lessons = await tools.db
      .select()
      .from(schema.lesson)
      .where(eq(schema.lesson.courseId, courseId));
    const required = lessons.filter((l) => !l.isOptional);

    const active = await newUser('Ana Ativa', 'a-ativa@example.test');
    const expired = await newUser('Bia Expirada', 'b-expirada@example.test');
    const suspended = await newUser('Caio Suspenso', 'c-suspenso@example.test');
    const manual = await newUser('Duda Manual', 'd-manual@example.test');
    const long = (
      userId: string,
      months: number,
      at: string,
      source: 'free_offer' | 'purchase' = 'free_offer',
    ) =>
      grantEntitlement(tools.db, {
        userId,
        courseId,
        offerId,
        source,
        sourceRef: `${source}:${userId}`,
        accessMonths: months,
        startsAt: new Date(at),
        grantedBy: userId,
      });
    await long(active.id, 12, '2026-10-11T12:00:00Z');
    await long(expired.id, 1, '2026-01-01T12:00:00Z');
    await long(suspended.id, 12, '2026-10-11T12:00:00Z', 'purchase');
    await tools.db
      .update(schema.enrollment)
      .set({ suspendedAt: NOW, suspendedReason: 'abuso' })
      .where(eq(schema.enrollment.userId, suspended.id));
    const admin = await newStaff('admin');
    await call(
      'POST',
      '/staff/enrollments',
      admin.headers,
      grantBody(manual.email, courseId, { months: 6 }),
    );
    // a Ana concluiu 2 das 5 obrigatórias
    for (const lesson of required.slice(0, 2)) {
      await tools.db
        .insert(schema.lessonCompletion)
        .values({ userId: active.id, courseId, lessonId: lesson.id });
    }

    const support = await newStaff('support');
    const response = await call('GET', `/staff/courses/${courseId}/enrollments`, support.headers);
    expect(response.status).toBe(200);
    const page = await json(response);
    expect(page).toMatchObject({ total: 4, page: 1, pageSize: 25 });
    const byEmail = Object.fromEntries(page.items.map((i: any) => [i.email, i]));
    expect(page.items.map((i: any) => i.email)).toEqual([
      'a-ativa@example.test',
      'b-expirada@example.test',
      'c-suspenso@example.test',
      'd-manual@example.test',
    ]);
    expect(byEmail['a-ativa@example.test']).toMatchObject({
      name: 'Ana Ativa',
      status: 'active',
      progress: { completed: 2, total: 5, percent: 40 },
      manualGrant: null,
      courseCompletedAt: null,
    });
    expect(byEmail['a-ativa@example.test'].expiresAt).toBe('2027-10-11T12:00:00.000Z');
    expect(byEmail['b-expirada@example.test']).toMatchObject({
      status: 'expired',
      expiresAt: '2026-02-01T12:00:00.000Z',
    });
    expect(byEmail['c-suspenso@example.test']).toMatchObject({
      status: 'suspended',
      suspendedReason: 'abuso',
    });
    expect(byEmail['d-manual@example.test'].manualGrant).toMatchObject({
      expiresAt: '2027-04-20T12:00:00.000Z',
    });
    expect(byEmail['d-manual@example.test'].manualGrant.entitlementId).toEqual(expect.any(String));
    // só o necessário: nada de campos internos de autoria nem tokens
    expect(JSON.stringify(page)).not.toMatch(/grantedBy|sessionToken|password/i);

    const second = await json(
      await call(
        'GET',
        `/staff/courses/${courseId}/enrollments?page=2&pageSize=3`,
        support.headers,
      ),
    );
    expect(second).toMatchObject({ total: 4, page: 2, pageSize: 3 });
    expect(second.items.map((i: any) => i.email)).toEqual(['d-manual@example.test']);
  });

  it('curso sem inscritos: lista vazia; página e tamanho inválidos caem no padrão; id malformado 404', async () => {
    const { courseId } = await createDemoCourse(tools.db);
    const support = await newStaff('support');
    expect(
      await json(
        await call(
          'GET',
          `/staff/courses/${courseId}/enrollments?page=abc&pageSize=9999`,
          support.headers,
        ),
      ),
    ).toEqual({ items: [], total: 0, page: 1, pageSize: 25 });
    expect((await call('GET', '/staff/courses/xyz/enrollments', support.headers)).status).toBe(404);
  });
});

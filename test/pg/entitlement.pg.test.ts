import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type OpenDatabase } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';
import {
  EntitlementNotFoundError,
  SourceRefConflictError,
  grantEntitlement,
  resolveAccess,
  revokeEntitlement,
  type GrantInput,
} from '../../src/server/access/entitlement-store.ts';
import {
  createCourse,
  createOffer,
  setCourseStatus,
  setOfferStatus,
} from '../../src/server/catalog/catalog-store.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M3-01 em Postgres 18 real: Entitlement (a fonte) e Enrollment (a projeção). Concessões concorrentes
 * viram UMA matrícula e UMA âncora; a âncora é imutável (gatilho); a expiração é avaliada pelo `agora`
 * recebido, sem tarefa agendada; `resolveAccess` é a única decisão.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const T0 = new Date('2026-01-10T12:00:00.000Z');

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

async function newUser() {
  seq += 1;
  const user = tools.test.createUser({ email: `aluno${seq}@example.test`, name: `Aluno ${seq}` });
  await tools.test.saveUser(user);
  return user.id;
}

async function newCourse(slug = `curso-${(seq += 1)}`) {
  const courseId = await createCourse(tools.db, {
    actorId: null,
    slug,
    title: 'Curso interno',
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
  await setCourseStatus(tools.db, { actorId: null, id: courseId, status: 'published' });
  return { courseId, offerId };
}

const grant = (
  over: Partial<GrantInput> & Pick<GrantInput, 'userId' | 'courseId'>,
): GrantInput => ({
  offerId: null,
  source: 'admin_grant',
  sourceRef: `ref-${(seq += 1)}`,
  accessMonths: 3,
  startsAt: T0,
  grantedBy: null,
  ...over,
});

const enrollmentRows = (userId: string, courseId: string) =>
  tools.db
    .select()
    .from(schema.enrollment)
    .where(
      sql`${schema.enrollment.userId} = ${userId} and ${schema.enrollment.courseId} = ${courseId}`,
    );
const entitlementRows = (userId: string, courseId: string) =>
  tools.db
    .select()
    .from(schema.entitlement)
    .where(
      sql`${schema.entitlement.userId} = ${userId} and ${schema.entitlement.courseId} = ${courseId}`,
    );

/** O Drizzle embrulha o erro do pg: a mensagem da violação fica em `cause`. */
async function expectViolation(work: PromiseLike<unknown>, pattern: RegExp) {
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

describe('concessão', () => {
  it('cria a matrícula (âncora = início) e o direito, com prazo em meses e a expiração efetiva', async () => {
    const userId = await newUser();
    const { courseId, offerId } = await newCourse();
    const result = await grantEntitlement(
      tools.db,
      grant({
        userId,
        courseId,
        offerId,
        source: 'free_offer',
        sourceRef: `free:${userId}:${courseId}`,
      }),
    );
    expect(result.created).toBe(true);
    expect(result.anchorAt.toISOString()).toBe('2026-01-10T12:00:00.000Z');
    expect(result.effectiveExpiresAt!.toISOString()).toBe('2026-04-10T12:00:00.000Z');
    const [enrol] = await enrollmentRows(userId, courseId);
    expect(enrol!.anchorAt.toISOString()).toBe('2026-01-10T12:00:00.000Z');
    expect(enrol!.effectiveExpiresAt!.toISOString()).toBe('2026-04-10T12:00:00.000Z');
    const [right] = await entitlementRows(userId, courseId);
    expect(right).toMatchObject({ source: 'free_offer', offerId, revokedAt: null });
    expect(right!.expiresAt.toISOString()).toBe('2026-04-10T12:00:00.000Z');
    const audit = (await tools.db.select().from(schema.auditLog)).filter(
      (row) => row.targetId === right!.id,
    );
    expect(audit.map((row) => row.action)).toEqual(['entitlement.grant']);
  });

  it('fim de mês: 31/jan + 1 mês vence em 28/fev', async () => {
    const userId = await newUser();
    const { courseId } = await newCourse();
    const result = await grantEntitlement(
      tools.db,
      grant({ userId, courseId, accessMonths: 1, startsAt: new Date('2026-01-31T10:00:00.000Z') }),
    );
    expect(result.effectiveExpiresAt!.toISOString()).toBe('2026-02-28T10:00:00.000Z');
  });

  it('a mesma source_ref é idempotente: não cria outro direito nem outra auditoria', async () => {
    const userId = await newUser();
    const { courseId } = await newCourse();
    const input = grant({ userId, courseId, sourceRef: 'pedido-1' });
    const first = await grantEntitlement(tools.db, input);
    const again = await grantEntitlement(tools.db, {
      ...input,
      startsAt: new Date('2026-02-01T00:00:00Z'),
    });
    expect(again.created).toBe(false);
    expect(again.entitlementId).toBe(first.entitlementId);
    expect(await entitlementRows(userId, courseId)).toHaveLength(1);
    expect(
      (await tools.db.select().from(schema.auditLog)).filter(
        (row) => row.targetId === first.entitlementId,
      ),
    ).toHaveLength(1);
  });

  it('a mesma source_ref de OUTRA pessoa ou curso é recusada (nunca devolve o direito alheio)', async () => {
    const one = await newUser();
    const two = await newUser();
    const { courseId } = await newCourse();
    await grantEntitlement(tools.db, grant({ userId: one, courseId, sourceRef: 'pedido-x' }));
    await expect(
      grantEntitlement(tools.db, grant({ userId: two, courseId, sourceRef: 'pedido-x' })),
    ).rejects.toBeInstanceOf(SourceRefConflictError);
    expect(await entitlementRows(two, courseId)).toHaveLength(0);
  });

  it('prazo inválido é recusado antes de gravar qualquer coisa', async () => {
    const userId = await newUser();
    const { courseId } = await newCourse();
    await expect(
      grantEntitlement(tools.db, grant({ userId, courseId, accessMonths: 0 })),
    ).rejects.toThrow(RangeError);
    expect(await enrollmentRows(userId, courseId)).toHaveLength(0);
  });
});

describe('concorrência', () => {
  async function connections(count: number): Promise<OpenDatabase[]> {
    return Promise.all(
      Array.from({ length: count }, () => openDatabase(database.connectionString)),
    );
  }

  it('várias concessões simultâneas (refs diferentes): UMA matrícula, UMA âncora, todos os direitos', async () => {
    const userId = await newUser();
    const { courseId } = await newCourse();
    const pool = await connections(8);
    try {
      const results = await Promise.all(
        pool.map((conn, index) =>
          grantEntitlement(
            conn.db,
            grant({
              userId,
              courseId,
              sourceRef: `paralelo-${index}`,
              accessMonths: index + 1,
              startsAt: new Date(T0.getTime() + index * 1000),
            }),
          ),
        ),
      );
      expect(results.every((result) => result.created)).toBe(true);
      expect(await enrollmentRows(userId, courseId)).toHaveLength(1);
      expect(new Set(results.map((result) => result.anchorAt.toISOString())).size).toBe(1);
      expect(await entitlementRows(userId, courseId)).toHaveLength(8);
      const [enrol] = await enrollmentRows(userId, courseId);
      // a efetiva é a MAIOR: 8 meses a partir de T0 + 7 s
      expect(enrol!.effectiveExpiresAt!.toISOString()).toBe('2026-09-10T12:00:07.000Z');
    } finally {
      await Promise.all(pool.map((conn) => conn.close()));
    }
  });

  it('10 requisições simultâneas com a MESMA source_ref: exatamente um direito', async () => {
    const userId = await newUser();
    const { courseId, offerId } = await newCourse();
    const pool = await connections(10);
    try {
      const results = await Promise.all(
        pool.map((conn) =>
          grantEntitlement(
            conn.db,
            grant({
              userId,
              courseId,
              offerId,
              source: 'free_offer',
              sourceRef: 'inscricao-unica',
            }),
          ),
        ),
      );
      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(new Set(results.map((result) => result.entitlementId)).size).toBe(1);
      expect(await entitlementRows(userId, courseId)).toHaveLength(1);
      expect(await enrollmentRows(userId, courseId)).toHaveLength(1);
    } finally {
      await Promise.all(pool.map((conn) => conn.close()));
    }
  });
});

describe('gatilhos', () => {
  async function granted() {
    const userId = await newUser();
    const { courseId, offerId } = await newCourse();
    const result = await grantEntitlement(
      tools.db,
      grant({ userId, courseId, offerId, source: 'purchase', sourceRef: 'pedido-9' }),
    );
    return { userId, courseId, offerId, ...result };
  }

  it('UPDATE da âncora, da chave ou DELETE da matrícula falham', async () => {
    const { userId, courseId } = await granted();
    await expectViolation(
      tools.db.execute(
        sql`update enrollment set anchor_at = anchor_at + interval '1 day' where user_id = ${userId}`,
      ),
      /anchor_locked/,
    );
    await expectViolation(
      tools.db.execute(
        sql`update enrollment set course_id = ${crypto.randomUUID()} where user_id = ${userId}`,
      ),
      /enrollment_key_locked|violates foreign key/,
    );
    await expectViolation(
      tools.db.execute(
        sql`delete from enrollment where user_id = ${userId} and course_id = ${courseId}`,
      ),
      /enrollment_not_deletable/,
    );
    const [enrol] = await enrollmentRows(userId, courseId);
    expect(enrol!.anchorAt.toISOString()).toBe('2026-01-10T12:00:00.000Z');
  });

  it('o direito não se apaga nem se reescreve (prazo, origem, ref, pessoa)', async () => {
    const { entitlementId } = await granted();
    for (const set of [
      sql`expires_at = expires_at + interval '1 year'`,
      sql`starts_at = starts_at - interval '1 day'`,
      sql`source_ref = 'outro'`,
      sql`source = 'admin_grant'`,
      sql`user_id = 'outra-pessoa'`,
      sql`granted_by = 'alguem'`,
    ]) {
      await expectViolation(
        tools.db.execute(sql`update entitlement set ${set} where id = ${entitlementId}`),
        /entitlement_immutable|violates foreign key/,
      );
    }
    await expectViolation(
      tools.db.execute(sql`delete from entitlement where id = ${entitlementId}`),
      /entitlement_not_deletable/,
    );
  });

  it('revogado é definitivo: não volta nem muda o motivo', async () => {
    const { entitlementId } = await granted();
    await revokeEntitlement(tools.db, { entitlementId, reason: 'teste', actorId: null, now: T0 });
    await expectViolation(
      tools.db.execute(
        sql`update entitlement set revoked_at = null, revoked_reason = null where id = ${entitlementId}`,
      ),
      /revoked_is_final|entitlement_revocation_check/,
    );
    await expectViolation(
      tools.db.execute(
        sql`update entitlement set revoked_reason = 'outro' where id = ${entitlementId}`,
      ),
      /revoked_is_final/,
    );
  });
});

describe('restrições do banco', () => {
  it('janela invertida, origem desconhecida, ref vazia e compra sem oferta falham', async () => {
    const userId = await newUser();
    const { courseId } = await newCourse();
    await grantEntitlement(tools.db, grant({ userId, courseId, sourceRef: 'base' }));
    const insert = (values: string) =>
      tools.db.execute(
        sql.raw(
          `insert into entitlement (user_id, course_id, offer_id, source, source_ref, starts_at, expires_at) values ('${userId}', '${courseId}', ${values})`,
        ),
      );
    await expectViolation(
      insert(`null, 'admin_grant', 'r1', '2026-02-01', '2026-01-01'`),
      /entitlement_window_check/,
    );
    await expectViolation(
      insert(`null, 'magica', 'r2', '2026-01-01', '2026-02-01'`),
      // sem oferta, a origem desconhecida também fere a regra da oferta: o Postgres cita uma das duas
      /entitlement_source_check|entitlement_offer_required_check/,
    );
    await expectViolation(
      insert(`null, 'admin_grant', '', '2026-01-01', '2026-02-01'`),
      /entitlement_source_ref_check/,
    );
    await expectViolation(
      insert(`null, 'purchase', 'r3', '2026-01-01', '2026-02-01'`),
      /entitlement_offer_required_check/,
    );
  });

  it('a oferta tem de ser do MESMO curso do direito', async () => {
    const userId = await newUser();
    const first = await newCourse('curso-a');
    const second = await newCourse('curso-b');
    await expectViolation(
      grantEntitlement(
        tools.db,
        grant({
          userId,
          courseId: first.courseId,
          offerId: second.offerId,
          source: 'purchase',
          sourceRef: 'cruzado',
        }),
      ),
      /entitlement_offer_fk/,
    );
  });

  it('não existe direito sem matrícula (FK composta)', async () => {
    const userId = await newUser();
    const { courseId } = await newCourse();
    await expectViolation(
      tools.db.execute(
        sql`insert into entitlement (user_id, course_id, source, source_ref, starts_at, expires_at) values (${userId}, ${courseId}, 'admin_grant', 'solto', now(), now() + interval '1 day')`,
      ),
      /entitlement_enrollment_fk/,
    );
  });
});

describe('resolveAccess (a única decisão)', () => {
  it('a expiração muda o resultado só pelo `agora`, sem nenhuma tarefa agendada', async () => {
    const userId = await newUser();
    const { courseId } = await newCourse();
    await grantEntitlement(tools.db, grant({ userId, courseId }));
    const at = (iso: string) => resolveAccess(tools.db, userId, courseId, new Date(iso));
    expect(await at('2026-04-10T11:59:59.999Z')).toMatchObject({ hasAccess: true, reason: 'ok' });
    expect(await at('2026-04-10T12:00:00.000Z')).toMatchObject({
      hasAccess: false,
      reason: 'expired',
    });
    expect(await at('2026-01-10T12:00:00.000Z')).toMatchObject({ hasAccess: true, reason: 'ok' });
  });

  it('sem matrícula: no_access', async () => {
    const userId = await newUser();
    const { courseId } = await newCourse();
    expect(await resolveAccess(tools.db, userId, courseId, T0)).toEqual({
      hasAccess: false,
      reason: 'no_access',
      anchorAt: null,
      expiresAt: null,
    });
  });

  it('vários direitos (um expirado, um válido): acesso até a maior expiração', async () => {
    const userId = await newUser();
    const { courseId } = await newCourse();
    await grantEntitlement(
      tools.db,
      grant({ userId, courseId, accessMonths: 1, sourceRef: 'curto' }),
    );
    await grantEntitlement(
      tools.db,
      grant({
        userId,
        courseId,
        accessMonths: 12,
        sourceRef: 'longo',
        startsAt: new Date('2026-02-01T00:00:00Z'),
      }),
    );
    const result = await resolveAccess(
      tools.db,
      userId,
      courseId,
      new Date('2026-06-01T00:00:00Z'),
    );
    expect(result).toMatchObject({ hasAccess: true, reason: 'ok' });
    expect(result.expiresAt!.toISOString()).toBe('2027-02-01T00:00:00.000Z');
  });

  it('direito revogado não conta; revogar recalcula a matrícula na mesma transação', async () => {
    const userId = await newUser();
    const { courseId } = await newCourse();
    const { entitlementId } = await grantEntitlement(tools.db, grant({ userId, courseId }));
    expect(
      await revokeEntitlement(tools.db, {
        entitlementId,
        reason: 'reembolso',
        actorId: null,
        now: T0,
      }),
    ).toEqual({ revoked: true });
    expect(await resolveAccess(tools.db, userId, courseId, T0)).toMatchObject({
      hasAccess: false,
      reason: 'no_access',
      expiresAt: null,
    });
    const [enrol] = await enrollmentRows(userId, courseId);
    expect(enrol!.effectiveExpiresAt).toBeNull();
    // revogar de novo é um no-op e não duplica a auditoria
    expect(
      await revokeEntitlement(tools.db, {
        entitlementId,
        reason: 'de novo',
        actorId: null,
        now: T0,
      }),
    ).toEqual({ revoked: false });
    const audit = (await tools.db.select().from(schema.auditLog)).filter(
      (row) => row.targetId === entitlementId,
    );
    expect(audit.map((row) => row.action).sort()).toEqual([
      'entitlement.grant',
      'entitlement.revoke',
    ]);
    await expect(
      revokeEntitlement(tools.db, {
        entitlementId: crypto.randomUUID(),
        reason: 'x',
        actorId: null,
        now: T0,
      }),
    ).rejects.toBeInstanceOf(EntitlementNotFoundError);
  });

  it('pessoa com conta suspensa ou matrícula suspensa: suspended, mesmo com direito válido', async () => {
    const userId = await newUser();
    const { courseId } = await newCourse();
    await grantEntitlement(tools.db, grant({ userId, courseId }));
    const soon = new Date('2026-02-01T00:00:00Z');
    expect(await resolveAccess(tools.db, userId, courseId, soon)).toMatchObject({ reason: 'ok' });

    await tools.db.insert(schema.userSuspension).values({ userId, reason: 'teste' });
    expect(await resolveAccess(tools.db, userId, courseId, soon)).toMatchObject({
      hasAccess: false,
      reason: 'suspended',
    });
    await tools.db
      .update(schema.userSuspension)
      .set({ liftedAt: new Date() })
      .where(eq(schema.userSuspension.userId, userId));
    expect(await resolveAccess(tools.db, userId, courseId, soon)).toMatchObject({ reason: 'ok' });

    await tools.db
      .update(schema.enrollment)
      .set({ suspendedAt: new Date(), suspendedReason: 'teste' })
      .where(eq(schema.enrollment.userId, userId));
    expect(await resolveAccess(tools.db, userId, courseId, soon)).toMatchObject({
      hasAccess: false,
      reason: 'suspended',
    });
  });

  it('nova concessão DEPOIS de expirar mantém a âncora original (o drip continua)', async () => {
    const userId = await newUser();
    const { courseId } = await newCourse();
    await grantEntitlement(tools.db, grant({ userId, courseId, sourceRef: 'primeira' }));
    const later = new Date('2027-03-01T00:00:00Z');
    expect(await resolveAccess(tools.db, userId, courseId, later)).toMatchObject({
      hasAccess: false,
      reason: 'expired',
    });
    const again = await grantEntitlement(
      tools.db,
      grant({ userId, courseId, sourceRef: 'segunda', startsAt: later }),
    );
    expect(again.anchorAt.toISOString()).toBe('2026-01-10T12:00:00.000Z');
    const result = await resolveAccess(tools.db, userId, courseId, later);
    expect(result).toMatchObject({ hasAccess: true, reason: 'ok' });
    expect(result.anchorAt!.toISOString()).toBe('2026-01-10T12:00:00.000Z');
    expect(await enrollmentRows(userId, courseId)).toHaveLength(1);
  });

  it('o direito é por (pessoa, curso): acesso a um curso não vale para o outro nem para outra pessoa', async () => {
    const one = await newUser();
    const two = await newUser();
    const a = await newCourse('curso-a');
    const b = await newCourse('curso-b');
    await grantEntitlement(tools.db, grant({ userId: one, courseId: a.courseId }));
    const soon = new Date('2026-02-01T00:00:00Z');
    expect((await resolveAccess(tools.db, one, a.courseId, soon)).hasAccess).toBe(true);
    expect((await resolveAccess(tools.db, one, b.courseId, soon)).hasAccess).toBe(false);
    expect((await resolveAccess(tools.db, two, a.courseId, soon)).hasAccess).toBe(false);
  });
});

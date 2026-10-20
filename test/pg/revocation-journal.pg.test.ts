import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { parseRevocationEntry, revocationLogKey } from '../../src/features/ops/revocation-log.ts';
import { grantEntitlement, revokeEntitlement } from '../../src/server/access/entitlement-store.ts';
import {
  reinstateEnrollment,
  suspendEnrollment,
} from '../../src/server/access/manual-enrollment.ts';
import { grantRole, liftSuspension, suspendUser } from '../../src/server/auth/access-store.ts';
import { revokeCertificate } from '../../src/server/certificate/lifecycle-store.ts';
import { createMemoryStorage } from '../../src/server/media/memory-storage.ts';
import { loadOperationsSnapshot } from '../../src/server/ops/operations-store.ts';
import {
  exportRevocations,
  hasPendingRevocationExport,
} from '../../src/server/ops/revocation-export.ts';
import { replayRevocations } from '../../src/server/ops/revocation-replay.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createDemoCourse, type DemoFixture } from '../helpers/demo-course.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M9-05 (ADR 0034) em Postgres 18 real: o registro das revogações FORA do banco. Um gatilho em `audit_log` cria uma linha do
 * diário por revogação ou suspensão, por qualquer caminho; o job exporta para o R2 (aqui, memória); a reaplicação
 * devolve o estado depois de uma restauração (a cópia restaurada ainda tem tudo ativo).
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const DAY = 86_400_000;

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let demo: DemoFixture;
let seq = 0;

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
  demo = await createDemoCourse(tools.db);
}, 120_000);
afterAll(async () => {
  await tools.close();
  await database.drop();
});

/** Uma pessoa com matrícula, direito ativo e um certificado `ready`. */
async function person() {
  seq += 1;
  const user = tools.test.createUser({ email: `rev${seq}@example.test`, name: `Rev ${seq}` });
  await tools.test.saveUser(user);
  const id = user.id as string;
  const granted = await grantEntitlement(tools.db, {
    userId: id,
    courseId: demo.courseId,
    offerId: demo.offerId,
    source: 'free_offer',
    sourceRef: `free:${id}:${demo.offerId}:0`,
    accessMonths: 3,
    startsAt: new Date(Date.now() - 10 * DAY),
    grantedBy: id,
  });
  const [entitlementRow] = await tools.db
    .select({ id: schema.entitlement.id })
    .from(schema.entitlement)
    .where(eq(schema.entitlement.userId, id));
  await tools.db
    .insert(schema.courseCompletion)
    .values({ userId: id, courseId: demo.courseId, requiredTotal: 5 });
  const [cert] = await tools.db
    .insert(schema.certificate)
    .values({
      userId: id,
      courseId: demo.courseId,
      code: `r${String(seq).padStart(21, 'x')}`,
      status: 'ready',
      snapshot: { version: 1, holderName: `Rev ${seq}` },
      pdfKey: `certificates/${crypto.randomUUID()}.pdf`,
      pdfSha256: 'a'.repeat(64),
      readyAt: new Date(),
    })
    .returning({ id: schema.certificate.id });
  void granted;
  return { id, entitlementId: entitlementRow!.id, certificateId: cert!.id };
}

const journalOf = async (targetId: string) =>
  (
    (await tools.db.execute(
      sql`select * from revocation_journal where target_id = ${targetId} order by audit_id`,
    )) as unknown as { rows: Record<string, any>[] }
  ).rows;

describe('o gatilho registra toda revogação e suspensão, por qualquer caminho', () => {
  it('certificado, direito, matrícula e conta: uma linha cada, só com ids, ação, categoria e instante', async () => {
    const p = await person();
    const admin = await person();

    await revokeCertificate(tools.db, {
      actorId: admin.id,
      certificateId: p.certificateId,
      category: 'issued_in_error',
      note: 'Nota interna com o CPF 123.456.789-09 da pessoa',
    });
    await revokeEntitlement(tools.db, {
      entitlementId: p.entitlementId,
      reason: 'Motivo livre escrito pela Staff',
      actorId: admin.id,
      now: new Date(),
    });
    await suspendEnrollment(tools.db, {
      actorId: admin.id,
      userId: p.id,
      courseId: demo.courseId,
      reason: 'Motivo da suspensão da matrícula',
    });
    await reinstateEnrollment(tools.db, {
      actorId: admin.id,
      userId: p.id,
      courseId: demo.courseId,
    });
    await suspendUser(tools.db, {
      actorId: admin.id,
      targetId: p.id,
      reason: 'Motivo da suspensão da conta',
    });
    await liftSuspension(tools.db, { actorId: admin.id, targetId: p.id });

    const cert = await journalOf(p.certificateId);
    expect(cert).toHaveLength(1);
    expect(cert[0]).toMatchObject({
      action: 'certificate.revoke',
      category: 'issued_in_error',
      exported_at: null,
    });

    const dir = await journalOf(p.entitlementId);
    expect(dir[0]).toMatchObject({
      action: 'entitlement.revoke',
      user_id: p.id,
      course_id: demo.courseId,
    });

    const enrollmentKey = `${demo.courseId}:${p.id}`;
    const enr = await journalOf(enrollmentKey);
    expect(enr.map((row) => row.action)).toEqual(['enrollment.suspend', 'enrollment.reinstate']);
    expect(enr[0]).toMatchObject({ user_id: p.id, course_id: demo.courseId });

    const acc = await journalOf(p.id);
    expect(acc.map((row) => row.action)).toEqual(['account.suspend', 'account.reactivate']);
    expect(acc[0]).toMatchObject({ user_id: p.id });

    // O diário NUNCA leva o motivo, a nota nem texto livre.
    const text = JSON.stringify([cert, dir, enr, acc]);
    for (const secret of ['123.456.789-09', 'Motivo livre', 'Motivo da suspensão', 'Nota interna'])
      expect(text).not.toContain(secret);
  });

  it('ação que não é revogação não entra no diário', async () => {
    const before = Number(
      (
        (await tools.db.execute(
          sql`select count(*)::int as n from revocation_journal`,
        )) as unknown as { rows: { n: number }[] }
      ).rows[0]?.n,
    );
    const target = await person();
    await grantRole(tools.db, { actorId: null, targetId: target.id, role: 'support' });
    const after = Number(
      (
        (await tools.db.execute(
          sql`select count(*)::int as n from revocation_journal`,
        )) as unknown as { rows: { n: number }[] }
      ).rows[0]?.n,
    );
    expect(after).toBe(before);
  });

  it('o banco recusa ação fora da lista e exportação pela metade', async () => {
    await expect(
      tools.db.execute(
        sql`insert into revocation_journal (audit_id, action, target_id, occurred_at) values (999999, 'role.grant', 'x', now())`,
      ),
    ).rejects.toThrow();
    await expect(
      tools.db.execute(
        sql`insert into revocation_journal (audit_id, action, target_id, occurred_at, exported_at) values (999998, 'account.suspend', 'x', now(), now())`,
      ),
    ).rejects.toThrow();
  });
});

describe('exportação para o R2', () => {
  it('um objeto por ação, na ordem da auditoria, sem texto livre; repetir não exporta de novo e o painel enxerga a pendência', async () => {
    const p = await person();
    await revokeEntitlement(tools.db, {
      entitlementId: p.entitlementId,
      reason: 'Motivo livre XYZ',
      actorId: null,
      now: new Date(),
    });
    expect(await hasPendingRevocationExport(tools.db)).toBe(true);
    expect(
      (await loadOperationsSnapshot(tools.db)).revocationExport.pending,
    ).toBeGreaterThanOrEqual(1);

    const storage = createMemoryStorage();
    const first = await exportRevocations(tools.db, storage);
    expect(first.failed).toBe(0);
    expect(first.exported).toBeGreaterThanOrEqual(1);
    expect(await hasPendingRevocationExport(tools.db)).toBe(false);
    expect((await loadOperationsSnapshot(tools.db)).revocationExport).toEqual({
      pending: 0,
      oldestAgeSeconds: null,
    });

    const [row] = await journalOf(p.entitlementId);
    const key = revocationLogKey({ auditId: Number(row!.audit_id), action: 'entitlement.revoke' });
    expect(row).toMatchObject({ export_key: key });
    expect(storage.contentTypeOf('private', key)).toBe('application/json');
    const object = JSON.parse(new TextDecoder().decode((await storage.read('private', key))!));
    expect(parseRevocationEntry(object)).toMatchObject({
      action: 'entitlement.revoke',
      targetId: p.entitlementId,
      userId: p.id,
      courseId: demo.courseId,
    });
    expect(JSON.stringify(object)).not.toContain('Motivo livre');

    expect((await exportRevocations(tools.db, storage)).exported).toBe(0);
  });

  it('falha do R2 numa linha deixa as outras seguirem; a que falhou sai no ciclo seguinte', async () => {
    const a = await person();
    const b = await person();
    await revokeEntitlement(tools.db, {
      entitlementId: a.entitlementId,
      reason: 'a',
      actorId: null,
      now: new Date(),
    });
    await revokeEntitlement(tools.db, {
      entitlementId: b.entitlementId,
      reason: 'b',
      actorId: null,
      now: new Date(),
    });

    const storage = createMemoryStorage();
    const realPut = storage.put.bind(storage);
    let failures = 1;
    storage.put = async (bucket, key, body, type) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('R2 fora do ar');
      }
      return realPut(bucket, key, body, type);
    };
    const first = await exportRevocations(tools.db, storage);
    expect(first.failed).toBe(1);
    expect(first.exported).toBeGreaterThanOrEqual(1);
    expect(await hasPendingRevocationExport(tools.db)).toBe(true);

    const second = await exportRevocations(tools.db, storage);
    expect(second).toMatchObject({ failed: 0, exported: 1 });
    expect(await hasPendingRevocationExport(tools.db)).toBe(false);
  });
});

describe('reaplicar depois de restaurar', () => {
  const entryFor = (
    auditId: number,
    action: string,
    targetId: string,
    extra: Record<string, unknown> = {},
  ) =>
    parseRevocationEntry({
      version: 1,
      auditId,
      action,
      targetId,
      userId: null,
      courseId: null,
      category: null,
      occurredAt: '2026-10-19T12:00:00.000Z',
      ...extra,
    })!;

  it('a cópia restaurada tem tudo ativo: a reaplicação revoga, suspende e respeita o último evento; repetir não muda nada', async () => {
    const p = await person();
    const q = await person();
    const absentUser = crypto.randomUUID();
    const entries = [
      entryFor(1, 'certificate.revoke', p.certificateId, { category: 'wrong_data' }),
      entryFor(2, 'entitlement.revoke', p.entitlementId, { userId: p.id, courseId: demo.courseId }),
      entryFor(3, 'account.suspend', p.id, { userId: p.id }),
      // Suspensa e levantada: o estado final é ATIVA, não pode voltar a bloquear.
      entryFor(4, 'account.suspend', q.id, { userId: q.id }),
      entryFor(5, 'account.reactivate', q.id, { userId: q.id }),
      entryFor(6, 'enrollment.suspend', `${demo.courseId}:${q.id}`, {
        userId: q.id,
        courseId: demo.courseId,
      }),
      entryFor(7, 'entitlement.revoke', crypto.randomUUID()),
      entryFor(8, 'account.suspend', absentUser, { userId: absentUser }),
    ];

    const dry = await replayRevocations(tools.db, entries, { execute: false });
    expect(dry).toMatchObject({ applied: 4, absent: 2, alreadyDone: 1, steps: 7 });
    expect(
      (
        await tools.db
          .select()
          .from(schema.certificate)
          .where(eq(schema.certificate.id, p.certificateId))
      )[0]?.status,
    ).toBe('ready');

    const real = await replayRevocations(tools.db, entries, { execute: true });
    expect(real).toMatchObject({ applied: 4, absent: 2 });

    const [cert] = await tools.db
      .select()
      .from(schema.certificate)
      .where(eq(schema.certificate.id, p.certificateId));
    expect(cert).toMatchObject({ status: 'revoked', revocationCategory: 'wrong_data' });
    const [dir] = await tools.db
      .select()
      .from(schema.entitlement)
      .where(eq(schema.entitlement.id, p.entitlementId));
    expect(dir?.revokedAt).not.toBeNull();
    const activeSuspensions = async (id: string) =>
      (
        await tools.db
          .select()
          .from(schema.userSuspension)
          .where(eq(schema.userSuspension.userId, id))
      ).filter((row) => row.liftedAt === null);
    expect(await activeSuspensions(p.id)).toHaveLength(1);
    expect(await activeSuspensions(q.id)).toHaveLength(0);
    const [enr] = await tools.db
      .select()
      .from(schema.enrollment)
      .where(eq(schema.enrollment.userId, q.id));
    expect(enr?.suspendedAt).not.toBeNull();

    const again = await replayRevocations(tools.db, entries, { execute: true });
    expect(again.applied).toBe(0);
    expect(again.alreadyDone).toBeGreaterThanOrEqual(4);
    expect(await activeSuspensions(p.id)).toHaveLength(1);

    const audits = await tools.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'restore.revocation_reapplied'));
    expect(audits.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(audits)).not.toContain('example.test');
  });
});

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type OpenDatabase } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';
import { CERTIFICATE_CODE_PATTERN } from '../../src/features/certificate/certificate.ts';
import { PermanentError, TransientError } from '../../src/server/async/handler-types.ts';
import {
  grantEntitlement,
  revokeEntitlementIn,
} from '../../src/server/access/entitlement-store.ts';
import {
  CertificateRenderRejectedError,
  CertificateRenderTransientError,
  createCertificateRenderHandler,
  issueCertificateIn,
  issuePendingCertificates,
  retryCertificate,
  setCertificatePolicy,
  type CertificateRenderer,
} from '../../src/server/certificate/certificate-store.ts';
import { completeLesson } from '../../src/server/learning/completion.ts';
import { createDemoCourse, type DemoFixture } from '../helpers/demo-course.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M7-01 em Postgres 18 real: a conclusão do curso cria UM certificado e UMA intenção `certificate.render` na mesma
 * transação (só o vencedor do insert), com a política ligada; falha de PDF nunca remove a conclusão nem duplica o
 * certificado. O renderer do M7-02 é uma porta: aqui, um roteirizado.
 */
const T0 = new Date('2026-10-11T12:00:00.000Z');
/** Todos os módulos do demonstrativo (D+0, D+7, D+14) já liberados pelo drip. */
const LATE = new Date('2026-10-30T12:00:00.000Z');
const REQUIRED = [
  'Boas-vindas',
  'Como estudar aqui',
  'Conceito central',
  'Revisão',
  'Próximos passos',
];

let database: TestSchema;
let main: OpenDatabase;
let seq = 0;

beforeAll(async () => {
  database = await createTestSchema();
  main = await openDatabase(database.connectionString);
});
afterAll(async () => {
  await main.close();
  await database.drop();
});
beforeEach(async () => {
  await main.db.execute(
    sql`truncate table certificate, certificate_policy, course_completion, lesson_completion, entitlement, enrollment, outbox_message, lesson, module, lesson_draft, module_draft, course_content, course_draft, curriculum_state, offer, course cascade`,
  );
  await main.db.delete(schema.user);
});

async function demo(): Promise<DemoFixture & { lessonByTitle: Record<string, string> }> {
  const fixture = await createDemoCourse(main.db);
  const rows = await main.db
    .select({ id: schema.lesson.id, title: schema.lesson.title })
    .from(schema.lesson)
    .where(eq(schema.lesson.courseId, fixture.courseId));
  return {
    ...fixture,
    lessonByTitle: Object.fromEntries(rows.map((row) => [row.title, row.id])),
  };
}

async function student(fixture: DemoFixture, options: { certificateName?: string } = {}) {
  seq += 1;
  const id = `aluna-${seq}-${crypto.randomUUID()}`;
  await main.db.insert(schema.user).values({
    id,
    name: `Aluna ${seq}`,
    email: `aluna${seq}-${crypto.randomUUID()}@example.test`,
  });
  if (options.certificateName) {
    await main.db
      .update(schema.profile)
      .set({ certificateName: options.certificateName })
      .where(eq(schema.profile.userId, id));
  }
  await grantEntitlement(main.db, {
    userId: id,
    courseId: fixture.courseId,
    offerId: fixture.offerId,
    source: 'free_offer',
    sourceRef: `free:${id}:${fixture.offerId}:0`,
    accessMonths: 12,
    startsAt: T0,
    grantedBy: id,
  });
  return id;
}

const finishCourse = async (
  fixture: Awaited<ReturnType<typeof demo>>,
  userId: string,
  db = main.db,
) => {
  for (const title of REQUIRED) {
    await completeLesson(db, {
      userId,
      lessonId: fixture.lessonByTitle[title]!,
      clock: () => LATE,
    });
  }
};

const certificates = () => main.db.select().from(schema.certificate);
const intents = () =>
  main.db
    .select()
    .from(schema.outboxMessage)
    .where(eq(schema.outboxMessage.kind, 'certificate.render'));
const completions = () => main.db.select().from(schema.courseCompletion);

const okRenderer = (calls: string[] = []): CertificateRenderer => ({
  async render({ certificateId, code }) {
    calls.push(certificateId);
    return { pdfKey: `certificates/${certificateId}/${code}.pdf`, pdfSha256: 'a'.repeat(64) };
  },
});

function context(certificateId: string) {
  return {
    db: main.db,
    payload: { certificateId },
    intentId: crypto.randomUUID(),
    correlationId: `certificate:${certificateId}`,
    idempotencyKey: `certificate:${certificateId}`,
    attempt: 1,
  };
}

describe('emissão pela conclusão do curso', () => {
  it('com a política desligada (padrão), a conclusão existe e nenhum certificado nasce', async () => {
    const fixture = await demo();
    const userId = await student(fixture);
    await finishCourse(fixture, userId);
    expect(await completions()).toHaveLength(1);
    expect(await certificates()).toHaveLength(0);
    expect(await intents()).toHaveLength(0);
  });

  it('com a política ligada: UM certificado queued, UMA intenção só com o id, snapshot congelado e código opaco', async () => {
    const fixture = await demo();
    const admin = await student(fixture);
    await setCertificatePolicy(main.db, {
      actorId: admin,
      courseId: fixture.courseId,
      enabled: true,
    });
    const userId = await student(fixture, { certificateName: 'Ana Maria de Souza' });
    await finishCourse(fixture, userId);

    const [row] = await certificates();
    expect(await certificates()).toHaveLength(1);
    expect(row).toMatchObject({
      userId,
      courseId: fixture.courseId,
      status: 'queued',
      pdfKey: null,
    });
    expect(row!.code).toMatch(CERTIFICATE_CODE_PATTERN);
    expect(row!.snapshot).toMatchObject({
      version: 1,
      holderName: 'Ana Maria de Souza',
      requiredTotal: 5,
      completedAt: LATE.toISOString(),
    });
    expect(Object.keys(row!.snapshot as object).sort()).toEqual([
      'completedAt',
      'courseTitle',
      'holderName',
      'issuer',
      'requiredTotal',
      'signatory',
      'version',
      'workloadHours',
    ]);
    const found = await intents();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      dedupeKey: `certificate:${row!.id}`,
      queue: 'general',
      payload: { certificateId: row!.id },
    });
    // o payload leva SÓ o id: nem nome, nem código, nem e-mail
    expect(JSON.stringify(found[0]!.payload)).not.toContain('Ana');
    expect(JSON.stringify(found[0]!.payload)).not.toContain(row!.code);
  });

  it('sem nome confirmado, usa o nome de exibição do perfil', async () => {
    const fixture = await demo();
    const admin = await student(fixture);
    await setCertificatePolicy(main.db, {
      actorId: admin,
      courseId: fixture.courseId,
      enabled: true,
    });
    const userId = await student(fixture);
    await finishCourse(fixture, userId);
    const [profileRow] = await main.db
      .select()
      .from(schema.profile)
      .where(eq(schema.profile.userId, userId));
    const [row] = await certificates().then((all) => all.filter((item) => item.userId === userId));
    expect((row!.snapshot as { holderName: string }).holderName).toBe(profileRow!.displayName);
  });

  it('duas conclusões SIMULTÂNEAS da última aula (conexões separadas): 1 conclusão, 1 certificado, 1 intenção', async () => {
    const fixture = await demo();
    const admin = await student(fixture);
    await setCertificatePolicy(main.db, {
      actorId: admin,
      courseId: fixture.courseId,
      enabled: true,
    });
    const userId = await student(fixture);
    for (const title of REQUIRED.slice(0, -1)) {
      await completeLesson(main.db, {
        userId,
        lessonId: fixture.lessonByTitle[title]!,
        clock: () => LATE,
      });
    }
    const other = await openDatabase(database.connectionString);
    try {
      const last = fixture.lessonByTitle[REQUIRED.at(-1)!]!;
      await Promise.all([
        completeLesson(main.db, { userId, lessonId: last, clock: () => LATE }),
        completeLesson(other.db, { userId, lessonId: last, clock: () => LATE }),
      ]);
    } finally {
      await other.close();
    }
    expect(await completions()).toHaveLength(1);
    expect(await certificates()).toHaveLength(1);
    expect(await intents()).toHaveLength(1);
  });

  it('concluir de novo (aula já concluída) não cria outro certificado nem outra intenção', async () => {
    const fixture = await demo();
    const admin = await student(fixture);
    await setCertificatePolicy(main.db, {
      actorId: admin,
      courseId: fixture.courseId,
      enabled: true,
    });
    const userId = await student(fixture);
    await finishCourse(fixture, userId);
    await finishCourse(fixture, userId);
    expect(await certificates()).toHaveLength(1);
    expect(await intents()).toHaveLength(1);
  });

  it('aula obrigatória pendente impede a conclusão e, portanto, o certificado', async () => {
    const fixture = await demo();
    const admin = await student(fixture);
    await setCertificatePolicy(main.db, {
      actorId: admin,
      courseId: fixture.courseId,
      enabled: true,
    });
    const userId = await student(fixture);
    for (const title of REQUIRED.slice(0, -1)) {
      await completeLesson(main.db, {
        userId,
        lessonId: fixture.lessonByTitle[title]!,
        clock: () => LATE,
      });
    }
    expect(await completions()).toHaveLength(0);
    expect(await certificates()).toHaveLength(0);
  });

  it('perder o acesso depois da conclusão (direito revogado) não apaga o certificado', async () => {
    const fixture = await demo();
    const admin = await student(fixture);
    await setCertificatePolicy(main.db, {
      actorId: admin,
      courseId: fixture.courseId,
      enabled: true,
    });
    const userId = await student(fixture);
    await finishCourse(fixture, userId);
    const [grant] = await main.db
      .select()
      .from(schema.entitlement)
      .where(eq(schema.entitlement.userId, userId));
    await main.db.transaction((tx) =>
      revokeEntitlementIn(tx, {
        entitlementId: grant!.id,
        reason: 'teste',
        actorId: null,
        now: LATE,
      }),
    );
    expect(await certificates()).toHaveLength(1);
  });
});

describe('dado que não cabe no certificado', () => {
  it('snapshot inválido (título gigante): nenhum certificado nasce, a transação segue e a falha fica na auditoria', async () => {
    const fixture = await demo();
    const admin = await student(fixture);
    await setCertificatePolicy(main.db, {
      actorId: admin,
      courseId: fixture.courseId,
      enabled: true,
    });
    const userId = await student(fixture);
    const id = await main.db.transaction((tx) =>
      issueCertificateIn(tx, {
        userId,
        courseId: fixture.courseId,
        completedAt: LATE,
        requiredTotal: 5,
        courseTitle: 'x'.repeat(300),
        workloadHours: 10,
      }),
    );
    expect(id).toBeNull();
    expect(await certificates()).toHaveLength(0);
    expect(await intents()).toHaveLength(0);
    const audits = await main.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, fixture.courseId));
    expect(audits.map((item) => item.action)).toContain('certificate.issue_failed');
  });
});

describe('política e emissão de pendentes', () => {
  it('ligar e desligar grava auditoria; curso inexistente é recusado', async () => {
    const fixture = await demo();
    const admin = await student(fixture);
    await setCertificatePolicy(main.db, {
      actorId: admin,
      courseId: fixture.courseId,
      enabled: true,
    });
    await setCertificatePolicy(main.db, {
      actorId: admin,
      courseId: fixture.courseId,
      enabled: false,
    });
    const audits = await main.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, fixture.courseId));
    const actions = audits.map((item) => item.action);
    expect(actions).toContain('certificate.policy.enable');
    expect(actions).toContain('certificate.policy.disable');
    await expect(
      setCertificatePolicy(main.db, {
        actorId: admin,
        courseId: crypto.randomUUID(),
        enabled: true,
      }),
    ).rejects.toBeInstanceOf(PermanentError);
  });

  it('"emitir pendentes" cria o certificado das conclusões antigas UMA vez (repetir é no-op) e só com a política ligada', async () => {
    const fixture = await demo();
    const admin = await student(fixture);
    const a = await student(fixture);
    const b = await student(fixture);
    await finishCourse(fixture, a);
    await finishCourse(fixture, b);
    expect(await certificates()).toHaveLength(0);

    const input = {
      actorId: admin,
      courseId: fixture.courseId,
      courseTitle: 'Curso demonstrativo',
      workloadHours: 10,
    };
    // política desligada: nada nasce
    expect(await issuePendingCertificates(main.db, input)).toEqual({ issued: 0, skipped: 2 });
    expect(await certificates()).toHaveLength(0);

    await setCertificatePolicy(main.db, {
      actorId: admin,
      courseId: fixture.courseId,
      enabled: true,
    });
    expect(await issuePendingCertificates(main.db, input)).toEqual({ issued: 2, skipped: 0 });
    expect(await certificates()).toHaveLength(2);
    expect(await intents()).toHaveLength(2);
    expect(await issuePendingCertificates(main.db, input)).toEqual({ issued: 0, skipped: 0 });
    expect(await certificates()).toHaveLength(2);
    expect(await intents()).toHaveLength(2);
    const audits = (
      await main.db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.targetId, fixture.courseId))
    ).map((item) => item.action);
    expect(audits).toContain('certificate.issue_pending');
  });
});

describe('renderização (handler do certificate.render)', () => {
  async function queued() {
    const fixture = await demo();
    const admin = await student(fixture);
    await setCertificatePolicy(main.db, {
      actorId: admin,
      courseId: fixture.courseId,
      enabled: true,
    });
    const userId = await student(fixture);
    await finishCourse(fixture, userId);
    const [row] = await certificates().then((all) => all.filter((item) => item.userId === userId));
    return { fixture, userId, certificateId: row!.id };
  }
  const statusOf = async (id: string) =>
    (await main.db.select().from(schema.certificate).where(eq(schema.certificate.id, id)))[0]!;

  it('renderer ok: vai a ready com a chave e o hash; a MESMA mensagem 2× chama o renderer UMA vez', async () => {
    const { certificateId } = await queued();
    const calls: string[] = [];
    const handler = createCertificateRenderHandler({ renderer: okRenderer(calls) });
    await handler(context(certificateId));
    await handler(context(certificateId));
    const row = await statusOf(certificateId);
    expect(row.status).toBe('ready');
    expect(row.pdfSha256).toBe('a'.repeat(64));
    expect(row.pdfKey).toBe(`certificates/${certificateId}/${row.code}.pdf`);
    expect(row.readyAt).not.toBeNull();
    expect(row.renderAttempts).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it('sem renderer configurado: failed com código claro, PermanentError, conclusão intacta; "tentar de novo" volta a queued sem outro certificado', async () => {
    const { certificateId } = await queued();
    await expect(createCertificateRenderHandler({})(context(certificateId))).rejects.toThrow(
      'renderer_not_configured',
    );
    expect((await statusOf(certificateId)).status).toBe('failed');
    expect((await statusOf(certificateId)).failureCode).toBe('renderer_not_configured');
    expect(await completions()).toHaveLength(1);
    expect(await certificates()).toHaveLength(1);

    expect(await retryCertificate(main.db, { actorId: 'x', certificateId })).toBe('requeued');
    expect((await statusOf(certificateId)).status).toBe('queued');
    expect((await statusOf(certificateId)).failureCode).toBeNull();
    expect(await certificates()).toHaveLength(1);
    expect(await intents()).toHaveLength(2);
    expect(await retryCertificate(main.db, { actorId: 'x', certificateId })).toBe('not_failed');
    expect(
      await retryCertificate(main.db, { actorId: 'x', certificateId: crypto.randomUUID() }),
    ).toBe('not_found');

    await createCertificateRenderHandler({ renderer: okRenderer() })(context(certificateId));
    expect((await statusOf(certificateId)).status).toBe('ready');
  });

  it('falha transitória do renderer: volta a queued e lança TransientError (a outbox repete); a conclusão fica', async () => {
    const { certificateId } = await queued();
    const flaky: CertificateRenderer = {
      async render() {
        throw new CertificateRenderTransientError('browser_run_timeout');
      },
    };
    await expect(
      createCertificateRenderHandler({ renderer: flaky })(context(certificateId)),
    ).rejects.toBeInstanceOf(TransientError);
    expect((await statusOf(certificateId)).status).toBe('queued');
    expect(await completions()).toHaveLength(1);
    await createCertificateRenderHandler({ renderer: okRenderer() })(context(certificateId));
    expect((await statusOf(certificateId)).status).toBe('ready');
    expect((await statusOf(certificateId)).renderAttempts).toBe(2);
  });

  it('erro desconhecido do renderer não vaza a mensagem e é tratado como transitório', async () => {
    const { certificateId } = await queued();
    const broken: CertificateRenderer = {
      async render() {
        throw new Error('segredo-que-nao-pode-vazar');
      },
    };
    const failure = await createCertificateRenderHandler({ renderer: broken })(
      context(certificateId),
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TransientError);
    expect(String((failure as Error).message)).not.toContain('segredo');
    expect((await statusOf(certificateId)).status).toBe('queued');
  });

  it('rejeição definitiva do renderer: failed com o código e PermanentError', async () => {
    const { certificateId } = await queued();
    const rejecting: CertificateRenderer = {
      async render() {
        throw new CertificateRenderRejectedError('not_a_pdf');
      },
    };
    await expect(
      createCertificateRenderHandler({ renderer: rejecting })(context(certificateId)),
    ).rejects.toBeInstanceOf(PermanentError);
    const row = await statusOf(certificateId);
    expect(row).toMatchObject({ status: 'failed', failureCode: 'not_a_pdf' });
  });

  it('certificado revogado ou substituído nunca é renderizado de novo; id inexistente é falha permanente', async () => {
    const { certificateId } = await queued();
    await main.db.execute(
      sql`update certificate set status = 'revoked' where id = ${certificateId}`,
    );
    const calls: string[] = [];
    await createCertificateRenderHandler({ renderer: okRenderer(calls) })(context(certificateId));
    expect(calls).toHaveLength(0);
    expect((await statusOf(certificateId)).status).toBe('revoked');
    await expect(
      createCertificateRenderHandler({ renderer: okRenderer() })(context(crypto.randomUUID())),
    ).rejects.toThrow('certificate_missing');
  });

  it('awaiting_name nunca renderiza (o nome só é confirmado no M7-07)', async () => {
    const { certificateId } = await queued();
    await main.db.execute(
      sql`update certificate set status = 'awaiting_name' where id = ${certificateId}`,
    );
    await expect(
      createCertificateRenderHandler({ renderer: okRenderer() })(context(certificateId)),
    ).rejects.toThrow('certificate_awaiting_name');
  });
});

describe('restrições do banco', () => {
  async function issued() {
    const fixture = await demo();
    const admin = await student(fixture);
    await setCertificatePolicy(main.db, {
      actorId: admin,
      courseId: fixture.courseId,
      enabled: true,
    });
    const userId = await student(fixture);
    await finishCourse(fixture, userId);
    const [row] = await certificates().then((all) => all.filter((item) => item.userId === userId));
    return row!;
  }
  const attempt = (query: ReturnType<typeof sql>) => main.db.execute(query);

  it('o snapshot, a identidade e o código não mudam; certificado não se apaga', async () => {
    const row = await issued();
    await expect(
      attempt(sql`update certificate set snapshot = '{"version":1}'::jsonb where id = ${row.id}`),
    ).rejects.toThrow();
    await expect(
      attempt(sql`update certificate set code = 'AAAAAAAAAAAAAAAAAAAAAA' where id = ${row.id}`),
    ).rejects.toThrow();
    await expect(
      attempt(sql`update certificate set user_id = 'outra' where id = ${row.id}`),
    ).rejects.toThrow();
    await expect(attempt(sql`delete from certificate where id = ${row.id}`)).rejects.toThrow();
  });

  it('um segundo certificado ORIGINAL da mesma conclusão é impossível; reemissão (com predecessor) é permitida; código é único', async () => {
    const row = await issued();
    await expect(
      main.db.insert(schema.certificate).values({
        userId: row.userId,
        courseId: row.courseId,
        code: 'BBBBBBBBBBBBBBBBBBBBBB',
        snapshot: row.snapshot,
      }),
    ).rejects.toThrow();
    await main.db.insert(schema.certificate).values({
      userId: row.userId,
      courseId: row.courseId,
      code: 'BBBBBBBBBBBBBBBBBBBBBB',
      snapshot: row.snapshot,
      predecessorId: row.id,
    });
    await expect(
      main.db.insert(schema.certificate).values({
        userId: row.userId,
        courseId: row.courseId,
        code: 'BBBBBBBBBBBBBBBBBBBBBB',
        snapshot: row.snapshot,
        predecessorId: row.id,
      }),
    ).rejects.toThrow();
  });

  it('código fora do formato, estado inválido e ready sem PDF são recusados', async () => {
    const row = await issued();
    await expect(
      attempt(sql`update certificate set status = 'inventado' where id = ${row.id}`),
    ).rejects.toThrow();
    await expect(
      attempt(sql`update certificate set status = 'ready' where id = ${row.id}`),
    ).rejects.toThrow();
    await expect(
      attempt(sql`update certificate set pdf_key = 'x' where id = ${row.id}`),
    ).rejects.toThrow();
  });

  it('ready é final (só vai a revoked ou superseded) e o PDF gravado não muda; revogado é final', async () => {
    const row = await issued();
    await createCertificateRenderHandler({ renderer: okRenderer() })(context(row.id));
    await expect(
      attempt(sql`update certificate set status = 'queued' where id = ${row.id}`),
    ).rejects.toThrow();
    await expect(
      attempt(sql`update certificate set pdf_sha256 = ${'b'.repeat(64)} where id = ${row.id}`),
    ).rejects.toThrow();
    await attempt(sql`update certificate set status = 'revoked' where id = ${row.id}`);
    await expect(
      attempt(sql`update certificate set status = 'ready' where id = ${row.id}`),
    ).rejects.toThrow();
  });

  it('nenhuma tabela de certificado guarda imagem ou prévia', async () => {
    const columns = await main.db.execute(
      sql`select column_name from information_schema.columns where table_schema = current_schema() and table_name in ('certificate', 'certificate_policy')`,
    );
    const names = (columns.rows as { column_name: string }[]).map((item) => item.column_name);
    for (const forbidden of ['png', 'preview', 'image', 'bytes', 'pdf_bytes', 'email']) {
      expect(
        names.some((name) => name.includes(forbidden)),
        forbidden,
      ).toBe(false);
    }
  });
});

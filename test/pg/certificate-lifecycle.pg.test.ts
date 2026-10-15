import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type OpenDatabase } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';
import { grantEntitlement } from '../../src/server/access/entitlement-store.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import {
  createCertificateRenderHandler,
  type CertificateRenderer,
} from '../../src/server/certificate/certificate-store.ts';
import { reissueCertificate } from '../../src/server/certificate/lifecycle-store.ts';
import { completeLesson } from '../../src/server/learning/completion.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { createMemoryStorage, type MemoryStorage } from '../../src/server/media/memory-storage.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { enableCertificates } from '../helpers/certificate-template.ts';
import { createDemoCourse } from '../helpers/demo-course.ts';
import { pdfBytes, sha256Hex } from '../helpers/media-bytes.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M7-04 em Postgres 18 real (armazenamento em memória): download do dono com o SHA-256 recalculado, revogação só do
 * Admin com reautenticação, reemissão por grant (um sucessor só, corrida decidida pelo índice), e-mail "certificado
 * emitido" uma vez, lista da Staff. O PDF é um objeto de teste: nenhum Browser Run foi exercitado.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const T0 = new Date('2026-10-11T12:00:00.000Z');
const LATE = new Date('2026-10-30T12:00:00.000Z');
const REQUIRED = [
  'Boas-vindas',
  'Como estudar aqui',
  'Conceito central',
  'Revisão',
  'Próximos passos',
];
const ALL_GRANTS = [
  'course.edit',
  'access.grant',
  'enrollment.support_edit',
  'refund.execute',
  'finance.review',
  'finance.view',
  'certificate.reissue',
  'discussion.moderate',
  'help.edit',
  'audit.view',
  'ops.queue',
];
const NO_CERT_GRANTS = ALL_GRANTS.filter((grant) => grant !== 'certificate.reissue');

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let storage: MemoryStorage;
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
  storage = createMemoryStorage();
  await tools.db.execute(
    sql`truncate table certificate, certificate_template, certificate_policy, certificate_signatory, certificate_issuer, email_message, media_reference, media_asset, outbox_message, course_completion, lesson_completion, entitlement, enrollment, lesson, module, lesson_draft, module_draft, course_content, course_draft, curriculum_state, offer, course cascade`,
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
let withStorage = true;
const app = () =>
  apiApp({
    emailSender: createFakeEmailSender(),
    isStaffEmail: async () => false,
    clock: () => LATE,
    ...(withStorage ? { mediaStorage: storage } : {}),
  });

interface Person {
  id: string;
  headers: Headers;
}
async function newPerson(role?: 'support' | 'admin', grants: string[] = []): Promise<Person> {
  seq += 1;
  const user = tools.test.createUser({ email: `pessoa${seq}@example.test`, name: `Pessoa ${seq}` });
  await tools.test.saveUser(user);
  if (role) await grantRole(tools.db, { actorId: null, targetId: user.id, role });
  for (const capability of grants) {
    await tools.db
      .insert(schema.staffGrant)
      .values({ userId: user.id, capability, grantedBy: user.id });
  }
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

/** Reautenticação recente para a sessão da pessoa (o fluxo real por link tem o teste do M1-05). */
async function reauth(person: Person) {
  await tools.db.execute(
    sql`insert into reauth_proof (session_id, verified_at) select s.id, now() from session s where s.user_id = ${person.id} on conflict (session_id) do update set verified_at = now()`,
  );
}

/** Renderer de teste: guarda um PDF no armazenamento privado e devolve a chave e o hash REAIS dele. */
function storingRenderer(bytes = pdfBytes(900)): CertificateRenderer {
  return {
    async render({ certificateId, code }) {
      const pdfKey = `certificates/${certificateId}/${code}.pdf`;
      await storage.put('private', pdfKey, bytes, 'application/pdf');
      return { pdfKey, pdfSha256: await sha256Hex(bytes) };
    },
  };
}

async function demo() {
  return createDemoCourse(tools.db);
}
async function finishCourse(
  fixture: Awaited<ReturnType<typeof demo>>,
  userId: string,
  db = tools.db,
) {
  const rows = await db
    .select({ id: schema.lesson.id, title: schema.lesson.title })
    .from(schema.lesson)
    .where(eq(schema.lesson.courseId, fixture.courseId));
  const byTitle = Object.fromEntries(rows.map((row) => [row.title, row.id]));
  for (const title of REQUIRED) {
    await completeLesson(db, { userId, lessonId: byTitle[title]!, clock: () => LATE });
  }
}

/** Curso com certificado ligado e UMA aluna que concluiu: devolve o certificado em `queued`. */
async function issued() {
  const fixture = await demo();
  const admin = await newPerson('admin');
  await enableCertificates(tools.db, { actorId: admin.id, courseId: fixture.courseId });
  const holder = await newPerson();
  await grantEntitlement(tools.db, {
    userId: holder.id,
    courseId: fixture.courseId,
    offerId: fixture.offerId,
    source: 'free_offer',
    sourceRef: `free:${holder.id}:${fixture.offerId}:0`,
    accessMonths: 12,
    startsAt: T0,
    grantedBy: holder.id,
  });
  await finishCourse(fixture, holder.id);
  const [row] = await tools.db
    .select()
    .from(schema.certificate)
    .where(eq(schema.certificate.userId, holder.id));
  return { fixture, admin, holder, certificateId: row!.id };
}

const render = (certificateId: string, renderer: CertificateRenderer = storingRenderer()) =>
  createCertificateRenderHandler({ renderer })({
    db: tools.db,
    payload: { certificateId },
    intentId: crypto.randomUUID(),
    correlationId: `certificate:${certificateId}`,
    idempotencyKey: `certificate:${certificateId}`,
    attempt: 1,
  });
const certRow = async (id: string) =>
  (await tools.db.select().from(schema.certificate).where(eq(schema.certificate.id, id)))[0]!;

async function ready() {
  const base = await issued();
  await render(base.certificateId);
  return base;
}

describe('e-mail "certificado emitido"', () => {
  it('ao chegar a ready, UM e-mail transacional para a dona; reprocessar a mensagem não reenvia', async () => {
    const { certificateId, holder } = await issued();
    expect(await tools.db.select().from(schema.emailMessage)).toHaveLength(0);
    await render(certificateId);
    await render(certificateId);
    const mails = await tools.db.select().from(schema.emailMessage);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({
      template: 'certificate-issued',
      recipientUserId: holder.id,
      dedupeKey: `certificate-issued:${certificateId}`,
    });
    expect(mails[0]!.variables).toMatchObject({ CERTIFICATE_ID: certificateId });
  });

  it('a falha do renderer não gera e-mail', async () => {
    const { certificateId } = await issued();
    await expect(
      render(certificateId, {
        async render() {
          throw new Error('x');
        },
      }),
    ).rejects.toThrow();
    expect(await tools.db.select().from(schema.emailMessage)).toHaveLength(0);
  });
});

describe('download do dono', () => {
  it('só o dono baixa o PDF ready, com hash conferido, no-store e nome com o código; sem sessão 401; id torto 404', async () => {
    const { certificateId, holder } = await ready();
    const row = await certRow(certificateId);
    const stranger = await newPerson();
    expect((await call('GET', `/me/certificates/${certificateId}/download`)).status).toBe(401);
    expect((await call('GET', `/me/certificates/xyz/download`, holder.headers)).status).toBe(404);
    expect(
      (await call('GET', `/me/certificates/${certificateId}/download`, stranger.headers)).status,
    ).toBe(404);

    const response = await call(
      'GET',
      `/me/certificates/${certificateId}/download`,
      holder.headers,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="certificado-${row.code}.pdf"`,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(await sha256Hex(bytes)).toBe(row.pdfSha256);
  });

  it('certificado na fila (não ready) não baixa: 404', async () => {
    const { certificateId, holder } = await issued();
    expect(
      (await call('GET', `/me/certificates/${certificateId}/download`, holder.headers)).status,
    ).toBe(404);
  });

  it('objeto ADULTERADO no R2: nada é entregue (503) e a divergência fica na auditoria', async () => {
    const { certificateId, holder } = await ready();
    const row = await certRow(certificateId);
    await storage.put('private', row.pdfKey!, pdfBytes(901), 'application/pdf');
    const response = await call(
      'GET',
      `/me/certificates/${certificateId}/download`,
      holder.headers,
    );
    expect(response.status).toBe(503);
    expect(await json(response)).toEqual({ error: { code: 'certificate_unavailable' } });
    const audits = await tools.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, certificateId));
    expect(audits.map((item) => item.action)).toContain('certificate.integrity_failed');
  });

  it('objeto que sumiu do R2: 503; sem armazenamento configurado: 503', async () => {
    const { certificateId, holder } = await ready();
    const row = await certRow(certificateId);
    await storage.delete('private', row.pdfKey!);
    expect(
      (await call('GET', `/me/certificates/${certificateId}/download`, holder.headers)).status,
    ).toBe(503);
    withStorage = false;
    try {
      expect(
        (await call('GET', `/me/certificates/${certificateId}/download`, holder.headers)).status,
      ).toBe(503);
    } finally {
      withStorage = true;
    }
  });

  it('a lista da pessoa traz só os dela, sem nota interna, motivo nem chave do arquivo', async () => {
    const { certificateId, holder } = await ready();
    const stranger = await newPerson();
    const mine = await json(await call('GET', '/me/certificates', holder.headers));
    expect(mine.certificates).toHaveLength(1);
    expect(mine.certificates[0]).toMatchObject({
      id: certificateId,
      status: 'ready',
      canDownload: true,
      courseTitle: expect.any(String),
    });
    expect(Object.keys(mine.certificates[0]).sort()).toEqual([
      'canDownload',
      'code',
      'courseTitle',
      'id',
      'readyAt',
      'status',
    ]);
    expect(
      (await json(await call('GET', '/me/certificates', stranger.headers))).certificates,
    ).toEqual([]);
    expect((await call('GET', '/me/certificates')).status).toBe(401);
  });
});

describe('revogação (só Admin)', () => {
  const body = { category: 'wrong_data', note: 'Nome escrito errado no certificado' };

  it('matriz: 401 sem sessão; aluna e Suporte (mesmo sem o grant de reemitir e com os outros) 403; Admin sem reautenticação 403', async () => {
    const { certificateId, holder, admin } = await ready();
    const support = await newPerson('support', ALL_GRANTS);
    const path = `/staff/certificates/${certificateId}/revoke`;
    expect((await call('POST', path, undefined, body)).status).toBe(401);
    expect((await call('POST', path, holder.headers, body)).status).toBe(403);
    expect((await call('POST', path, support.headers, body)).status).toBe(403);
    const blocked = await call('POST', path, admin.headers, body);
    expect(blocked.status).toBe(403);
    expect(await json(blocked)).toEqual({ error: { code: 'reauth_required' } });
    expect((await certRow(certificateId)).status).toBe('ready');
  });

  it('com reautenticação revoga: grava quem, quando, categoria e nota; novos downloads falham na hora; o PDF e o snapshot ficam', async () => {
    const { certificateId, holder } = await ready();
    const admin = await newPerson('admin');
    await reauth(admin);
    const before = await certRow(certificateId);
    expect(
      (await call('GET', `/me/certificates/${certificateId}/download`, holder.headers)).status,
    ).toBe(200);
    expect(
      (await call('POST', `/staff/certificates/${certificateId}/revoke`, admin.headers, body))
        .status,
    ).toBe(200);
    const after = await certRow(certificateId);
    expect(after).toMatchObject({
      status: 'revoked',
      revokedBy: admin.id,
      revocationCategory: 'wrong_data',
      revocationNote: 'Nome escrito errado no certificado',
    });
    expect(after.revokedAt).not.toBeNull();
    expect(JSON.stringify(after.snapshot)).toBe(JSON.stringify(before.snapshot));
    expect(after.pdfSha256).toBe(before.pdfSha256);
    expect(
      (await call('GET', `/me/certificates/${certificateId}/download`, holder.headers)).status,
    ).toBe(404);
    // a pessoa vê "revogado" sem a nota interna
    const mine = await json(await call('GET', '/me/certificates', holder.headers));
    expect(mine.certificates[0]).toMatchObject({ status: 'revoked', canDownload: false });
    expect(JSON.stringify(mine)).not.toContain('Nome escrito errado');
    const audits = await tools.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, certificateId));
    expect(audits.map((item) => item.action)).toContain('certificate.revoke');
  });

  it('corpo inválido 400; revogar duas vezes ou o que não está ready 409; id inexistente 404', async () => {
    const { certificateId } = await ready();
    const queued = await issued();
    const admin = await newPerson('admin');
    await reauth(admin);
    const path = (id: string) => `/staff/certificates/${id}/revoke`;
    for (const bad of [
      {},
      { category: 'inventada', note: 'Motivo qualquer válido' },
      { category: 'other', note: 'x' },
      { category: 'other', note: `Nota${String.fromCodePoint(0x202e)}insegura` },
      { category: 'other', note: 'Motivo válido', extra: 1 },
    ]) {
      expect((await call('POST', path(certificateId), admin.headers, bad)).status).toBe(400);
    }
    expect((await call('POST', path(certificateId), admin.headers, body)).status).toBe(200);
    expect((await call('POST', path(certificateId), admin.headers, body)).status).toBe(409);
    expect((await call('POST', path(queued.certificateId), admin.headers, body)).status).toBe(409);
    expect((await call('POST', path(crypto.randomUUID()), admin.headers, body)).status).toBe(404);
  });

  it('o banco recusa revoked sem data e revogado voltar a ready', async () => {
    const { certificateId } = await ready();
    await expect(
      tools.db.execute(sql`update certificate set status = 'revoked' where id = ${certificateId}`),
    ).rejects.toThrow();
    const admin = await newPerson('admin');
    await reauth(admin);
    await call('POST', `/staff/certificates/${certificateId}/revoke`, admin.headers, body);
    await expect(
      tools.db.execute(sql`update certificate set status = 'ready' where id = ${certificateId}`),
    ).rejects.toThrow();
  });
});

describe('reemissão (grant certificate.reissue)', () => {
  const body = { reason: 'Correção do nome pedida pela aluna' };

  it('matriz: 401; aluna 403; Suporte sem o grant 403; Suporte com o grant e Admin 201', async () => {
    const { certificateId, holder } = await ready();
    const noGrant = await newPerson('support', NO_CERT_GRANTS);
    const withGrant = await newPerson('support', ['certificate.reissue']);
    const path = `/staff/certificates/${certificateId}/reissue`;
    expect((await call('POST', path, undefined, body)).status).toBe(401);
    expect((await call('POST', path, holder.headers, body)).status).toBe(403);
    expect((await call('POST', path, noGrant.headers, body)).status).toBe(403);
    expect((await call('POST', path, withGrant.headers, body)).status).toBe(201);
    const second = await ready();
    const admin = await newPerson('admin');
    expect(
      (
        await call(
          'POST',
          `/staff/certificates/${second.certificateId}/reissue`,
          admin.headers,
          body,
        )
      ).status,
    ).toBe(201);
  });

  it('cria certificado NOVO (código novo, nome atual, ligado ao anterior) e o anterior vira superseded sem mudar', async () => {
    const { certificateId, holder } = await ready();
    const old = await certRow(certificateId);
    await tools.db
      .update(schema.profile)
      .set({ certificateName: 'Nome Corrigido da Aluna' })
      .where(eq(schema.profile.userId, holder.id));
    const support = await newPerson('support', ['certificate.reissue']);
    const created = await json(
      await call('POST', `/staff/certificates/${certificateId}/reissue`, support.headers, body),
    );
    const fresh = await certRow(created.certificateId);
    expect(fresh).toMatchObject({
      status: 'queued',
      predecessorId: certificateId,
      userId: holder.id,
    });
    expect(fresh.code).not.toBe(old.code);
    expect((fresh.snapshot as any).holderName).toBe('Nome Corrigido da Aluna');

    const superseded = await certRow(certificateId);
    expect(superseded.status).toBe('superseded');
    expect(JSON.stringify(superseded.snapshot)).toBe(JSON.stringify(old.snapshot));
    expect(superseded.pdfSha256).toBe(old.pdfSha256);

    // a intenção de renderização do novo existe e o antigo não baixa mais
    const intents = await tools.db
      .select()
      .from(schema.outboxMessage)
      .where(eq(schema.outboxMessage.dedupeKey, `certificate:${fresh.id}`));
    expect(intents).toHaveLength(1);
    expect(
      (await call('GET', `/me/certificates/${certificateId}/download`, holder.headers)).status,
    ).toBe(404);
    const audits = await tools.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, certificateId));
    const reissue = audits.find((item) => item.action === 'certificate.reissue');
    expect(reissue?.details).toMatchObject({ newId: fresh.id, reason: body.reason });
  });

  it('só o MAIS RECENTE é reemitível: reemitir o antigo, ou o que está na fila ou falhou, dá 409', async () => {
    const { certificateId } = await ready();
    const support = await newPerson('support', ['certificate.reissue']);
    const path = (id: string) => `/staff/certificates/${id}/reissue`;
    const first = await json(await call('POST', path(certificateId), support.headers, body));
    expect((await call('POST', path(certificateId), support.headers, body)).status).toBe(409);
    // o novo está na fila: ainda não é reemitível
    expect((await call('POST', path(first.certificateId), support.headers, body)).status).toBe(409);
    await tools.db.execute(
      sql`update certificate set status = 'failed', failure_code = 'x' where id = ${first.certificateId}`,
    );
    expect((await call('POST', path(first.certificateId), support.headers, body)).status).toBe(409);
    expect((await call('POST', path(crypto.randomUUID()), support.headers, body)).status).toBe(404);
  });

  it('certificado REVOGADO pode ser reemitido e continua revogado', async () => {
    const { certificateId } = await ready();
    const admin = await newPerson('admin');
    await reauth(admin);
    await call('POST', `/staff/certificates/${certificateId}/revoke`, admin.headers, {
      category: 'wrong_data',
      note: 'Nome escrito errado no certificado',
    });
    const created = await call(
      'POST',
      `/staff/certificates/${certificateId}/reissue`,
      admin.headers,
      body,
    );
    expect(created.status).toBe(201);
    expect((await certRow(certificateId)).status).toBe('revoked');
  });

  it('corpo inválido: 400 (sem motivo, motivo curto ou inseguro, campo extra)', async () => {
    const { certificateId } = await ready();
    const admin = await newPerson('admin');
    for (const bad of [
      {},
      { reason: 'x' },
      { reason: `Motivo${String.fromCodePoint(0x200b)}oculto` },
      { reason: 'Motivo válido', extra: true },
    ]) {
      expect(
        (await call('POST', `/staff/certificates/${certificateId}/reissue`, admin.headers, bad))
          .status,
      ).toBe(400);
    }
  });

  it('duas reemissões SIMULTÂNEAS (conexões separadas): exatamente UM novo certificado', async () => {
    const { certificateId, admin } = await ready();
    const other: OpenDatabase = await openDatabase(database.connectionString);
    try {
      const results = await Promise.allSettled([
        reissueCertificate(tools.db, {
          actorId: admin.id,
          certificateId,
          reason: 'Primeira tentativa',
        }),
        reissueCertificate(other.db, {
          actorId: admin.id,
          certificateId,
          reason: 'Segunda tentativa',
        }),
      ]);
      expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((item) => item.status === 'rejected')).toHaveLength(1);
    } finally {
      await other.close();
    }
    const all = await tools.db.select().from(schema.certificate);
    expect(all).toHaveLength(2);
    expect(new Set(all.map((item) => item.code)).size).toBe(2);
  });

  it('o banco não deixa dois sucessores do mesmo certificado', async () => {
    const { certificateId } = await ready();
    const support = await newPerson('support', ['certificate.reissue']);
    await call('POST', `/staff/certificates/${certificateId}/reissue`, support.headers, body);
    const old = await certRow(certificateId);
    await expect(
      tools.db.insert(schema.certificate).values({
        userId: old.userId,
        courseId: old.courseId,
        code: 'CCCCCCCCCCCCCCCCCCCCCC',
        snapshot: old.snapshot,
        predecessorId: certificateId,
      }),
    ).rejects.toThrow();
  });
});

describe('lista da Staff e "tentar de novo"', () => {
  it('Admin, Suporte com reemitir e Suporte com ops.queue veem; Suporte sem nenhum, aluna e visitante não', async () => {
    await ready();
    const admin = await newPerson('admin');
    const reissuer = await newPerson('support', ['certificate.reissue']);
    const ops = await newPerson('support', ['ops.queue']);
    const none = await newPerson('support', ['help.edit']);
    const student = await newPerson();
    expect((await call('GET', '/staff/certificates')).status).toBe(401);
    for (const who of [admin, reissuer, ops]) {
      const list = await call('GET', '/staff/certificates', who.headers);
      expect(list.status).toBe(200);
      expect((await json(list)).certificates).toHaveLength(1);
    }
    for (const who of [none, student]) {
      expect((await call('GET', '/staff/certificates', who.headers)).status).toBe(403);
    }
  });

  it('cada linha traz pessoa, curso, estado, sucessor e o campo do reembolso; filtro por estado; estado inválido 400', async () => {
    const { certificateId } = await ready();
    const admin = await newPerson('admin');
    const support = await newPerson('support', ['certificate.reissue']);
    const created = await json(
      await call('POST', `/staff/certificates/${certificateId}/reissue`, support.headers, {
        reason: 'Correção do nome pedida pela aluna',
      }),
    );
    const all = (await json(await call('GET', '/staff/certificates', admin.headers))).certificates;
    expect(all).toHaveLength(2);
    const old = all.find((item: any) => item.id === certificateId);
    expect(old).toMatchObject({ status: 'superseded', hasSuccessor: true, refundedAt: null });
    expect(old.holderEmail).toContain('@example.test');
    const fresh = all.find((item: any) => item.id === created.certificateId);
    expect(fresh).toMatchObject({
      status: 'queued',
      predecessorId: certificateId,
      hasSuccessor: false,
    });
    const queued = (
      await json(await call('GET', '/staff/certificates?status=queued', admin.headers))
    ).certificates;
    expect(queued.map((item: any) => item.id)).toEqual([created.certificateId]);
    expect((await call('GET', '/staff/certificates?status=inventado', admin.headers)).status).toBe(
      400,
    );
  });

  it('"tentar de novo" só com ops.queue e só em failed; volta a queued sem outro certificado', async () => {
    const { certificateId } = await issued();
    await expect(
      render(certificateId, {
        async render() {
          throw new (
            await import('../../src/server/certificate/certificate-store.ts')
          ).CertificateRenderRejectedError('not_a_pdf');
        },
      }),
    ).rejects.toThrow();
    expect((await certRow(certificateId)).status).toBe('failed');
    const ops = await newPerson('support', ['ops.queue']);
    const noOps = await newPerson('support', ['certificate.reissue']);
    const path = `/staff/certificates/${certificateId}/retry`;
    expect((await call('POST', path, undefined)).status).toBe(401);
    expect((await call('POST', path, noOps.headers)).status).toBe(403);
    expect((await call('POST', path, ops.headers)).status).toBe(200);
    expect((await certRow(certificateId)).status).toBe('queued');
    expect((await call('POST', path, ops.headers)).status).toBe(409);
    expect((await tools.db.select().from(schema.certificate)).length).toBe(1);
  });
});

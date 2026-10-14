import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { grantEntitlement } from '../../src/server/access/entitlement-store.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { setCertificatePolicy } from '../../src/server/certificate/certificate-store.ts';
import { completeLesson } from '../../src/server/learning/completion.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { createMemoryStorage, type MemoryStorage } from '../../src/server/media/memory-storage.ts';
import { cleanupMedia } from '../../src/server/media/store.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createDemoCourse } from '../helpers/demo-course.ts';
import { pngBytes } from '../helpers/media-bytes.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M7-06 em Postgres 18 real (armazenamento de mídia EM MEMÓRIA): emitente global e signatário por curso, só do Admin
 * (403 direto pela API para o Suporte, mesmo com todos os grants), CNPJ pelos dígitos verificadores, assinatura como
 * mídia PRIVADA que só o Admin abre, e o snapshot do certificado que congela o que valia na emissão.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const T0 = new Date('2026-10-11T12:00:00.000Z');
const LATE = new Date('2026-10-30T12:00:00.000Z');
const CNPJ = '11.222.333/0001-81';
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
    sql`truncate table certificate, certificate_policy, certificate_signatory, certificate_issuer, media_reference, media_asset, outbox_message, course_completion, lesson_completion, entitlement, enrollment, lesson, module, lesson_draft, module_draft, course_content, course_draft, curriculum_state, offer, course cascade`,
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
    clock: () => LATE,
    mediaStorage: storage,
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

/** Mídia do propósito, sem passar pelo fluxo de upload (o fluxo tem o teste do M5-07). */
async function readyAsset(createdBy: string, purpose: string, state = 'ready') {
  const id = crypto.randomUUID();
  const bytes = pngBytes(600, 200, 400);
  const isPrivate = purpose === 'certificate_asset' || purpose === 'lesson_material';
  await tools.db.insert(schema.mediaAsset).values({
    id,
    purpose,
    visibility: isPrivate ? 'private' : 'public',
    storageKey: `m/${id}`,
    declaredType: 'image/png',
    declaredSize: bytes.length,
    contentType: 'image/png',
    state,
    size: bytes.length,
    width: 600,
    height: 200,
    sha256: 'a'.repeat(64),
    confirmedAt: LATE,
    createdBy,
    expiresAt: new Date(LATE.getTime() + 24 * 3_600_000),
  });
  storage.upload(`m/${id}`, bytes, 'image/png');
  return id;
}
const course = () => createDemoCourse(tools.db);
const signatoryPath = (courseId: string) => `/staff/courses/${courseId}/certificate/signatory`;
const SIGNATORY = { name: 'Dra. Ana Lima', title: 'Diretora Acadêmica' };

describe('emitente (global)', () => {
  it('só o Admin lê e grava: sem sessão 401; aluno e Suporte (mesmo com TODOS os grants) 403', async () => {
    const student = await newPerson();
    const support = await newPerson('support', ALL_GRANTS);
    const admin = await newPerson('admin');
    const body = { legalName: 'Neuro Capacitar LTDA', cnpj: CNPJ };
    expect((await call('GET', '/staff/certificate/issuer')).status).toBe(401);
    expect((await call('PUT', '/staff/certificate/issuer', undefined, body)).status).toBe(401);
    for (const who of [student, support]) {
      expect((await call('GET', '/staff/certificate/issuer', who.headers)).status).toBe(403);
      expect((await call('PUT', '/staff/certificate/issuer', who.headers, body)).status).toBe(403);
    }
    expect((await call('GET', '/staff/certificate/issuer', admin.headers)).status).toBe(200);
    expect((await call('PUT', '/staff/certificate/issuer', admin.headers, body)).status).toBe(200);
  });

  it('guarda só os dígitos, devolve com máscara, mantém UMA linha e audita', async () => {
    const admin = await newPerson('admin');
    expect(await json(await call('GET', '/staff/certificate/issuer', admin.headers))).toEqual({
      issuer: null,
    });
    const saved = await json(
      await call('PUT', '/staff/certificate/issuer', admin.headers, {
        legalName: '  Neuro   Capacitar LTDA ',
        cnpj: CNPJ,
      }),
    );
    expect(saved.issuer).toMatchObject({
      legalName: 'Neuro Capacitar LTDA',
      cnpj: '11222333000181',
      cnpjFormatted: CNPJ,
    });
    await call('PUT', '/staff/certificate/issuer', admin.headers, {
      legalName: 'Neuro Capacitar Educação LTDA',
      cnpj: '45.723.174/0001-10',
    });
    const rows = await tools.db.select().from(schema.certificateIssuer);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      legalName: 'Neuro Capacitar Educação LTDA',
      cnpj: '45723174000110',
    });
    const audits = await tools.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'certificate.issuer.save'));
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });

  it('CNPJ inválido, nome inseguro, campo extra e corpo vazio: 400; o banco também recusa CNPJ torto', async () => {
    const admin = await newPerson('admin');
    for (const bad of [
      { legalName: 'Neuro LTDA', cnpj: '11.222.333/0001-82' },
      { legalName: 'Neuro LTDA', cnpj: '00000000000000' },
      { legalName: `Neuro${String.fromCodePoint(0x202e)}LTDA`, cnpj: CNPJ },
      { legalName: 'Neuro LTDA', cnpj: CNPJ, extra: true },
      {},
    ]) {
      expect((await call('PUT', '/staff/certificate/issuer', admin.headers, bad)).status).toBe(400);
    }
    expect(await tools.db.select().from(schema.certificateIssuer)).toHaveLength(0);
    await expect(
      tools.db.execute(
        sql`insert into certificate_issuer (legal_name, cnpj) values ('Neuro LTDA', '123')`,
      ),
    ).rejects.toThrow();
  });
});

describe('signatário (por curso)', () => {
  it('só o Admin: 401, 403 para aluno e Suporte com todos os grants; curso inexistente e id torto 404', async () => {
    const fixture = await course();
    const student = await newPerson();
    const support = await newPerson('support', ALL_GRANTS);
    const admin = await newPerson('admin');
    const body = { ...SIGNATORY, signatureMediaId: null };
    const path = signatoryPath(fixture.courseId);
    expect((await call('GET', path)).status).toBe(401);
    expect((await call('PUT', path, undefined, body)).status).toBe(401);
    for (const who of [student, support]) {
      expect((await call('GET', path, who.headers)).status).toBe(403);
      expect((await call('PUT', path, who.headers, body)).status).toBe(403);
    }
    expect(
      (await call('PUT', signatoryPath(crypto.randomUUID()), admin.headers, body)).status,
    ).toBe(404);
    expect((await call('PUT', signatoryPath('xyz'), admin.headers, body)).status).toBe(404);
    expect((await call('GET', signatoryPath('xyz'), admin.headers)).status).toBe(404);
    expect(await json(await call('GET', path, admin.headers))).toEqual({ signatory: null });
    expect((await call('PUT', path, admin.headers, body)).status).toBe(200);
  });

  it('grava nome, cargo e a assinatura (referência na mesma transação); trocar move a referência; null remove', async () => {
    const fixture = await course();
    const admin = await newPerson('admin');
    const path = signatoryPath(fixture.courseId);
    const first = await readyAsset(admin.id, 'certificate_asset');
    const saved = await json(
      await call('PUT', path, admin.headers, { ...SIGNATORY, signatureMediaId: first }),
    );
    expect(saved.signatory).toMatchObject({
      ...SIGNATORY,
      signatureMediaId: first,
      courseId: fixture.courseId,
    });
    const refs = () =>
      tools.db
        .select()
        .from(schema.mediaReference)
        .where(eq(schema.mediaReference.ownerType, 'certificate_signatory'));
    expect(await refs()).toMatchObject([
      { mediaId: first, ownerId: fixture.courseId, slot: 'signature' },
    ]);

    const second = await readyAsset(admin.id, 'certificate_asset');
    await call('PUT', path, admin.headers, { ...SIGNATORY, signatureMediaId: second });
    expect(await refs()).toMatchObject([{ mediaId: second }]);

    await call('PUT', path, admin.headers, { ...SIGNATORY, signatureMediaId: null });
    expect(await refs()).toHaveLength(0);
    expect((await json(await call('GET', path, admin.headers))).signatory).toMatchObject({
      signatureMediaId: null,
    });
  });

  it('mídia de outro propósito (capa pública): 422; não pronta ou inexistente: 409; nada é gravado', async () => {
    const fixture = await course();
    const admin = await newPerson('admin');
    const path = signatoryPath(fixture.courseId);
    const wrongPurpose = await readyAsset(admin.id, 'course_cover');
    const pending = await readyAsset(admin.id, 'certificate_asset', 'pending_upload');
    expect(
      (await call('PUT', path, admin.headers, { ...SIGNATORY, signatureMediaId: wrongPurpose }))
        .status,
    ).toBe(422);
    expect(
      (await call('PUT', path, admin.headers, { ...SIGNATORY, signatureMediaId: pending })).status,
    ).toBe(409);
    expect(
      (
        await call('PUT', path, admin.headers, {
          ...SIGNATORY,
          signatureMediaId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(409);
    expect(await tools.db.select().from(schema.certificateSignatory)).toHaveLength(0);
  });

  it('nome ou cargo com caractere inseguro, vazio ou campo extra: 400', async () => {
    const fixture = await course();
    const admin = await newPerson('admin');
    const path = signatoryPath(fixture.courseId);
    for (const bad of [
      { name: `Ana${String.fromCodePoint(0x200b)}Lima`, title: 'Diretora', signatureMediaId: null },
      { name: 'Ana Lima', title: '', signatureMediaId: null },
      { name: 'Ana Lima', title: 'Diretora', signatureMediaId: 'abc' },
      { name: 'Ana Lima', title: 'Diretora', signatureMediaId: null, url: 'https://x' },
      { name: 'Ana Lima', title: 'Diretora' },
    ]) {
      expect((await call('PUT', path, admin.headers, bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('a limpeza de órfãos nunca apaga a assinatura em uso', async () => {
    const fixture = await course();
    const admin = await newPerson('admin');
    const media = await readyAsset(admin.id, 'certificate_asset');
    await call('PUT', signatoryPath(fixture.courseId), admin.headers, {
      ...SIGNATORY,
      signatureMediaId: media,
    });
    await cleanupMedia(tools.db, storage, new Date(LATE.getTime() + 72 * 3_600_000));
    const [row] = await tools.db
      .select()
      .from(schema.mediaAsset)
      .where(eq(schema.mediaAsset.id, media));
    expect(row!.state).toBe('ready');
  });
});

describe('a assinatura é privada', () => {
  it('só o Admin abre (200, no-store, nosniff); Suporte com todos os grants, aluno e visitante não alcançam', async () => {
    const fixture = await course();
    const admin = await newPerson('admin');
    const support = await newPerson('support', ALL_GRANTS);
    const student = await newPerson();
    const media = await readyAsset(admin.id, 'certificate_asset');
    await call('PUT', signatoryPath(fixture.courseId), admin.headers, {
      ...SIGNATORY,
      signatureMediaId: media,
    });

    const opened = await call('GET', `/media/${media}/content`, admin.headers);
    expect(opened.status).toBe(200);
    expect(opened.headers.get('cache-control')).toContain('no-store');
    expect(opened.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await opened.arrayBuffer()).byteLength).toBeGreaterThan(0);

    expect((await call('GET', `/media/${media}/content`)).status).toBe(401);
    for (const who of [support, student]) {
      expect((await call('GET', `/media/${media}/content`, who.headers)).status).toBe(404);
    }
  });

  it('nenhuma resposta do cadastro expõe a chave do objeto nem uma URL da assinatura', async () => {
    const fixture = await course();
    const admin = await newPerson('admin');
    const media = await readyAsset(admin.id, 'certificate_asset');
    const put = await call('PUT', signatoryPath(fixture.courseId), admin.headers, {
      ...SIGNATORY,
      signatureMediaId: media,
    });
    const text =
      JSON.stringify(await json(put)) +
      JSON.stringify(await json(await call('GET', signatoryPath(fixture.courseId), admin.headers)));
    expect(text).not.toContain(`m/${media}`);
    expect(text).not.toMatch(/https?:/);
  });
});

describe('o snapshot do certificado', () => {
  async function finishCourse(fixture: Awaited<ReturnType<typeof course>>, userId: string) {
    const rows = await tools.db
      .select({ id: schema.lesson.id, title: schema.lesson.title })
      .from(schema.lesson)
      .where(eq(schema.lesson.courseId, fixture.courseId));
    const byTitle = Object.fromEntries(rows.map((row) => [row.title, row.id]));
    for (const title of REQUIRED) {
      await completeLesson(tools.db, { userId, lessonId: byTitle[title]!, clock: () => LATE });
    }
  }
  async function student(fixture: Awaited<ReturnType<typeof course>>) {
    const person = await newPerson();
    await grantEntitlement(tools.db, {
      userId: person.id,
      courseId: fixture.courseId,
      offerId: fixture.offerId,
      source: 'free_offer',
      sourceRef: `free:${person.id}:${fixture.offerId}:0`,
      accessMonths: 12,
      startsAt: T0,
      grantedBy: person.id,
    });
    return person;
  }

  it('copia emitente e signatário na emissão; trocá-los depois NÃO altera o certificado emitido', async () => {
    const fixture = await course();
    const admin = await newPerson('admin');
    const media = await readyAsset(admin.id, 'certificate_asset');
    await call('PUT', '/staff/certificate/issuer', admin.headers, {
      legalName: 'Neuro Capacitar LTDA',
      cnpj: CNPJ,
    });
    await call('PUT', signatoryPath(fixture.courseId), admin.headers, {
      ...SIGNATORY,
      signatureMediaId: media,
    });
    await setCertificatePolicy(tools.db, {
      actorId: admin.id,
      courseId: fixture.courseId,
      enabled: true,
    });

    const holder = await student(fixture);
    await finishCourse(fixture, holder.id);
    const [issued] = await tools.db.select().from(schema.certificate);
    expect(issued!.snapshot).toMatchObject({
      issuer: { legalName: 'Neuro Capacitar LTDA', cnpj: '11222333000181' },
      signatory: { name: 'Dra. Ana Lima', title: 'Diretora Acadêmica', signatureMediaId: media },
    });
    const frozen = JSON.stringify(issued!.snapshot);

    // troca o signatário e o emitente: o certificado já emitido fica como estava
    await call('PUT', signatoryPath(fixture.courseId), admin.headers, {
      name: 'Outro Diretor',
      title: 'Reitor',
      signatureMediaId: null,
    });
    await call('PUT', '/staff/certificate/issuer', admin.headers, {
      legalName: 'Outra Empresa LTDA',
      cnpj: '45.723.174/0001-10',
    });
    const [after] = await tools.db.select().from(schema.certificate);
    expect(JSON.stringify(after!.snapshot)).toBe(frozen);
  });

  it('sem emitente nem signatário cadastrados, o snapshot leva null (o renderer do M7-02 recusa)', async () => {
    const fixture = await course();
    const admin = await newPerson('admin');
    await setCertificatePolicy(tools.db, {
      actorId: admin.id,
      courseId: fixture.courseId,
      enabled: true,
    });
    const holder = await student(fixture);
    await finishCourse(fixture, holder.id);
    const [issued] = await tools.db.select().from(schema.certificate);
    expect(issued!.snapshot).toMatchObject({ issuer: null, signatory: null });
  });
});

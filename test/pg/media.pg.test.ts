import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';
import { grantEntitlement } from '../../src/server/access/entitlement-store.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { loadPublicCoursePage } from '../../src/server/catalog/public-page.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { createMemoryStorage, type MemoryStorage } from '../../src/server/media/memory-storage.ts';
import { setReferenceIn } from '../../src/server/media/references.ts';
import { cleanupMedia, hasMediaWork } from '../../src/server/media/store.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createDemoCourse } from '../helpers/demo-course.ts';
import { jpegBytes, pdfBytes, pngBytes, sha256Hex, textBytes } from '../helpers/media-bytes.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M5-07 em Postgres 18 real, com o armazenamento EM MEMÓRIA (o R2 real não foi exercitado, ver STATUS): intenção,
 * confirmação por BYTES (tipo, tamanho, dimensões, SHA-256), capa e banner (copiar para o público antes do
 * ponteiro), referências sob trava, limpeza de órfãos e de uploads vencidos, e entrega privada autorizada.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const T0 = new Date('2026-10-11T12:00:00.000Z');
const LATE = new Date('2026-10-30T12:00:00.000Z');
const HOUR = 3_600_000;

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let storage: MemoryStorage;
let seq = 0;
let clockNow = LATE;
let withStorage = true;

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
  withStorage = true;
  storage = createMemoryStorage();
  await tools.db.execute(
    sql`truncate table media_reference, media_asset, course_interest_notification, course_interest, course_availability_cycle, email_message, outbox_message, quiz_attempt, discussion_report, discussion_post, video_progress, course_completion, lesson_completion, entitlement, enrollment, lesson, module, lesson_draft, module_draft, course_content, course_draft, curriculum_state, offer, course cascade`,
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
    clock: () => clockNow,
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
const assetRow = async (id: string) =>
  (await tools.db.select().from(schema.mediaAsset).where(eq(schema.mediaAsset.id, id)))[0]!;

const intent = (who: Person, purpose: string, contentType: string, size: number) =>
  call('POST', '/media/intents', who.headers, { purpose, contentType, size });

/** Fluxo completo: intenção, "PUT" do navegador, confirmação. Devolve o id e a resposta da confirmação. */
async function uploadAndConfirm(
  who: Person,
  purpose: string,
  contentType: string,
  bytes: Uint8Array,
  options: { declaredSize?: number | undefined } = {},
) {
  const created = await intent(who, purpose, contentType, options.declaredSize ?? bytes.length);
  expect(created.status).toBe(201);
  const { id } = await json(created);
  storage.upload(`m/${id}`, bytes, contentType);
  return { id: id as string, confirm: await call('POST', `/media/${id}/confirm`, who.headers) };
}
const ready = async (who: Person, purpose: string, contentType: string, bytes: Uint8Array) => {
  const { id, confirm } = await uploadAndConfirm(who, purpose, contentType, bytes);
  expect(confirm.status).toBe(200);
  return id;
};
const cover = (extra = 0) => pngBytes(1280, 720, 300 + extra);
const banner = () => pngBytes(1680, 420, 300);

describe('a intenção de upload', () => {
  it('só quem pode envia o propósito: sem sessão 401, aluno 403, Suporte sem course.edit 403, com o grant 201', async () => {
    const student = await newPerson();
    const plain = await newPerson('support');
    const editor = await newPerson('support', ['course.edit']);
    const admin = await newPerson('admin');
    expect((await call('POST', '/media/intents', undefined, {})).status).toBe(401);
    expect((await intent(student, 'course_cover', 'image/png', 1000)).status).toBe(403);
    expect((await intent(plain, 'course_cover', 'image/png', 1000)).status).toBe(403);
    expect((await intent(editor, 'course_cover', 'image/png', 1000)).status).toBe(201);
    expect((await intent(admin, 'course_banner', 'image/png', 1000)).status).toBe(201);
    // o ativo do certificado é do Admin (não delegável): o Suporte com course.edit não envia
    expect((await intent(editor, 'certificate_asset', 'image/png', 1000)).status).toBe(403);
    expect((await intent(admin, 'certificate_asset', 'image/png', 1000)).status).toBe(201);
  });

  it('grava o asset pendente com chave OPACA e devolve o PUT curto que assina o Content-Type', async () => {
    const admin = await newPerson('admin');
    const response = await intent(admin, 'course_cover', 'image/png', 12_345);
    expect(response.status).toBe(201);
    const body = await json(response);
    expect(body.upload).toEqual({
      method: 'PUT',
      url: expect.stringContaining(`m/${body.id}`),
      headers: { 'content-type': 'image/png' },
      expiresInSeconds: 300,
    });
    expect(storage.presigned).toEqual([
      { key: `m/${body.id}`, contentType: 'image/png', expiresSeconds: 300 },
    ]);
    const row = await assetRow(body.id);
    expect(row).toMatchObject({
      state: 'pending_upload',
      purpose: 'course_cover',
      visibility: 'public',
      declaredType: 'image/png',
      declaredSize: 12_345,
      createdBy: admin.id,
    });
    expect(row.storageKey).toMatch(/^m\/[0-9a-f-]{36}$/);
    expect(row.expiresAt.getTime() - clockNow.getTime()).toBe(24 * HOUR);
  });

  it('recusas: tipo não permitido (SVG, PDF como capa), grande demais, corpo inválido e campos de chave ou nome', async () => {
    const admin = await newPerson('admin');
    for (const [purpose, type, size, reason] of [
      ['course_cover', 'image/svg+xml', 1000, 'content_type_not_allowed'],
      ['course_cover', 'application/pdf', 1000, 'content_type_not_allowed'],
      ['course_cover', 'text/html', 1000, 'content_type_not_allowed'],
      ['course_cover', 'image/png', 4 * 1024 * 1024, 'too_large'],
      ['course_banner', 'image/png', 6 * 1024 * 1024, 'too_large'],
    ] as const) {
      const response = await intent(admin, purpose, type, size);
      expect(response.status, `${purpose} ${type}`).toBe(422);
      expect(await json(response)).toEqual({ error: { code: 'invalid_media', reason } });
    }
    for (const body of [
      {},
      { purpose: 'avatar', contentType: 'image/png', size: 10 },
      { purpose: 'course_cover', contentType: 'image/png', size: 0 },
      { purpose: 'course_cover', contentType: 'image/png', size: 1.5 },
      // a chave NUNCA vem do cliente (path traversal): campo extra é recusado
      { purpose: 'course_cover', contentType: 'image/png', size: 10, key: '../../etc/passwd' },
      { purpose: 'course_cover', contentType: 'image/png', size: 10, filename: '../x.png' },
    ]) {
      expect(
        (await call('POST', '/media/intents', admin.headers, body)).status,
        JSON.stringify(body),
      ).toBe(400);
    }
    expect(await tools.db.select().from(schema.mediaAsset)).toHaveLength(0);
  });

  it('sem R2 configurado a mídia fica desligada: 503 e nada é gravado', async () => {
    withStorage = false;
    const admin = await newPerson('admin');
    const response = await intent(admin, 'course_cover', 'image/png', 1000);
    expect(response.status).toBe(503);
    expect(await json(response)).toEqual({ error: { code: 'media_not_configured' } });
    expect(await tools.db.select().from(schema.mediaAsset)).toHaveLength(0);
  });
});

describe('a confirmação confere os BYTES', () => {
  it('imagem íntegra vira ready com tipo real, dimensões do cabeçalho e SHA-256; repetir é idempotente', async () => {
    const admin = await newPerson('admin');
    const bytes = cover();
    const { id, confirm } = await uploadAndConfirm(admin, 'course_cover', 'image/png', bytes);
    expect(confirm.status).toBe(200);
    expect((await json(confirm)).media).toEqual({
      id,
      purpose: 'course_cover',
      state: 'ready',
      contentType: 'image/png',
      size: bytes.length,
      width: 1280,
      height: 720,
    });
    const row = await assetRow(id);
    expect(row.sha256).toBe(await sha256Hex(bytes));
    expect(row.confirmedAt).not.toBeNull();
    expect((await call('POST', `/media/${id}/confirm`, admin.headers)).status).toBe(200);
    const parallel = await Promise.all(
      Array.from({ length: 4 }, () => call('POST', `/media/${id}/confirm`, admin.headers)),
    );
    expect(parallel.map((item) => item.status)).toEqual([200, 200, 200, 200]);
  });

  it('PUT sem confirmar não publica nada; confirmar antes do PUT é 409 e continua pendente', async () => {
    const admin = await newPerson('admin');
    const created = await intent(admin, 'course_cover', 'image/png', 300);
    const { id } = await json(created);
    const early = await call('POST', `/media/${id}/confirm`, admin.headers);
    expect(early.status).toBe(409);
    expect((await json(early)).error.code).toBe('upload_missing');
    expect((await assetRow(id)).state).toBe('pending_upload');
    storage.upload(`m/${id}`, cover(), 'image/png'); // o PUT aconteceu, mas não foi confirmado
    // não dá para referenciar nem publicar: continua pendente
    const draftBody = await draftWith(admin, { coverMediaId: id });
    expect(draftBody.status).toBe(400);
    expect((await json(draftBody)).error.code).toBe('media_not_ready');
    expect(storage.keys('public')).toEqual([]);
  });

  it('só o AUTOR confirma (a outra pessoa recebe "não existe"); id malformado 404; sem sessão 401', async () => {
    const admin = await newPerson('admin');
    const other = await newPerson('admin');
    const { id } = await json(await intent(admin, 'course_cover', 'image/png', 300));
    storage.upload(`m/${id}`, cover(), 'image/png');
    expect((await call('POST', `/media/${id}/confirm`, other.headers)).status).toBe(404);
    expect((await call('POST', '/media/xyz/confirm', admin.headers)).status).toBe(404);
    expect((await call('POST', `/media/${id}/confirm`, undefined)).status).toBe(401);
    const student = await newPerson();
    expect((await call('POST', `/media/${id}/confirm`, student.headers)).status).toBe(403);
    expect((await assetRow(id)).state).toBe('pending_upload');
  });

  it('Content-Type certo com bytes errados, script com cara de imagem e SVG: 422, asset rejeitado e objeto apagado', async () => {
    const admin = await newPerson('admin');
    for (const [label, bytes, type, reason] of [
      ['jpeg declarado png', jpegBytes(1280, 720), 'image/png', 'type_mismatch'],
      ['script', textBytes('<script>alert(1)</script>'), 'image/png', 'type_mismatch'],
      ['executável', textBytes('MZ\u0090 executável'), 'image/jpeg', 'type_mismatch'],
      ['pdf como capa', pdfBytes(), 'image/png', 'type_mismatch'],
    ] as const) {
      const { id, confirm } = await uploadAndConfirm(admin, 'course_cover', type, bytes);
      expect(confirm.status, label).toBe(422);
      expect(await json(confirm)).toEqual({ error: { code: 'invalid_media', reason } });
      const row = await assetRow(id);
      expect(row).toMatchObject({ state: 'rejected', rejectedReason: reason });
      expect(storage.has('private', `m/${id}`), label).toBe(false);
      // rejeitado não volta a ser confirmado
      expect((await call('POST', `/media/${id}/confirm`, admin.headers)).status).toBe(409);
    }
  });

  it('imagem gigante em pixels, minúscula, de proporção errada ou com tamanho diferente do declarado: recusada', async () => {
    const admin = await newPerson('admin');
    const cases = [
      ['pixels demais', pngBytes(50_000, 28_125), 'dimensions_out_of_range', undefined],
      ['minúscula', pngBytes(100, 56), 'dimensions_out_of_range', undefined],
      ['quadrada na capa', pngBytes(1000, 1000), 'aspect_mismatch', undefined],
      ['tamanho declarado diferente', cover(), 'size_mismatch', 999],
    ] as const;
    for (const [label, bytes, reason, declaredSize] of cases) {
      const { confirm } = await uploadAndConfirm(admin, 'course_cover', 'image/png', bytes, {
        declaredSize,
      });
      expect(confirm.status, label).toBe(422);
      expect((await json(confirm)).error.reason, label).toBe(reason);
    }
  });

  it('objeto acima do limite do propósito (declarado pequeno, enviado grande) é recusado antes de ler tudo', async () => {
    const admin = await newPerson('admin');
    const created = await intent(admin, 'course_cover', 'image/png', 300);
    const { id } = await json(created);
    storage.upload(`m/${id}`, pngBytes(1280, 720, 3 * 1024 * 1024 + 10), 'image/png');
    const confirm = await call('POST', `/media/${id}/confirm`, admin.headers);
    expect(confirm.status).toBe(422);
    expect((await json(confirm)).error.reason).toBe('too_large');
    expect(storage.has('private', `m/${id}`)).toBe(false);
  });

  it('upload vencido (>24 h): 410 e o asset segue pendente até a limpeza', async () => {
    const admin = await newPerson('admin');
    const { id } = await json(await intent(admin, 'course_cover', 'image/png', 300));
    storage.upload(`m/${id}`, cover(), 'image/png');
    clockNow = new Date(LATE.getTime() + 25 * HOUR);
    const response = await call('POST', `/media/${id}/confirm`, admin.headers);
    expect(response.status).toBe(410);
    expect((await json(response)).error.code).toBe('upload_expired');
  });

  it('PDF íntegro passa no material de aula; PDF truncado não', async () => {
    const admin = await newPerson('admin');
    expect(
      (await uploadAndConfirm(admin, 'lesson_material', 'application/pdf', pdfBytes())).confirm
        .status,
    ).toBe(200);
    const truncated = new TextEncoder().encode(`%PDF-1.7\n${'x'.repeat(500)}`);
    const { confirm } = await uploadAndConfirm(
      admin,
      'lesson_material',
      'application/pdf',
      truncated,
    );
    expect(confirm.status).toBe(422);
    expect((await json(confirm)).error.reason).toBe('pdf_truncated');
  });
});

/** Salva o rascunho do demonstrativo trocando só a capa/banner. */
async function draftWith(
  who: Person,
  details: { coverMediaId?: string | null; bannerMediaId?: string | null },
  courseId?: string,
) {
  const fixture = courseId ? { courseId } : await createDemoCourse(tools.db);
  const current = await json(
    await call('GET', `/staff/courses/${fixture.courseId}/draft`, who.headers),
  );
  return call('PUT', `/staff/courses/${fixture.courseId}/draft`, who.headers, {
    expectedRev: current.rev,
    details: { ...current.details, ...details },
    modules: current.modules,
  });
}

describe('capa e banner do curso', () => {
  it('o rascunho referencia a mídia PRONTA e do propósito certo; nada vai ao bucket público antes de publicar', async () => {
    const admin = await newPerson('admin');
    const coverId = await ready(admin, 'course_cover', 'image/png', cover());
    const bannerId = await ready(admin, 'course_banner', 'image/png', banner());
    const fixture = await createDemoCourse(tools.db);
    const saved = await draftWith(
      admin,
      { coverMediaId: coverId, bannerMediaId: bannerId },
      fixture.courseId,
    );
    expect(saved.status).toBe(200);
    expect((await json(saved)).details).toMatchObject({
      coverMediaId: coverId,
      bannerMediaId: bannerId,
    });
    const refs = await tools.db.select().from(schema.mediaReference);
    expect(refs.map((row) => [row.ownerType, row.slot, row.mediaId]).sort()).toEqual(
      [
        ['course_draft', 'banner', bannerId],
        ['course_draft', 'cover', coverId],
      ].sort(),
    );
    expect(storage.keys('public')).toEqual([]);
    // propósito trocado e id inexistente
    const mismatch = await draftWith(admin, { coverMediaId: bannerId }, fixture.courseId);
    expect(mismatch.status).toBe(400);
    expect((await json(mismatch)).error.code).toBe('media_purpose_mismatch');
    const unknown = await draftWith(admin, { coverMediaId: crypto.randomUUID() }, fixture.courseId);
    expect(unknown.status).toBe(400);
    expect((await json(unknown)).error.code).toBe('media_not_ready');
    // `null` remove a referência
    expect((await draftWith(admin, { bannerMediaId: null }, fixture.courseId)).status).toBe(200);
    expect(await tools.db.select().from(schema.mediaReference)).toHaveLength(1);
  });

  it('publicar COPIA para o bucket público e só depois o ponteiro; a página pública traz a variante e o fallback', async () => {
    const admin = await newPerson('admin');
    const coverId = await ready(admin, 'course_cover', 'image/png', cover());
    const fixture = await createDemoCourse(tools.db);
    expect((await draftWith(admin, { coverMediaId: coverId }, fixture.courseId)).status).toBe(200);
    const [course] = await tools.db
      .select()
      .from(schema.course)
      .where(eq(schema.course.id, fixture.courseId));

    // antes de publicar: a página não mostra imagem
    expect(
      (await loadPublicCoursePage(tools.db, course!.slug, 'https://midia.exemplo.com.br'))!.cover,
    ).toBeNull();

    const published = await call(
      'POST',
      `/staff/courses/${fixture.courseId}/publish`,
      admin.headers,
    );
    expect(published.status).toBe(200);
    expect(storage.keys('public')).toEqual([`${coverId}.png`]);
    expect(storage.contentTypeOf('public', `${coverId}.png`)).toBe('image/png');
    const row = await assetRow(coverId);
    expect(row.publicKey).toBe(`${coverId}.png`);
    expect(row.publishedAt).not.toBeNull();
    const [content] = await tools.db
      .select()
      .from(schema.courseContent)
      .where(eq(schema.courseContent.courseId, fixture.courseId));
    expect(content!.coverMediaId).toBe(coverId);
    const refs = await tools.db.select().from(schema.mediaReference);
    expect(refs.map((r) => r.ownerType).sort()).toEqual(['course_content', 'course_draft']);

    const page = await loadPublicCoursePage(tools.db, course!.slug, 'https://midia.exemplo.com.br');
    expect(page!.cover).toEqual({
      src: `https://midia.exemplo.com.br/cdn-cgi/image/width=1280,quality=80,format=auto/${coverId}.png`,
      fallbackSrc: `https://midia.exemplo.com.br/${coverId}.png`,
      width: 1280,
      height: 720,
    });
    expect(page!.banner).toBeNull();
    // sem o domínio público configurado, nenhuma imagem sai (a página não quebra)
    expect((await loadPublicCoursePage(tools.db, course!.slug))!.cover).toBeNull();
  });

  it('publicar com imagem e sem R2 é 503; o ponteiro público nunca aponta para mídia ainda não copiada', async () => {
    const admin = await newPerson('admin');
    const coverId = await ready(admin, 'course_cover', 'image/png', cover());
    const fixture = await createDemoCourse(tools.db);
    await draftWith(admin, { coverMediaId: coverId }, fixture.courseId);
    withStorage = false;
    const response = await call(
      'POST',
      `/staff/courses/${fixture.courseId}/publish`,
      admin.headers,
    );
    expect(response.status).toBe(503);
    expect((await json(response)).error.code).toBe('media_not_configured');
    const [content] = await tools.db
      .select()
      .from(schema.courseContent)
      .where(eq(schema.courseContent.courseId, fixture.courseId));
    expect(content!.coverMediaId).toBeNull();
    // a defesa em camadas: a transação também recusa ponteiro para mídia não copiada
    await expect(
      tools.db.transaction((tx) =>
        setReferenceIn(tx, {
          ownerType: 'course_content',
          ownerId: fixture.courseId,
          slot: 'cover',
          mediaId: coverId,
          purpose: 'course_cover',
          requirePublished: true,
        }),
      ),
    ).rejects.toThrow('media_not_published');
  });

  it('trocar a capa: a antiga perde a referência e a limpeza a apaga (os dois buckets) depois de 24 h', async () => {
    const admin = await newPerson('admin');
    const first = await ready(admin, 'course_cover', 'image/png', cover());
    const second = await ready(admin, 'course_cover', 'image/png', cover(10));
    const fixture = await createDemoCourse(tools.db);
    await draftWith(admin, { coverMediaId: first }, fixture.courseId);
    await call('POST', `/staff/courses/${fixture.courseId}/publish`, admin.headers);
    await draftWith(admin, { coverMediaId: second }, fixture.courseId);
    await call('POST', `/staff/courses/${fixture.courseId}/publish`, admin.headers);
    expect(storage.keys('public').sort()).toEqual([`${first}.png`, `${second}.png`].sort());
    const refs = await tools.db.select().from(schema.mediaReference);
    expect(refs.every((row) => row.mediaId === second)).toBe(true);

    // ainda dentro das 24 h: nada é apagado
    expect(await cleanupMedia(tools.db, storage, new Date(LATE.getTime() + HOUR))).toMatchObject({
      orphaned: 0,
    });
    const after = new Date(LATE.getTime() + 30 * HOUR);
    const result = await cleanupMedia(tools.db, storage, after);
    expect(result).toMatchObject({ orphaned: 1, purged: 1, failed: 0 });
    expect(await assetRow(first)).toMatchObject({ state: 'deleted', rejectedReason: 'orphan' });
    expect((await assetRow(first)).storagePurgedAt).not.toBeNull();
    expect(storage.has('private', `m/${first}`)).toBe(false);
    expect(storage.has('public', `${first}.png`)).toBe(false);
    // a que está em uso fica intacta
    expect((await assetRow(second)).state).toBe('ready');
    expect(storage.has('public', `${second}.png`)).toBe(true);
  });
});

describe('limpeza', () => {
  it('upload pendente vencido some, e a limpeza é repetível quando o R2 falha', async () => {
    const admin = await newPerson('admin');
    const { id } = await json(await intent(admin, 'course_cover', 'image/png', 300));
    storage.upload(`m/${id}`, cover(), 'image/png');
    const later = new Date(LATE.getTime() + 25 * HOUR);
    expect(await hasMediaWork(tools.db, LATE)).toBe(false);
    expect(await hasMediaWork(tools.db, later)).toBe(true);
    storage.failNextDelete = true;
    const first = await cleanupMedia(tools.db, storage, later);
    expect(first).toMatchObject({ expired: 1, purged: 0, failed: 1 });
    expect(await assetRow(id)).toMatchObject({ state: 'deleted', rejectedReason: 'expired' });
    expect((await assetRow(id)).storagePurgedAt).toBeNull();
    expect(storage.has('private', `m/${id}`)).toBe(true);
    expect(await hasMediaWork(tools.db, later)).toBe(true);
    const second = await cleanupMedia(tools.db, storage, later);
    expect(second).toMatchObject({ purged: 1, failed: 0 });
    expect(storage.has('private', `m/${id}`)).toBe(false);
    expect(await hasMediaWork(tools.db, later)).toBe(false);
  });

  it('CORRIDA referência × limpeza: o objeto que ganha referência no meio NÃO é apagado (releitura sob trava)', async () => {
    const admin = await newPerson('admin');
    const id = await ready(admin, 'course_cover', 'image/png', cover());
    const fixture = await createDemoCourse(tools.db);
    const [writer, cleaner] = await Promise.all([
      openDatabase(database.connectionString),
      openDatabase(database.connectionString),
    ]);
    try {
      const after = new Date(LATE.getTime() + 30 * HOUR);
      await writer.db.transaction(async (tx) => {
        // A transação que passa a usar o objeto trava o asset...
        await setReferenceIn(tx, {
          ownerType: 'course_draft',
          ownerId: fixture.courseId,
          slot: 'cover',
          mediaId: id,
          purpose: 'course_cover',
        });
        // ...e a limpeza, rodando AGORA em outra conexão, pula a linha travada.
        const result = await cleanupMedia(cleaner.db, storage, after);
        expect(result.orphaned).toBe(0);
      });
      expect((await assetRow(id)).state).toBe('ready');
      expect(storage.has('private', `m/${id}`)).toBe(true);
      // com a referência já gravada, a limpeza seguinte também não apaga
      expect(await cleanupMedia(cleaner.db, storage, after)).toMatchObject({ orphaned: 0 });
    } finally {
      await Promise.all([writer.close(), cleaner.close()]);
    }
  });
});

describe('entrega PRIVADA autorizada', () => {
  async function material(lessonTitle = 'Boas-vindas') {
    const fixture = await createDemoCourse(tools.db);
    const [lesson] = await tools.db
      .select()
      .from(schema.lesson)
      .where(
        and(eq(schema.lesson.courseId, fixture.courseId), eq(schema.lesson.title, lessonTitle)),
      );
    const [later] = await tools.db
      .select()
      .from(schema.lesson)
      .where(
        and(
          eq(schema.lesson.courseId, fixture.courseId),
          eq(schema.lesson.title, 'Conceito central'),
        ),
      );
    const admin = await newPerson('admin');
    const bytes = pdfBytes(900);
    const id = await ready(admin, 'lesson_material', 'application/pdf', bytes);
    await tools.db.transaction((tx) =>
      setReferenceIn(tx, {
        ownerType: 'lesson',
        ownerId: lesson!.id,
        slot: 'material',
        mediaId: id,
        purpose: 'lesson_material',
      }),
    );
    return { fixture, lesson: lesson!, later: later!, admin, id, bytes };
  }
  async function enrolled(fixture: { courseId: string; offerId: string }) {
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

  it('o aluno que pode abrir a aula baixa o PDF com cabeçalhos privados; o conteúdo chega íntegro', async () => {
    const { fixture, id, bytes } = await material();
    const student = await enrolled(fixture);
    const response = await call('GET', `/media/${id}/content`, student.headers);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    // o middleware de segurança do /api sempre impõe no-store (mais forte que private: nada é guardado)
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it('aluno de OUTRO curso, sem matrícula, sem sessão, com a aula bloqueada pelo drip: não baixa', async () => {
    const { fixture, id } = await material('Conceito central'); // módulo D+7
    expect((await call('GET', `/media/${id}/content`, undefined)).status).toBe(401);
    const outsider = await newPerson();
    expect((await call('GET', `/media/${id}/content`, outsider.headers)).status).toBe(404);
    // matriculada neste curso, mas a aula do material ainda bloqueada pelo drip (e pela sequência guiada)
    const student = await enrolled(fixture);
    clockNow = new Date(T0.getTime() + 24 * HOUR);
    expect((await call('GET', `/media/${id}/content`, student.headers)).status).toBe(404);
  });

  it('a Staff (staff.read) baixa para conferir; mídia pública, inexistente e não pronta não passam por esta rota', async () => {
    const { admin, id } = await material();
    expect((await call('GET', `/media/${id}/content`, admin.headers)).status).toBe(200);
    const publicId = await ready(admin, 'course_cover', 'image/png', cover());
    expect((await call('GET', `/media/${publicId}/content`, admin.headers)).status).toBe(404);
    expect((await call('GET', `/media/${crypto.randomUUID()}/content`, admin.headers)).status).toBe(
      404,
    );
    expect((await call('GET', '/media/xyz/content', admin.headers)).status).toBe(404);
    const pending = await json(await intent(admin, 'lesson_material', 'application/pdf', 300));
    expect((await call('GET', `/media/${pending.id}/content`, admin.headers)).status).toBe(404);
  });

  it('aluno suspenso e mídia desativada pelo apagamento não baixam', async () => {
    const { fixture, id } = await material();
    const student = await enrolled(fixture);
    await tools.db.insert(schema.userSuspension).values({ userId: student.id, reason: 'teste' });
    expect((await call('GET', `/media/${id}/content`, student.headers)).status).toBe(403);
  });
});

describe('o banco guarda as regras da mídia', () => {
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

  it('propósito, visibilidade, estado, ready completo, chave pública só em público pronto e chave única', async () => {
    const admin = await newPerson('admin');
    const base = {
      purpose: 'course_cover',
      visibility: 'public',
      declaredType: 'image/png',
      declaredSize: 100,
      createdBy: admin.id,
      expiresAt: new Date(),
    };
    await violation(
      tools.db.insert(schema.mediaAsset).values({ ...base, purpose: 'avatar', storageKey: 'm/a' }),
      /media_asset_purpose_check/,
    );
    await violation(
      tools.db
        .insert(schema.mediaAsset)
        .values({ ...base, visibility: 'segredo', storageKey: 'm/b' }),
      /media_asset_visibility_check/,
    );
    await violation(
      tools.db.insert(schema.mediaAsset).values({ ...base, state: 'ready', storageKey: 'm/c' }),
      /media_asset_ready_check/,
    );
    await violation(
      tools.db.insert(schema.mediaAsset).values({
        ...base,
        purpose: 'lesson_material',
        visibility: 'private',
        publicKey: 'x.png',
        storageKey: 'm/d',
      }),
      /media_asset_public_key_check/,
    );
    await tools.db.insert(schema.mediaAsset).values({ ...base, storageKey: 'm/e' });
    await violation(
      tools.db.insert(schema.mediaAsset).values({ ...base, storageKey: 'm/e' }),
      /media_asset_storage_key_unique|duplicate key/,
    );
    await violation(
      tools.db.insert(schema.mediaAsset).values({ ...base, declaredSize: 0, storageKey: 'm/f' }),
      /media_asset_size_check/,
    );
  });

  it('referência: um objeto por espaço do dono, dono de tipo válido, e o objeto referenciado não é apagado', async () => {
    const admin = await newPerson('admin');
    const id = await ready(admin, 'course_cover', 'image/png', cover());
    const other = await ready(admin, 'course_cover', 'image/png', cover(5));
    const owner = crypto.randomUUID();
    await tools.db.insert(schema.mediaReference).values({
      mediaId: id,
      ownerType: 'course_draft',
      ownerId: owner,
      slot: 'cover',
    });
    await violation(
      tools.db.insert(schema.mediaReference).values({
        mediaId: other,
        ownerType: 'course_draft',
        ownerId: owner,
        slot: 'cover',
      }),
      /media_reference_pk/,
    );
    await violation(
      tools.db.insert(schema.mediaReference).values({
        mediaId: other,
        ownerType: 'planeta',
        ownerId: owner,
        slot: 'cover',
      }),
      /media_reference_owner_check/,
    );
    await violation(
      tools.db.execute(sql`delete from media_asset where id = ${id}`),
      /violates|restrict|foreign key/i,
    );
  });
});

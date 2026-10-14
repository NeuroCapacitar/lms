import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { defaultLayout, fieldOf } from '../../src/features/certificate/layout.ts';
import { grantEntitlement } from '../../src/server/access/entitlement-store.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { setCertificatePolicy } from '../../src/server/certificate/certificate-store.ts';
import { completeLesson } from '../../src/server/learning/completion.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { createMemoryStorage, type MemoryStorage } from '../../src/server/media/memory-storage.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { publishDefaultTemplate } from '../helpers/certificate-template.ts';
import { createDemoCourse } from '../helpers/demo-course.ts';
import { pngBytes } from '../helpers/media-bytes.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M7-03 em Postgres 18 real: o template do curso (layout validado no servidor, só do Admin), rascunho com controle
 * otimista de versão, publicação que congela e substitui o anterior, fundo como mídia privada, e a emissão que só
 * acontece com template PUBLICADO e copia o layout para o snapshot (certificados emitidos nunca mudam).
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
    sql`truncate table certificate, certificate_template, certificate_policy, certificate_signatory, certificate_issuer, media_reference, media_asset, outbox_message, course_completion, lesson_completion, entitlement, enrollment, lesson, module, lesson_draft, module_draft, course_content, course_draft, curriculum_state, offer, course cascade`,
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
const course = () => createDemoCourse(tools.db);
const templatePath = (courseId: string, suffix = '') =>
  `/staff/courses/${courseId}/certificate/template${suffix}`;

async function readyAsset(createdBy: string, purpose = 'certificate_asset', state = 'ready') {
  const id = crypto.randomUUID();
  const bytes = pngBytes(1200, 800, 500);
  await tools.db.insert(schema.mediaAsset).values({
    id,
    purpose,
    visibility: purpose === 'certificate_asset' ? 'private' : 'public',
    storageKey: `m/${id}`,
    declaredType: 'image/png',
    declaredSize: bytes.length,
    contentType: 'image/png',
    state,
    size: bytes.length,
    width: 1200,
    height: 800,
    sha256: 'a'.repeat(64),
    confirmedAt: LATE,
    createdBy,
    expiresAt: new Date(LATE.getTime() + 24 * 3_600_000),
  });
  storage.upload(`m/${id}`, bytes, 'image/png');
  return id;
}

const draftBody = (overrides: Record<string, unknown> = {}) => ({
  layout: defaultLayout(),
  backgroundMediaId: null,
  expectedVersion: null,
  ...overrides,
});

describe('autorização', () => {
  it('só o Admin: 401 sem sessão; aluno e Suporte (todos os grants) 403 em todas as rotas; id torto 404', async () => {
    const fixture = await course();
    const student = await newPerson();
    const support = await newPerson('support', ALL_GRANTS);
    const admin = await newPerson('admin');
    const calls: [string, string, unknown?][] = [
      ['GET', templatePath(fixture.courseId)],
      ['PUT', templatePath(fixture.courseId), draftBody()],
      ['POST', templatePath(fixture.courseId, '/publish'), { expectedVersion: 1 }],
      ['POST', templatePath(fixture.courseId, '/discard')],
    ];
    for (const [method, path, body] of calls) {
      expect((await call(method, path, undefined, body)).status, `${method} ${path}`).toBe(401);
      for (const who of [student, support]) {
        expect((await call(method, path, who.headers, body)).status, `${method} ${path}`).toBe(403);
      }
    }
    expect((await call('GET', templatePath('xyz'), admin.headers)).status).toBe(404);
    expect((await call('PUT', templatePath('xyz'), admin.headers, draftBody())).status).toBe(404);
    expect((await call('GET', templatePath(fixture.courseId), admin.headers)).status).toBe(200);
  });
});

describe('rascunho', () => {
  it('sem rascunho nem publicado devolve nulos; o primeiro PUT (expectedVersion null) cria a versão 1', async () => {
    const fixture = await course();
    const admin = await newPerson('admin');
    expect(await json(await call('GET', templatePath(fixture.courseId), admin.headers))).toEqual({
      draft: null,
      published: null,
    });
    const saved = await json(
      await call('PUT', templatePath(fixture.courseId), admin.headers, draftBody()),
    );
    expect(saved.draft).toMatchObject({ status: 'draft', version: 1, backgroundMediaId: null });
    expect(saved.draft.layout).toEqual(defaultLayout());
  });

  it('dois Admins no mesmo rascunho: a versão velha recebe 409 com a versão atual e nada é sobrescrito', async () => {
    const fixture = await course();
    const one = await newPerson('admin');
    const two = await newPerson('admin');
    await call('PUT', templatePath(fixture.courseId), one.headers, draftBody());
    // segundo Admin ainda acha que não há rascunho
    const stale = await call('PUT', templatePath(fixture.courseId), two.headers, draftBody());
    expect(stale.status).toBe(409);
    expect(await json(stale)).toEqual({ error: { code: 'conflict', currentVersion: 1 } });

    const moved = defaultLayout();
    fieldOf(moved, 'title').x = 30;
    expect(
      (
        await call(
          'PUT',
          templatePath(fixture.courseId),
          one.headers,
          draftBody({ layout: moved, expectedVersion: 1 }),
        )
      ).status,
    ).toBe(200);
    // o segundo, ainda com a versão 1, perde
    const outdated = await call(
      'PUT',
      templatePath(fixture.courseId),
      two.headers,
      draftBody({ expectedVersion: 1 }),
    );
    expect(outdated.status).toBe(409);
    expect((await json(outdated)).error.currentVersion).toBe(2);
    const current = await json(await call('GET', templatePath(fixture.courseId), one.headers));
    expect(fieldOf(current.draft.layout, 'title').x).toBe(30);
  });

  it('layout inválido é 400 e não grava: campo faltando, desconhecido, NaN, cor com url()', async () => {
    const fixture = await course();
    const admin = await newPerson('admin');
    const broken = (mutate: (layout: any) => void) => {
      const layout = structuredClone(defaultLayout()) as any;
      mutate(layout);
      return draftBody({ layout });
    };
    for (const body of [
      broken((layout) => layout.fields.pop()),
      broken((layout) => (layout.fields[0].id = 'html')),
      broken((layout) => (layout.fields[0].x = 'NaN')),
      broken((layout) => (layout.fields[0].color = 'url(javascript:alert(1))')),
      broken((layout) => (layout.fields[0].style = 'position:fixed')),
      draftBody({ expectedVersion: 0 }),
      { layout: defaultLayout() },
    ]) {
      expect((await call('PUT', templatePath(fixture.courseId), admin.headers, body)).status).toBe(
        400,
      );
    }
    expect(await tools.db.select().from(schema.certificateTemplate)).toHaveLength(0);
  });

  it('layout com ERRO (fora da página) salva como rascunho, mas NÃO publica (422 com os problemas)', async () => {
    const fixture = await course();
    const admin = await newPerson('admin');
    const bad = defaultLayout();
    Object.assign(fieldOf(bad, 'title'), { x: 200, w: 150 });
    const saved = await call(
      'PUT',
      templatePath(fixture.courseId),
      admin.headers,
      draftBody({ layout: bad }),
    );
    expect(saved.status).toBe(200);
    const published = await call(
      'POST',
      templatePath(fixture.courseId, '/publish'),
      admin.headers,
      { expectedVersion: 1 },
    );
    expect(published.status).toBe(422);
    const body = await json(published);
    expect(body.error.code).toBe('layout_invalid');
    expect(body.error.problems).toContainEqual({
      code: 'out_of_page',
      fieldId: 'title',
      severity: 'error',
    });
    expect(
      (await json(await call('GET', templatePath(fixture.courseId), admin.headers))).published,
    ).toBeNull();
  });

  it('descartar remove só o rascunho (e a referência do fundo dele)', async () => {
    const fixture = await course();
    const admin = await newPerson('admin');
    const media = await readyAsset(admin.id);
    await call(
      'PUT',
      templatePath(fixture.courseId),
      admin.headers,
      draftBody({ backgroundMediaId: media }),
    );
    expect(await tools.db.select().from(schema.mediaReference)).toHaveLength(1);
    expect(
      await json(await call('POST', templatePath(fixture.courseId, '/discard'), admin.headers)),
    ).toEqual({ discarded: true });
    expect(await tools.db.select().from(schema.mediaReference)).toHaveLength(0);
    expect(
      await json(await call('POST', templatePath(fixture.courseId, '/discard'), admin.headers)),
    ).toEqual({ discarded: false });
  });
});

describe('fundo (mídia privada)', () => {
  it('só mídia certificate_asset pronta: capa pública 422, não pronta e inexistente 409; a referência é feita junto', async () => {
    const fixture = await course();
    const admin = await newPerson('admin');
    const path = templatePath(fixture.courseId);
    const wrong = await readyAsset(admin.id, 'course_cover');
    const pending = await readyAsset(admin.id, 'certificate_asset', 'pending_upload');
    expect(
      (await call('PUT', path, admin.headers, draftBody({ backgroundMediaId: wrong }))).status,
    ).toBe(422);
    expect(
      (await call('PUT', path, admin.headers, draftBody({ backgroundMediaId: pending }))).status,
    ).toBe(409);
    expect(
      (
        await call(
          'PUT',
          path,
          admin.headers,
          draftBody({ backgroundMediaId: crypto.randomUUID() }),
        )
      ).status,
    ).toBe(409);
    expect(await tools.db.select().from(schema.certificateTemplate)).toHaveLength(0);

    const good = await readyAsset(admin.id);
    expect(
      (await call('PUT', path, admin.headers, draftBody({ backgroundMediaId: good }))).status,
    ).toBe(200);
    const refs = await tools.db.select().from(schema.mediaReference);
    expect(refs).toMatchObject([
      { mediaId: good, ownerType: 'certificate_template', slot: 'draft_background' },
    ]);
  });
});

describe('publicação', () => {
  it('publica o rascunho: vira o vigente, congela, não sobra rascunho e o fundo muda de espaço; publicar de novo substitui o anterior', async () => {
    const fixture = await course();
    const admin = await newPerson('admin');
    const media = await readyAsset(admin.id);
    await call(
      'PUT',
      templatePath(fixture.courseId),
      admin.headers,
      draftBody({ backgroundMediaId: media }),
    );
    // versão errada: 409
    expect(
      (
        await call('POST', templatePath(fixture.courseId, '/publish'), admin.headers, {
          expectedVersion: 7,
        })
      ).status,
    ).toBe(409);
    const published = await json(
      await call('POST', templatePath(fixture.courseId, '/publish'), admin.headers, {
        expectedVersion: 1,
      }),
    );
    expect(published.published).toMatchObject({ status: 'published', backgroundMediaId: media });
    expect(published.published.publishedAt).not.toBeNull();
    const state = await json(await call('GET', templatePath(fixture.courseId), admin.headers));
    expect(state.draft).toBeNull();
    expect(state.published.id).toBe(published.published.id);
    const refs = await tools.db.select().from(schema.mediaReference);
    expect(refs).toMatchObject([{ slot: 'published_background', mediaId: media }]);

    // segundo ciclo: novo rascunho a partir do publicado, publicar substitui
    const edited = defaultLayout();
    fieldOf(edited, 'holderName').fontSize = 28;
    await call('PUT', templatePath(fixture.courseId), admin.headers, draftBody({ layout: edited }));
    const second = await json(
      await call('POST', templatePath(fixture.courseId, '/publish'), admin.headers, {
        expectedVersion: 1,
      }),
    );
    expect(second.published.id).not.toBe(published.published.id);
    const rows = await tools.db.select().from(schema.certificateTemplate);
    expect(rows.map((row) => row.status).sort()).toEqual(['published', 'superseded']);
    expect(rows.find((row) => row.status === 'superseded')!.id).toBe(published.published.id);
  });

  it('sem rascunho, publicar é 409 draft_missing', async () => {
    const fixture = await course();
    const admin = await newPerson('admin');
    const response = await call('POST', templatePath(fixture.courseId, '/publish'), admin.headers, {
      expectedVersion: 1,
    });
    expect(response.status).toBe(409);
    expect(await json(response)).toEqual({ error: { code: 'draft_missing' } });
  });

  it('auditoria de salvar, publicar e descartar', async () => {
    const fixture = await course();
    const admin = await newPerson('admin');
    await call('PUT', templatePath(fixture.courseId), admin.headers, draftBody());
    await call('POST', templatePath(fixture.courseId, '/publish'), admin.headers, {
      expectedVersion: 1,
    });
    await call('PUT', templatePath(fixture.courseId), admin.headers, draftBody());
    await call('POST', templatePath(fixture.courseId, '/discard'), admin.headers);
    const actions = (
      await tools.db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.targetId, fixture.courseId))
    ).map((row) => row.action);
    for (const action of [
      'certificate.template.save_draft',
      'certificate.template.publish',
      'certificate.template.discard_draft',
    ]) {
      expect(actions, action).toContain(action);
    }
  });
});

describe('restrições do banco', () => {
  it('o publicado e o superseded não mudam; só um rascunho e um publicado por curso; só rascunho se apaga', async () => {
    const fixture = await course();
    const admin = await newPerson('admin');
    const published = await publishDefaultTemplate(tools.db, {
      actorId: admin.id,
      courseId: fixture.courseId,
    });
    await expect(
      tools.db.execute(
        sql`update certificate_template set layout = '{}'::jsonb where id = ${published.id}`,
      ),
    ).rejects.toThrow();
    await expect(
      tools.db.execute(sql`delete from certificate_template where id = ${published.id}`),
    ).rejects.toThrow();
    await expect(
      tools.db.execute(
        sql`update certificate_template set status = 'draft', published_at = null where id = ${published.id}`,
      ),
    ).rejects.toThrow();
    // um segundo publicado do mesmo curso é impossível
    await expect(
      tools.db.insert(schema.certificateTemplate).values({
        courseId: fixture.courseId,
        status: 'published',
        publishedAt: new Date(),
        layout: defaultLayout(),
      }),
    ).rejects.toThrow();
  });
});

describe('emissão com template', () => {
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
  async function finish(fixture: Awaited<ReturnType<typeof course>>, userId: string) {
    const rows = await tools.db
      .select({ id: schema.lesson.id, title: schema.lesson.title })
      .from(schema.lesson)
      .where(eq(schema.lesson.courseId, fixture.courseId));
    const byTitle = Object.fromEntries(rows.map((row) => [row.title, row.id]));
    for (const title of REQUIRED) {
      await completeLesson(tools.db, { userId, lessonId: byTitle[title]!, clock: () => LATE });
    }
  }

  it('com a política ligada mas SEM template publicado, a conclusão existe e nenhum certificado nasce', async () => {
    const fixture = await course();
    const admin = await newPerson('admin');
    await setCertificatePolicy(tools.db, {
      actorId: admin.id,
      courseId: fixture.courseId,
      enabled: true,
    });
    const holder = await student(fixture);
    await finish(fixture, holder.id);
    expect(await tools.db.select().from(schema.courseCompletion)).toHaveLength(1);
    expect(await tools.db.select().from(schema.certificate)).toHaveLength(0);
    expect(await tools.db.select().from(schema.outboxMessage)).toHaveLength(0);
  });

  it('um rascunho NÃO basta: só o template PUBLICADO libera a emissão', async () => {
    const fixture = await course();
    const admin = await newPerson('admin');
    await setCertificatePolicy(tools.db, {
      actorId: admin.id,
      courseId: fixture.courseId,
      enabled: true,
    });
    await call('PUT', templatePath(fixture.courseId), admin.headers, draftBody());
    const holder = await student(fixture);
    await finish(fixture, holder.id);
    expect(await tools.db.select().from(schema.certificate)).toHaveLength(0);
  });

  it('o snapshot copia o layout e o fundo do publicado; trocar o template depois NÃO altera o certificado emitido', async () => {
    const fixture = await course();
    const admin = await newPerson('admin');
    const media = await readyAsset(admin.id);
    await setCertificatePolicy(tools.db, {
      actorId: admin.id,
      courseId: fixture.courseId,
      enabled: true,
    });
    const first = defaultLayout();
    fieldOf(first, 'holderName').fontSize = 30;
    await call(
      'PUT',
      templatePath(fixture.courseId),
      admin.headers,
      draftBody({ layout: first, backgroundMediaId: media }),
    );
    await call('POST', templatePath(fixture.courseId, '/publish'), admin.headers, {
      expectedVersion: 1,
    });

    const holder = await student(fixture);
    await finish(fixture, holder.id);
    const [issued] = await tools.db.select().from(schema.certificate);
    expect(fieldOf((issued!.snapshot as any).layout, 'holderName').fontSize).toBe(30);
    expect((issued!.snapshot as any).backgroundMediaId).toBe(media);
    const frozen = JSON.stringify(issued!.snapshot);

    // novo template publicado: o certificado emitido fica como estava
    const second = defaultLayout();
    fieldOf(second, 'holderName').fontSize = 20;
    await call('PUT', templatePath(fixture.courseId), admin.headers, draftBody({ layout: second }));
    await call('POST', templatePath(fixture.courseId, '/publish'), admin.headers, {
      expectedVersion: 1,
    });
    const [after] = await tools.db.select().from(schema.certificate);
    expect(JSON.stringify(after!.snapshot)).toBe(frozen);
  });
});

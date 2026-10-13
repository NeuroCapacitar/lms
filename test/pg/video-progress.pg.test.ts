import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { grantEntitlement } from '../../src/server/access/entitlement-store.ts';
import { grantRole } from '../../src/server/auth/access-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createDemoCourse } from '../helpers/demo-course.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M5-02 em Postgres 18 real: progresso de aula de vídeo. Conclui no limiar do curso (89% não, 90% sim), com a
 * MAIOR posição monotônica, `seq` por sessão, posição limitada à duração, drip e acesso reverificados a cada
 * envio, prévia da Staff sem gravar, conclusão idempotente com evidência e sem conclusão manual de vídeo.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const T0 = new Date('2026-10-11T12:00:00.000Z');
/** Todos os módulos do demonstrativo (D+0, D+7, D+14) já liberados pelo drip. */
const LATE = new Date('2026-10-30T12:00:00.000Z');
const DURATION = 600;

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let seq = 0;
let clockNow = LATE;

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
  await tools.db.execute(
    sql`truncate table video_progress, video_asset, video_provider_connection, course_completion, lesson_completion, entitlement, enrollment, lesson, module, lesson_draft, module_draft, course_content, course_draft, curriculum_state, offer, course cascade`,
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
    isStaffEmail: async () => false,
    clock: () => clockNow,
  });

async function newStudent() {
  seq += 1;
  const user = tools.test.createUser({ email: `aluno${seq}@example.test`, name: `Aluno ${seq}` });
  await tools.test.saveUser(user);
  return { id: user.id, headers: (await tools.test.login({ userId: user.id })).headers };
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

/** O demonstrativo com a primeira aula (Boas-vindas, módulo D+0) e uma de módulo futuro viradas em VÍDEO. */
async function videoCourse(
  options: { duration?: number | null; state?: string; percent?: number } = {},
) {
  const fixture = await createDemoCourse(tools.db);
  const rows = await tools.db
    .select({ id: schema.lesson.id, title: schema.lesson.title })
    .from(schema.lesson)
    .where(eq(schema.lesson.courseId, fixture.courseId));
  const lesson = Object.fromEntries(rows.map((row) => [row.title, row.id])) as Record<
    string,
    string
  >;

  const connectionId = crypto.randomUUID();
  await tools.db.insert(schema.videoProviderConnection).values({
    id: connectionId,
    provider: 'youtube',
    label: 'público',
  });
  const [asset] = await tools.db
    .insert(schema.videoAsset)
    .values({
      connectionId,
      provider: 'youtube',
      externalId: 'abc123xyz',
      mode: 'referenced',
      state: options.state ?? 'ready',
      durationSeconds: options.duration === undefined ? DURATION : options.duration,
      capabilities: { reportsTime: true, reportsEnded: true, resume: true, ignored: false },
    })
    .returning();
  const [lateAsset] = await tools.db
    .insert(schema.videoAsset)
    .values({
      connectionId,
      provider: 'youtube',
      externalId: 'late456',
      mode: 'referenced',
      state: 'ready',
      durationSeconds: DURATION,
    })
    .returning();
  for (const [title, assetId] of [
    ['Boas-vindas', asset!.id],
    ['Conceito central', lateAsset!.id],
  ] as const) {
    await tools.db
      .update(schema.lesson)
      .set({ kind: 'video', videoAssetId: assetId })
      .where(eq(schema.lesson.id, lesson[title]!));
  }
  if (options.percent !== undefined) {
    await tools.db
      .update(schema.course)
      .set({ videoCompletionPercent: options.percent })
      .where(eq(schema.course.id, fixture.courseId));
  }
  return { ...fixture, lesson, assetId: asset!.id, lateAssetId: lateAsset!.id, connectionId };
}

async function enrolled(courseId: string, offerId: string, accessMonths = 12) {
  const student = await newStudent();
  await grantEntitlement(tools.db, {
    userId: student.id,
    courseId,
    offerId,
    source: 'free_offer',
    sourceRef: `free:${student.id}:${offerId}:0`,
    accessMonths,
    startsAt: T0,
    grantedBy: student.id,
  });
  return student;
}

const SESSION_A = 'sessao-aba-a-0001';
const SESSION_B = 'sessao-aba-b-0002';
function report(
  headers: Headers | undefined,
  lessonId: string,
  assetId: string,
  position: number,
  sequence: number,
  options: { session?: string; duration?: number } = {},
) {
  return call('POST', `/lessons/${lessonId}/video-progress`, headers, {
    videoAssetId: assetId,
    playbackSessionId: options.session ?? SESSION_A,
    seq: sequence,
    position,
    ...(options.duration === undefined ? {} : { duration: options.duration }),
  });
}
const progressOf = async (userId: string, lessonId: string) =>
  (
    await tools.db
      .select()
      .from(schema.videoProgress)
      .where(
        sql`${schema.videoProgress.userId} = ${userId} and ${schema.videoProgress.lessonId} = ${lessonId}`,
      )
  )[0];
const completionsOf = (userId: string) =>
  tools.db.select().from(schema.lessonCompletion).where(eq(schema.lessonCompletion.userId, userId));

describe('o limiar de conclusão (90% por padrão)', () => {
  it('89% não conclui; 90% conclui, com a evidência e o método video', async () => {
    const { courseId, offerId, lesson, assetId } = await videoCourse();
    const student = await enrolled(courseId, offerId);
    const below = await report(student.headers, lesson['Boas-vindas']!, assetId, 539, 1);
    expect(below.status).toBe(200);
    expect(await json(below)).toMatchObject({
      status: 'updated',
      maxPosition: 539,
      completed: false,
    });
    expect(await completionsOf(student.id)).toHaveLength(0);

    const at = await report(student.headers, lesson['Boas-vindas']!, assetId, 540, 2);
    const body = await json(at);
    expect(body).toMatchObject({ status: 'updated', maxPosition: 540, completed: true });
    expect(body.completion).toMatchObject({ status: 'completed', courseJustCompleted: false });

    const [completion] = await completionsOf(student.id);
    expect(completion).toMatchObject({ lessonId: lesson['Boas-vindas'], method: 'video' });
    const row = await progressOf(student.id, lesson['Boas-vindas']!);
    expect(row!.completedAt).not.toBeNull();
    expect(row!.evidence).toEqual({
      provider: 'youtube',
      videoAssetId: assetId,
      position: 540,
      duration: DURATION,
      percent: 90,
      serverTime: LATE.toISOString(),
    });
  });

  it('seek direto ao limiar no PRIMEIRO envio conclui', async () => {
    const { courseId, offerId, lesson, assetId } = await videoCourse();
    const student = await enrolled(courseId, offerId);
    const response = await report(student.headers, lesson['Boas-vindas']!, assetId, 540, 1);
    expect(await json(response)).toMatchObject({ completed: true });
  });

  it('o limiar do curso vale (80% conclui em 480 s)', async () => {
    const { courseId, offerId, lesson, assetId } = await videoCourse({ percent: 80 });
    const student = await enrolled(courseId, offerId);
    expect(
      await json(await report(student.headers, lesson['Boas-vindas']!, assetId, 479, 1)),
    ).toMatchObject({ completed: false });
    expect(
      await json(await report(student.headers, lesson['Boas-vindas']!, assetId, 480, 2)),
    ).toMatchObject({ completed: true });
  });

  it('posição acima da duração é limitada à duração (e conclui); a fração é descartada para baixo', async () => {
    const { courseId, offerId, lesson, assetId } = await videoCourse();
    const student = await enrolled(courseId, offerId);
    const response = await report(student.headers, lesson['Boas-vindas']!, assetId, 539.99, 1);
    expect(await json(response)).toMatchObject({ maxPosition: 539, completed: false });
    const over = await report(student.headers, lesson['Boas-vindas']!, assetId, 99_999, 2);
    expect(await json(over)).toMatchObject({ maxPosition: DURATION, completed: true });
  });
});

describe('monotonicidade, seq e abas', () => {
  it('guarda a MAIOR posição: voltar no vídeo não a reduz (nem o gatilho do banco deixa)', async () => {
    const { courseId, offerId, lesson, assetId } = await videoCourse();
    const student = await enrolled(courseId, offerId);
    await report(student.headers, lesson['Boas-vindas']!, assetId, 300, 1);
    const back = await report(student.headers, lesson['Boas-vindas']!, assetId, 10, 2);
    expect(await json(back)).toMatchObject({ status: 'updated', maxPosition: 300 });
    expect((await progressOf(student.id, lesson['Boas-vindas']!))!.maxPosition).toBe(300);
    await expect(
      tools.db.execute(
        sql`update video_progress set max_position = 5 where user_id = ${student.id} and lesson_id = ${lesson['Boas-vindas']}`,
      ),
    ).rejects.toThrow();
  });

  it('seq repetido ou menor na MESMA sessão é ignorado (sem gravar); a posição maior atrasada não vale', async () => {
    const { courseId, offerId, lesson, assetId } = await videoCourse();
    const student = await enrolled(courseId, offerId);
    await report(student.headers, lesson['Boas-vindas']!, assetId, 100, 5);
    for (const sequence of [5, 4, 0]) {
      const stale = await report(student.headers, lesson['Boas-vindas']!, assetId, 500, sequence);
      expect(await json(stale), `seq ${sequence}`).toMatchObject({
        status: 'ignored',
        maxPosition: 100,
      });
    }
    const row = await progressOf(student.id, lesson['Boas-vindas']!);
    expect(row).toMatchObject({ maxPosition: 100, lastSeq: 5 });
  });

  it('duas abas (sessões) têm contadores próprios: a segunda não é tratada como atrasada e vale a maior posição', async () => {
    const { courseId, offerId, lesson, assetId } = await videoCourse();
    const student = await enrolled(courseId, offerId);
    await report(student.headers, lesson['Boas-vindas']!, assetId, 200, 50, { session: SESSION_A });
    const other = await report(student.headers, lesson['Boas-vindas']!, assetId, 150, 1, {
      session: SESSION_B,
    });
    expect(await json(other)).toMatchObject({ status: 'updated', maxPosition: 200 });
    const again = await report(student.headers, lesson['Boas-vindas']!, assetId, 260, 51, {
      session: SESSION_A,
    });
    expect(await json(again)).toMatchObject({ status: 'updated', maxPosition: 260 });
  });

  it('reprodução em 2× (envios rápidos e crescentes) acumula sem perder posição', async () => {
    const { courseId, offerId, lesson, assetId } = await videoCourse();
    const student = await enrolled(courseId, offerId);
    let last: Record<string, any> = {};
    for (let step = 1; step <= 12; step += 1) {
      last = await json(
        await report(student.headers, lesson['Boas-vindas']!, assetId, step * 40, step),
      );
    }
    expect(last).toMatchObject({ maxPosition: 480, completed: false });
  });

  it('concluída: envios seguintes são ignorados e a conclusão (e a evidência) não mudam', async () => {
    const { courseId, offerId, lesson, assetId } = await videoCourse();
    const student = await enrolled(courseId, offerId);
    await report(student.headers, lesson['Boas-vindas']!, assetId, 600, 1);
    const [before] = await completionsOf(student.id);
    const again = await report(student.headers, lesson['Boas-vindas']!, assetId, 10, 2);
    expect(await json(again)).toMatchObject({ status: 'ignored', completed: true });
    const rows = await completionsOf(student.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.completedAt).toEqual(before!.completedAt);
    await expect(
      tools.db.execute(
        sql`update video_progress set evidence = '{}'::jsonb where user_id = ${student.id}`,
      ),
    ).rejects.toThrow();
  });

  it('envios SIMULTÂNEOS que cruzam o limiar geram UMA conclusão', async () => {
    const { courseId, offerId, lesson, assetId } = await videoCourse();
    const student = await enrolled(courseId, offerId);
    const responses = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        report(student.headers, lesson['Boas-vindas']!, assetId, 560, n, {
          session: `sessao-simultanea-${n}0`,
        }),
      ),
    );
    for (const response of responses) expect(response.status).toBe(200);
    expect(await completionsOf(student.id)).toHaveLength(1);
  });
});

describe('acesso, drip e prévia (a cada envio)', () => {
  it('sem sessão 401; id malformado 404; aula inexistente 404; sem Origin 403 (CSRF)', async () => {
    const { lesson, assetId } = await videoCourse();
    expect((await report(undefined, lesson['Boas-vindas']!, assetId, 10, 1)).status).toBe(401);
    const student = await newStudent();
    expect((await call('POST', '/lessons/xyz/video-progress', student.headers, {})).status).toBe(
      404,
    );
    expect((await report(student.headers, crypto.randomUUID(), assetId, 10, 1)).status).toBe(404);
    const noOrigin = await app().request(
      `/api/lessons/${lesson['Boas-vindas']}/video-progress`,
      { method: 'POST', headers: new Headers({ 'content-type': 'application/json' }), body: '{}' },
      env(),
    );
    expect(noOrigin.status).toBe(403);
  });

  it('aula de módulo ainda NÃO liberado pelo drip: 403 lesson_locked e nada gravado', async () => {
    const { courseId, offerId, lesson, lateAssetId } = await videoCourse();
    clockNow = new Date(T0.getTime() + 60_000); // só o módulo 1 está liberado
    const student = await enrolled(courseId, offerId);
    const response = await report(
      student.headers,
      lesson['Conceito central']!,
      lateAssetId,
      540,
      1,
    );
    expect(response.status).toBe(403);
    expect((await json(response)).error).toMatchObject({ code: 'lesson_locked' });
    expect(await progressOf(student.id, lesson['Conceito central']!)).toBeUndefined();
    expect(await completionsOf(student.id)).toHaveLength(0);
  });

  it('acesso EXPIRADO no meio da reprodução: 403 e nada é gravado; o progresso anterior fica intacto', async () => {
    const { courseId, offerId, lesson, assetId } = await videoCourse();
    const student = await enrolled(courseId, offerId, 1); // 1 mês de acesso
    clockNow = new Date('2026-10-20T12:00:00.000Z');
    await report(student.headers, lesson['Boas-vindas']!, assetId, 300, 1);
    clockNow = new Date('2026-12-30T12:00:00.000Z'); // depois de expirar
    const response = await report(student.headers, lesson['Boas-vindas']!, assetId, 560, 2);
    expect(response.status).toBe(403);
    expect((await json(response)).error).toMatchObject({
      code: 'access_denied',
      reason: 'expired',
    });
    expect((await progressOf(student.id, lesson['Boas-vindas']!))!.maxPosition).toBe(300);
    expect(await completionsOf(student.id)).toHaveLength(0);
  });

  it('quem NÃO está matriculado (e a Staff na prévia) não grava nada: 403', async () => {
    const { courseId, lesson, assetId } = await videoCourse();
    const outsider = await newStudent();
    expect((await report(outsider.headers, lesson['Boas-vindas']!, assetId, 600, 1)).status).toBe(
      403,
    );

    seq += 1;
    const staffUser = tools.test.createUser({ email: `staff${seq}@example.test`, name: 'Staff' });
    await tools.test.saveUser(staffUser);
    await grantRole(tools.db, { actorId: null, targetId: staffUser.id, role: 'admin' });
    const staff = await tools.test.login({ userId: staffUser.id });
    expect((await report(staff.headers, lesson['Boas-vindas']!, assetId, 600, 1)).status).toBe(403);
    expect(await tools.db.select().from(schema.videoProgress)).toHaveLength(0);
    expect(await tools.db.select().from(schema.lessonCompletion)).toHaveLength(0);

    // A prévia mostra o vídeo, sem progresso nem retomada, e não grava.
    const preview = await call(
      'GET',
      `/staff/preview/courses/${courseId}/lessons/${lesson['Boas-vindas']}`,
      staff.headers,
    );
    expect(preview.status).toBe(200);
    const view = await json(preview);
    expect(view.lesson).toMatchObject({
      kind: 'video',
      video: { provider: 'youtube', maxPosition: 0, durationSeconds: DURATION },
    });
    expect(await tools.db.select().from(schema.videoProgress)).toHaveLength(0);
  });
});

describe('o vídeo da aula e o corpo do envio', () => {
  it('corpo inválido: 400 (campo a mais, sessão malformada, seq e posição absurdos)', async () => {
    const { courseId, offerId, lesson, assetId } = await videoCourse();
    const student = await enrolled(courseId, offerId);
    for (const body of [
      {},
      { videoAssetId: assetId, playbackSessionId: SESSION_A, seq: 1, position: 1, extra: 1 },
      { videoAssetId: 'nao-uuid', playbackSessionId: SESSION_A, seq: 1, position: 1 },
      { videoAssetId: assetId, playbackSessionId: 'x', seq: 1, position: 1 },
      { videoAssetId: assetId, playbackSessionId: SESSION_A, seq: -1, position: 1 },
      { videoAssetId: assetId, playbackSessionId: SESSION_A, seq: 1, position: -1 },
    ]) {
      expect(
        (
          await call(
            'POST',
            `/lessons/${lesson['Boas-vindas']}/video-progress`,
            student.headers,
            body,
          )
        ).status,
      ).toBe(400);
    }
    expect(await tools.db.select().from(schema.videoProgress)).toHaveLength(0);
  });

  it('o videoAssetId do envio precisa ser o vídeo DESTA aula (409 video_asset_mismatch)', async () => {
    const { courseId, offerId, lesson, lateAssetId } = await videoCourse();
    const student = await enrolled(courseId, offerId);
    const response = await report(student.headers, lesson['Boas-vindas']!, lateAssetId, 600, 1);
    expect(response.status).toBe(409);
    expect((await json(response)).error).toEqual({ code: 'video_asset_mismatch' });
    expect(await tools.db.select().from(schema.videoProgress)).toHaveLength(0);
  });

  it('vídeo ainda processando: 409 not_ready; sem duração conhecida e sem duração do player: 409 duration_unknown', async () => {
    const processing = await videoCourse({ state: 'processing' });
    const student = await enrolled(processing.courseId, processing.offerId);
    const notReady = await report(
      student.headers,
      processing.lesson['Boas-vindas']!,
      processing.assetId,
      10,
      1,
    );
    expect(notReady.status).toBe(409);
    expect((await json(notReady)).error).toMatchObject({ reason: 'not_ready' });
  });

  it('duração desconhecida: o PRIMEIRO valor plausível do player congela e o resto é ignorado', async () => {
    const { courseId, offerId, lesson, assetId } = await videoCourse({ duration: null });
    const student = await enrolled(courseId, offerId);
    const without = await report(student.headers, lesson['Boas-vindas']!, assetId, 10, 1);
    expect(without.status).toBe(409);
    expect((await json(without)).error).toMatchObject({ reason: 'duration_unknown' });
    const absurd = await report(student.headers, lesson['Boas-vindas']!, assetId, 10, 1, {
      duration: 100_000,
    });
    expect(absurd.status).toBe(409);

    const first = await report(student.headers, lesson['Boas-vindas']!, assetId, 100, 1, {
      duration: 600.8,
    });
    expect(await json(first)).toMatchObject({ status: 'updated', durationSeconds: 600 });
    // Outro valor depois NÃO muda a duração (mudança exige ressincronização pela Staff).
    const second = await report(student.headers, lesson['Boas-vindas']!, assetId, 200, 2, {
      duration: 60,
    });
    expect(await json(second)).toMatchObject({ durationSeconds: 600, maxPosition: 200 });
    const [asset] = await tools.db
      .select()
      .from(schema.videoAsset)
      .where(eq(schema.videoAsset.id, assetId));
    expect(asset!.durationSeconds).toBe(600);
  });

  it('com a duração conhecida do provider, a duração do cliente é IGNORADA', async () => {
    const { courseId, offerId, lesson, assetId } = await videoCourse();
    const student = await enrolled(courseId, offerId);
    const response = await report(student.headers, lesson['Boas-vindas']!, assetId, 100, 1, {
      duration: 60,
    });
    expect(await json(response)).toMatchObject({ durationSeconds: DURATION });
  });

  it('NÃO há conclusão manual de vídeo, e a aula de TEXTO não aceita progresso de vídeo (404)', async () => {
    const { courseId, offerId, lesson, assetId } = await videoCourse();
    const student = await enrolled(courseId, offerId);
    expect(
      (await call('POST', `/lessons/${lesson['Boas-vindas']}/complete`, student.headers, {}))
        .status,
    ).toBe(404);
    expect(
      (await report(student.headers, lesson['Como estudar aqui']!, assetId, 10, 1)).status,
    ).toBe(404);
    expect(await completionsOf(student.id)).toHaveLength(0);
  });

  it('a aula traz o vídeo para o player: provider, id público, só as capabilities declaradas e o ponto de retomada', async () => {
    const { courseId, offerId, lesson, assetId } = await videoCourse();
    const student = await enrolled(courseId, offerId);
    await report(student.headers, lesson['Boas-vindas']!, assetId, 321, 1);
    const response = await call('GET', `/lessons/${lesson['Boas-vindas']}`, student.headers);
    expect(response.status).toBe(200);
    const view = await json(response);
    expect(view.lesson).toMatchObject({
      kind: 'video',
      video: {
        assetId,
        provider: 'youtube',
        externalId: 'abc123xyz',
        durationSeconds: DURATION,
        capabilities: { reportsTime: true, reportsEnded: true, resume: true },
        maxPosition: 321,
        completionPercent: 90,
      },
    });
    // Capability não declarada (false) não aparece, e nunca há segredo de conexão.
    expect(view.lesson.video.capabilities.ignored).toBeUndefined();
    expect(JSON.stringify(view)).not.toMatch(/ciphertext|nonce|connectionId|secret/i);
  });

  it('trocaram o vídeo da aula antes de concluir: o progresso recomeça no vídeo novo', async () => {
    const { courseId, offerId, lesson, assetId, lateAssetId } = await videoCourse();
    const student = await enrolled(courseId, offerId);
    await report(student.headers, lesson['Boas-vindas']!, assetId, 400, 1);
    await tools.db
      .update(schema.lesson)
      .set({ videoAssetId: lateAssetId })
      .where(eq(schema.lesson.id, lesson['Boas-vindas']!));
    const response = await report(student.headers, lesson['Boas-vindas']!, lateAssetId, 30, 1);
    expect(await json(response)).toMatchObject({ status: 'updated', maxPosition: 30 });
    expect(await progressOf(student.id, lesson['Boas-vindas']!)).toMatchObject({
      videoAssetId: lateAssetId,
      maxPosition: 30,
    });
  });
});

describe('conclusão do curso pelo vídeo', () => {
  it('a última obrigatória sendo o vídeo cria a conclusão do curso UMA vez', async () => {
    const { courseId, offerId, lesson, assetId, lateAssetId } = await videoCourse();
    // A última obrigatória do curso (Próximos passos) também vira vídeo.
    await tools.db
      .update(schema.lesson)
      .set({ kind: 'video', videoAssetId: lateAssetId })
      .where(eq(schema.lesson.id, lesson['Próximos passos']!));
    const student = await enrolled(courseId, offerId);
    const text = (title: string) =>
      call('POST', `/lessons/${lesson[title]}/complete`, student.headers, {});

    // Na ordem do curso (sequência guiada): vídeo, texto, vídeo, texto e, por último, o vídeo.
    expect(
      (await json(await report(student.headers, lesson['Boas-vindas']!, assetId, 600, 1)))
        .completed,
    ).toBe(true);
    expect((await text('Como estudar aqui')).status).toBe(201);
    const middle = await report(student.headers, lesson['Conceito central']!, lateAssetId, 600, 1);
    expect((await json(middle)).completion).toMatchObject({ courseJustCompleted: false });
    expect((await text('Revisão')).status).toBe(201);
    expect(
      await tools.db
        .select()
        .from(schema.courseCompletion)
        .where(eq(schema.courseCompletion.userId, student.id)),
    ).toHaveLength(0);

    const last = await report(student.headers, lesson['Próximos passos']!, lateAssetId, 600, 1);
    const body = await json(last);
    expect(body.completion).toMatchObject({ courseJustCompleted: true, courseCompleted: true });
    expect(
      await tools.db
        .select()
        .from(schema.courseCompletion)
        .where(eq(schema.courseCompletion.userId, student.id)),
    ).toHaveLength(1);

    // Repetir não cria outra conclusão do curso.
    const again = await report(student.headers, lesson['Próximos passos']!, lateAssetId, 600, 2);
    expect(await json(again)).toMatchObject({ status: 'ignored' });
    expect(
      await tools.db
        .select()
        .from(schema.courseCompletion)
        .where(eq(schema.courseCompletion.userId, student.id)),
    ).toHaveLength(1);
    const methods = (await completionsOf(student.id)).map((row) => row.method).sort();
    expect(methods).toEqual(['manual', 'manual', 'video', 'video', 'video']);
  });
});

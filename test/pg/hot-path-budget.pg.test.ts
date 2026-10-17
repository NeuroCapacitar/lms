import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { grantEntitlement } from '../../src/server/access/entitlement-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createDemoCourse } from '../helpers/demo-course.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';
import { countQueries } from '../helpers/query-count.ts';

/**
 * M9-07 em Postgres 18 real: ORÇAMENTO DE IDAS AO BANCO por rota quente. Cada `query` do cliente `pg` (inclusive BEGIN e COMMIT) é uma
 * viagem ao Neon pelo Hyperdrive; a contagem por requisição é o que dá a latência e o uso de conexão da rota. Os tetos abaixo vêm da
 * MEDIÇÃO (ver docs/review/evidencias/m9-07/) com uma folga curta: subir um teto exige um motivo escrito. Isto NÃO mede CPU do Worker
 * nem a latência real (isso é no Staging, M9-07 passo 3 e 6).
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const T0 = new Date('2026-10-11T12:00:00.000Z');
const LATE = new Date('2026-10-30T12:00:00.000Z');
const DURATION = 600;

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let seq = 0;

beforeAll(async () => {
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
}, 120_000);
afterAll(async () => {
  await tools.close();
  await database.drop();
});

const env = () =>
  ({
    HYPERDRIVE: { connectionString: database.connectionString },
    APP_BASE_URL: BASE_URL,
    BETTER_AUTH_SECRET: SECRET,
    TURNSTILE_SECRET_KEY: 'x',
  }) as unknown as Env;
const application = () =>
  apiApp({
    emailSender: createFakeEmailSender(),
    isStaffEmail: async () => false,
    clock: () => LATE,
  });

function call(method: string, path: string, headers: Headers, body?: unknown) {
  const merged = new Headers(headers);
  merged.set('origin', BASE_URL);
  merged.set('content-type', 'application/json');
  return application().request(
    `/api${path}`,
    { method, headers: merged, ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}) },
    env(),
  );
}

async function student(courseId: string, offerId: string) {
  seq += 1;
  const user = tools.test.createUser({
    email: `orc${seq}@orcamento.example.test`,
    name: `Orc ${seq}`,
  });
  await tools.test.saveUser(user);
  await grantEntitlement(tools.db, {
    userId: user.id,
    courseId,
    offerId,
    source: 'free_offer',
    sourceRef: `free:${user.id}:${offerId}:0`,
    accessMonths: 12,
    startsAt: T0,
    grantedBy: user.id,
  });
  return { id: user.id, headers: (await tools.test.login({ userId: user.id })).headers };
}

let fixture: Awaited<ReturnType<typeof setup>>;
async function setup() {
  const demo = await createDemoCourse(tools.db);
  const rows = await tools.db
    .select({ id: schema.lesson.id, title: schema.lesson.title })
    .from(schema.lesson)
    .where(eq(schema.lesson.courseId, demo.courseId));
  const lesson = Object.fromEntries(rows.map((row) => [row.title, row.id])) as Record<
    string,
    string
  >;
  const connectionId = crypto.randomUUID();
  await tools.db
    .insert(schema.videoProviderConnection)
    .values({ id: connectionId, provider: 'youtube', label: 'público' });
  const [asset] = await tools.db
    .insert(schema.videoAsset)
    .values({
      connectionId,
      provider: 'youtube',
      externalId: 'orcamento',
      mode: 'referenced',
      state: 'ready',
      durationSeconds: DURATION,
      capabilities: { reportsTime: true, reportsEnded: true, resume: true, ignored: false },
    })
    .returning();
  await tools.db
    .update(schema.lesson)
    .set({ kind: 'video', videoAssetId: asset!.id })
    .where(eq(schema.lesson.id, lesson['Boas-vindas']!));
  // Sequência livre: a rota da aula de texto não depende de concluir as anteriores (o que se mede é o caminho, não a regra).
  await tools.db
    .update(schema.course)
    .set({ sequenceMode: 'free' })
    .where(eq(schema.course.id, demo.courseId));
  return { ...demo, lesson, assetId: asset!.id };
}

/**
 * Tetos de idas ao banco por rota quente = o que foi MEDIDO em 2026-10-17 (docs/review/evidencias/m9-07/). Servem de guarda de regressão:
 * uma rota que passe a fazer MAIS idas falha aqui. Baixar o teto exige uma otimização medida; subir exige motivo escrito.
 * Medido antes de `withSessionOnce` (ADR 0032): 9, 20, 21, 20, 22, 21 e 15; a sessão era lida duas vezes por requisição. O que sobra de custo:
 * o mapa, a aula, a conclusão e o heartbeat recarregam a árvore do currículo publicado para decidir drip e sequência (decisão: não mexer, ADR 0032).
 */
const BUDGET = {
  sessao: 7,
  mapa: 18,
  aula_texto: 19,
  concluir_aula_texto: 18,
  heartbeat_video: 20,
  heartbeat_repetido: 19,
  catalogo: 13,
} as const;

const measured: Record<string, number> = {};
async function measure(name: keyof typeof BUDGET, run: () => Promise<Response>) {
  const { result, statements } = await countQueries(run);
  const body = await result.text();
  expect(result.status, `${name} respondeu ${result.status}: ${body.slice(0, 200)}`).toBeLessThan(
    300,
  );
  measured[name] = statements.length;
  console.info(`[orçamento] ${name}: ${statements.length} idas ao banco`);
  for (const text of statements) console.info(`    ${text.slice(0, 110)}`);
  return statements;
}

describe('idas ao banco por rota quente (a contagem é o orçamento)', () => {
  beforeAll(async () => {
    fixture = await setup();
  }, 120_000);

  it('cada rota quente respeita o teto medido', async () => {
    const person = await student(fixture.courseId, fixture.offerId);
    const text = fixture.lesson['Como estudar aqui']!;
    const video = fixture.lesson['Boas-vindas']!;

    await measure('sessao', () => call('GET', '/me/access', person.headers));
    await measure('mapa', () =>
      call('GET', `/courses/${fixture.courseId}/outline`, person.headers),
    );
    await measure('aula_texto', () => call('GET', `/lessons/${text}`, person.headers));
    await measure('catalogo', () => call('GET', '/catalog/courses', person.headers));
    await measure('concluir_aula_texto', () =>
      call('POST', `/lessons/${text}/complete`, person.headers, {}),
    );
    await measure('heartbeat_video', () =>
      call('POST', `/lessons/${video}/video-progress`, person.headers, {
        videoAssetId: fixture.assetId,
        playbackSessionId: 'sessao-orcamento-01',
        seq: 1,
        position: 100,
      }),
    );
    await measure('heartbeat_repetido', () =>
      call('POST', `/lessons/${video}/video-progress`, person.headers, {
        videoAssetId: fixture.assetId,
        playbackSessionId: 'sessao-orcamento-01',
        seq: 1,
        position: 100,
      }),
    );

    for (const [name, ceiling] of Object.entries(BUDGET)) {
      expect(
        measured[name],
        `${name}: ${measured[name]} idas, teto ${ceiling}`,
      ).toBeLessThanOrEqual(ceiling);
    }
  }, 120_000);
});

describe('heartbeat de vídeo com várias pessoas no MESMO vídeo', () => {
  it('20 pessoas enviando ao mesmo tempo terminam todas, sem perder posição (o registro do vídeo é travado: mede o custo)', async () => {
    const people = [];
    for (let index = 0; index < 20; index += 1) {
      people.push(await student(fixture.courseId, fixture.offerId));
    }
    const video = fixture.lesson['Boas-vindas']!;
    const text = fixture.lesson['Como estudar aqui']!;
    // Referências de tempo no MESMO banco: um heartbeat sozinho e 20 leituras de aula simultâneas (sem o travamento do vídeo).
    const lone = Date.now();
    await call('POST', `/lessons/${video}/video-progress`, people[0]!.headers, {
      videoAssetId: fixture.assetId,
      playbackSessionId: 'sessao-sozinha-0001',
      seq: 1,
      position: 50,
    });
    console.info(`[orçamento] 1 heartbeat sozinho: ${Date.now() - lone} ms`);
    const reads = Date.now();
    await Promise.all(people.map((person) => call('GET', `/lessons/${text}`, person.headers)));
    console.info(`[orçamento] 20 leituras de aula simultâneas: ${Date.now() - reads} ms no total`);
    const started = Date.now();
    const responses = await Promise.all(
      people.map((person) =>
        call('POST', `/lessons/${video}/video-progress`, person.headers, {
          videoAssetId: fixture.assetId,
          playbackSessionId: `sessao-concorrente-${person.id.slice(0, 8)}`,
          seq: 1,
          position: 200,
        }),
      ),
    );
    const elapsed = Date.now() - started;
    console.info(`[orçamento] 20 heartbeats simultâneos no mesmo vídeo: ${elapsed} ms no total`);
    expect(responses.map((response) => response.status)).toEqual(Array(20).fill(200));
    const rows = await tools.db.execute(
      sql`select count(*)::int as n from video_progress where max_position = 200`,
    );
    expect((rows as unknown as { rows: { n: number }[] }).rows[0]!.n).toBe(20);
  }, 180_000);
});

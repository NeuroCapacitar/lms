import { eq, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { grantEntitlement } from '../../src/server/access/entitlement-store.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { loadCourseAnalytics, loadOfferAnalytics } from '../../src/server/staff/analytics-store.ts';
import { loadStaffPanel } from '../../src/server/staff/panel-store.ts';
import { loadStaffQueue } from '../../src/server/staff/queue-store.ts';
import { apiApp } from '../helpers/api-app.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createDemoCourse } from '../helpers/demo-course.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';
import { countQueries, type CapturedQuery } from '../helpers/query-count.ts';

/**
 * M9-07 (passo 4): EVIDÊNCIA de `EXPLAIN (ANALYZE, BUFFERS)` do caminho quente e das consultas do M9-01 e do M9-02, com 10 mil
 * matrículas sintéticas. NÃO afirma nada: só imprime (rode com `EXPLAIN=1`). Não entra no CI. Cada instrução é capturada de uma execução
 * real (rota ou função de leitura) e repetida sob EXPLAIN com os mesmos parâmetros; só SELECT (EXPLAIN ANALYZE executa a instrução, então
 * escrita fica de fora). O plano de um banco pequeno pode escolher varredura sequencial com razão: leia o tempo junto.
 */
const enabled = process.env.EXPLAIN === '1';
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const T0 = new Date('2026-10-11T12:00:00.000Z');
const LATE = new Date('2026-10-30T12:00:00.000Z');
const PEOPLE = 10_000;

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;

beforeAll(async () => {
  if (!enabled) return;
  database = await createTestSchema();
  tools = await createTestAuth(database.connectionString, { baseUrl: BASE_URL, secret: SECRET });
}, 120_000);
afterAll(async () => {
  if (!enabled) return;
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

async function explain(label: string, queries: CapturedQuery[]) {
  const client = new pg.Client({ connectionString: database.connectionString });
  await client.connect();
  try {
    const seen = new Set<string>();
    for (const query of queries) {
      if (!/^(select|with) /i.test(query.text) || seen.has(query.text)) continue;
      seen.add(query.text);
      const result = await client
        .query({
          text: `explain (analyze, buffers, costs off, timing on) ${query.text}`,
          values: query.values,
        })
        .catch((error: Error) => {
          console.info(
            `[explain] ${label} | NÃO EXPLICADO (${error.message}; ${query.values.length} parâmetros) | ${query.text.slice(0, 120)}`,
          );
          return null;
        });
      if (result === null) continue;
      const lines = result.rows.map((row: { 'QUERY PLAN': string }) => row['QUERY PLAN']);
      const time = /Execution Time: ([\d.]+) ms/.exec(lines.join('\n'))?.[1] ?? '?';
      const scans = [
        ...lines
          .join('\n')
          .matchAll(/Seq Scan on (\w+)(?: \w+)?\s+\(actual time=[\d.]+\.\.[\d.]+ rows=(\d+)/g),
      ].map((match) => `${match[1]}(${match[2]} linhas)`);
      console.info(
        `[explain] ${label} | ${time} ms | seq: ${scans.length === 0 ? '-' : scans.join(', ')} | ${query.text.slice(0, 90)}`,
      );
      if (Number(time) > 8) console.info(lines.map((line: string) => `      ${line}`).join('\n'));
    }
  } finally {
    await client.end();
  }
}

describe.skipIf(!enabled)('EXPLAIN com 10 mil matrículas (evidência, não afirma nada)', () => {
  it('imprime o plano do caminho quente e das consultas do M9-01 e M9-02', async () => {
    const demo = await createDemoCourse(tools.db);
    const rows = await tools.db
      .select({ id: schema.lesson.id, title: schema.lesson.title })
      .from(schema.lesson)
      .where(eq(schema.lesson.courseId, demo.courseId));
    const lesson = Object.fromEntries(rows.map((row) => [row.title, row.id])) as Record<
      string,
      string
    >;
    await tools.db
      .update(schema.course)
      .set({ sequenceMode: 'free' })
      .where(eq(schema.course.id, demo.courseId));
    const connectionId = crypto.randomUUID();
    await tools.db
      .insert(schema.videoProviderConnection)
      .values({ id: connectionId, provider: 'youtube', label: 'público' });
    const [asset] = await tools.db
      .insert(schema.videoAsset)
      .values({
        connectionId,
        provider: 'youtube',
        externalId: 'explain',
        mode: 'referenced',
        state: 'ready',
        durationSeconds: 600,
        capabilities: { reportsTime: true, reportsEnded: true, resume: true, ignored: false },
      })
      .returning();
    await tools.db
      .update(schema.lesson)
      .set({ kind: 'video', videoAssetId: asset!.id })
      .where(eq(schema.lesson.id, lesson['Boas-vindas']!));

    // 10 mil pessoas com matrícula, direito, conclusão de duas aulas e progresso de vídeo.
    await tools.db.execute(sql`
      insert into "user" (id, name, email)
      select 'ex-' || n, 'Ex ' || n, 'ex' || n || '@explain.example.test' from generate_series(1, ${PEOPLE}) n`);
    await tools.db.execute(sql`
      insert into enrollment (user_id, course_id, anchor_at)
      select 'ex-' || n, ${demo.courseId}::uuid, now() - interval '100 days' from generate_series(1, ${PEOPLE}) n`);
    await tools.db.execute(sql`
      insert into entitlement (user_id, course_id, source, source_ref, starts_at, expires_at)
      select 'ex-' || n, ${demo.courseId}::uuid, 'admin_grant', 'ex-' || n, now() - interval '100 days',
             now() + (case when n % 10 = 0 then interval '3 days' else interval '60 days' end)
        from generate_series(1, ${PEOPLE}) n`);
    await tools.db.execute(sql`
      insert into lesson_completion (user_id, course_id, lesson_id, completed_at)
      select 'ex-' || n, ${demo.courseId}::uuid, ${lesson['Como estudar aqui']}::uuid, now() - (n % 40 || ' days')::interval
        from generate_series(1, ${PEOPLE}) n`);
    await tools.db.execute(sql`
      insert into video_progress (user_id, lesson_id, course_id, video_asset_id, max_position, duration_seconds, updated_at)
      select 'ex-' || n, ${lesson['Boas-vindas']}::uuid, ${demo.courseId}::uuid, ${asset!.id}::uuid, (n % 600), 600, now() - (n % 40 || ' days')::interval
        from generate_series(1, ${PEOPLE}) n`);

    // A pessoa que faz as requisições do caminho quente.
    const user = tools.test.createUser({ email: 'quente@explain.example.test', name: 'Quente' });
    await tools.test.saveUser(user);
    await grantEntitlement(tools.db, {
      userId: user.id,
      courseId: demo.courseId,
      offerId: demo.offerId,
      source: 'free_offer',
      sourceRef: `free:${user.id}`,
      accessMonths: 12,
      startsAt: T0,
      grantedBy: user.id,
    });
    const headers = (await tools.test.login({ userId: user.id })).headers;
    const app = apiApp({
      emailSender: createFakeEmailSender(),
      isStaffEmail: async () => false,
      clock: () => LATE,
    });
    const call = (method: string, path: string, body?: unknown) => {
      const merged = new Headers(headers);
      merged.set('origin', BASE_URL);
      merged.set('content-type', 'application/json');
      return app.request(
        `/api${path}`,
        {
          method,
          headers: merged,
          ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
        },
        env(),
      );
    };

    const hot: [string, () => Promise<Response>][] = [
      ['GET /me/access', () => call('GET', '/me/access')],
      ['GET /courses/:id/outline', () => call('GET', `/courses/${demo.courseId}/outline`)],
      ['GET /lessons/:id', () => call('GET', `/lessons/${lesson['Como estudar aqui']}`)],
      ['GET /catalog/courses', () => call('GET', '/catalog/courses')],
      [
        'POST /lessons/:id/video-progress',
        () =>
          call('POST', `/lessons/${lesson['Boas-vindas']}/video-progress`, {
            videoAssetId: asset!.id,
            playbackSessionId: 'sessao-explain-0001',
            seq: 1,
            position: 100,
          }),
      ],
    ];
    for (const [label, run] of hot) {
      const { result, queries } = await countQueries(run);
      expect(result.status, label).toBeLessThan(300);
      await explain(label, queries);
    }

    const admin = {
      userId: 'x',
      suspended: false,
      roles: new Set(['admin' as const]),
      grants: new Set<never>(),
    };
    const stores: [string, () => Promise<unknown>][] = [
      ['painel (M9-01)', () => loadStaffPanel(tools.db, { finance: true, moderation: true })],
      ['fila (M9-01)', () => loadStaffQueue(tools.db, admin)],
      ['análise do curso (M9-02)', () => loadCourseAnalytics(tools.db, demo.courseId)],
      ['análise das ofertas (M9-02)', () => loadOfferAnalytics(tools.db)],
    ];
    for (const [label, run] of stores) {
      const { queries } = await countQueries(run);
      await explain(label, queries);
    }
  }, 600_000);
});

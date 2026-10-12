/**
 * Servidor da JORNADA E2E (M3-05): a API REAL (`createApp`, as mesmas rotas, middlewares e regras do
 * Worker) sobre um Postgres 18 de TESTE com todas as migrations, servindo o build da SPA. Só mudam as
 * bordas que falam com o mundo externo: o e-mail é falso (o link fica numa caixa em memória), o
 * Turnstile é aprovado sem rede e o relógio pode andar (para o drip D+7 e D+14 sem esperar).
 *
 * Os endpoints `/__test/*` existem SÓ neste arquivo de teste (nunca no Worker): ler o link do e-mail
 * falso, avançar o relógio, expirar sessão, contar linhas e ler os logs capturados. O Staging usa o
 * Worker de verdade e uma caixa de teste (passo assistido, ver docs/operations/testing.md).
 *
 *   TEST_DATABASE_URL=... bun e2e-journey/server.ts
 */
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { format } from 'node:util';

import { eq, sql } from 'drizzle-orm';

import { openDatabase } from '../src/db/client.ts';
import * as schema from '../src/db/schema.ts';
import { richTextFromParagraph } from '../src/features/content/rich-text.ts';
import { grantCapability, grantRole } from '../src/server/auth/access-store.ts';
import {
  createCourse,
  createOffer,
  setCourseStatus,
  setOfferStatus,
} from '../src/server/catalog/catalog-store.ts';
import { publishCurriculum, saveDraft } from '../src/server/catalog/curriculum-store.ts';
import { seedDemoCourse } from '../src/server/catalog/demo-seed.ts';
import { createFakeEmailSender } from '../src/server/email/fake.ts';
import { createTestSchema } from '../test/helpers/pg-schema.ts';

const PORT = Number(process.env.JOURNEY_PORT ?? 4174);
const BASE_URL = `http://localhost:${PORT}`;
const CLIENT = path.resolve('dist/client');

// As constantes que o Vite injeta no build do Worker; aqui o código roda direto no Node.
const globals = globalThis as unknown as Record<string, string>;
globals.__RELEASE_ID__ = 'journey';
globals.__APP_ENV__ = 'dev';

// Captura o que o servidor escreve (os eventos amplos do evlog) para conferir correlation id e redação.
const logs: string[] = [];
for (const method of ['log', 'info', 'warn', 'error'] as const) {
  const original = console[method].bind(console);
  console[method] = (...args: unknown[]) => {
    // O evlog entrega o evento como OBJETO; guardá-lo como JSON é o que o Workers Logs recebe.
    const [first] = args;
    logs.push(
      args.length === 1 && typeof first === 'object' && first !== null
        ? JSON.stringify(first)
        : format(...args),
    );
    original(...args);
  };
}

const { createApp } = await import('../src/server/app.ts');

const testSchema = await createTestSchema({ keepLegalSeeds: true });
const database = await openDatabase(testSchema.connectionString);
const sender = createFakeEmailSender();
let clockOffsetMs = 0;
const now = () => new Date(Date.now() + clockOffsetMs);

// --- dados sintéticos -------------------------------------------------------------------------
const demo = await seedDemoCourse(database.db);

async function publishedCourse(slug: string, title: string) {
  const courseId = await createCourse(database.db, {
    actorId: null,
    slug,
    title: `${title} (interno)`,
    sequenceMode: 'free',
  });
  await saveDraft(database.db, {
    courseId,
    expectedRev: 0,
    details: {
      displayTitle: title,
      description: richTextFromParagraph('Outro curso.'),
      workloadHours: 1,
    },
    modules: [
      {
        title: 'Único módulo',
        dripDays: 0,
        lessons: [
          {
            title: 'Aula do outro curso',
            isOptional: false,
            body: richTextFromParagraph('Conteúdo do outro curso.'),
          },
        ],
      },
    ],
  });
  await publishCurriculum(database.db, { actorId: null, courseId });
  const offerId = await createOffer(database.db, {
    actorId: null,
    courseId,
    name: 'Gratuita',
    kind: 'free',
    priceCents: 0,
    accessMonths: 3,
    maxInstallments: 1,
  });
  await setOfferStatus(database.db, { actorId: null, courseId, offerId, status: 'active' });
  await setCourseStatus(database.db, { actorId: null, id: courseId, status: 'published' });
  const [lesson] = await database.db
    .select()
    .from(schema.lesson)
    .where(eq(schema.lesson.courseId, courseId));
  return { courseId, offerId, lessonId: lesson!.id };
}
const other = await publishedCourse('outro-curso', 'Outro Curso');

async function syntheticUser(name: string, email: string) {
  const id = randomUUID().replaceAll('-', '');
  await database.db.insert(schema.user).values({ id, name, email, emailVerified: true });
  return id;
}
const support = await syntheticUser('Sueli Suporte', 'suporte.jornada@example.test');
await grantRole(database.db, { actorId: null, targetId: support, role: 'support' });
await grantCapability(database.db, {
  actorId: null,
  targetId: support,
  capability: 'access.grant',
});
await grantCapability(database.db, {
  actorId: null,
  targetId: support,
  capability: 'enrollment.support_edit',
});
await syntheticUser('Beto Cadastrado', 'beto.jornada@example.test');

const ids = {
  demoCourseId: demo.courseId,
  demoOfferId: demo.offerId,
  otherCourseId: other.courseId,
  otherLessonId: other.lessonId,
};

// --- a aplicação REAL --------------------------------------------------------------------------
const app = createApp({
  auth: {
    emailSender: sender,
    turnstileFetch: (async () => Response.json({ success: true })) as unknown as typeof fetch,
    clock: now,
  },
});
const env = {
  HYPERDRIVE: { connectionString: testSchema.connectionString },
  APP_BASE_URL: BASE_URL,
  BETTER_AUTH_SECRET: 'segredo-da-jornada-somente-local-0123456789abcdef',
  TURNSTILE_SECRET_KEY: 'segredo-de-teste',
  ASSETS: { fetch: async () => serveStatic('/') },
} as unknown as Env;
const executionContext = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;

// --- arquivos estáticos (o build da SPA) -------------------------------------------------------
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

async function serveStatic(pathname: string): Promise<Response> {
  const clean = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  let file = path.join(CLIENT, clean);
  if (!file.startsWith(CLIENT)) return new Response('Not found', { status: 404 });
  const found = await stat(file).catch(() => null);
  if (!found?.isFile()) file = path.join(CLIENT, 'index.html'); // SPA: o roteador do cliente decide
  const body = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream;
  return new Response(body, {
    headers: { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' },
  });
}

// --- endpoints SÓ de teste --------------------------------------------------------------------
async function counts() {
  const count = async (table: string) =>
    Number(
      (await database.db.execute(sql.raw(`select count(*)::int as n from ${table}`))).rows[0]?.n ??
        0,
    );
  return {
    entitlement: await count('entitlement'),
    enrollment: await count('enrollment'),
    lessonCompletion: await count('lesson_completion'),
    courseCompletion: await count('course_completion'),
  };
}

async function testEndpoint(request: Request, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/__test/')) return null;
  const email = url.searchParams.get('email')?.toLowerCase() ?? '';
  switch (url.pathname) {
    case '/__test/ids':
      return Response.json(ids);
    case '/__test/link': {
      const message = [...sender.sent]
        .reverse()
        .find((item) => item.to.toLowerCase() === email && item.template === 'magic-link');
      return message
        ? Response.json({ link: message.variables.LINK_URL })
        : Response.json({ link: null }, { status: 404 });
    }
    case '/__test/advance': {
      clockOffsetMs += Number(url.searchParams.get('days') ?? '0') * 86_400_000;
      return Response.json({ now: now().toISOString() });
    }
    case '/__test/counts':
      return Response.json(await counts());
    case '/__test/logs':
      return Response.json({ lines: logs });
    case '/__test/mail-count':
      return Response.json({ total: sender.sent.length });
    case '/__test/expire-session': {
      await database.db.execute(
        sql`update session set expires_at = now() - interval '1 hour' where user_id in (select id from "user" where email = ${email})`,
      );
      return Response.json({ ok: true });
    }
    default:
      return request.method === 'GET' ? Response.json({ error: 'unknown' }, { status: 404 }) : null;
  }
}

// --- HTTP --------------------------------------------------------------------------------------
const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', BASE_URL);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) for (const item of value) headers.append(name, item);
      else headers.set(name, value);
    }
    const init: RequestInit & { duplex?: 'half' } = { method: req.method ?? 'GET', headers };
    if (init.method !== 'GET' && init.method !== 'HEAD') {
      init.body = Readable.toWeb(req) as unknown as ReadableStream;
      init.duplex = 'half';
    }
    const request = new Request(url, init);

    let response = await testEndpoint(request, url);
    if (!response) {
      if (url.pathname.startsWith('/api/')) {
        // O id de correlação nasce no servidor (como no Worker): o que o cliente mandar é ignorado.
        const withId = new Headers(request.headers);
        const requestId = randomUUID();
        withId.set('x-request-id', requestId);
        const answered = await app.fetch(
          new Request(request, { headers: withId }),
          env,
          executionContext,
        );
        response = new Response(answered.body, answered);
        response.headers.set('x-request-id', requestId);
      } else {
        response = await serveStatic(url.pathname);
      }
    }
    const out: Record<string, string | string[]> = {};
    response.headers.forEach((value, name) => {
      if (name !== 'set-cookie') out[name] = value;
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) out['set-cookie'] = cookies;
    res.writeHead(response.status, out);
    if (!response.body || req.method === 'HEAD') {
      res.end();
      return;
    }
    Readable.fromWeb(response.body as never).pipe(res);
  })().catch((error: unknown) => {
    console.error('journey_server_error', error instanceof Error ? error.message : String(error));
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

async function shutdown() {
  server.close();
  await database.close();
  await testSchema.drop();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

server.listen(PORT, () => {
  console.info(`jornada: ${BASE_URL} (schema ${testSchema.name})`);
});

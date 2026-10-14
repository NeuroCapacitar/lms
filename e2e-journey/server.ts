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
import { processInbox } from '../src/server/async/inbox-processor.ts';
import { createAsaasEventHandler } from '../src/server/commerce/asaas-events.ts';
import { createFakeCheckoutProvider } from '../src/server/commerce/fake-checkout.ts';
import { createFakePaymentReader } from '../src/server/commerce/fake-payments.ts';
import { createFakeRefundProvider } from '../src/server/commerce/fake-refund.ts';
import { createPayerEnricher } from '../src/server/commerce/payer-store.ts';
import { reconcilePending } from '../src/server/commerce/reconciler.ts';
import { createRefundHandler } from '../src/server/commerce/refund-store.ts';
import { createFakeEmailSender } from '../src/server/email/fake.ts';
import { createFakeMailer } from '../src/server/email/mailer.ts';
import { createQuotaGate } from '../src/server/email/quota-store.ts';
import { createEmailHandler } from '../src/server/email/send-handler.ts';
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

/** Curso PAGO (M6-06): duas aulas, oferta paga ativa. O preço e o parcelamento vêm do pedido, nunca do navegador. */
async function paidCourse(
  slug: string,
  title: string,
  priceCents: number,
  maxInstallments: number,
) {
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
      description: richTextFromParagraph('Curso pago da jornada comercial.'),
      workloadHours: 2,
    },
    modules: [
      {
        title: 'Módulo único',
        dripDays: 0,
        lessons: [
          {
            title: 'Primeira aula paga',
            isOptional: false,
            body: richTextFromParagraph('Conteúdo pago 1.'),
          },
          {
            title: 'Segunda aula paga',
            isOptional: false,
            body: richTextFromParagraph('Conteúdo pago 2.'),
          },
        ],
      },
    ],
  });
  await publishCurriculum(database.db, { actorId: null, courseId });
  const offerId = await createOffer(database.db, {
    actorId: null,
    courseId,
    name: 'Acesso anual',
    kind: 'paid',
    priceCents,
    accessMonths: 12,
    maxInstallments,
  });
  await setOfferStatus(database.db, { actorId: null, courseId, offerId, status: 'active' });
  await setCourseStatus(database.db, { actorId: null, id: courseId, status: 'published' });
  const lessons = await database.db
    .select({ id: schema.lesson.id })
    .from(schema.lesson)
    .where(eq(schema.lesson.courseId, courseId))
    .orderBy(schema.lesson.position);
  return { courseId, offerId, lessonIds: lessons.map((row) => row.id) };
}
const paid = await paidCourse('curso-pago', 'Curso Pago', 19_700, 1);
const installments = await paidCourse('curso-parcelado', 'Curso Parcelado', 24_000, 12);
const disputed = await paidCourse('curso-disputa', 'Curso Disputa', 9_900, 1);
const late = await paidCourse('curso-tardio', 'Curso Tardio', 4_900, 1);

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
// Equipe financeira (M6-06): o Suporte com os grants financeiros e um Admin (a exceção depois dos 7 dias).
const finance = await syntheticUser('Fabi Financeiro', 'financeiro.jornada@example.test');
await grantRole(database.db, { actorId: null, targetId: finance, role: 'support' });
for (const capability of ['finance.view', 'finance.review', 'refund.execute'] as const) {
  await grantCapability(database.db, { actorId: null, targetId: finance, capability });
}
const adminId = await syntheticUser('Ada Admin', 'admin.jornada@example.test');
await grantRole(database.db, { actorId: null, targetId: adminId, role: 'admin' });

const ids = {
  demoCourseId: demo.courseId,
  demoOfferId: demo.offerId,
  otherCourseId: other.courseId,
  otherLessonId: other.lessonId,
  paid: { courseId: paid.courseId, offerId: paid.offerId, lessonIds: paid.lessonIds },
  installments: {
    courseId: installments.courseId,
    offerId: installments.offerId,
    lessonIds: installments.lessonIds,
  },
  disputed: {
    courseId: disputed.courseId,
    offerId: disputed.offerId,
    lessonIds: disputed.lessonIds,
  },
  late: { courseId: late.courseId, offerId: late.offerId, lessonIds: late.lessonIds },
};

// --- o ASAAS FALSO (M6-06): o checkout, a leitura dos pagamentos e o reembolso -----------------
const WEBHOOK_TOKEN = 'token-do-webhook-da-jornada-com-mais-de-32-caracteres';
const checkoutProvider = createFakeCheckoutProvider();
const paymentReader = createFakePaymentReader();
const refundProvider = createFakeRefundProvider();
// Quando o provider "aceita" o estorno, o pagamento passa a REFUND_REQUESTED (como no Asaas).
refundProvider.onAccepted = (target) => {
  paymentReader.set({ id: target.paymentId, status: 'REFUND_REQUESTED' });
};

// --- a aplicação REAL --------------------------------------------------------------------------
const app = createApp({
  auth: {
    emailSender: sender,
    checkoutProvider,
    paymentReader,
    refundProvider,
    turnstileFetch: (async () => Response.json({ success: true })) as unknown as typeof fetch,
    clock: now,
  },
});
const env = {
  HYPERDRIVE: { connectionString: testSchema.connectionString },
  APP_BASE_URL: BASE_URL,
  BETTER_AUTH_SECRET: 'segredo-da-jornada-somente-local-0123456789abcdef',
  TURNSTILE_SECRET_KEY: 'segredo-de-teste',
  ASAAS_WEBHOOK_TOKEN: WEBHOOK_TOKEN,
  FINANCE_SECRETS_MASTER_KEY: `1:${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')}`,
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

// E-mail TRANSACIONAL pela outbox (compra confirmada, reembolso): a Queue `general` do Worker, aqui síncrona e com o
// mailer em memória. O estado final do e-mail (`email_message.state`) é o que o teste conta.
const mailer = createFakeMailer();
const emailHandler = createEmailHandler({
  getMailer: () => mailer,
  quota: createQuotaGate(),
  from: 'NeuroCapacitar <acesso@neurocapacitar.example>',
  appUrl: `http://localhost:${PORT}`,
  allowlist: [],
});
async function drainEmail() {
  const pending = await database.db
    .select()
    .from(schema.outboxMessage)
    .where(sql`kind = 'email.send' and state = 'pending'`);
  for (const row of pending) {
    await emailHandler({
      db: database.db,
      payload: row.payload as { emailMessageId: string },
      intentId: row.id,
      correlationId: row.correlationId,
      idempotencyKey: row.dedupeKey,
      attempt: 1,
    });
    await database.db
      .update(schema.outboxMessage)
      .set({ state: 'delivered', finishedAt: sql`now()` })
      .where(eq(schema.outboxMessage.id, row.id));
  }
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
    // --- Asaas falso -------------------------------------------------------------------------
    case '/__test/asaas/token':
      return Response.json({ token: WEBHOOK_TOKEN });
    case '/__test/asaas/session': {
      // A sessão de checkout (id do provider) do pedido: o "Asaas" a conhece, o teste a usa para criar o pagamento.
      const orderId = url.searchParams.get('order') ?? '';
      const [row] = await database.db
        .select({
          id: schema.checkoutSession.providerSessionId,
          state: schema.checkoutSession.state,
        })
        .from(schema.checkoutSession)
        .where(eq(schema.checkoutSession.orderId, orderId));
      return Response.json({ sessionId: row?.id ?? null, state: row?.state ?? null });
    }
    case '/__test/asaas/order-of': {
      const userEmail = email;
      const result = await database.db.execute(
        sql`select o.id, o.status from purchase_order o join "user" u on u.id = o.user_id where u.email = ${userEmail} order by o.created_at desc limit 1`,
      );
      const row = result.rows[0] as { id: string; status: string } | undefined;
      return Response.json({ orderId: row?.id ?? null, status: row?.status ?? null });
    }
    case '/__test/asaas/set-payment': {
      const body = (await request.json()) as Record<string, unknown> & { id: string };
      const { paidAt, ...rest } = body;
      paymentReader.set({
        ...(rest as Parameters<typeof paymentReader.set>[0]),
        ...(typeof paidAt === 'string' ? { paidAt: new Date(paidAt) } : {}),
      });
      return Response.json({ ok: true });
    }
    case '/__test/asaas/set-customer': {
      const body = (await request.json()) as {
        id: string;
        name: string | null;
        document: string | null;
      };
      paymentReader.customers.set(body.id, { name: body.name, document: body.document });
      return Response.json({ ok: true });
    }
    case '/__test/asaas/checkout-mode': {
      checkoutProvider.next = (url.searchParams.get('next') ??
        'ok') as typeof checkoutProvider.next;
      return Response.json({ ok: true });
    }
    case '/__test/asaas/refund-mode': {
      refundProvider.next = (await request.json()) as typeof refundProvider.next;
      return Response.json({ ok: true });
    }
    case '/__test/asaas/refund-calls':
      return Response.json({ calls: refundProvider.calls });
    case '/__test/asaas/checkout-calls':
      return Response.json({ total: checkoutProvider.requests.length });
    case '/__test/process-inbox': {
      // O Cron do Worker: processa a inbox com o handler do Asaas (leitura do pagamento + matriz de liberação).
      const count = await processInbox(database.db, {
        handlers: {
          asaas: createAsaasEventHandler({
            reader: paymentReader,
            now,
            afterGrant: createPayerEnricher({
              reader: paymentReader,
              masterKey: env.FINANCE_SECRETS_MASTER_KEY,
            }),
          }),
        },
        owner: `journey:${randomUUID()}`,
        alert: () => undefined,
      });
      await drainEmail();
      return Response.json({ processed: count });
    }
    case '/__test/reconcile': {
      const summary = await reconcilePending(database.db, { reader: paymentReader, now: now() });
      await drainEmail();
      return Response.json(summary);
    }
    case '/__test/run-refund': {
      // A fila `finance` do Worker: roda o executor do reembolso.
      const refundRequestId = url.searchParams.get('id') ?? '';
      const handler = createRefundHandler({ provider: refundProvider, reader: paymentReader, now });
      try {
        await handler({
          db: database.db,
          payload: { refundRequestId },
          intentId: randomUUID(),
          correlationId: 'journey',
          idempotencyKey: `refund:${refundRequestId}`,
          attempt: 1,
        });
        return Response.json({ ok: true });
      } catch (error) {
        return Response.json({ ok: false, error: error instanceof Error ? error.message : 'erro' });
      }
    }
    case '/__test/reauth': {
      // Reautenticação recente SÓ para o teste (o fluxo real é o link por e-mail, coberto no M1-05).
      await database.db.execute(
        sql`insert into reauth_proof (session_id, verified_at) select s.id, now() from session s join "user" u on u.id = s.user_id where u.email = ${email} on conflict (session_id) do update set verified_at = now()`,
      );
      return Response.json({ ok: true });
    }
    case '/__test/facts': {
      const orderId = url.searchParams.get('order') ?? '';
      const result = await database.db.execute(
        sql`select kind from financial_event where order_id = ${orderId} order by created_at, kind`,
      );
      return Response.json({ kinds: (result.rows as { kind: string }[]).map((row) => row.kind) });
    }
    case '/__test/audit-actions': {
      const result = await database.db.execute(sql`select action from audit_log order by id`);
      return Response.json({
        actions: (result.rows as { action: string }[]).map((row) => row.action),
      });
    }
    case '/__test/rows-text': {
      // Todas as linhas das tabelas financeiras como texto: o teste confere que não há CPF em claro.
      const parts: string[] = [];
      for (const table of [
        'payment',
        'financial_event',
        'audit_log',
        'purchase_order',
        'outbox_message',
        'email_message',
      ]) {
        const result = await database.db.execute(
          sql.raw(`select row_to_json(t)::text as j from ${table} t`),
        );
        parts.push(...(result.rows as { j: string }[]).map((row) => row.j));
      }
      return Response.json({ text: parts.join('\n') });
    }
    case '/__test/mails': {
      const template = url.searchParams.get('template');
      // `magic-link` vai pelo sender do login; os demais (outbox) contam pelo estado final do e-mail transacional.
      if (template && template !== 'magic-link') {
        const result = await database.db.execute(
          sql`select count(*)::int as n from email_message where template = ${template} and state = 'accepted'`,
        );
        return Response.json({ total: Number((result.rows[0] as { n: number }).n) });
      }
      return Response.json({
        total: sender.sent.filter((item) => !template || item.template === template).length,
      });
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

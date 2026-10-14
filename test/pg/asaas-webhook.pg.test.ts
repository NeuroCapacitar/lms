import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type OpenDatabase } from '../../src/db/client.ts';
import * as schema from '../../src/db/schema.ts';
import { claimInbox } from '../../src/server/async/inbox-store.ts';
import { processInbox } from '../../src/server/async/inbox-processor.ts';
import { csrfProtection } from '../../src/server/security/csrf.ts';
import { asaasWebhookRoutes } from '../../src/server/webhooks/asaas-routes.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M6-03 em Postgres 18 real: o webhook do Asaas autentica pelo token ANTES de ler o corpo, grava na inbox ANTES de
 * responder, responde 200 explícito em todo caminho de sucesso (duplicata, evento desconhecido, token errado) e só
 * responde 5xx se a inbox não puder gravar. Nenhuma regra de negócio roda na requisição e nenhum dado pessoal é guardado.
 */
let database: TestSchema;
let main: OpenDatabase;

const TOKEN = 'token-do-webhook-de-teste-com-mais-de-32-caracteres';
const BASE = 'https://hub.example.test';

function env(overrides: Partial<Env> = {}, connectionString = database.connectionString): Env {
  return {
    APP_BASE_URL: BASE,
    ASAAS_WEBHOOK_TOKEN: TOKEN,
    HYPERDRIVE: { connectionString },
    ...overrides,
  } as unknown as Env;
}

const app = () =>
  new Hono<{ Bindings: Env }>()
    .use('/api/*', csrfProtection())
    .route('/api/webhooks', asaasWebhookRoutes());

let seq = 0;
const paymentEvent = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: `evt_${(seq += 1)}_${crypto.randomUUID()}`,
    event: 'PAYMENT_RECEIVED',
    payment: {
      id: `pay_${seq}`,
      checkoutSession: crypto.randomUUID(),
      status: 'RECEIVED',
      value: 197,
      description: 'Maria da Silva maria@example.com',
    },
    ...overrides,
  });

function post(
  body: string,
  options: { token?: string | null; environment?: Env; contentType?: string } = {},
) {
  const headers: Record<string, string> = {
    'content-type': options.contentType ?? 'application/json',
  };
  const token = options.token === undefined ? TOKEN : options.token;
  if (token !== null) headers['asaas-access-token'] = token;
  return app().request(
    '/api/webhooks/asaas',
    { method: 'POST', body, headers },
    options.environment ?? env(),
  );
}

const inbox = () =>
  main.db.select().from(schema.inboxEvent).where(eq(schema.inboxEvent.provider, 'asaas'));

beforeAll(async () => {
  database = await createTestSchema();
  main = await openDatabase(database.connectionString);
});
afterAll(async () => {
  await main.close();
  await database.drop();
});
beforeEach(async () => {
  await main.db.delete(schema.inboxEvent);
});

describe('autenticação pelo token', () => {
  it('token ausente, errado, com prefixo ou de outro tamanho: 200 e NADA gravado', async () => {
    const body = paymentEvent();
    for (const token of [
      null,
      '',
      'errado',
      `${TOKEN}x`,
      TOKEN.slice(0, -1),
      TOKEN.toUpperCase(),
    ]) {
      const response = await post(body, { token });
      expect(response.status, String(token)).toBe(200);
    }
    expect(await inbox()).toHaveLength(0);
  });

  it('a resposta ao token errado é IDÊNTICA à de sucesso (não revela a validade do token)', async () => {
    const body = paymentEvent();
    const wrong = await post(body, { token: 'errado' });
    const right = await post(body);
    expect(wrong.status).toBe(right.status);
    expect(await wrong.json()).toEqual(await right.json());
    expect(wrong.headers.get('content-type')).toBe(right.headers.get('content-type'));
  });

  it('sem o segredo configurado (ou curto demais) o webhook falha ALTO (500) e não grava nada', async () => {
    for (const secret of [undefined, '', 'curto']) {
      const response = await post(paymentEvent(), {
        environment: env({ ASAAS_WEBHOOK_TOKEN: secret }),
        token: secret ?? TOKEN,
      });
      expect(response.status, String(secret)).toBe(500);
    }
    expect(await inbox()).toHaveLength(0);
  });

  it('autentica por token, não por cookie: passa sem Origin e sem CSRF, e aceita qualquer content-type', async () => {
    const response = await post(paymentEvent(), { contentType: 'text/plain' });
    expect(response.status).toBe(200);
    expect(await inbox()).toHaveLength(1);
  });
});

describe('inbox antes do ACK', () => {
  it('evento autenticado: grava só os ids e responde exatamente 200 com a linha já persistida', async () => {
    const body = paymentEvent();
    const response = await post(body);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const rows = await inbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'asaas', state: 'pending' });
    expect(rows[0]!.payload).toMatchObject({
      event: 'PAYMENT_RECEIVED',
      statusHint: 'RECEIVED',
      malformed: false,
    });
    // sem PII, sem valor e sem corpo bruto na inbox
    const stored = JSON.stringify(rows[0]!.payload);
    for (const leak of ['Maria', 'maria@', 'description', '197']) {
      expect(stored, leak).not.toContain(leak);
    }
    expect(Number(rows[0]!.correlationId.length)).toBeGreaterThan(0);
  });

  it('o mesmo event id duas vezes: 200 nas duas e UMA linha', async () => {
    const body = paymentEvent();
    expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(200);
    expect(await inbox()).toHaveLength(1);
  });

  it('entregas simultâneas do mesmo evento (conexões separadas): uma linha, todas 200', async () => {
    const body = paymentEvent();
    const responses = await Promise.all([1, 2, 3, 4, 5].map(() => post(body)));
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await inbox()).toHaveLength(1);
  });

  it('evento desconhecido, sem id ou com JSON inválido também é gravado e recebe 200', async () => {
    const unknown = JSON.stringify({ event: 'ALGO_NOVO', foo: 'bar' });
    for (const body of [unknown, unknown, 'não é json', '[]', '']) {
      expect((await post(body)).status, body).toBe(200);
    }
    const rows = await inbox();
    // o mesmo corpo sem id não duplica; corpos diferentes ficam como evidência
    expect(rows).toHaveLength(4);
    expect(rows.filter((row) => (row.payload as { malformed: boolean }).malformed)).toHaveLength(3);
    expect(rows.every((row) => row.eventId.startsWith('noid:'))).toBe(true);
  });

  it('corpo acima do limite (autenticado): 413 e nada gravado; o mesmo corpo com token errado é só 200', async () => {
    const huge = JSON.stringify({
      id: 'evt_big',
      event: 'PAYMENT_RECEIVED',
      pad: 'x'.repeat(130 * 1024),
    });
    expect((await post(huge)).status).toBe(413);
    expect((await post(huge, { token: 'errado' })).status).toBe(200);
    expect(await inbox()).toHaveLength(0);
  });

  it('inbox indisponível: 500 (o Asaas reenvia) e nada de falso sucesso', async () => {
    const broken = env({}, 'postgresql://nao-existe:nao@127.0.0.1:1/nada?connect_timeout=2');
    const response = await post(paymentEvent(), { environment: broken });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: 'inbox_unavailable' } });
  });

  it('o processador da inbox NÃO consome eventos do Asaas enquanto não há handler (M6-07): ficam pending sem gastar tentativa', async () => {
    await post(paymentEvent());
    const processed = await processInbox(main.db, {
      handlers: {},
      owner: 'teste',
      alert: () => undefined,
    });
    expect(processed).toBe(0);
    const [row] = await inbox();
    expect(row).toMatchObject({ state: 'pending', attempts: 0 });
    // e o claim só por provider Asaas já enxerga o evento
    const claimed = await claimInbox(main.db, 10, 'teste', 60, ['asaas']);
    expect(claimed).toHaveLength(1);
  });
});

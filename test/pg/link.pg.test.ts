import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '../../src/db/schema.ts';
import { LINK_LIMITS } from '../../src/features/identity/link-policy.ts';
import { authRoutes, type AuthRouteOverrides } from '../../src/server/auth/routes.ts';
import { createFakeEmailSender } from '../../src/server/email/fake.ts';
import { createTestAuth } from '../helpers/auth.ts';
import { createTestSchema, type TestSchema } from '../helpers/pg-schema.ts';

/**
 * M1-06 em Postgres 18 real: pedido de link (Turnstile, limites, resposta genérica, Staff) e
 * confirmação por POST (uso único, expiração, cookie), pelas rotas reais montadas em /api.
 */
const SECRET = 'segredo-de-teste-somente-local-0123456789abcdef';
const BASE_URL = 'https://app.example.test';
const HUMAN = 'token-humano';

let database: TestSchema;
let tools: Awaited<ReturnType<typeof createTestAuth>>;
let sender: ReturnType<typeof createFakeEmailSender>;
let staffEmails: Set<string>;
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
  sender = createFakeEmailSender();
  staffEmails = new Set();
  await tools.db.delete(schema.authThrottle);
  await tools.db.delete(schema.verification);
  await tools.db.delete(schema.session);
  await tools.db.delete(schema.user);
});
afterEach(() => vi.restoreAllMocks());

const env = () =>
  ({
    HYPERDRIVE: { connectionString: database.connectionString },
    APP_BASE_URL: BASE_URL,
    BETTER_AUTH_SECRET: SECRET,
    TURNSTILE_SECRET_KEY: 'segredo-turnstile-de-teste',
  }) as unknown as Env;

/** Turnstile falso: só `HUMAN` passa. Nunca chama a rede. */
const turnstileFetch = (async (_url: unknown, init?: RequestInit) => {
  const response = new URLSearchParams(String(init?.body)).get('response');
  return Response.json({ success: response === HUMAN });
}) as unknown as typeof fetch;

function appWith(overrides: AuthRouteOverrides = {}) {
  return new Hono<{ Bindings: Env }>().route(
    '/api',
    authRoutes({
      emailSender: sender,
      isStaffEmail: async (email) => staffEmails.has(email),
      turnstileFetch,
      ...overrides,
    }),
  );
}

function post(
  app: ReturnType<typeof appWith>,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(
    `/api${path}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE_URL, ...headers },
      body: JSON.stringify(body),
    },
    env(),
  );
}

const requestLink = (
  app: ReturnType<typeof appWith>,
  email: string,
  options: { ip?: string; captcha?: string; origin?: string } = {},
) =>
  post(
    app,
    '/auth/link/request',
    { email, captchaToken: options.captcha ?? HUMAN },
    {
      'cf-connecting-ip': options.ip ?? `203.0.113.${(seq += 1)}`,
      ...(options.origin ? { origin: options.origin } : {}),
    },
  );

const tokenOfLastEmail = () => {
  const message = sender.sent.at(-1);
  expect(message, 'um e-mail foi enviado').toBeDefined();
  const url = new URL(message!.variables.LINK_URL!);
  return decodeURIComponent(url.hash.replace('#token=', ''));
};

describe('pedido de link', () => {
  it('aceita, responde o corpo genérico e envia um e-mail com o link na página de confirmação', async () => {
    const app = appWith();
    const response = await requestLink(app, 'Pessoa@Example.test');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(sender.sent).toHaveLength(1);
    const message = sender.sent[0]!;
    expect(message.to).toBe('pessoa@example.test');
    expect(message.template).toBe('magic-link');
    expect(message.variables.LINK_URL).toMatch(
      /^https:\/\/app\.example\.test\/entrar\/confirmar#token=[^&]+$/,
    );
    expect(message.idempotencyKey).toMatch(/^magic-link:[0-9a-f]{64}$/);
  });

  it('guarda o token com hash (o valor no banco não contém o token enviado) e expira em 15 minutos', async () => {
    await requestLink(appWith(), 'hash@example.test');
    const token = tokenOfLastEmail();
    const rows = await tools.db.select().from(schema.verification);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
    const minutes = (rows[0]!.expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);
  });

  it('a resposta é idêntica para e-mail existente, novo e limitado (conteúdo e cabeçalhos)', async () => {
    const app = appWith();
    const user = tools.test.createUser({ email: 'existe@example.test' });
    await tools.test.saveUser(user);
    const existing = await requestLink(app, 'existe@example.test');
    const fresh = await requestLink(app, 'novo@example.test');
    // limitado: estoura o limite por e-mail
    for (let i = 0; i < LINK_LIMITS.perEmail.max; i += 1)
      await requestLink(app, 'limitado@example.test');
    const limited = await requestLink(app, 'limitado@example.test');
    for (const other of [fresh, limited]) {
      expect(other.status).toBe(existing.status);
      expect(await other.clone().text()).toBe(await existing.clone().text());
      expect(other.headers.get('content-type')).toBe(existing.headers.get('content-type'));
      expect(other.headers.get('cache-control')).toBe(existing.headers.get('cache-control'));
    }
  });

  it('o tempo de resposta não separa e-mail existente de novo (mediana, tolerância larga)', async () => {
    const app = appWith();
    for (let i = 0; i < 4; i += 1) {
      const user = tools.test.createUser({ email: `t-existe${i}@example.test` });
      await tools.test.saveUser(user);
    }
    const time = async (email: string) => {
      const start = performance.now();
      await requestLink(app, email);
      return performance.now() - start;
    };
    const existing: number[] = [];
    const fresh: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      existing.push(await time(`t-existe${i}@example.test`));
      fresh.push(await time(`t-novo${i}@example.test`));
    }
    const median = (values: number[]) =>
      [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
    expect(Math.abs(median(existing) - median(fresh))).toBeLessThan(150);
  });

  it('recusa origem errada, Turnstile inválido e entrada inválida sem enviar nada', async () => {
    const app = appWith();
    expect(
      (await requestLink(app, 'a@example.test', { origin: 'https://evil.example' })).status,
    ).toBe(403);
    const noHuman = await requestLink(app, 'b@example.test', { captcha: 'robo' });
    expect(noHuman.status).toBe(403);
    expect(await noHuman.json()).toEqual({ error: { code: 'captcha_failed' } });
    expect((await requestLink(app, 'sem-arroba')).status).toBe(400);
    expect((await post(app, '/auth/link/request', { email: 'c@example.test' })).status).toBe(400);
    expect((await post(app, '/auth/link/request', null)).status).toBe(400);
    expect(sender.sent).toHaveLength(0);
  });

  it('o Turnstile fora do ar fecha o pedido (falha de rede = recusado)', async () => {
    const down = (async () => {
      throw new Error('rede');
    }) as unknown as typeof fetch;
    const response = await requestLink(appWith({ turnstileFetch: down }), 'a@example.test');
    expect(response.status).toBe(403);
    expect(sender.sent).toHaveLength(0);
  });

  it('os endpoints nativos do plugin não são expostos (pulariam captcha e limites; GET criaria sessão)', async () => {
    const app = appWith();
    expect((await post(app, '/auth/sign-in/magic-link', { email: 'x@example.test' })).status).toBe(
      404,
    );
    for (const method of ['GET', 'HEAD']) {
      const response = await app.request(
        '/api/auth/magic-link/verify?token=abc',
        { method },
        env(),
      );
      expect(response.status).toBe(404);
    }
    expect(sender.sent).toHaveLength(0);
  });
});

describe('limites', () => {
  it('o mesmo e-mail é limitado depois de 3 pedidos e os 6 seguidos não geram 6 e-mails', async () => {
    const app = appWith();
    for (let i = 0; i < 6; i += 1) {
      const response = await requestLink(app, 'repete@example.test');
      expect(response.status).toBe(200);
    }
    expect(sender.sent).toHaveLength(LINK_LIMITS.perEmail.max);
  });

  it('o mesmo IP é limitado entre e-mails diferentes, e outro IP não é afetado', async () => {
    const app = appWith({
      limits: { ...LINK_LIMITS, perIp: { max: 2, windowSeconds: 600 } },
    });
    for (let i = 0; i < 4; i += 1)
      await requestLink(app, `ip${i}@example.test`, { ip: '198.51.100.7' });
    expect(sender.sent).toHaveLength(2);
    await requestLink(app, 'outro-ip@example.test', { ip: '198.51.100.8' });
    expect(sender.sent).toHaveLength(3);
  });

  it('o teto diário global bloqueia o envio e o spam recusado não consome a cota', async () => {
    const app = appWith({ limits: { ...LINK_LIMITS, globalPerDay: 2 } });
    for (let i = 0; i < 5; i += 1) await requestLink(app, 'mesmo@example.test'); // só 3 passam por e-mail
    const [counter] = await tools.db
      .select()
      .from(schema.authThrottle)
      .where(eq(schema.authThrottle.key, `link:global:${new Date().toISOString().slice(0, 10)}`));
    expect(counter?.count, 'só o que passou nos limites por e-mail e IP conta').toBe(3);
    expect(sender.sent).toHaveLength(2);
    const blocked = await requestLink(
      appWith({ limits: { ...LINK_LIMITS, globalPerDay: 2 } }),
      'novo-dia@example.test',
    );
    expect(blocked.status).toBe(200);
    expect(sender.sent).toHaveLength(2);
  });

  it('a chave do contador guarda hash do e-mail, nunca o e-mail', async () => {
    await requestLink(appWith(), 'privado@example.test');
    const rows = await tools.db.select().from(schema.authThrottle);
    expect(JSON.stringify(rows)).not.toContain('privado@example.test');
  });
});

describe('Staff', () => {
  it('e-mail de Staff sem usuário não recebe link nem cria conta; com usuário existente recebe', async () => {
    staffEmails.add('staff@example.test');
    const app = appWith();
    const first = await requestLink(app, 'staff@example.test');
    expect(first.status).toBe(200);
    expect(sender.sent).toHaveLength(0);
    const users = await tools.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, 'staff@example.test'));
    expect(users).toHaveLength(0);

    await tools.test.saveUser(tools.test.createUser({ email: 'staff@example.test' }));
    await requestLink(app, 'staff@example.test');
    expect(sender.sent).toHaveLength(1);
  });
});

describe('confirmação por POST', () => {
  it('cria a pessoa e a sessão, devolve só {status:ok} e o cookie HttpOnly/Secure/SameSite=Lax', async () => {
    const app = appWith();
    await requestLink(app, 'entra@example.test');
    const token = tokenOfLastEmail();
    const response = await post(app, '/auth/link/confirm', { token });
    expect(response.status).toBe(200);
    const bodyText = await response.text();
    expect(JSON.parse(bodyText)).toEqual({ status: 'ok' });
    const cookie = response.headers.getSetCookie().find((value) => value.includes('session_token'));
    expect(cookie).toMatch(/^__Secure-better-auth\.session_token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const [created] = await tools.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, 'entra@example.test'));
    expect(created?.emailVerified).toBe(true);

    // O cookie vale em /api/me; o valor do cookie (token da sessão) não aparece no corpo.
    const sessionCookie = cookie!.split(';')[0]!;
    const sessionToken = decodeURIComponent(sessionCookie.split('=')[1] ?? '').split('.')[0]!;
    expect(bodyText).not.toContain(sessionToken);
    const me = await app.request('/api/me', { headers: { cookie: sessionCookie } }, env());
    expect(me.status).toBe(200);
    expect(((await me.json()) as { email: string }).email).toBe('entra@example.test');
  });

  it('o mesmo link usado duas vezes falha e não cria outra sessão', async () => {
    const app = appWith();
    await requestLink(app, 'uma-vez@example.test');
    const token = tokenOfLastEmail();
    expect((await post(app, '/auth/link/confirm', { token })).status).toBe(200);
    const again = await post(app, '/auth/link/confirm', { token });
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: { code: 'invalid_or_expired_link' } });
    const [created] = await tools.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, 'uma-vez@example.test'));
    const sessions = await tools.db
      .select()
      .from(schema.session)
      .where(eq(schema.session.userId, created!.id));
    expect(sessions).toHaveLength(1);
  });

  it('link expirado e token qualquer falham, e a origem errada é recusada', async () => {
    const app = appWith();
    await requestLink(app, 'expira@example.test');
    const token = tokenOfLastEmail();
    await tools.db.update(schema.verification).set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await post(app, '/auth/link/confirm', { token })).status).toBe(400);
    expect((await post(app, '/auth/link/confirm', { token: 'x'.repeat(40) })).status).toBe(400);
    expect((await post(app, '/auth/link/confirm', { token: 'curto' })).status).toBe(400);
    expect(
      (await post(app, '/auth/link/confirm', { token }, { origin: 'https://evil.example' })).status,
    ).toBe(403);
  });

  it('GET na rota de confirmação não cria sessão', async () => {
    const app = appWith();
    await requestLink(app, 'scanner@example.test');
    const token = tokenOfLastEmail();
    const response = await app.request(
      `/api/auth/link/confirm?token=${encodeURIComponent(token)}`,
      {},
      env(),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await tools.db.select().from(schema.session)).toHaveLength(0);
  });
});

describe('registros', () => {
  it('nenhum token nem e-mail aparece no console durante o fluxo completo', async () => {
    const logged: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(
          args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '),
        );
      });
    }
    const app = appWith();
    await requestLink(app, 'sigilo@example.test');
    const token = tokenOfLastEmail();
    await post(app, '/auth/link/confirm', { token });
    await post(app, '/auth/link/confirm', { token });
    const text = logged.join('\n');
    expect(text).not.toContain(token);
    expect(text).not.toContain('sigilo@example.test');
  });

  it('falha no envio do e-mail não muda a resposta e registra só o tipo do erro', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
    const broken = {
      send: async () => {
        throw new Error('provedor caiu para quem@example.test com link https://x/#token=segredo');
      },
    };
    const response = await requestLink(appWith({ emailSender: broken }), 'quem@example.test');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    const text = errors.join('\n');
    expect(text).toContain('link_delivery_failed');
    expect(text).not.toContain('quem@example.test');
    expect(text).not.toContain('segredo');
  });
});

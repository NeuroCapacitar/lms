import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import type { Database } from '../../db/client';
import { hitThrottle } from '../../db/throttle';
import {
  GOOGLE_START_LIMIT,
  PASSWORD_LIMITS,
  emptyBodySchema,
  passwordSignInSchema,
  setPasswordSchema,
} from '../../features/identity/credentials';
import { sha256Hex } from '../crypto';
import { hasStaffRole } from './access-store';
import type { Auth } from './create-auth';
import { requireRecentAuth } from './reauth';
import type { AuthVars } from './types';
import { verifyTurnstile } from './turnstile';

type MethodContext = Context<{ Bindings: Env; Variables: AuthVars }>;

interface MethodRouteDeps {
  /** Abre o banco e monta o Better Auth como middleware (rotas autenticadas). */
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
  /** Abre o banco SÓ depois do Turnstile (o pedido de robô nunca acorda o Neon). */
  runWithDatabase: <T>(
    c: MethodContext,
    work: (context: { db: Database; auth: Auth }) => Promise<T>,
  ) => Promise<T>;
  /** O Google está configurado neste ambiente? */
  googleEnabled: (c: MethodContext) => boolean;
  turnstileFetch?: typeof fetch;
}

const INVALID_CREDENTIALS = { error: { code: 'invalid_credentials' } } as const;
const NOT_FOUND = { error: { code: 'not_found' } } as const;

/** Copia os cookies de uma resposta do Better Auth para a nossa (a sessão vive só no cookie). */
function withCookies(source: Response, body: unknown, status = 200): Response {
  const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
  for (const cookie of source.headers.getSetCookie()) headers.append('set-cookie', cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

/** Erro genérico do retorno do Google: o motivo real (Staff, suspensa, sem ligação...) nunca aparece. */
function genericGoogleError(location: string, baseUrl: string): string {
  const target = new URL(location, baseUrl);
  const linking = target.pathname.startsWith('/conta/seguranca');
  return `${linking ? '/conta/seguranca' : '/entrar'}?erro=google`;
}

/**
 * Métodos opcionais de entrada do aluno (M1-07): senha e Google. Ambos só se ADICIONAM depois de
 * entrar por link de acesso; a Staff só entra por link (o gancho de sessão do Better Auth recusa
 * qualquer outro caminho). Toda falha de login responde igual, sem dizer se o e-mail existe, se a
 * conta é de Staff ou se está suspensa. As rotas nativas do Better Auth não ficam expostas: cada
 * ação passa por aqui, com Turnstile, limites e reautenticação recente.
 */
export function methodRoutes(deps: MethodRouteDeps) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();

  routes.get('/auth/options', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ google: deps.googleEnabled(c) });
  });

  // Login por senha: Turnstile ANTES do banco, limites por e-mail e por IP, falha sempre igual.
  routes.post('/auth/password/sign-in', async (c) => {
    c.header('Cache-Control', 'no-store');
    const parsed = passwordSignInSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    const { email, password, captchaToken } = parsed.data;
    const ip = c.req.header('cf-connecting-ip');
    const human = await verifyTurnstile({
      secret: c.env.TURNSTILE_SECRET_KEY,
      token: captchaToken,
      ip,
      ...(deps.turnstileFetch ? { fetchImpl: deps.turnstileFetch } : {}),
    });
    if (!human) return c.json({ error: { code: 'captcha_failed' } }, 403);

    return deps.runWithDatabase(c, async ({ db, auth }) => {
      const byEmail = await hitThrottle(
        db,
        `pwd:email:${await sha256Hex(email)}`,
        PASSWORD_LIMITS.perEmail.windowSeconds,
      );
      const byIp = await hitThrottle(
        db,
        `pwd:ip:${ip ?? 'desconhecido'}`,
        PASSWORD_LIMITS.perIp.windowSeconds,
      );
      if (byEmail > PASSWORD_LIMITS.perEmail.max || byIp > PASSWORD_LIMITS.perIp.max) {
        return c.json({ error: { code: 'rate_limited' } }, 429);
      }
      let response: Response | null = null;
      try {
        response = await auth.api.signInEmail({
          body: { email, password },
          headers: c.req.raw.headers,
          asResponse: true,
        });
      } catch {
        // Senha errada, e-mail sem senha, conta de Staff ou suspensa: a mesma resposta.
        response = null;
      }
      if (!response || response.status >= 300) return c.json(INVALID_CREDENTIALS, 401);
      return withCookies(response, { status: 'ok' });
    });
  });

  // Início do login com Google: devolve o endereço do Google; o navegador vai até lá.
  routes.post('/auth/google/start', deps.withDatabase, async (c) => {
    if (!deps.googleEnabled(c)) return c.json(NOT_FOUND, 404);
    if (!emptyBodySchema.safeParse(await c.req.json().catch(() => null)).success) {
      return c.json({ error: { code: 'invalid_request' } }, 400);
    }
    const ip = c.req.header('cf-connecting-ip') ?? 'desconhecido';
    if (
      (await hitThrottle(c.var.db, `google:ip:${ip}`, GOOGLE_START_LIMIT.windowSeconds)) >
      GOOGLE_START_LIMIT.max
    ) {
      return c.json({ error: { code: 'rate_limited' } }, 429);
    }
    const response = await c.var.auth.api.signInSocial({
      body: {
        provider: 'google',
        callbackURL: '/',
        errorCallbackURL: '/entrar?erro=google',
        disableRedirect: true,
      },
      headers: c.req.raw.headers,
      asResponse: true,
    });
    const { url } = (await response.json().catch(() => ({}))) as { url?: string };
    return url ? withCookies(response, { url }) : c.json({ error: { code: 'unavailable' } }, 502);
  });

  // Retorno do Google. Qualquer falha vira o MESMO redirecionamento, sem o código do Better Auth.
  routes.get('/auth/callback/google', deps.withDatabase, async (c) => {
    if (!deps.googleEnabled(c)) return c.json(NOT_FOUND, 404);
    const response = await c.var.auth.handler(c.req.raw);
    const location = response.headers.get('location');
    const redirected = response.status >= 300 && response.status < 400 && location;
    const failed =
      response.status >= 400 ||
      (redirected && new URL(location, c.env.APP_BASE_URL).searchParams.has('error'));
    if (failed) {
      // Falha de qualquer natureza (código do Better Auth, Staff, conta suspensa, estado inválido):
      // o MESMO redirecionamento, sem corpo, sem código e sem cookie.
      return new Response(null, {
        status: 302,
        headers: {
          location: genericGoogleError(location ?? '', c.env.APP_BASE_URL),
          'cache-control': 'no-store',
        },
      });
    }
    return response;
  });

  // ---- Segurança da conta (autenticado) ----

  async function sessionUser(c: MethodContext) {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    return session?.user ?? null;
  }
  async function accountsOf(c: MethodContext) {
    return c.var.auth.api.listUserAccounts({ headers: c.req.raw.headers });
  }

  routes.get('/me/security', deps.withDatabase, async (c) => {
    const user = await sessionUser(c);
    if (!user) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const accounts = await accountsOf(c);
    return c.json({
      methods: {
        password: accounts.some((account) => account.providerId === 'credential'),
        google: accounts.some((account) => account.providerId === 'google'),
      },
      googleAvailable: deps.googleEnabled(c),
      // Staff só entra por link: não pode ter senha nem Google ativos.
      canManageMethods: !(await hasStaffRole(c.var.db, user.id)),
    });
  });

  // Mudar método de entrada: reautenticação recente + não ser Staff.
  async function guarded(c: MethodContext): Promise<{ id: string } | Response> {
    const user = await sessionUser(c);
    if (!user) return c.json({ error: { code: 'unauthenticated' } }, 401);
    if (await hasStaffRole(c.var.db, user.id)) {
      return c.json({ error: { code: 'forbidden' } }, 403);
    }
    return { id: user.id };
  }

  routes.post('/me/security/password', deps.withDatabase, requireRecentAuth(), async (c) => {
    const who = await guarded(c);
    if (who instanceof Response) return who;
    const parsed = setPasswordSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    await c.var.auth.api.setPassword({
      body: { newPassword: parsed.data.password },
      headers: c.req.raw.headers,
    });
    return c.json({ status: 'ok' });
  });

  routes.post('/me/security/password/remove', deps.withDatabase, requireRecentAuth(), async (c) => {
    const who = await guarded(c);
    if (who instanceof Response) return who;
    if (!emptyBodySchema.safeParse(await c.req.json().catch(() => null)).success) {
      return c.json({ error: { code: 'invalid_request' } }, 400);
    }
    const account = (await accountsOf(c)).find((item) => item.providerId === 'credential');
    if (!account) return c.json(NOT_FOUND, 404);
    await c.var.auth.api.unlinkAccount({
      body: { accountId: account.id },
      headers: c.req.raw.headers,
    });
    return c.json({ status: 'ok' });
  });

  routes.post('/me/security/google/link', deps.withDatabase, requireRecentAuth(), async (c) => {
    if (!deps.googleEnabled(c)) return c.json(NOT_FOUND, 404);
    const who = await guarded(c);
    if (who instanceof Response) return who;
    if (!emptyBodySchema.safeParse(await c.req.json().catch(() => null)).success) {
      return c.json({ error: { code: 'invalid_request' } }, 400);
    }
    const response = await c.var.auth.api.linkSocialAccount({
      body: {
        provider: 'google',
        callbackURL: '/conta/seguranca',
        errorCallbackURL: '/conta/seguranca?erro=google',
        disableRedirect: true,
      },
      headers: c.req.raw.headers,
      asResponse: true,
    });
    const { url } = (await response.json().catch(() => ({}))) as { url?: string };
    return url ? withCookies(response, { url }) : c.json({ error: { code: 'unavailable' } }, 502);
  });

  routes.post('/me/security/google/unlink', deps.withDatabase, requireRecentAuth(), async (c) => {
    const who = await guarded(c);
    if (who instanceof Response) return who;
    if (!emptyBodySchema.safeParse(await c.req.json().catch(() => null)).success) {
      return c.json({ error: { code: 'invalid_request' } }, 400);
    }
    const account = (await accountsOf(c)).find((item) => item.providerId === 'google');
    if (!account) return c.json(NOT_FOUND, 404);
    await c.var.auth.api.unlinkAccount({
      body: { accountId: account.id },
      headers: c.req.raw.headers,
    });
    return c.json({ status: 'ok' });
  });

  return routes;
}

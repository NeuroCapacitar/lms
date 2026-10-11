import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';

import { openDatabase, type Database } from '../../db/client';
import { hitThrottle } from '../../db/throttle';
import { user } from '../../db/schema';
import {
  linkConfirmSchema,
  linkRequestSchema,
  reauthRequestSchema,
} from '../../features/identity/email';
import {
  decideDelivery,
  LINK_LIMITS,
  type EmailSender,
  type LinkLimits,
} from '../../features/identity/link-policy';
import { effectiveCapabilities } from '../../features/identity/capabilities';
import { acceptLegalSchema, type LegalStatusDto } from '../../features/identity/legal';
import { profilePatchSchema } from '../../features/identity/profile';
import { sha256Hex } from '../crypto';
import { createEmailSender } from '../email/factory';
import { createAuth, type Auth } from './create-auth';
import { getProfile, updateProfile } from './profile-store';
import { isStaffEmail as lookupStaffEmail, isSuspended, loadAccess } from './access-store';
import { confirmReauth, createReauthChallenge, hasRecentReauth } from './reauth';
import { staffRoutes } from './staff-routes';
import { acceptCurrent, currentVersions, pendingVersions } from './legal-store';
import { requireAcceptedTerms } from './terms-gate';
import type { AuthVars } from './types';
import { verifyTurnstile } from './turnstile';

/** DTO mínimo de `GET /api/me`: nada além do necessário para a interface identificar a pessoa. */
interface MeDto {
  id: string;
  email: string;
  name: string;
}

/** Resposta ÚNICA do pedido de link: igual para e-mail existente, novo, de Staff ou limitado. */
const GENERIC_LINK_RESPONSE = { status: 'ok' } as const;

/** Substitutos injetáveis nos testes; em produção tudo vem do ambiente. */
export interface AuthRouteOverrides {
  emailSender?: EmailSender;
  isStaffEmail?: (email: string) => Promise<boolean>;
  isSuspended?: (userId: string) => Promise<boolean>;
  turnstileFetch?: typeof fetch;
  limits?: LinkLimits;
}

type Vars = AuthVars;

type AuthContext = Context<{ Bindings: Env; Variables: Vars }>;

/** Violação `restrict_violation` (SQLSTATE 23001) do Postgres, mesmo embrulhada em `cause`. */
function isRestrictViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if ((current as { code?: string }).code === '23001') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function waitUntil(c: AuthContext, work: Promise<unknown>): boolean {
  try {
    c.executionCtx.waitUntil(work);
    return true;
  } catch {
    // Fora do Worker (testes em Node) não há ExecutionContext.
    return false;
  }
}

/**
 * Rotas de identidade: o handler do Better Auth em `/api/auth/*`, o pedido e a confirmação do link
 * de acesso e `GET /api/me`. O banco (um cliente `pg` por requisição) só abre nestas rotas, para
 * `health/live` e 404 de varredura nunca acordarem o Neon.
 */
export function authRoutes(overrides: AuthRouteOverrides = {}) {
  const routes = new Hono<{ Bindings: Env; Variables: Vars }>();
  const limits = overrides.limits ?? LINK_LIMITS;

  /**
   * Abre o banco (um cliente `pg` por requisição), monta o Better Auth e roda o trabalho. O envio
   * do e-mail (`defer`) continua DEPOIS da resposta, para o tempo de resposta não revelar se um
   * e-mail existe ou é de Staff; o banco só fecha quando ele termina.
   */
  async function runWithDatabase<T>(
    c: AuthContext,
    work: (context: { db: Database; auth: Auth; defer: Vars['defer'] }) => Promise<T>,
  ): Promise<T> {
    const opened = await openDatabase(c.env.HYPERDRIVE.connectionString);
    const pending: Promise<unknown>[] = [];
    const defer: Vars['defer'] = (job) => void pending.push(job);
    const auth = createAuth(
      opened.db,
      { baseUrl: c.env.APP_BASE_URL, secret: c.env.BETTER_AUTH_SECRET },
      {
        emailSender: overrides.emailSender ?? createEmailSender(c.env),
        isStaffEmail: overrides.isStaffEmail ?? ((email) => lookupStaffEmail(opened.db, email)),
        isSuspended: overrides.isSuspended ?? ((userId) => isSuspended(opened.db, userId)),
      },
    );
    let result: T;
    try {
      result = await work({ db: opened.db, auth, defer });
    } catch (error) {
      await opened.close();
      throw error;
    }
    const finish = Promise.allSettled(pending).then(() => opened.close());
    if (!waitUntil(c, finish)) await finish;
    return result;
  }

  const withDatabase = createMiddleware<{ Bindings: Env; Variables: Vars }>(async (c, next) => {
    // Idempotente: um portão (`use`) e a própria rota podem pedir o banco sem abri-lo duas vezes.
    if (c.get('db')) {
      await next();
      return;
    }
    await runWithDatabase(c, async ({ db, auth, defer }) => {
      c.set('db', db);
      c.set('auth', auth);
      c.set('defer', defer);
      await next();
      // Respostas de sessão e identidade nunca são cacheáveis.
      c.header('Cache-Control', 'no-store');
    });
  });

  // Os endpoints nativos do plugin NÃO são expostos: o de pedido pularia o Turnstile e os limites,
  // e o de verificação cria sessão em GET (scanners de e-mail o consumiriam).
  const notFound = (c: Context) => c.json({ error: { code: 'not_found' } }, 404);
  routes.on(['GET', 'HEAD', 'POST'], '/auth/sign-in/magic-link', notFound);
  routes.on(['GET', 'HEAD', 'POST'], '/auth/magic-link/verify', notFound);

  // Aceite dos Termos e da Política com a declaração de 18+ (M1-09). Estas rotas vêm ANTES do
  // portão abaixo: são as únicas de área logada que respondem sem o aceite (além do sign-out).
  routes.get('/me/legal', withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const [documents, pending] = await Promise.all([
      currentVersions(c.var.db),
      pendingVersions(c.var.db, session.user.id),
    ]);
    const status: LegalStatusDto = { accepted: pending.length === 0, documents };
    return c.json(status);
  });

  routes.post('/me/legal/accept', withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const parsed = acceptLegalSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    const result = await acceptCurrent(c.var.db, {
      userId: session.user.id,
      documentVersionIds: parsed.data.documentVersionIds,
    });
    return result === 'accepted'
      ? c.json({ status: 'ok' })
      : c.json({ error: { code: 'terms_changed' } }, 409);
  });

  // PORTÃO: toda rota de área logada (`/me/*` e `/staff/*`) exige o aceite das versões vigentes.
  // Registrado antes das rotas que protege, porque a ordem de registro é a ordem de execução.
  routes.use('/me/*', withDatabase, requireAcceptedTerms());
  routes.use('/staff/*', withDatabase, requireAcceptedTerms());

  routes.post('/auth/link/request', async (c) => {
    c.header('Cache-Control', 'no-store');
    const parsed = linkRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    const { email, captchaToken } = parsed.data;
    const ip = c.req.header('cf-connecting-ip');

    const human = await verifyTurnstile({
      secret: c.env.TURNSTILE_SECRET_KEY,
      token: captchaToken,
      ip,
      ...(overrides.turnstileFetch ? { fetchImpl: overrides.turnstileFetch } : {}),
    });
    if (!human) return c.json({ error: { code: 'captcha_failed' } }, 403);

    // Só aqui o banco abre: pedido inválido ou de robô nunca acorda o Neon.
    return runWithDatabase(c, async ({ db, auth, defer }) => {
      // Limites por e-mail e por IP; o teto global só conta o que passou nos dois (spam recusado
      // não consome a cota de e-mails do dia). Excesso = mesma resposta genérica, sem envio.
      const byEmail = await hitThrottle(
        db,
        `link:email:${await sha256Hex(email)}`,
        limits.perEmail.windowSeconds,
      );
      const byIp = await hitThrottle(
        db,
        `link:ip:${ip ?? 'desconhecido'}`,
        limits.perIp.windowSeconds,
      );
      if (byEmail > limits.perEmail.max || byIp > limits.perIp.max) {
        return c.json(GENERIC_LINK_RESPONSE);
      }
      const today = new Date().toISOString().slice(0, 10);
      const global = await hitThrottle(db, `link:global:${today}`, 24 * 60 * 60);
      if (global > limits.globalPerDay) return c.json(GENERIC_LINK_RESPONSE);

      const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
      const staff = await (
        overrides.isStaffEmail ?? ((value: string) => lookupStaffEmail(db, value))
      )(email);
      const suspended = existing
        ? await (overrides.isSuspended ?? ((id: string) => isSuspended(db, id)))(existing.id)
        : false;
      if (
        decideDelivery({
          userExists: existing !== undefined,
          isStaffEmail: staff,
          isSuspended: suspended,
        }) === 'send'
      ) {
        defer(
          auth.api
            .signInMagicLink({ body: { email }, headers: c.req.raw.headers })
            .catch((error: unknown) => {
              // Sem e-mail, token ou endereço no registro: só o tipo do erro.
              console.error(
                JSON.stringify({
                  event: 'link_delivery_failed',
                  error: error instanceof Error ? error.name : 'unknown',
                }),
              );
            }),
        );
      }
      return c.json(GENERIC_LINK_RESPONSE);
    });
  });

  routes.post('/auth/link/confirm', withDatabase, async (c) => {
    const parsed = linkConfirmSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    let verified: Response;
    try {
      verified = await c.var.auth.api.magicLinkVerify({
        query: { token: parsed.data.token },
        headers: c.req.raw.headers,
        asResponse: true,
      });
    } catch (error) {
      // Conta suspensa no meio do login (corrida): o gatilho do banco recusou a sessão. Mesma
      // resposta de link inválido: não revela que a conta existe nem que está suspensa.
      if (isRestrictViolation(error)) {
        return c.json({ error: { code: 'invalid_or_expired_link' } }, 400);
      }
      throw error;
    }
    // Em falha o plugin responde com redirect para uma página de erro; a API devolve JSON.
    if (verified.status >= 300) {
      return c.json({ error: { code: 'invalid_or_expired_link' } }, 400);
    }
    // O corpo do plugin traz o token da sessão; a sessão vive só no cookie HttpOnly.
    const headers = new Headers({ 'content-type': 'application/json' });
    for (const cookie of verified.headers.getSetCookie()) headers.append('set-cookie', cookie);
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers });
  });

  routes.use('/auth/*', withDatabase);
  // Reautenticação recente: pedir o link (sempre para o e-mail da PRÓPRIA sessão) e confirmar nesta
  // mesma sessão. O desafio é de uso único e ligado à sessão que o pediu.
  routes.post('/auth/reauth/request', withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    if (!reauthRequestSchema.safeParse(await c.req.json().catch(() => null)).success) {
      return c.json({ error: { code: 'invalid_request' } }, 400);
    }
    const byUser = await hitThrottle(
      c.var.db,
      `reauth:user:${await sha256Hex(session.user.id)}`,
      limits.perEmail.windowSeconds,
    );
    const today = new Date().toISOString().slice(0, 10);
    const global = await hitThrottle(c.var.db, `link:global:${today}`, 24 * 60 * 60);
    if (byUser > limits.perEmail.max || global > limits.globalPerDay) {
      return c.json({ error: { code: 'rate_limited' } }, 429);
    }
    const token = await createReauthChallenge(c.var.db, {
      sessionId: session.session.id,
      userId: session.user.id,
    });
    const sender = overrides.emailSender ?? createEmailSender(c.env);
    c.var.defer(
      sender
        .send({
          to: session.user.email,
          template: 'reauth-link',
          variables: {
            LINK_URL: `${c.env.APP_BASE_URL}/entrar/confirmar#token=${encodeURIComponent(token)}&purpose=reauth`,
          },
          idempotencyKey: `reauth-link:${await sha256Hex(token)}`,
        })
        .catch((error: unknown) => {
          console.error(
            JSON.stringify({
              event: 'reauth_delivery_failed',
              error: error instanceof Error ? error.name : 'unknown',
            }),
          );
        }),
    );
    return c.json(GENERIC_LINK_RESPONSE);
  });

  routes.post('/auth/reauth/confirm', withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const parsed = linkConfirmSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    const confirmed = await confirmReauth(c.var.db, {
      sessionId: session.session.id,
      token: parsed.data.token,
    });
    return confirmed
      ? c.json({ status: 'ok' })
      : c.json({ error: { code: 'invalid_or_expired_link' } }, 400);
  });

  // Convite de Staff (M1-04): /api/staff/invitations/*.
  routes.route(
    '/staff',
    staffRoutes({
      withDatabase,
      emailSender: (c) => overrides.emailSender ?? createEmailSender(c.env),
      globalPerDay: limits.globalPerDay,
    }),
  );

  routes.on(['GET', 'POST'], '/auth/*', (c) => c.var.auth.handler(c.req.raw));

  routes.get('/me', async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ error: { code: 'unauthenticated' } }, 401);
    }
    const me: MeDto = { id: session.user.id, email: session.user.email, name: session.user.name };
    return c.json(me);
  });

  // O que a pessoa pode fazer, para a interface decidir o que mostrar. NÃO autoriza nada: cada rota
  // protegida confere a capability no servidor (requireCapability).
  routes.get('/me/access', withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const access = await loadAccess(c.var.db, session.user.id);
    if (access.suspended) return c.json({ error: { code: 'account_suspended' } }, 403);
    return c.json({
      roles: ['student', ...access.roles],
      capabilities: effectiveCapabilities(access),
      recentAuth: await hasRecentReauth(c.var.db, session.session.id),
    });
  });

  // Perfil e preferências da PRÓPRIA pessoa: o usuário vem sempre da sessão, nunca do corpo nem do
  // caminho, então não existe forma de apontar para o perfil de outra pessoa.
  routes.get('/me/profile', withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const found = await getProfile(c.var.db, session.user.id);
    return found ? c.json(found) : c.json({ error: { code: 'profile_not_found' } }, 404);
  });

  routes.patch('/me/profile', withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const parsed = profilePatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    const updated = await updateProfile(c.var.db, session.user.id, parsed.data);
    return updated ? c.json(updated) : c.json({ error: { code: 'profile_not_found' } }, 404);
  });

  return routes;
}

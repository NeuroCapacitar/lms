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
import {
  hasStaffRole,
  isStaffEmail as lookupStaffEmail,
  isSuspended,
  loadAccess,
} from './access-store';
import { catalogRoutes } from '../catalog/routes';
import { studentCatalogRoutes } from '../catalog/student-routes';
import { courseAccessRoutes } from '../access/routes';
import { certificateStaffRoutes } from '../certificate/routes';
import { enrollmentStaffRoutes } from '../access/staff-routes';
import { discussionRoutes, discussionStaffRoutes } from '../discussion/routes';
import { interestRoutes, interestStaffRoutes } from '../interest/routes';
import { bannerRoutes, bannerStaffRoutes } from '../banner/routes';
import type { CheckoutProvider } from '../commerce/checkout-provider';
import type { PaymentReader } from '../commerce/payment-reader';
import type { RefundProvider } from '../commerce/refund-provider';
import { financeStaffRoutes } from '../commerce/finance-routes';
import { commerceRoutes } from '../commerce/routes';
import { helpRoutes, helpStaffRoutes } from '../help/routes';
import { createR2Storage } from '../media/r2-storage';
import { mediaRoutes } from '../media/routes';
import type { ObjectStorage } from '../media/storage';
import { operationsRoutes } from '../ops/routes';
import { videoRoutes } from '../video/routes';
import { emailQuotaExhausted } from '../email/quota-store';
import { previewRoutes } from '../learning/preview-routes';
import { learningRoutes } from '../learning/routes';
import { methodRoutes } from './method-routes';
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
  isStaffUser?: (userId: string) => Promise<boolean>;
  /** Credenciais do Google nos testes; `null` desliga. Em produção vêm do ambiente. */
  google?: { clientId: string; clientSecret: string } | null;
  turnstileFetch?: typeof fetch;
  limits?: LinkLimits;
  /** Relógio das rotas de estudo (drip), só nos testes. */
  clock?: () => Date;
  /** Armazenamento de mídia nos testes; em produção vem do R2 do ambiente (`undefined` = mídia desligada). */
  mediaStorage?: ObjectStorage;
  /** Provider de checkout nos testes (dublê do Asaas); em produção vem de `ASAAS_API_KEY` (`undefined` = compra desligada). */
  checkoutProvider?: CheckoutProvider;
  /** Leitor de pagamentos nos testes (dublê do Asaas); em produção vem de `ASAAS_API_KEY`. */
  paymentReader?: PaymentReader;
  /** Provider de reembolso nos testes (dublê do Asaas); em produção vem de `ASAAS_API_KEY`. */
  refundProvider?: RefundProvider;
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
  /** O Google só existe quando as duas credenciais estão no ambiente (ou injetadas nos testes). */
  const googleOf = (env: Env) => {
    if (overrides.google !== undefined) return overrides.google;
    return env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
      : null;
  };

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
        isStaffUser: overrides.isStaffUser ?? ((userId) => hasStaffRole(opened.db, userId)),
        ...(googleOf(c.env) ? { google: googleOf(c.env)! } : {}),
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

  // PORTÃO: toda rota de área logada (`/me/*`, `/staff/*`, `/catalog/*`, `/courses/*` e `/lessons/*`) exige o aceite das versões vigentes.
  // Registrado antes das rotas que protege, porque a ordem de registro é a ordem de execução.
  routes.use('/me/*', withDatabase, requireAcceptedTerms());
  routes.use('/staff/*', withDatabase, requireAcceptedTerms());
  routes.use('/catalog/*', withDatabase, requireAcceptedTerms());
  routes.use('/courses/*', withDatabase, requireAcceptedTerms());
  routes.use('/lessons/*', withDatabase, requireAcceptedTerms());
  routes.use('/media/*', withDatabase, requireAcceptedTerms());

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

      // Cota de e-mail do dia esgotada (M4-08): avisa em vez de prometer um link que não vai chegar. O
      // aviso é GLOBAL (vale para qualquer e-mail, antes de olhar quem é a pessoa), então não revela se
      // o e-mail tem conta nem se é da equipe. Depois da meia-noite UTC (21h em Brasília) volta ao normal.
      if (await emailQuotaExhausted(db)) {
        return c.json({ error: { code: 'email_unavailable' } }, 503);
      }

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

  // Prévia de aluno da Staff (M3-07): /api/staff/preview/courses/:id/outline e /lessons/:lessonId (só leitura).
  routes.route(
    '/staff',
    previewRoutes({ withDatabase, ...(overrides.clock ? { clock: overrides.clock } : {}) }),
  );

  // Matrícula manual, suspensão e inscritos (M3-06): /api/staff/enrollments, /entitlements e /courses/:id/enrollments.
  routes.route(
    '/staff',
    enrollmentStaffRoutes({ withDatabase, ...(overrides.clock ? { clock: overrides.clock } : {}) }),
  );

  // Catálogo da Staff (M2-01): /api/staff/courses/*.
  routes.route(
    '/staff',
    catalogRoutes({
      withDatabase,
      storage: (c) => overrides.mediaStorage ?? createR2Storage(c.env),
    }),
  );

  // Operations Center (M4-05): /api/staff/operations (leitura da Staff; ações com grant e reautenticação).
  routes.route('/staff', operationsRoutes({ withDatabase }));

  // Conexões com providers de vídeo (M5-01): /api/staff/video/* (só Admin; segredo nunca volta).
  routes.route('/staff', videoRoutes({ withDatabase }));

  // Contagens de interessados por curso e ciclo (M5-06): /api/staff/courses/:id/interests (staff.read).
  routes.route('/staff', interestStaffRoutes({ withDatabase }));

  // Revisões financeiras (M6-04): /api/staff/finance (grant finance.review; leitor do Asaas do ambiente).
  routes.route(
    '/staff',
    financeStaffRoutes({
      withDatabase,
      ...(overrides.paymentReader ? { reader: () => overrides.paymentReader } : {}),
      ...(overrides.refundProvider ? { refundProvider: () => overrides.refundProvider } : {}),
      ...(overrides.clock ? { clock: overrides.clock } : {}),
    }),
  );

  // Ajuda da Staff (M5-14): /api/staff/help (FAQ com help.edit; pedidos com staff.read).
  routes.route('/staff', helpStaffRoutes({ withDatabase }));

  // Banners do painel e imagens do login (M5-15): /api/staff/banners (só Admin; R2 do ambiente para publicar).
  routes.route(
    '/staff',
    bannerStaffRoutes({
      withDatabase,
      storage: (c) => overrides.mediaStorage ?? createR2Storage(c.env),
    }),
  );

  // Emitente e signatário do certificado (M7-06): /api/staff/certificate e /api/staff/courses/:id/certificate (só Admin).
  routes.route('/staff', certificateStaffRoutes({ withDatabase }));

  // Moderação e resposta da equipe nas discussões (M5-05): /api/staff/discussions (grant discussion.moderate).
  routes.route('/staff', discussionStaffRoutes({ withDatabase }));

  // Mídia (M5-07): /api/media/intents, /:id/confirm e /:id/content (sessão e termos; R2 do ambiente).
  routes.route(
    '/',
    mediaRoutes({
      withDatabase,
      storage: (c) => overrides.mediaStorage ?? createR2Storage(c.env),
      ...(overrides.clock ? { clock: overrides.clock } : {}),
    }),
  );

  // Banners do painel do aluno (M5-15): /api/me/banners (sessão e termos).
  routes.route(
    '/',
    bannerRoutes({ withDatabase, ...(overrides.clock ? { clock: overrides.clock } : {}) }),
  );

  // Compra (M6-02): /api/me/checkout (sessão e termos; Asaas do ambiente).
  routes.route(
    '/',
    commerceRoutes({
      withDatabase,
      ...(overrides.checkoutProvider ? { provider: () => overrides.checkoutProvider } : {}),
      ...(overrides.paymentReader ? { reader: () => overrides.paymentReader } : {}),
      ...(overrides.clock ? { clock: overrides.clock } : {}),
    }),
  );

  // Ajuda do aluno (M5-14): /api/me/help/faq e /api/me/help/requests (sessão e termos).
  routes.route(
    '/',
    helpRoutes({ withDatabase, ...(overrides.clock ? { clock: overrides.clock } : {}) }),
  );

  // Interesse em cursos ainda não abertos (M5-06): /api/me/course-interests (sessão e termos).
  routes.route(
    '/',
    interestRoutes({ withDatabase, ...(overrides.clock ? { clock: overrides.clock } : {}) }),
  );

  // Catálogo do aluno (M2-04): /api/catalog/courses (com sessão e termos aceitos).
  routes.route(
    '/catalog',
    studentCatalogRoutes({ withDatabase, ...(overrides.clock ? { clock: overrides.clock } : {}) }),
  );

  // Acesso do aluno a um curso (M3-02): /api/courses/:id/access e /enroll (termos aceitos).
  routes.route(
    '/',
    courseAccessRoutes({ withDatabase, ...(overrides.clock ? { clock: overrides.clock } : {}) }),
  );

  // Estudo (M3-03): o mapa do curso e a aula, com drip e sequência decididos no servidor.
  routes.route(
    '/',
    learningRoutes({ withDatabase, ...(overrides.clock ? { clock: overrides.clock } : {}) }),
  );

  // Discussão por aula (M5-05): /api/lessons/:id/discussion (a mesma aula que abre para a pessoa).
  routes.route(
    '/',
    discussionRoutes({ withDatabase, ...(overrides.clock ? { clock: overrides.clock } : {}) }),
  );

  // Senha e Google (M1-07): login, retorno do Google e "Segurança da conta".
  routes.route(
    '/',
    methodRoutes({
      withDatabase,
      runWithDatabase: (c, work) => runWithDatabase(c, work),
      googleEnabled: (c) => googleOf(c.env) !== null,
      ...(overrides.turnstileFetch ? { turnstileFetch: overrides.turnstileFetch } : {}),
    }),
  );

  // Do Better Auth só o encerramento de sessão fica exposto. Os demais endpoints nativos (login
  // por senha, login social, troca de senha, ligação de conta, `get-session`...) pulariam o Turnstile,
  // os limites e a reautenticação, ou devolveriam o token da sessão no corpo: tudo passa pelas rotas
  // acima. Lista de permitidos de UM caminho; o resto é 404.
  routes.post('/auth/sign-out', withDatabase, (c) => c.var.auth.handler(c.req.raw));
  routes.all('/auth/*', notFound);

  routes.get('/me', async (c) => {
    // `returnHeaders`: a sessão é rolling e o Better Auth reenvia o cookie renovado; sem repassar,
    // o navegador o descartaria 7 dias depois do login mesmo com a sessão viva no banco.
    const result = await c.var.auth.api.getSession({
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    const session = result.response;
    if (!session) {
      return c.json({ error: { code: 'unauthenticated' } }, 401);
    }
    for (const cookie of result.headers.getSetCookie())
      c.header('set-cookie', cookie, { append: true });
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

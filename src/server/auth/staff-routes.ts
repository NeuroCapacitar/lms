import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import { hitThrottle } from '../../db/throttle';
import type { EmailSender } from '../../features/identity/link-policy';
import {
  acceptInvitationSchema,
  inviteStaffSchema,
} from '../../features/identity/staff-invitation';
import { sha256Hex } from '../crypto';
import { requireCapability } from './authorization';
import { requireRecentAuth } from './reauth';
import {
  AlreadyInvitedError,
  AlreadyStaffError,
  acceptInvitation,
  createInvitation,
  listInvitations,
  resendInvitation,
  revokeInvitation,
} from './staff-invitations';
import type { AuthVars } from './types';

type StaffContext = Context<{ Bindings: Env; Variables: AuthVars }>;

interface StaffRouteDeps {
  /** Middleware que abre o banco e monta o Better Auth (o mesmo das rotas de identidade). */
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
  emailSender: (c: StaffContext) => EmailSender;
  /** Teto diário global de e-mails de link/convite (o Resend Free envia 100 por dia). */
  globalPerDay: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Convite de Staff (M1-04). Criar, reenviar e revogar exigem a capability `staff.manage` (só o
 * Admin) E a reautenticação recente da sessão; listar exige só a capability. Aceitar exige apenas
 * uma sessão: quem decide é o e-mail da sessão contra o do convite. Tudo é decidido no servidor,
 * por requisição; nada vem do corpo além do e-mail convidado e dos grants iniciais.
 */
export function staffRoutes(deps: StaffRouteDeps) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();
  const sensitive = [
    deps.withDatabase,
    requireCapability('staff.manage'),
    requireRecentAuth(),
  ] as const;

  function sendInvitation(c: StaffContext, to: string, token: string, hash: string) {
    c.var.defer(
      deps
        .emailSender(c)
        .send({
          to,
          template: 'staff-invitation',
          variables: {
            LINK_URL: `${c.env.APP_BASE_URL}/convite#token=${encodeURIComponent(token)}`,
          },
          idempotencyKey: `staff-invitation:${hash}`,
        })
        .catch((error: unknown) => {
          console.error(
            JSON.stringify({
              event: 'staff_invitation_delivery_failed',
              error: error instanceof Error ? error.name : 'unknown',
            }),
          );
        }),
    );
  }

  async function overDailyCap(c: StaffContext): Promise<boolean> {
    const today = new Date().toISOString().slice(0, 10);
    return (await hitThrottle(c.var.db, `link:global:${today}`, 24 * 60 * 60)) > deps.globalPerDay;
  }

  routes.get('/invitations', deps.withDatabase, requireCapability('staff.manage'), async (c) =>
    c.json({ invitations: await listInvitations(c.var.db) }),
  );

  routes.post('/invitations', ...sensitive, async (c) => {
    const parsed = inviteStaffSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    if (await overDailyCap(c)) return c.json({ error: { code: 'rate_limited' } }, 429);
    const actor = (await c.var.auth.api.getSession({ headers: c.req.raw.headers }))!.user;
    try {
      const { id, token } = await createInvitation(c.var.db, {
        actorId: actor.id,
        email: parsed.data.email,
        grants: parsed.data.grants,
      });
      sendInvitation(c, parsed.data.email, token, await sha256Hex(token));
      return c.json({ id, status: 'pending' }, 201);
    } catch (error) {
      if (error instanceof AlreadyStaffError) {
        return c.json({ error: { code: 'already_staff' } }, 409);
      }
      if (error instanceof AlreadyInvitedError) {
        return c.json({ error: { code: 'already_invited' } }, 409);
      }
      throw error;
    }
  });

  routes.post('/invitations/:id/resend', ...sensitive, async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ error: { code: 'not_found' } }, 404);
    if (await overDailyCap(c)) return c.json({ error: { code: 'rate_limited' } }, 429);
    const actor = (await c.var.auth.api.getSession({ headers: c.req.raw.headers }))!.user;
    try {
      const resent = await resendInvitation(c.var.db, { actorId: actor.id, id });
      if (!resent) return c.json({ error: { code: 'not_found' } }, 404);
      sendInvitation(c, resent.email, resent.token, await sha256Hex(resent.token));
      return c.json({ status: 'ok' });
    } catch (error) {
      if (error instanceof AlreadyStaffError) {
        return c.json({ error: { code: 'already_staff' } }, 409);
      }
      throw error;
    }
  });

  routes.post('/invitations/:id/revoke', ...sensitive, async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ error: { code: 'not_found' } }, 404);
    const actor = (await c.var.auth.api.getSession({ headers: c.req.raw.headers }))!.user;
    return (await revokeInvitation(c.var.db, { actorId: actor.id, id }))
      ? c.json({ status: 'ok' })
      : c.json({ error: { code: 'not_found' } }, 404);
  });

  routes.post('/invitations/accept', deps.withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const parsed = acceptInvitationSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    // Freio contra tentativa de adivinhar token (256 bits: só higiene) e contra repetição.
    const attempts = await hitThrottle(
      c.var.db,
      `invite-accept:${await sha256Hex(session.user.id)}`,
      10 * 60,
    );
    if (attempts > 10) return c.json({ error: { code: 'rate_limited' } }, 429);
    const result = await acceptInvitation(c.var.db, {
      token: parsed.data.token,
      userId: session.user.id,
    });
    switch (result) {
      case 'accepted':
        return c.json({ status: 'ok' });
      case 'suspended':
        return c.json({ error: { code: 'account_suspended' } }, 403);
      case 'unverified':
        return c.json({ error: { code: 'email_not_verified' } }, 403);
      default:
        return c.json({ error: { code: 'invalid_or_expired_invitation' } }, 400);
    }
  });

  return routes;
}

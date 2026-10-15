import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';

import {
  CERTIFICATE_STATUSES,
  type CertificateStatus,
} from '../../features/certificate/certificate';
import { reissueInputSchema, revokeInputSchema } from '../../features/certificate/lifecycle';
import { hasCapability, type Capability } from '../../features/identity/capabilities';
import { loadAccess } from '../auth/access-store';
import { requireCapability } from '../auth/authorization';
import { requireRecentAuth } from '../auth/reauth';
import type { AuthVars } from '../auth/types';
import type { ObjectStorage } from '../media/storage';
import {
  CertificateIntegrityError,
  CertificateNotFoundError,
  CertificateStateError,
  listMyCertificates,
  listStaffCertificates,
  openCertificateDownload,
  reissueCertificate,
  revokeCertificate,
} from './lifecycle-store';
import { retryCertificate } from './certificate-store';

type Ctx = Context<{ Bindings: Env; Variables: AuthVars }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Qualquer uma das capabilities (decidido no servidor a cada requisição; Admin tem todas). */
function requireAnyCapability(capabilities: readonly Capability[]) {
  return createMiddleware<{ Bindings: Env; Variables: AuthVars }>(async (c, next) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const access = await loadAccess(c.var.db, session.user.id);
    if (access.suspended) return c.json({ error: { code: 'account_suspended' } }, 403);
    if (!capabilities.some((capability) => hasCapability(access, capability))) {
      return c.json({ error: { code: 'forbidden' } }, 403);
    }
    c.set('access', access);
    await next();
  });
}

function failure(c: Ctx, error: unknown): Response {
  if (error instanceof CertificateNotFoundError) {
    return c.json({ error: { code: 'not_found' } }, 404);
  }
  if (error instanceof CertificateIntegrityError) {
    return c.json({ error: { code: 'certificate_unavailable' } }, 503);
  }
  if (error instanceof CertificateStateError) {
    return c.json({ error: { code: error.code } }, 409);
  }
  throw error;
}

/**
 * Certificados do ALUNO (M7-04), sob `/api/me/certificates` (sessão e termos): a lista e o download do PDF. O Worker lê
 * o objeto do R2 privado e confere o SHA-256; nunca há URL reutilizável. Quem não é dono, ou certificado que não está
 * `ready`, recebe 404.
 */
export function myCertificateRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
  storage: (c: Ctx) => ObjectStorage | undefined;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();

  routes.get('/me/certificates', deps.withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    c.header('Cache-Control', 'private, no-store');
    return c.json({ certificates: await listMyCertificates(c.var.db, session.user.id) });
  });

  routes.get('/me/certificates/:id/download', deps.withDatabase, async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ error: { code: 'not_found' } }, 404);
    const storage = deps.storage(c);
    if (!storage) return c.json({ error: { code: 'media_not_configured' } }, 503);
    try {
      const file = await openCertificateDownload(c.var.db, storage, {
        userId: session.user.id,
        certificateId: id,
      });
      return new Response(file.bytes as Uint8Array<ArrayBuffer>, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': String(file.bytes.byteLength),
          // O hash que o Worker JÁ conferiu: o app guarda a cópia offline e o recalcula antes de abri-la (M8-06).
          'X-Content-SHA256': file.sha256,
          'Content-Disposition': `attachment; filename="${file.filename}"`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
        },
      });
    } catch (error) {
      return failure(c, error);
    }
  });

  return routes;
}

/**
 * Certificados para a STAFF (M7-04), sob `/api/staff/certificates`: lista (Admin, `certificate.reissue` ou `ops.queue`),
 * revogar (SÓ Admin, reautenticação recente, categoria e nota interna), reemitir (`certificate.reissue`, com motivo) e
 * tentar de novo (`ops.queue`). O reembolso NÃO revoga: a Staff vê a data do reembolso junto do certificado.
 */
export function certificateLifecycleStaffRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();

  routes.get(
    '/certificates',
    deps.withDatabase,
    requireAnyCapability(['staff.manage', 'certificate.reissue', 'ops.queue']),
    async (c) => {
      const status = c.req.query('status');
      if (status !== undefined && !(CERTIFICATE_STATUSES as readonly string[]).includes(status)) {
        return c.json({ error: { code: 'invalid_request' } }, 400);
      }
      c.header('Cache-Control', 'no-store');
      return c.json({
        certificates: await listStaffCertificates(
          c.var.db,
          status ? { status: status as CertificateStatus } : {},
        ),
      });
    },
  );

  routes.post(
    '/certificates/:id/revoke',
    deps.withDatabase,
    requireCapability('staff.manage'),
    requireRecentAuth(),
    async (c) => {
      const id = c.req.param('id');
      if (!UUID.test(id)) return c.json({ error: { code: 'not_found' } }, 404);
      const parsed = revokeInputSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
      try {
        await revokeCertificate(c.var.db, {
          ...parsed.data,
          certificateId: id,
          actorId: c.var.access!.userId,
        });
        return c.json({ revoked: true });
      } catch (error) {
        return failure(c, error);
      }
    },
  );

  routes.post(
    '/certificates/:id/reissue',
    deps.withDatabase,
    requireCapability('certificate.reissue'),
    async (c) => {
      const id = c.req.param('id');
      if (!UUID.test(id)) return c.json({ error: { code: 'not_found' } }, 404);
      const parsed = reissueInputSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
      try {
        const newId = await reissueCertificate(c.var.db, {
          certificateId: id,
          reason: parsed.data.reason,
          actorId: c.var.access!.userId,
        });
        return c.json({ certificateId: newId }, 201);
      } catch (error) {
        return failure(c, error);
      }
    },
  );

  routes.post(
    '/certificates/:id/retry',
    deps.withDatabase,
    requireCapability('ops.queue'),
    async (c) => {
      const id = c.req.param('id');
      if (!UUID.test(id)) return c.json({ error: { code: 'not_found' } }, 404);
      const result = await retryCertificate(c.var.db, {
        certificateId: id,
        actorId: c.var.access!.userId,
      });
      if (result === 'not_found') return c.json({ error: { code: 'not_found' } }, 404);
      if (result === 'not_failed') return c.json({ error: { code: 'not_failed' } }, 409);
      return c.json({ requeued: true });
    },
  );

  return routes;
}

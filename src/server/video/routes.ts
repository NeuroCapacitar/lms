import type { Context, MiddlewareHandler } from 'hono';
import { Hono } from 'hono';

import { createConnectionSchema, rotateSecretSchema } from '../../features/video/providers';
import { providerAvailability, verificationEnvironment } from '../../features/video/verification';
import { requireCapability } from '../auth/authorization';
import { requireRecentAuth } from '../auth/reauth';
import type { AuthVars } from '../auth/types';
import { APP_ENV } from '../release';
import { SecretBoxConfigError, parseKeyring, type Keyring } from '../security/secret-box';
import {
  ConnectionNotFoundError,
  KeyringMissingError,
  ProviderNotVerifiedError,
  SecretRequiredError,
  createConnection,
  listConnections,
  rekeyAll,
  rotateSecret,
  setConnectionStatus,
} from './connection-store';

type VideoContext = Context<{ Bindings: Env; Variables: AuthVars }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O cofre do ambiente; `undefined` se o segredo do Worker não foi configurado (ou está malformado). */
async function keyringOf(c: VideoContext): Promise<Keyring | undefined> {
  try {
    return await parseKeyring(c.env.VIDEO_SECRETS_MASTER_KEY);
  } catch (error) {
    if (error instanceof SecretBoxConfigError) return undefined;
    throw error;
  }
}

/**
 * Conexões com providers de vídeo (M5-01), sob `/api/staff/video`. SÓ o Admin (`integration.credentials`,
 * nunca delegável): a leitura e cada mudança conferem a capability no servidor a cada requisição, e as
 * mudanças pedem reautenticação recente. NENHUMA resposta devolve o segredo, cifrado ou não: só
 * "configurado" e a versão da chave. A auditoria (na mesma transação) nunca grava o segredo.
 */
export function videoRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();
  const guarded = [deps.withDatabase, requireCapability('integration.credentials')] as const;
  const sensitive = [...guarded, requireRecentAuth()] as const;
  const actor = (c: VideoContext) => c.var.access!.userId;

  function failure(c: VideoContext, error: unknown): Response {
    if (error instanceof SecretRequiredError) {
      return c.json({ error: { code: 'secret_required' } }, 400);
    }
    if (error instanceof ProviderNotVerifiedError) {
      return c.json({ error: { code: 'provider_not_verified' } }, 400);
    }
    if (error instanceof ConnectionNotFoundError) {
      return c.json({ error: { code: 'not_found' } }, 404);
    }
    if (error instanceof KeyringMissingError) {
      return c.json({ error: { code: 'video_secrets_not_configured' } }, 503);
    }
    throw error;
  }

  routes.get('/video/connections', ...guarded, async (c) => {
    c.header('cache-control', 'no-store');
    return c.json({ connections: await listConnections(c.var.db) });
  });

  // Quais providers este ambiente oferece (M5-03): Production só os verificados; Dev/Staging todos, com aviso.
  routes.get('/video/providers', ...guarded, (c) => {
    c.header('cache-control', 'no-store');
    return c.json({
      environment: verificationEnvironment(APP_ENV),
      providers: providerAvailability(APP_ENV),
    });
  });

  routes.post('/video/connections', ...sensitive, async (c) => {
    const parsed = createConnectionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    try {
      const connection = await createConnection(c.var.db, await keyringOf(c), {
        ...parsed.data,
        actorId: actor(c),
      });
      return c.json({ connection }, 201);
    } catch (error) {
      return failure(c, error);
    }
  });

  routes.put('/video/connections/:id/secret', ...sensitive, async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ error: { code: 'invalid_request' } }, 400);
    const parsed = rotateSecretSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    try {
      const connection = await rotateSecret(c.var.db, await keyringOf(c), {
        id,
        secret: parsed.data.secret,
        actorId: actor(c),
      });
      return c.json({ connection });
    } catch (error) {
      return failure(c, error);
    }
  });

  for (const [path, status] of [
    ['disable', 'disabled'],
    ['enable', 'active'],
  ] as const) {
    routes.post(`/video/connections/:id/${path}`, ...sensitive, async (c) => {
      const id = c.req.param('id');
      if (!UUID.test(id)) return c.json({ error: { code: 'invalid_request' } }, 400);
      try {
        const connection = await setConnectionStatus(c.var.db, { id, status, actorId: actor(c) });
        return c.json({ connection });
      } catch (error) {
        return failure(c, error);
      }
    });
  }

  routes.post('/video/rekey', ...sensitive, async (c) => {
    const keyring = await keyringOf(c);
    if (!keyring) return c.json({ error: { code: 'video_secrets_not_configured' } }, 503);
    return c.json(await rekeyAll(c.var.db, keyring, actor(c)));
  });

  return routes;
}

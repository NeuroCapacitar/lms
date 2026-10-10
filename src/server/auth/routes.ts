import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';

import { openDatabase } from '../../db/client';
import { createAuth, type Auth } from './create-auth';

/** DTO mínimo de `GET /api/me`: nada além do necessário para a interface identificar a pessoa. */
interface MeDto {
  id: string;
  email: string;
  name: string;
}

/**
 * Rotas de identidade: o handler do Better Auth em `/api/auth/*` e `GET /api/me`. Abre o banco
 * (um cliente `pg` por requisição) só nestas rotas, para `health/live` nunca acordar o Neon.
 */
export function authRoutes() {
  const routes = new Hono<{ Bindings: Env; Variables: { auth: Auth } }>();

  // Só nestas duas rotas: um `use('*')` abriria o banco para QUALQUER /api (inclusive 404 de
  // varredura) e acordaria o Neon a cada caminho inventado.
  const withDatabase = createMiddleware<{ Bindings: Env; Variables: { auth: Auth } }>(
    async (c, next) => {
      const opened = await openDatabase(c.env.HYPERDRIVE.connectionString);
      try {
        c.set(
          'auth',
          createAuth(opened.db, { baseUrl: c.env.APP_BASE_URL, secret: c.env.BETTER_AUTH_SECRET }),
        );
        await next();
        // Respostas de sessão e identidade nunca são cacheáveis.
        c.header('Cache-Control', 'no-store');
      } finally {
        await opened.close();
      }
    },
  );
  routes.use('/auth/*', withDatabase);
  routes.use('/me', withDatabase);

  routes.on(['GET', 'POST'], '/auth/*', (c) => c.var.auth.handler(c.req.raw));

  routes.get('/me', async (c) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ error: { code: 'unauthenticated' } }, 401);
    }
    const me: MeDto = { id: session.user.id, email: session.user.email, name: session.user.name };
    return c.json(me);
  });

  return routes;
}

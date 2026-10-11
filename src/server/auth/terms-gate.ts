import { createMiddleware } from 'hono/factory';

import { hasAcceptedCurrent } from './legal-store';
import type { AuthVars } from './types';

/**
 * Portão do aceite (M1-09): quem tem sessão e ainda não aceitou as versões vigentes dos Termos e da
 * Política (com a declaração de 18+) recebe 403 `terms_required` em TODA rota de área logada. Sem
 * sessão passa direto (a própria rota responde 401). As únicas exceções são as rotas de aceite
 * (`/me/legal`) e o encerramento de sessão, registradas ANTES deste portão. Decidido no servidor, a
 * cada requisição; a tela de aceite da interface é só consequência.
 */
export function requireAcceptedTerms() {
  return createMiddleware<{ Bindings: Env; Variables: AuthVars }>(async (c, next) => {
    // `returnHeaders`: este é o primeiro `getSession` da requisição e é ele quem renova a sessão
    // rolling; se o cookie renovado não fosse repassado aqui, a rota (que já encontra a sessão em dia)
    // não o reenviaria e o navegador o descartaria 7 dias após o login.
    const result = await c.var.auth.api.getSession({
      headers: c.req.raw.headers,
      returnHeaders: true,
    });
    for (const cookie of result.headers.getSetCookie()) {
      c.header('set-cookie', cookie, { append: true });
    }
    const session = result.response;
    if (session && !(await hasAcceptedCurrent(c.var.db, session.user.id))) {
      return c.json({ error: { code: 'terms_required' } }, 403);
    }
    await next();
  });
}

import { Hono, type Context, type MiddlewareHandler } from 'hono';
import type { ZodError } from 'zod';

import { createIncidentSchema, updateIncidentSchema } from '../../features/privacy/incident';
import { requireCapability } from '../auth/authorization';
import { requireRecentAuth } from '../auth/reauth';
import type { AuthVars } from '../auth/types';
import {
  IncidentClosedError,
  IncidentNotFoundError,
  IncidentRuleError,
  createIncident,
  listIncidents,
  updateIncident,
} from './incident-store';

type IncidentContext = Context<{ Bindings: Env; Variables: AuthVars }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O texto trazia dado pessoal? Diz isso à tela (código próprio) em vez de um "inválido" genérico. */
function invalid(c: IncidentContext, error: ZodError): Response {
  const personal = error.issues.some((issue) => issue.message === 'personal_data_in_text');
  return c.json({ error: { code: personal ? 'personal_data_in_text' : 'invalid_request' } }, 400);
}

/**
 * Registro de incidentes com dados pessoais (M9-06, ADR 0033), sob `/api/staff/privacy/incidents`. SÓ o Admin
 * (`staff.manage`); escrever exige reautenticação recente; o texto nunca pode carregar dado pessoal (a API recusa
 * e-mail, CPF, CNPJ, telefone e link de acesso). Nada é apagado. A decisão de comunicar à ANPD é do responsável
 * com o advogado: aqui só se registra.
 */
export function privacyIncidentRoutes(deps: {
  withDatabase: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }>;
}) {
  const routes = new Hono<{ Bindings: Env; Variables: AuthVars }>();
  const read = [deps.withDatabase, requireCapability('staff.manage')] as const;
  const write = [...read, requireRecentAuth()] as const;

  routes.get('/privacy/incidents', ...read, async (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ items: await listIncidents(c.var.db) });
  });

  routes.post('/privacy/incidents', ...write, async (c) => {
    const parsed = createIncidentSchema().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, parsed.error);
    const item = await createIncident(c.var.db, c.var.access!.userId, parsed.data);
    return c.json({ item }, 201);
  });

  routes.patch('/privacy/incidents/:id', ...write, async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ error: { code: 'not_found' } }, 404);
    const parsed = updateIncidentSchema().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, parsed.error);
    try {
      return c.json({
        item: await updateIncident(c.var.db, c.var.access!.userId, id, parsed.data),
      });
    } catch (error) {
      if (error instanceof IncidentNotFoundError)
        return c.json({ error: { code: 'not_found' } }, 404);
      if (error instanceof IncidentClosedError)
        return c.json({ error: { code: 'incident_closed' } }, 409);
      if (error instanceof IncidentRuleError) return c.json({ error: { code: error.code } }, 409);
      throw error;
    }
  });

  return routes;
}

import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';

import type { Database } from '../../db/client';
import { reauthChallenge, reauthProof } from '../../db/schema';
import { LINK_LIMITS } from '../../features/identity/link-policy';
import { sha256Hex } from '../crypto';
import type { AuthVars } from './types';

/** Janela da prova de reautenticação (proposta: 10 minutos). */
const REAUTH_MAX_MINUTES = 10;

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

/** Cria um desafio ligado A UMA sessão. Devolve o token em texto; o banco guarda só o hash. */
export async function createReauthChallenge(
  db: Database,
  input: { sessionId: string; userId: string },
): Promise<string> {
  const token = randomToken();
  await db.insert(reauthChallenge).values({
    tokenHash: await sha256Hex(token),
    sessionId: input.sessionId,
    userId: input.userId,
    expiresAt: new Date(Date.now() + LINK_LIMITS.linkTtlSeconds * 1000),
  });
  return token;
}

/**
 * Consome o desafio (uso único, atômico) SÓ se ele pertence a esta sessão e não expirou, e grava a
 * prova da sessão. Token de outra sessão, usado, expirado ou inventado: `false`, sem diferença.
 */
export async function confirmReauth(
  db: Database,
  input: { sessionId: string; token: string },
): Promise<boolean> {
  const tokenHash = await sha256Hex(input.token);
  return db.transaction(async (tx) => {
    const consumed = await tx
      .update(reauthChallenge)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(reauthChallenge.tokenHash, tokenHash),
          eq(reauthChallenge.sessionId, input.sessionId),
          isNull(reauthChallenge.usedAt),
          gt(reauthChallenge.expiresAt, sql`now()`),
        ),
      )
      .returning({ tokenHash: reauthChallenge.tokenHash });
    if (consumed.length === 0) return false;
    await tx
      .insert(reauthProof)
      .values({ sessionId: input.sessionId, verifiedAt: new Date() })
      .onConflictDoUpdate({ target: reauthProof.sessionId, set: { verifiedAt: new Date() } });
    return true;
  });
}

/** A sessão tem prova de reautenticação dentro da janela? (entrar há pouco NÃO conta) */
export async function hasRecentReauth(
  db: Database,
  sessionId: string,
  maxMinutes: number = REAUTH_MAX_MINUTES,
): Promise<boolean> {
  const rows = await db
    .select({ sessionId: reauthProof.sessionId })
    .from(reauthProof)
    .where(
      and(
        eq(reauthProof.sessionId, sessionId),
        gt(reauthProof.verifiedAt, sql`now() - make_interval(mins => ${maxMinutes})`),
      ),
    );
  return rows.length > 0;
}

/**
 * Guard reutilizável para ações sensíveis (convidar Staff, papéis e grants, suspender; reembolso no
 * M6): exige a prova de reautenticação RECENTE da sessão atual. Sem ela, 403 `reauth_required`
 * (código próprio, para a interface pedir um novo link). Vai depois do middleware que abre o
 * banco e, normalmente, depois de `requireCapability`.
 */
export function requireRecentAuth(maxMinutes: number = REAUTH_MAX_MINUTES) {
  return createMiddleware<{ Bindings: Env; Variables: AuthVars }>(async (c, next) => {
    const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: { code: 'unauthenticated' } }, 401);
    if (!(await hasRecentReauth(c.var.db, session.session.id, maxMinutes))) {
      return c.json({ error: { code: 'reauth_required' } }, 403);
    }
    await next();
  });
}

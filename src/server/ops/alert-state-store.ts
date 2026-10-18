import { inArray, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { alertState } from '../../db/schema';
import { planNotifications } from '../../features/ops/alert-notify';
import type { OpsAlert } from '../../features/ops/operations';

/**
 * Entrega dos alertas ativos (M9-06, ADR 0033). Lê o estado, decide quem notificar (`planNotifications`), chama
 * `send` FORA de transação (rede nunca dentro de transação do banco) e grava o resultado: só o que o `send` confirmou
 * recebe `last_notified_at` (um envio que falhou é tentado de novo no próximo ciclo). Alerta que sumiu perde o estado.
 * Devolve quantas notificações saíram.
 */
export async function deliverAlerts(
  db: Database,
  alerts: readonly OpsAlert[],
  send: (alert: OpsAlert) => Promise<boolean>,
): Promise<number> {
  const rows = await db.select().from(alertState);
  const plan = planNotifications(
    alerts,
    rows.map((row) => ({ code: row.code, lastNotifiedAt: row.lastNotifiedAt?.getTime() ?? null })),
    Date.now(),
  );

  const delivered: string[] = [];
  for (const alert of plan.notify) if (await send(alert)) delivered.push(alert.code);

  await db.transaction(async (tx) => {
    for (const alert of alerts) {
      await tx
        .insert(alertState)
        .values({
          code: alert.code,
          severity: alert.severity,
          lastNotifiedAt: delivered.includes(alert.code) ? sql`now()` : null,
        })
        .onConflictDoUpdate({
          target: alertState.code,
          set: {
            severity: alert.severity,
            lastSeenAt: sql`now()`,
            ...(delivered.includes(alert.code) ? { lastNotifiedAt: sql`now()` } : {}),
          },
        });
    }
    if (plan.clear.length > 0)
      await tx.delete(alertState).where(inArray(alertState.code, plan.clear));
  });
  return delivered.length;
}

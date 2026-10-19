import { inArray, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { payment, purchaseOrder } from '../../db/schema';
import { auditEvent } from '../auth/access-store';
import { applyPaymentEvidence } from '../commerce/payment-evidence-store';
import {
  PaymentReadPermanentError,
  PaymentReadTransientError,
  type PaymentReader,
} from '../commerce/payment-reader';
import { setQueuePaused } from './operations-store';

/**
 * Reconciliação PÓS-RESTORE (M9-05). Depois de restaurar um backup, o banco está atrasado em relação ao mundo (Asaas,
 * Resend, pessoas que pediram exclusão). NADA aqui roda sozinho nem por rota: são passos do runbook, chamados pelo script
 * `bun run restore:reconcile`, nesta ordem: (1) QUARENTENA das duas filas, (2) reler os pagamentos no Asaas, (3) retirar
 * os e-mails pendentes (podem já ter saído), (4) reaplicar as exclusões (script de privacidade) e só então (5) liberar.
 * Nunca restaure direto em Production sem revisão; nada aqui chama o provider dentro de transação.
 */
const LANES = ['finance', 'general'] as const;

/** Passo 1: pausa as duas filas (kill switch) e deixa o motivo na auditoria. Idempotente. */
export async function quarantineQueues(
  db: Database,
  input: { actorId: string; reason: string },
): Promise<void> {
  for (const lane of LANES)
    await setQueuePaused(db, { lane, paused: true, actorId: input.actorId, reason: input.reason });
}

/** Passo final: retoma as duas filas, SÓ depois de reconciliar. */
export async function releaseQuarantine(
  db: Database,
  input: { actorId: string; reason: string },
): Promise<void> {
  for (const lane of LANES)
    await setQueuePaused(db, { lane, paused: false, actorId: input.actorId, reason: input.reason });
}

export interface ResyncSummary {
  /** Pagamentos relidos no Asaas. */
  checked: number;
  /** Quantos mudaram o estado do pedido (reembolso, estorno, concessão...), por resultado. */
  outcomes: Record<string, number>;
  /** Pagamentos que o Asaas já não conhece. */
  notFound: number;
  /** Parou antes do fim (falha do provider): quantos ficaram sem reler. */
  remaining: number;
  stopped: 'transient' | 'permanent' | null;
}

/**
 * Passo 2: relê NO ASAAS cada pagamento de pedido ainda aberto ou concluído no banco restaurado e aplica a evidência
 * pelo MESMO caminho de sempre (`applyPaymentEvidence`, fonte `reconciliation`): um reembolso feito depois do backup
 * revoga o acesso e leva o pedido a `refunded`; um pagamento confirmado depois concede o acesso. Leitura primeiro,
 * fora de transação; o estado terminal já gravado não regride (a máquina de estados cuida). 429 ou falha do Asaas
 * INTERROMPE o lote e informa quantos faltam: repita depois. **Pedidos criados DEPOIS do backup não existem no banco e
 * este passo não os enxerga**: a Staff os confere à mão no painel do Asaas (o leitor não lista por data).
 */
export async function resyncPaymentsFromProvider(
  db: Database,
  deps: { reader: PaymentReader; now?: () => Date },
): Promise<ResyncSummary> {
  const rows = await db
    .select({ providerPaymentId: payment.providerPaymentId })
    .from(payment)
    .innerJoin(purchaseOrder, sql`${purchaseOrder.id} = ${payment.orderId}`)
    .where(
      inArray(purchaseOrder.status, ['pending', 'paid', 'refund_requested', 'disputed', 'review']),
    )
    .orderBy(payment.createdAt);
  const summary: ResyncSummary = {
    checked: 0,
    outcomes: {},
    notFound: 0,
    remaining: 0,
    stopped: null,
  };
  for (const [index, row] of rows.entries()) {
    try {
      const result = await applyPaymentEvidence(
        db,
        { reader: deps.reader, ...(deps.now ? { now: deps.now } : {}) },
        { paymentId: row.providerPaymentId, eventHint: null, source: 'reconciliation' },
      );
      summary.checked += 1;
      if (result.outcome === 'not_found') summary.notFound += 1;
      else summary.outcomes[result.outcome] = (summary.outcomes[result.outcome] ?? 0) + 1;
    } catch (error) {
      if (
        error instanceof PaymentReadTransientError ||
        error instanceof PaymentReadPermanentError
      ) {
        summary.stopped = error instanceof PaymentReadTransientError ? 'transient' : 'permanent';
        summary.remaining = rows.length - index;
        return summary;
      }
      throw error;
    }
  }
  return summary;
}

export interface SupersedeSummary {
  /** E-mails retirados da fila, por modelo (para a Staff decidir o que reenviar à mão). */
  byTemplate: Record<string, number>;
  total: number;
}

/**
 * Passo 3: retira da fila os e-mails que estavam PENDENTES no backup. Eles podem ter saído depois do backup, e reabrir a
 * fila os enviaria DE NOVO (a pessoa receberia duas vezes, ou um link de acesso vencido). Cada um vira `superseded` na
 * fila e o e-mail correspondente `failed` com o código `restore_superseded`. O que for importante de verdade (certificado
 * pronto, acesso liberado) a Staff reenvia depois, olhando a lista por modelo.
 */
export async function supersedePendingEmails(
  db: Database,
  input: { actorId: string },
): Promise<SupersedeSummary> {
  return db.transaction(async (tx) => {
    const rows = (
      (await tx.execute(sql`
        update outbox_message o
           set state = 'superseded', finished_at = now(), updated_at = now(),
               lease_owner = null, lease_until = null, lease_version = o.lease_version + 1
         where o.kind = 'email.send' and o.state in ('pending', 'leased')
        returning o.payload->>'emailMessageId' as email_id`)) as unknown as {
        rows: { email_id: string | null }[];
      }
    ).rows;
    const ids = rows.map((row) => row.email_id).filter((id): id is string => id !== null);
    const byTemplate: Record<string, number> = {};
    if (ids.length > 0) {
      const updated = (
        (await tx.execute(sql`
          update email_message
             set state = 'failed', last_error_code = 'restore_superseded', updated_at = now()
           where id in (${sql.join(
             ids.map((id) => sql`${id}::uuid`),
             sql`, `,
           )}) and state in ('queued', 'sending')
          returning template`)) as unknown as { rows: { template: string }[] }
      ).rows;
      for (const row of updated) byTemplate[row.template] = (byTemplate[row.template] ?? 0) + 1;
    }
    await auditEvent(tx, {
      actorId: input.actorId,
      action: 'ops.restore_supersede_emails',
      targetType: 'queue',
      targetId: 'general',
      details: { total: rows.length, byTemplate },
    });
    return { byTemplate, total: rows.length };
  });
}

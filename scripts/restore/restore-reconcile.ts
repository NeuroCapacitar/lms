/**
 * Reconciliação depois de RESTAURAR um backup (M9-05). Passos do runbook `docs/operations/backup-and-restore.md`, nesta
 * ordem. Sem `--execute` só mostra o que faria (`status` é sempre só leitura).
 *
 *   DATABASE_URL_MIGRATION=… bun scripts/restore/restore-reconcile.ts <ambiente> status
 *   … quarantine --execute --reason "restauração de 2026-10-18"
 *   … resync-payments --execute            (precisa de ASAAS_API_KEY e ASAAS_API_BASE_URL)
 *   … supersede-emails --execute
 *   … reapply-revocations --log-dir <pasta com o revocation-log baixado do R2> --execute
 *   (reaplicar as exclusões: bun run privacy:request <ambiente> reapply --log-dir <pasta> --execute)
 *   … release --execute --reason "reconciliação concluída"
 *
 * Nunca restaure em Production sem revisão. Nada aqui imprime dado pessoal: só contagens, ids de pagamento do provedor
 * (não identificam a pessoa) e nomes de modelos de e-mail.
 */
import { sql } from 'drizzle-orm';

import { openDatabase } from '../../src/db/client.ts';
import { createAsaasPaymentReader } from '../../src/server/commerce/payment-reader.ts';
import {
  quarantineQueues,
  releaseQuarantine,
  resyncPaymentsFromProvider,
  supersedePendingEmails,
} from '../../src/server/ops/restore-reconcile.ts';
import { replayRevocations } from '../../src/server/ops/revocation-replay.ts';
import { parseTarget } from '../db/guards.ts';
import { readRevocationLogs } from './restore-core.ts';

const COMMANDS = [
  'status',
  'quarantine',
  'resync-payments',
  'supersede-emails',
  'reapply-revocations',
  'release',
] as const;

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const [environment, command] = process.argv.slice(2);
  if (!environment || !command || !(COMMANDS as readonly string[]).includes(command))
    throw new Error(
      `uso: <dev|staging|production> <${COMMANDS.join('|')}> [--execute] [--reason texto]`,
    );
  const target = parseTarget(environment, process.env.DATABASE_URL_MIGRATION);
  const execute = process.argv.includes('--execute');
  const actorId = option('--operator') ?? 'restore-script';
  const reason = option('--reason');
  if ((command === 'quarantine' || command === 'release') && execute && !reason)
    throw new Error('informe --reason (vai para a auditoria)');

  console.log(
    `${execute ? 'EXECUTANDO' : 'ENSAIO (nada será gravado; use --execute)'}: ${command} em "${target.environment}"`,
  );
  const opened = await openDatabase(target.url.toString());
  try {
    const { db } = opened;
    const rows = async (query: ReturnType<typeof sql>) =>
      ((await db.execute(query)) as unknown as { rows: Record<string, unknown>[] }).rows;

    if (command === 'status') {
      console.log(
        'filas pausadas:',
        JSON.stringify(
          await rows(
            sql`select key, enabled from system_flag where key like 'queue.%' order by key`,
          ),
        ),
      );
      console.log(
        'e-mails pendentes na fila:',
        JSON.stringify(
          await rows(
            sql`select state, count(*)::int as n from outbox_message where kind = 'email.send' and state in ('pending', 'leased') group by state`,
          ),
        ),
      );
      console.log(
        'pedidos por estado:',
        JSON.stringify(
          await rows(
            sql`select status, count(*)::int as n from purchase_order group by status order by status`,
          ),
        ),
      );
      return;
    }
    if (command === 'quarantine' || command === 'release') {
      if (!execute)
        return console.log(
          `${command === 'quarantine' ? 'Pausaria' : 'Retomaria'} as duas filas (finance e general).`,
        );
      const input = { actorId, reason: reason! };
      await (command === 'quarantine' ? quarantineQueues(db, input) : releaseQuarantine(db, input));
      console.log(command === 'quarantine' ? 'Filas pausadas.' : 'Filas retomadas.');
      return;
    }
    if (command === 'reapply-revocations') {
      const dir = option('--log-dir');
      if (!dir)
        throw new Error(
          'reapply-revocations exige --log-dir (a pasta com o revocation-log baixado do R2)',
        );
      console.log(
        JSON.stringify(await replayRevocations(db, readRevocationLogs(dir), { execute })),
      );
      return;
    }
    if (command === 'supersede-emails') {
      const pending = await rows(
        sql`select count(*)::int as n from outbox_message where kind = 'email.send' and state in ('pending', 'leased')`,
      );
      console.log(`e-mails pendentes que seriam retirados: ${String(pending[0]?.n)}`);
      if (!execute) return;
      console.log(JSON.stringify(await supersedePendingEmails(db, { actorId })));
      return;
    }
    // resync-payments
    const open = await rows(
      sql`select count(*)::int as n from payment p join purchase_order o on o.id = p.order_id where o.status in ('pending','paid','refund_requested','disputed','review')`,
    );
    console.log(`pagamentos a reler no Asaas: ${String(open[0]?.n)}`);
    if (!execute) return;
    const apiKey = process.env.ASAAS_API_KEY;
    const baseUrl = process.env.ASAAS_API_BASE_URL;
    if (!apiKey || !baseUrl)
      throw new Error('resync-payments exige ASAAS_API_KEY e ASAAS_API_BASE_URL no ambiente');
    const summary = await resyncPaymentsFromProvider(db, {
      reader: createAsaasPaymentReader({ apiKey, baseUrl }),
    });
    console.log(JSON.stringify(summary));
    if (summary.stopped) {
      console.error(
        `PARADO (${summary.stopped}): faltam ${summary.remaining}. Repita o comando depois; não libere as filas antes.`,
      );
      process.exitCode = 2;
    }
  } finally {
    await opened.close();
  }
}

main().catch((error: unknown) => {
  console.error(`ERRO: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

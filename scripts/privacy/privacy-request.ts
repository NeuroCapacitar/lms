/**
 * Pedidos de privacidade da Staff (M9-10): exportar, excluir, trocar o e-mail e reaplicar exclusões depois de uma
 * restauração. **Não existe botão para isso no produto**: o pedido chega por e-mail e a Staff executa este script, com
 * `--dry-run` por padrão (sem `--execute` nada é gravado) e um registro de cada execução. Nunca SQL avulso em Production.
 *
 *   DATABASE_URL_MIGRATION=… bun scripts/privacy/privacy-request.ts staging erase --email pessoa@exemplo --request-ref CH-123
 *   … erase --email … --request-ref CH-123 --log-dir ~/.hub-privacy-log --execute
 *   … export --user <id> --out ~/pedidos/CH-123.json
 *   … change-email --user <id> --new-email novo@exemplo --confirmed-old --confirmed-new --execute
 *   … reapply --log-dir ~/.hub-privacy-log --execute          (depois de restaurar um backup)
 *
 * Nada aqui imprime nome, e-mail ou conteúdo de pessoa: só o identificador interno, contagens e o resultado.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';

import { openDatabase } from '../../src/db/client.ts';
import {
  ERASURE_POLICY_APPROVED,
  ERASURE_POLICY_VERSION,
  erasureLogFileName,
  pendingItems,
} from '../../src/features/privacy/erasure-policy.ts';
import { changeUserEmail } from '../../src/server/privacy/email-change-store.ts';
import { eraseUser, reapplyErasures } from '../../src/server/privacy/erasure-store.ts';
import { exportPersonData } from '../../src/server/privacy/export-store.ts';
import { parseTarget } from '../db/guards.ts';
import {
  assertCanExecute,
  assertOutsideRepo,
  parseArgs,
  personSelector,
  requestRef,
  readLogs,
  writeLog,
  type ParsedArgs,
} from './privacy-core.ts';

/** Envia o registro ao bucket de backup (prefixo `erasure-log/`, sem regra de expiração). Exige as mesmas variáveis do backup. */
function uploadLog(file: string, name: string): void {
  const endpoint = process.env.BACKUP_S3_ENDPOINT;
  const bucket = process.env.BACKUP_S3_BUCKET;
  if (!endpoint || !bucket) throw new Error('--log-s3 exige BACKUP_S3_ENDPOINT e BACKUP_S3_BUCKET');
  execFileSync(
    'aws',
    [
      's3',
      'cp',
      file,
      `s3://${bucket}/erasure-log/${name}`,
      '--endpoint-url',
      endpoint,
      '--only-show-errors',
    ],
    {
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );
}

async function main(): Promise<void> {
  const args: ParsedArgs = parseArgs(process.argv.slice(2));
  const target = parseTarget(args.environment, process.env.DATABASE_URL_MIGRATION);
  assertCanExecute(args);
  const execute = args.flags.has('--execute');
  const operatorId = args.values.get('--operator') ?? null;
  const ref = requestRef(args);
  console.log(
    `${execute ? 'EXECUTANDO' : 'ENSAIO (nada será gravado; use --execute)'}: ${args.command} em "${target.environment}" (política ${ERASURE_POLICY_VERSION}, ${ERASURE_POLICY_APPROVED ? 'aprovada' : `NÃO aprovada: ${pendingItems().length} itens pendentes do advogado ou do contador`})`,
  );

  const opened = await openDatabase(target.url.toString());
  try {
    const { db } = opened;

    if (args.command === 'reapply') {
      const dir = args.values.get('--log-dir');
      if (!dir) throw new Error('reapply exige --log-dir (a pasta com os registros de eliminação)');
      const summary = await reapplyErasures(db, readLogs(dir), { execute, operatorId });
      console.log(JSON.stringify(summary));
      return;
    }

    const selector = personSelector(args);
    let userId = selector.value;
    if (selector.by === 'email') {
      const result = (await db.execute(
        sql`select id from "user" where lower(email) = ${selector.value}`,
      )) as unknown as { rows: { id: string }[] };
      if (result.rows.length !== 1)
        throw new Error('nenhuma pessoa com este e-mail (ou mais de uma)');
      userId = result.rows[0]!.id;
    }
    console.log(`pessoa: ${userId}`);

    if (args.command === 'export') {
      const out = assertOutsideRepo(args.values.get('--out') ?? '');
      const data = await exportPersonData(db, userId);
      if (data === 'not_found' || data === 'already_erased')
        throw new Error(`não exportado: ${data}`);
      const counts = Object.fromEntries(
        Object.entries(data.sections).map(([name, rows]) => [name, rows.length]),
      );
      console.log(`seções: ${JSON.stringify(counts)}`);
      if (!execute) {
        console.log('Ensaio: o arquivo NÃO foi gravado. Rode de novo com --execute.');
        return;
      }
      writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      chmodSync(out, 0o600);
      console.log(
        `arquivo gravado (permissão restrita): ${out}. Envie à pessoa por canal seguro e apague depois.`,
      );
      return;
    }

    if (args.command === 'change-email') {
      const next = args.values.get('--new-email');
      if (!next) throw new Error('change-email exige --new-email');
      const result = await changeUserEmail(db, userId, next, {
        execute,
        operatorId,
        requestRef: ref,
      });
      console.log(`resultado: ${result.outcome}`);
      if (!['dry_run', 'changed'].includes(result.outcome)) process.exitCode = 1;
      return;
    }

    // erase
    const result = await eraseUser(db, userId, { execute, operatorId, requestRef: ref });
    console.log(`resultado: ${result.outcome}`);
    if ('counts' in result) console.log(`contagens: ${JSON.stringify(result.counts)}`);
    if (result.outcome === 'erased') {
      const dir = args.values.get('--log-dir')!;
      try {
        const file = writeLog(dir, result.entry);
        console.log(`registro da eliminação (FORA do banco): ${file}`);
        if (args.flags.has('--log-s3')) uploadLog(file, erasureLogFileName(result.entry));
      } catch (error) {
        // A exclusão JÁ foi confirmada: o registro só tem id e contagens, então é seguro mostrá-lo para ser guardado à mão.
        console.error(
          `FALHA ao gravar o registro (${error instanceof Error ? error.message : 'erro'}). Guarde isto à mão:`,
        );
        console.error(JSON.stringify(result.entry));
        process.exitCode = 2;
      }
    } else if (result.outcome !== 'dry_run') process.exitCode = 1;
  } finally {
    await opened.close();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`ERRO: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

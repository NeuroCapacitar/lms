/**
 * Cria o PRIMEIRO Admin, sem senha embutida. Execução MANUAL do responsável, só em Development e
 * Staging neste marco (Production é recusada). Recusa se já existir Admin. A pessoa entra depois
 * por link de acesso; nada aqui envia e-mail.
 *
 *   DATABASE_URL_MIGRATION=... bun scripts/admin-bootstrap.ts <dev|staging> --email <endereço> [--apply]
 *
 * Sem `--apply` é só um ensaio: mostra o alvo e o que faria, e não escreve nada. A conexão é a
 * DIRETA da Neon com a role de migração (mesmas travas de `scripts/db/guards.ts`: host aprovado
 * para o ambiente, sem pooler). A senha do banco nunca é impressa.
 */
import { openDatabase } from '../src/db/client.ts';
import { normalizeEmail } from '../src/features/identity/email.ts';
import {
  AdminAlreadyExistsError,
  adminExists,
  bootstrapAdmin,
} from '../src/server/auth/bootstrap.ts';
import { parseTarget } from './db/guards.ts';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const environment = process.argv[2] ?? '';
  if (environment === 'production') {
    throw new Error(
      'Production recusada: o bootstrap do Admin só roda em dev e staging neste marco (M1-04).',
    );
  }
  const target = parseTarget(environment, process.env.DATABASE_URL_MIGRATION);
  const email = normalizeEmail(option('--email') ?? '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('informe um e-mail válido: --email <endereço>');
  }
  const apply = process.argv.includes('--apply');

  const opened = await openDatabase(target.url.toString());
  try {
    if (await adminExists(opened.db)) {
      throw new AdminAlreadyExistsError();
    }
    console.log(
      `${apply ? 'APLICANDO' : 'ENSAIO (nada será gravado)'} em "${target.environment}" (${target.url.hostname}): conceder o papel admin a ${email}`,
    );
    if (!apply) {
      console.log('Rode de novo com --apply para executar.');
      return;
    }
    const result = await bootstrapAdmin(opened.db, email);
    console.log(
      `Admin criado${result.createdUser ? ' (a pessoa ainda não existia e foi criada)' : ''}. Ela entra pelo link de acesso em /entrar.`,
    );
  } finally {
    await opened.close();
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof AdminAlreadyExistsError
      ? 'recusado: já existe um Admin neste banco (o bootstrap serve só para o primeiro).'
      : error instanceof Error
        ? error.message
        : String(error);
  console.error(`ERRO: ${message}`);
  process.exit(1);
});

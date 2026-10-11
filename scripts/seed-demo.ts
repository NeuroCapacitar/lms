/**
 * Cria o "Curso Demonstrativo" (M2-07), SINTÉTICO, em Development ou Staging. Execução MANUAL e
 * repetível: rodar de novo não duplica nada. Production é recusada.
 *
 *   DATABASE_URL_MIGRATION=... bun scripts/seed-demo.ts <dev|staging> [--apply]
 *
 * Sem `--apply` é só um ensaio (não escreve). Usa a conexão DIRETA da Neon com a role de migração
 * (mesmas travas de `scripts/db/guards.ts`); a senha nunca é impressa. Nada aqui envia e-mail.
 */
import { openDatabase } from '../src/db/client.ts';
import { seedDemoCourse } from '../src/server/catalog/demo-seed.ts';
import { resolveSeedTarget } from './seed-demo-core.ts';

async function main() {
  const target = resolveSeedTarget(process.argv[2] ?? '', process.env.DATABASE_URL_MIGRATION);
  const apply = process.argv.includes('--apply');
  console.log(
    `${apply ? 'APLICANDO' : 'ENSAIO (nada será gravado)'} em "${target.environment}" (${target.url.hostname}): curso demonstrativo`,
  );
  if (!apply) {
    console.log('Rode de novo com --apply para executar.');
    return;
  }
  const opened = await openDatabase(target.url.toString());
  try {
    const result = await seedDemoCourse(opened.db);
    const did = Object.entries(result.created)
      .filter(([, value]) => value)
      .map(([key]) => key);
    console.log(
      did.length > 0
        ? `Feito: ${did.join(', ')}. Curso ${result.courseId}.`
        : `Nada a fazer: o curso demonstrativo já está completo (${result.courseId}).`,
    );
  } finally {
    await opened.close();
  }
}

main().catch((error: unknown) => {
  console.error(`ERRO: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

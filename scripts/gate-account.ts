/**
 * Prepara uma CONTA DE TESTE do gate M8-04 (iPhone) no Staging. Execução MANUAL e repetível; Production é recusada.
 *
 *   DATABASE_URL_MIGRATION=... bun scripts/gate-account.ts staging <e-mail> <a|b> [--apply]
 *
 * - O e-mail PRECISA ter o sufixo `+gate` (ex.: `caixa+gate-a@dominio`): só endereços de teste, nunca de aluno real.
 * - Papel `a`: matrícula com a âncora do drip 20 dias atrás (todos os módulos abertos), as 5 aulas OBRIGATÓRIAS já concluídas (o curso
 *   conclui e o certificado nasce pelo caminho normal, com o template sintético do Staging) e a aula OPCIONAL deixada em aberto,
 *   para o roteiro concluí-la sem rede.
 * - Papel `b`: só a matrícula (âncora de agora), para o passo "outra conta".
 * Sem `--apply` é só um ensaio. Usa a conexão DIRETA da Neon com a role de migração (mesmas travas de `scripts/db/guards.ts`); nada é
 * impresso além de contagens. Nada aqui envia e-mail: a pessoa entra depois, pelo link de acesso, no Staging.
 */
import { and, asc, eq, isNull } from 'drizzle-orm';

import { openDatabase } from '../src/db/client.ts';
import { courseModule, lesson, user } from '../src/db/schema.ts';
import { grantEntitlement } from '../src/server/access/entitlement-store.ts';
import { seedDemoCourse } from '../src/server/catalog/demo-seed.ts';
import { completeLesson } from '../src/server/learning/completion.ts';
import { isGateEmail } from './gate-account-core.ts';
import { resolveSeedTarget } from './seed-demo-core.ts';

const DAY = 86_400_000;

async function main() {
  const target = resolveSeedTarget(process.argv[2] ?? '', process.env.DATABASE_URL_MIGRATION);
  const email = (process.argv[3] ?? '').trim().toLowerCase();
  const role = process.argv[4];
  const apply = process.argv.includes('--apply');
  if (!isGateEmail(email)) {
    throw new Error(
      'recusado: o e-mail precisa ter o sufixo +gate (conta de TESTE, nunca de aluno real).',
    );
  }
  if (role !== 'a' && role !== 'b')
    throw new Error('o papel é "a" (com certificado) ou "b" (só matrícula).');
  console.log(
    `${apply ? 'APLICANDO' : 'ENSAIO (nada será gravado)'} em "${target.environment}" (${target.url.hostname}): conta de teste do gate, papel ${role}`,
  );
  if (!apply) {
    console.log('Rode de novo com --apply para executar.');
    return;
  }

  const opened = await openDatabase(target.url.toString());
  try {
    const { db } = opened;
    const seeded = await seedDemoCourse(db);
    const now = new Date();

    let [person] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
    if (!person) {
      [person] = await db
        .insert(user)
        .values({
          id: crypto.randomUUID().replaceAll('-', ''),
          name: 'Conta de teste do gate',
          email,
          emailVerified: true,
        })
        .returning({ id: user.id });
    }
    const userId = person!.id;

    const startsAt = role === 'a' ? new Date(now.getTime() - 20 * DAY) : now;
    await grantEntitlement(db, {
      userId,
      courseId: seeded.courseId,
      offerId: seeded.offerId,
      source: 'free_offer',
      sourceRef: `free:${userId}:${seeded.offerId}:0`,
      accessMonths: 3,
      startsAt,
      grantedBy: userId,
    });
    console.log(`Matrícula pronta (âncora do drip ${role === 'a' ? '20 dias atrás' : 'agora'}).`);

    if (role === 'a') {
      const required = await db
        .select({ id: lesson.id })
        .from(lesson)
        .innerJoin(courseModule, eq(courseModule.id, lesson.moduleId))
        .where(
          and(
            eq(lesson.courseId, seeded.courseId),
            eq(lesson.isOptional, false),
            eq(lesson.kind, 'text'),
            isNull(lesson.retiredAt),
          ),
        )
        .orderBy(asc(courseModule.position), asc(lesson.position));
      let created = 0;
      for (const item of required) {
        const result = await completeLesson(db, { userId, lessonId: item.id });
        if (result.status === 'completed') created += 1;
      }
      console.log(
        `Aulas obrigatórias: ${required.length} (concluídas agora: ${created}). A aula opcional ficou em aberto. O certificado nasce na conclusão do curso e o PDF sai no próximo ciclo do Cron (até ~30 min).`,
      );
    }
    console.log(
      'Pronto. A pessoa entra depois pelo link de acesso e aceita os termos na primeira vez.',
    );
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

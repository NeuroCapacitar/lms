import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { legalDocumentVersion, termsAcceptance } from '../../db/schema';
import type { LegalDocumentDto, LegalKind } from '../../features/identity/legal';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** As versões VIGENTES: de cada tipo, a de maior `effective_from` já alcançada. */
async function currentIn(db: Database | Tx): Promise<LegalDocumentDto[]> {
  const rows = await db
    .selectDistinctOn([legalDocumentVersion.kind], {
      id: legalDocumentVersion.id,
      kind: legalDocumentVersion.kind,
      version: legalDocumentVersion.version,
      body: legalDocumentVersion.body,
      effectiveFrom: legalDocumentVersion.effectiveFrom,
    })
    .from(legalDocumentVersion)
    .where(lte(legalDocumentVersion.effectiveFrom, sql`now()`))
    .orderBy(legalDocumentVersion.kind, desc(legalDocumentVersion.effectiveFrom));
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as LegalKind,
    version: row.version,
    body: row.body,
    effectiveFrom: row.effectiveFrom.toISOString(),
  }));
}

export const currentVersions = (db: Database) => currentIn(db);

/** Quais das versões vigentes esta pessoa ainda NÃO aceitou? Sem versão vigente, nada a aceitar. */
export async function pendingVersions(db: Database, userId: string): Promise<LegalDocumentDto[]> {
  const current = await currentIn(db);
  if (current.length === 0) return [];
  const accepted = await db
    .select({ id: termsAcceptance.documentVersionId })
    .from(termsAcceptance)
    .where(
      and(
        eq(termsAcceptance.userId, userId),
        inArray(
          termsAcceptance.documentVersionId,
          current.map((doc) => doc.id),
        ),
      ),
    );
  const done = new Set(accepted.map((row) => row.id));
  return current.filter((doc) => !done.has(doc.id));
}

export async function hasAcceptedCurrent(db: Database, userId: string): Promise<boolean> {
  return (await pendingVersions(db, userId)).length === 0;
}

export type AcceptResult = 'accepted' | 'changed';

/**
 * Registra o aceite das versões vigentes. Exige que os IDs enviados sejam EXATAMENTE as versões
 * vigentes agora (senão `changed`: saiu uma versão nova e a pessoa precisa ler de novo). Repetir é
 * idempotente: o que já foi aceito não muda e não duplica.
 */
export async function acceptCurrent(
  db: Database,
  input: { userId: string; documentVersionIds: readonly string[] },
): Promise<AcceptResult> {
  return db.transaction(async (tx) => {
    const current = await currentIn(tx);
    const sent = new Set(input.documentVersionIds);
    if (
      current.length === 0 ||
      sent.size !== current.length ||
      !current.every((doc) => sent.has(doc.id))
    ) {
      return 'changed';
    }
    await tx
      .insert(termsAcceptance)
      .values(
        current.map((doc) => ({
          userId: input.userId,
          documentVersionId: doc.id,
          adultDeclared: true,
        })),
      )
      .onConflictDoNothing();
    return 'accepted';
  });
}

/**
 * Publica uma nova versão (uma nova linha). A versão anterior deixa de ser a vigente quando a nova
 * alcança `effectiveFrom`, e todos voltam a ser bloqueados até aceitar. Sem rota ainda: a tela da
 * Staff para publicar é de marco futuro; hoje é o mecanismo (e o caminho de migration).
 */
export async function publishLegalVersion(
  db: Database,
  input: { kind: LegalKind; version: string; body: string; effectiveFrom: Date },
): Promise<string> {
  const [created] = await db
    .insert(legalDocumentVersion)
    .values(input)
    .returning({ id: legalDocumentVersion.id });
  return created!.id;
}

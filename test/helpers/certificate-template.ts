import type { Database } from '../../src/db/client.ts';
import { defaultLayout } from '../../src/features/certificate/layout.ts';
import { setCertificatePolicy } from '../../src/server/certificate/certificate-store.ts';
import { publishTemplate, saveTemplateDraft } from '../../src/server/certificate/template-store.ts';

/** Publica o modelo padrão como template do curso (a emissão do M7-03 exige template publicado). */
export async function publishDefaultTemplate(
  db: Database,
  input: { actorId: string; courseId: string; backgroundMediaId?: string | null },
) {
  const draft = await saveTemplateDraft(db, {
    actorId: input.actorId,
    courseId: input.courseId,
    layout: defaultLayout(),
    backgroundMediaId: input.backgroundMediaId ?? null,
    expectedVersion: null,
  });
  return publishTemplate(db, {
    actorId: input.actorId,
    courseId: input.courseId,
    expectedVersion: draft.version,
  });
}

/** Liga a política do curso E publica o template padrão: o curso passa a emitir certificado. */
export async function enableCertificates(
  db: Database,
  input: { actorId: string; courseId: string },
) {
  await setCertificatePolicy(db, { ...input, enabled: true });
  await publishDefaultTemplate(db, input);
}

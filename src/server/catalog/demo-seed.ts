import { eq } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { course, offer } from '../../db/schema';
import {
  DEMO_DRAFT,
  DEMO_OFFER,
  DEMO_SEQUENCE_MODE,
  DEMO_SLUG,
  DEMO_TITLE,
} from '../../features/catalog/demo-course';
import { createCourse, createOffer, setCourseStatus, setOfferStatus } from './catalog-store';
import { getDraft, publishCurriculum, saveDraft } from './curriculum-store';

export interface DemoSeedResult {
  courseId: string;
  offerId: string;
  /** O que ESTA execução fez; tudo `false` quando o curso já estava completo. */
  created: { course: boolean; offer: boolean; published: boolean };
}

/**
 * Cria o curso demonstrativo (M2-07) pelas MESMAS funções de domínio do Course Builder, de forma
 * repetível: cada passo confere o estado antes de agir, então rodar de novo não duplica nada. O
 * rascunho só é preenchido se ainda nunca foi salvo, e o currículo só é publicado se ainda não houve
 * publicação: edições feitas depois por uma pessoa nunca são sobrescritas. Sem autor (`actorId`
 * nulo): é uma ação do sistema, auditada como tal. Não decide AMBIENTE: quem chama (o script) recusa
 * Production antes de abrir o banco.
 */
export async function seedDemoCourse(db: Database): Promise<DemoSeedResult> {
  const actorId = null;
  const created = { course: false, offer: false, published: false };

  let [courseRow] = await db.select().from(course).where(eq(course.slug, DEMO_SLUG));
  if (!courseRow) {
    const id = await createCourse(db, {
      actorId,
      slug: DEMO_SLUG,
      title: DEMO_TITLE,
      sequenceMode: DEMO_SEQUENCE_MODE,
    });
    [courseRow] = await db.select().from(course).where(eq(course.id, id));
    created.course = true;
  }
  const courseId = courseRow!.id;

  const draft = await getDraft(db, courseId);
  if (draft && draft.publishedVersion === 0) {
    if (draft.rev === 0) {
      await saveDraft(db, { courseId, expectedRev: 0, ...DEMO_DRAFT });
    }
    const published = await publishCurriculum(db, { actorId, courseId });
    created.published = published.status === 'published';
  }

  if (courseRow!.status === 'draft') {
    await setCourseStatus(db, { actorId, id: courseId, status: 'published' });
  }

  const offers = await db.select().from(offer).where(eq(offer.courseId, courseId));
  let offerRow = offers.find((item) => item.name === DEMO_OFFER.name);
  let offerId = offerRow?.id;
  if (!offerId) {
    offerId = await createOffer(db, { actorId, courseId, ...DEMO_OFFER });
    created.offer = true;
    offerRow = undefined;
  }
  if (!offerRow || offerRow.status === 'draft') {
    await setOfferStatus(db, { actorId, courseId, offerId, status: 'active' });
  }

  return { courseId, offerId, created };
}

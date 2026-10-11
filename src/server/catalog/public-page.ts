import { and, eq } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { course } from '../../db/schema';
import { slugSchema } from '../../features/catalog/catalog';
import { toPublicCoursePage, type PublicCoursePageDto } from '../../features/catalog/public-course';
import { getPublicCourse } from './catalog-store';
import { getPublishedCurriculum } from './curriculum-store';

/**
 * O curso como a página pública o mostra, ou `null`. `null` cobre, SEM distinção, slug malformado,
 * inexistente, em rascunho, arquivado ou sem currículo publicado: quem pergunta não consegue saber
 * qual dos casos é (nenhum vazamento de curso ainda não publicado).
 */
export async function loadPublicCoursePage(
  db: Database,
  slug: string,
): Promise<PublicCoursePageDto | null> {
  if (!slugSchema.safeParse(slug).success) return null;
  const visible = await getPublicCourse(db, slug);
  if (!visible) return null;
  const [row] = await db
    .select({ id: course.id })
    .from(course)
    .where(and(eq(course.slug, slug), eq(course.status, 'published')));
  if (!row) return null;
  const curriculum = await getPublishedCurriculum(db, row.id);
  return toPublicCoursePage(
    visible,
    (curriculum?.modules ?? []).map((module) => module.title),
  );
}

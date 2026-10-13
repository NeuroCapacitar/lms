import { and, eq } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { course, mediaAsset } from '../../db/schema';
import { slugSchema } from '../../features/catalog/catalog';
import { toPublicCoursePage, type PublicCoursePageDto } from '../../features/catalog/public-course';
import {
  toPublicImage,
  type ImageVariantName,
  type PublicImageDto,
} from '../../features/media/delivery';
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
  mediaBaseUrl?: string,
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
  const image = async (
    mediaId: string | null | undefined,
    variant: ImageVariantName,
  ): Promise<PublicImageDto | null> => {
    if (!mediaId || !mediaBaseUrl) return null;
    const [asset] = await db.select().from(mediaAsset).where(eq(mediaAsset.id, mediaId));
    // Só mídia PRONTA e já copiada para o bucket público sai na página.
    if (!asset || asset.state !== 'ready' || !asset.publicKey || !asset.width || !asset.height) {
      return null;
    }
    return toPublicImage({
      baseUrl: mediaBaseUrl,
      publicKey: asset.publicKey,
      variant,
      width: asset.width,
      height: asset.height,
    });
  };
  return toPublicCoursePage(
    visible,
    (curriculum?.modules ?? []).map((module) => module.title),
    {
      cover: await image(curriculum?.details.coverMediaId, 'cover_hero'),
      banner: await image(curriculum?.details.bannerMediaId, 'banner_wide'),
    },
  );
}

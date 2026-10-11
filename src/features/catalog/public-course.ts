import type { RichText } from '../content/rich-text';
import type { PublicCourseDto, SequenceMode } from './catalog';
import { toCatalogCourse, type CatalogOfferSummary } from './student-catalog';

/**
 * Página pública do curso (M2-06): o que QUALQUER pessoa vê em `/cursos/:slug`, sem login. Só o
 * publicado: título, descrição (texto rico do M2-05), ementa só com os TÍTULOS dos módulos (nada de
 * aulas nem conteúdo) e o resumo da oferta aberta. Sem título interno, autoria, estado nem id.
 */
export interface PublicCoursePageDto {
  slug: string;
  title: string;
  description: RichText | null;
  workloadHours: number | null;
  sequenceMode: SequenceMode;
  availability: 'open' | 'closed';
  offer: CatalogOfferSummary | null;
  syllabus: string[];
}

/** `null` se o curso não tem currículo publicado (então não há página para mostrar). */
export function toPublicCoursePage(
  course: PublicCourseDto,
  moduleTitles: string[],
): PublicCoursePageDto | null {
  const catalog = toCatalogCourse(course);
  if (!catalog || !course.content) return null;
  return {
    slug: catalog.slug,
    title: catalog.title,
    description: course.content.description,
    workloadHours: catalog.workloadHours,
    sequenceMode: catalog.sequenceMode,
    availability: catalog.availability,
    offer: catalog.offer,
    syllabus: moduleTitles,
  };
}

import type { PublicCoursePageDto } from '../../features/catalog/public-course';
import type { CatalogCourseDto } from '../../features/catalog/student-catalog';
import { getJson } from './staff';

/** Cliente do catálogo do aluno (M2-04): `GET /api/catalog/courses`. 401 e 403 viram os erros de `getJson`. */
export const fetchCatalog = async () =>
  (await getJson<{ courses: CatalogCourseDto[] }>('/api/catalog/courses')).courses;

/**
 * Página pública do curso (M2-06): `GET /api/public/courses/:slug`, sem sessão. 404 (curso
 * inexistente, rascunho, arquivado ou sem currículo publicado, sem distinção) vira `null`.
 */
export async function fetchPublicCourse(slug: string): Promise<PublicCoursePageDto | null> {
  const response = await fetch(`/api/public/courses/${encodeURIComponent(slug)}`, {
    credentials: 'same-origin',
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as PublicCoursePageDto;
}

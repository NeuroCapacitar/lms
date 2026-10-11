import type { CatalogCourseDto } from '../../features/catalog/student-catalog';
import { getJson } from './staff';

/** Cliente do catálogo do aluno (M2-04): `GET /api/catalog/courses`. 401 e 403 viram os erros de `getJson`. */
export const fetchCatalog = async () =>
  (await getJson<{ courses: CatalogCourseDto[] }>('/api/catalog/courses')).courses;

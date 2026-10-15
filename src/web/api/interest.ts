import type { InterestStatsDto, MyInterestDto } from '../../features/interest/interest';
import { postAction } from './action';
import { getJson } from './http';

/** Cliente do interesse em cursos ainda não abertos (M5-06). Quem decide é o servidor; a tela só envia e mostra. */
export const fetchMyInterests = async () =>
  (await getJson<{ interests: MyInterestDto[] }>('/api/me/course-interests')).interests;

export const registerCourseInterest = (courseId: string) =>
  postAction('/api/me/course-interests', { courseId });

export const withdrawCourseInterest = (courseId: string) =>
  postAction(`/api/me/course-interests/${courseId}/withdraw`, {});

/** Contagens de interessados por curso e ciclo, para a Staff (nunca a lista de pessoas). */
export const fetchInterestStats = (courseId: string) =>
  getJson<InterestStatsDto>(`/api/staff/courses/${courseId}/interests`);

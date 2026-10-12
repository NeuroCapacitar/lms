import type { AccessDto } from '../../features/access/access';
import { postAction } from './action';
import { getJson } from './staff';

/**
 * Cliente do acesso a um curso (M3-02). A tela só pergunta e pede; o servidor decide (oferta aberta,
 * termos, suspensão, idempotência). `fetchCourseAccess` lança `UnauthenticatedError` sem sessão.
 */
export const fetchCourseAccess = (courseId: string) =>
  getJson<AccessDto>(`/api/courses/${courseId}/access`);

export const enrollInCourse = (courseId: string, offerId: string) =>
  postAction<{ status: 'enrolled' | 'already_enrolled'; access: AccessDto }>(
    `/api/courses/${courseId}/enroll`,
    { offerId },
  );

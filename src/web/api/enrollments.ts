import type { EnrolleePageDto } from '../../features/access/manual-enrollment';
import { postAction } from './action';
import { getJson } from './staff';

/**
 * Cliente da matrícula manual e da lista de inscritos (M3-06). A tela só pede e mostra: cada rota
 * confere a capability no servidor (`access.grant`, `enrollment.support_edit`, `staff.read`).
 */
export const fetchEnrollees = (courseId: string, page: number, pageSize = 25) =>
  getJson<EnrolleePageDto>(
    `/api/staff/courses/${courseId}/enrollments?page=${page}&pageSize=${pageSize}`,
  );

export const grantEnrollment = (body: {
  email: string;
  courseId: string;
  months: number;
  reason: string;
  requestId: string;
}) =>
  postAction<{ status: 'enrolled' | 'already_enrolled'; userId: string; expiresAt: string | null }>(
    '/api/staff/enrollments',
    body,
  );

export const suspendEnrollment = (courseId: string, userId: string, reason: string) =>
  postAction(`/api/staff/courses/${courseId}/enrollments/${userId}/suspend`, { reason });

export const reinstateEnrollment = (courseId: string, userId: string) =>
  postAction(`/api/staff/courses/${courseId}/enrollments/${userId}/reinstate`, {});

export const adjustGrant = (
  entitlementId: string,
  body: { months: number; reason: string; requestId: string },
) =>
  postAction<{ status: 'adjusted' | 'unchanged'; entitlementId: string; expiresAt: string }>(
    `/api/staff/entitlements/${entitlementId}/adjust`,
    body,
  );

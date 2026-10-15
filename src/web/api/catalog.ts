import type { StaffCourseDto, OfferStatus, CourseStatus } from '../../features/catalog/catalog';
import type { DraftDto } from '../../features/catalog/curriculum';
import type { SaveDraftBody } from '../../features/catalog/curriculum';
import type { PublishPreview } from '../../features/catalog/curriculum-diff';
import { sendAction } from './action';
import { getJson } from './http';

/**
 * Cliente do Course Builder (M2-03). A interface só pede e mostra: o servidor decide cada ação
 * (capability, regras comerciais, concorrência). As funções de escrita devolvem o resultado bruto
 * (`ActionOutcome`) para a tela mapear erros por campo, conflito de rascunho e problemas de publicação.
 */
export const fetchCourses = async () =>
  (await getJson<{ courses: StaffCourseDto[] }>('/api/staff/courses')).courses;
export const fetchCourse = (id: string) => getJson<StaffCourseDto>(`/api/staff/courses/${id}`);
export const fetchDraft = (id: string) => getJson<DraftDto>(`/api/staff/courses/${id}/draft`);
export const fetchPublishPreview = (id: string) =>
  getJson<PublishPreview>(`/api/staff/courses/${id}/publish-preview`);

export const createCourse = (body: { slug: string; title: string; sequenceMode: string }) =>
  sendAction<{ id: string }>('POST', '/api/staff/courses', body);
export const updateCourseMeta = (id: string, body: { slug?: string; title?: string }) =>
  sendAction('PATCH', `/api/staff/courses/${id}`, body);
export const setCourseStatus = (id: string, status: CourseStatus) =>
  sendAction('POST', `/api/staff/courses/${id}/status`, { status });

export const saveDraft = (id: string, body: SaveDraftBody) =>
  sendAction<DraftDto>('PUT', `/api/staff/courses/${id}/draft`, body);
export const publishCurriculum = (id: string) =>
  sendAction<{ status: 'published' | 'unchanged'; version: number }>(
    'POST',
    `/api/staff/courses/${id}/publish`,
    {},
  );

export interface OfferInput {
  name: string;
  kind: string;
  priceCents: number;
  accessMonths: number;
  maxInstallments: number;
}
export const createOffer = (courseId: string, body: OfferInput) =>
  sendAction<{ id: string }>('POST', `/api/staff/courses/${courseId}/offers`, body);
export const updateOffer = (
  courseId: string,
  offerId: string,
  body: Partial<Omit<OfferInput, 'kind'>>,
) => sendAction('PATCH', `/api/staff/courses/${courseId}/offers/${offerId}`, body);
export const setOfferStatus = (courseId: string, offerId: string, status: OfferStatus) =>
  sendAction('POST', `/api/staff/courses/${courseId}/offers/${offerId}/status`, { status });

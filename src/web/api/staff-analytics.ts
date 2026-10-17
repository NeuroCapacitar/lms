import type { CourseAnalyticsDto, OfferAnalyticsDto } from '../../features/staff/analytics';
import { getJson } from './http';

/** Clientes da análise (M9-02). Só leitura; o servidor decide o que cada pessoa vê. */
export const fetchCourseAnalytics = (courseId: string) =>
  getJson<CourseAnalyticsDto>(`/api/staff/analytics/courses/${encodeURIComponent(courseId)}`);

export const fetchOfferAnalytics = () => getJson<OfferAnalyticsDto>('/api/staff/analytics/offers');

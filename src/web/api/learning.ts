import { postAction } from './action';
import type { CourseOutlineDto, LessonViewDto } from '../../features/access/outline';
import type { LessonLockReason } from '../../features/access/lesson-access';

/**
 * Cliente do estudo (M3-03). As respostas 403 do servidor dizem PORQUE (sem acesso ao curso ou aula
 * bloqueada) e a tela mostra a mensagem certa; nada aqui decide acesso. Erro inesperado lança.
 */
export type DeniedReason = 'no_access' | 'expired' | 'suspended';

export type StudyResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'denied'; reason: DeniedReason }
  | { kind: 'locked'; reason: LessonLockReason; releasesAt: string | null }
  | { kind: 'not_found' }
  | { kind: 'unauthenticated' }
  | { kind: 'terms_required' };

async function readStudy<T>(path: string): Promise<StudyResult<T>> {
  const response = await fetch(path, { credentials: 'same-origin' });
  if (response.ok) return { kind: 'ok', data: (await response.json()) as T };
  if (response.status === 401) return { kind: 'unauthenticated' };
  if (response.status === 404) return { kind: 'not_found' };
  if (response.status === 403) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; reason?: string; releasesAt?: string | null };
    } | null;
    const error = body?.error;
    if (error?.code === 'terms_required') return { kind: 'terms_required' };
    if (error?.code === 'lesson_locked') {
      return {
        kind: 'locked',
        reason: error.reason as LessonLockReason,
        releasesAt: error.releasesAt ?? null,
      };
    }
    if (error?.code === 'access_denied') {
      return { kind: 'denied', reason: error.reason as DeniedReason };
    }
  }
  throw new Error(`HTTP ${response.status}`);
}

export const fetchOutline = (courseId: string) =>
  readStudy<CourseOutlineDto>(`/api/courses/${courseId}/outline`);

export const fetchLesson = (lessonId: string) =>
  readStudy<LessonViewDto>(`/api/lessons/${lessonId}`);

/** Resposta de `POST /api/lessons/:id/complete`. */
export interface CompleteLessonResponse {
  status: 'completed' | 'already_completed';
  progress: { completed: number; total: number; percent: number };
  courseCompleted: boolean;
  /** `true` só na chamada que criou a conclusão do curso (mensagem de parabéns). */
  courseJustCompleted: boolean;
  courseCompletedAt: string | null;
}

export const completeLesson = (lessonId: string) =>
  postAction<CompleteLessonResponse>(`/api/lessons/${lessonId}/complete`, {});

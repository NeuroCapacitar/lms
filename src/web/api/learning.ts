import type { ProgressPayload, SendOutcome } from '../video/progress-reporter';
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
  | { kind: 'terms_required' }
  /** Só a equipe usa esta área (prévia): a pessoa não tem papel de Staff. */
  | { kind: 'forbidden' };

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
    if (error?.code === 'forbidden') return { kind: 'forbidden' };
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

/** Prévia de aluno da Staff (M3-07): as mesmas formas, só leitura, tudo liberado. */
export const fetchPreviewOutline = (courseId: string) =>
  readStudy<CourseOutlineDto>(`/api/staff/preview/courses/${courseId}/outline`);

export const fetchPreviewLesson = (courseId: string, lessonId: string) =>
  readStudy<LessonViewDto>(`/api/staff/preview/courses/${courseId}/lessons/${lessonId}`);

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

/**
 * Envia o progresso de uma aula de vídeo (M5-02). Usa `fetch` com `keepalive` (a requisição sobrevive ao
 * descarregar da página), `content-type` JSON e o cabeçalho de origem que o navegador manda sozinho: o CSRF
 * do projeto os exige (por isso NÃO se usa `sendBeacon`). 401 e 403 viram `denied`; o resto, `error`.
 */
export async function sendVideoProgress(
  lessonId: string,
  payload: ProgressPayload,
  options: { keepalive: boolean },
): Promise<SendOutcome> {
  try {
    const response = await fetch(`/api/lessons/${lessonId}/video-progress`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      keepalive: options.keepalive,
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      const body = (await response.json().catch(() => null)) as {
        completed?: boolean;
        maxPosition?: number;
        completion?: { courseJustCompleted?: boolean };
      } | null;
      return {
        kind: 'ok',
        completed: body?.completed === true,
        maxPosition: body?.maxPosition ?? 0,
        courseJustCompleted: body?.completion?.courseJustCompleted === true,
      };
    }
    if (response.status === 401 || response.status === 403) return { kind: 'denied' };
    return { kind: 'error' };
  } catch {
    return { kind: 'error' };
  }
}

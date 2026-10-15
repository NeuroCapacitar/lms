import type { CourseOutlineDto, LessonViewDto } from '../../features/access/outline';
import { fetchLesson, fetchOutline, type StudyResult } from '../api/learning';
import { offline } from './runtime';
import type { OfflineRead } from './service';

/** Falha de REDE do `fetch` (sem conexão): o navegador rejeita com `TypeError`. Erro HTTP não é falha de rede. */
export function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError;
}

function fromOffline<T>(read: OfflineRead<T>): StudyResult<T> {
  if (read.kind === 'blocked') return { kind: 'offline_blocked', reason: read.reason };
  return {
    kind: 'ok',
    data: read.data,
    offline: {
      leaseUntil: read.leaseUntil,
      savedAt: read.savedAt,
      ...(read.savedLessonIds ? { savedLessonIds: read.savedLessonIds } : {}),
    },
  };
}

/**
 * A aula do ALUNO (M8-02). Online: o servidor decide e a aula de texto liberada é guardada para depois (melhor esforço).
 * Sem rede: lê o que foi guardado, só se o lease do curso estiver em dia e o relógio não tiver voltado. Resposta do servidor
 * (inclusive "bloqueada" ou "sem acesso") nunca é trocada pela cópia local.
 */
export async function loadLesson(
  courseId: string,
  lessonId: string,
): Promise<StudyResult<LessonViewDto>> {
  try {
    const result = await fetchLesson(lessonId);
    if (result.kind === 'ok') void offline.rememberLesson(result.data);
    else if (result.kind === 'denied') void offline.refreshInBackground();
    return result;
  } catch (error) {
    if (!isNetworkFailure(error)) throw error;
    return fromOffline(await offline.readLesson(courseId, lessonId));
  }
}

/** O mapa do curso do ALUNO (M8-02): a mesma regra de `loadLesson`. */
export async function loadOutline(courseId: string): Promise<StudyResult<CourseOutlineDto>> {
  try {
    const result = await fetchOutline(courseId);
    if (result.kind === 'ok') void offline.rememberOutline(result.data);
    else if (result.kind === 'denied') void offline.refreshInBackground();
    return result;
  } catch (error) {
    if (!isNetworkFailure(error)) throw error;
    return fromOffline(await offline.readOutline(courseId));
  }
}

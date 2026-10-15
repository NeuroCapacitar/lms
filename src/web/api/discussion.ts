import type {
  DiscussionPostDto,
  LessonDiscussionDto,
  PostState,
  StaffDiscussionItemDto,
} from '../../features/discussion/discussion';
import { postAction, sendAction } from './action';
import { getJson } from './http';

/**
 * Clientes da discussão (M5-05). A interface só mostra e envia: quem decide acesso, autoria, limite e
 * moderação é o servidor. Erros viram o `ActionResult` de `postAction`; o código do servidor vem em `code`.
 */
export type DiscussionLoad =
  | { kind: 'ok'; data: LessonDiscussionDto }
  | { kind: 'denied' }
  | { kind: 'locked' }
  | { kind: 'not_found' }
  | { kind: 'unauthenticated' };

export async function fetchLessonDiscussion(lessonId: string): Promise<DiscussionLoad> {
  const response = await fetch(`/api/lessons/${lessonId}/discussion`, {
    credentials: 'same-origin',
  });
  if (response.ok) return { kind: 'ok', data: (await response.json()) as LessonDiscussionDto };
  if (response.status === 401) return { kind: 'unauthenticated' };
  if (response.status === 404) return { kind: 'not_found' };
  if (response.status === 403) {
    const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    return { kind: body?.error?.code === 'lesson_locked' ? 'locked' : 'denied' };
  }
  throw new Error(`HTTP ${response.status}`);
}

export const createDiscussionPost = (lessonId: string, body: string, parentId?: string) =>
  postAction<{ post: DiscussionPostDto }>(`/api/lessons/${lessonId}/discussion/posts`, {
    body,
    ...(parentId ? { parentId } : {}),
  });

export const editDiscussionPost = (lessonId: string, postId: string, body: string) =>
  sendAction<{ post: DiscussionPostDto }>(
    'PATCH',
    `/api/lessons/${lessonId}/discussion/posts/${postId}`,
    { body },
  );

export const deleteDiscussionPost = (lessonId: string, postId: string) =>
  postAction(`/api/lessons/${lessonId}/discussion/posts/${postId}/delete`, {});

export const reportDiscussionPost = (lessonId: string, postId: string, reason?: string) =>
  postAction(
    `/api/lessons/${lessonId}/discussion/posts/${postId}/report`,
    reason ? { reason } : {},
  );

export type StaffDiscussionView = 'reported' | 'unanswered';

export const fetchStaffDiscussions = async (view: StaffDiscussionView) =>
  (
    await getJson<{ view: StaffDiscussionView; items: StaffDiscussionItemDto[] }>(
      `/api/staff/discussions?view=${view}`,
    )
  ).items;

export const staffReplyToPost = (postId: string, body: string) =>
  postAction<{ post: DiscussionPostDto }>(`/api/staff/discussions/posts/${postId}/reply`, { body });

export const moderateDiscussionPost = (
  postId: string,
  action: 'hide' | 'restore' | 'delete',
  reason: string,
) =>
  postAction<{ state: PostState }>(`/api/staff/discussions/posts/${postId}/moderate`, {
    action,
    reason,
  });

export const dismissDiscussionReports = (postId: string, reason?: string) =>
  postAction(`/api/staff/discussions/posts/${postId}/dismiss`, reason ? { reason } : {});

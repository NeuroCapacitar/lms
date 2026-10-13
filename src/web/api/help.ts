import type {
  FaqState,
  HelpCategory,
  HelpFaqItemDto,
  SupportRequestItemDto,
} from '../../features/help/help';
import type { RichText } from '../../features/content/rich-text';
import { postAction, sendAction } from './action';
import { getJson } from './staff';

/**
 * Clientes da Ajuda (M5-14). A interface só mostra e envia; quem decide permissão, limite e validade é o servidor.
 */
export const fetchFaq = async () =>
  (await getJson<{ items: HelpFaqItemDto[] }>('/api/me/help/faq')).items;

export const sendSupportRequest = (input: {
  category: HelpCategory;
  message: string;
  courseId?: string;
}) => postAction<{ id: string }>('/api/me/help/requests', input);

/** O endereço de suporte da EQUIPE, para quem não consegue entrar (sem sessão). */
export async function fetchSupportEmail(): Promise<string | null> {
  try {
    const response = await fetch('/api/public/help', { credentials: 'same-origin' });
    if (!response.ok) return null;
    const body = (await response.json()) as { supportEmail?: string | null };
    return body.supportEmail ?? null;
  } catch {
    return null;
  }
}

/* ---- Staff ---- */
export const fetchStaffFaq = async () =>
  (await getJson<{ items: HelpFaqItemDto[] }>('/api/staff/help/faq')).items;

export const fetchSupportRequests = async () =>
  (await getJson<{ requests: SupportRequestItemDto[] }>('/api/staff/help/requests')).requests;

interface FaqInput {
  category: HelpCategory;
  question: string;
  answer: RichText;
}

export const createFaq = (input: FaqInput) => postAction('/api/staff/help/faq', input);

export const updateFaq = (id: string, input: FaqInput) =>
  sendAction('PUT', `/api/staff/help/faq/${id}`, input);

export const setFaqState = (id: string, state: FaqState) =>
  postAction(`/api/staff/help/faq/${id}/state`, { state });

export const moveFaq = (id: string, direction: 'up' | 'down') =>
  postAction(`/api/staff/help/faq/${id}/move`, { direction });

export const deleteFaq = (id: string) => postAction(`/api/staff/help/faq/${id}/delete`, {});

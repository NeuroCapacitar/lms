import type {
  BannerState,
  LoginMediaDto,
  PanelBannerDto,
  StaffLoginMediaDto,
  StaffPanelBannerDto,
} from '../../features/banner/banner';
import { postAction, sendAction } from './action';
import { getJson } from './http';

/**
 * Clientes dos banners do painel e das imagens do login (M5-15). A interface só mostra e envia; quem decide
 * permissão, link válido, janela e o teto de 5 imagens publicadas é o servidor.
 */
export const fetchPanelBanners = async () =>
  (await getJson<{ banners: PanelBannerDto[] }>('/api/me/banners')).banners;

/** Imagens decorativas do login (sem sessão). Qualquer falha vira lista vazia: a tela segue sem imagem. */
export async function fetchLoginMedia(): Promise<LoginMediaDto[]> {
  try {
    const response = await fetch('/api/public/login-media', { credentials: 'same-origin' });
    if (!response.ok) return [];
    const body = (await response.json()) as { items?: LoginMediaDto[] };
    return body.items ?? [];
  } catch {
    return [];
  }
}

/* ---- Staff ---- */
export const fetchStaffBanners = () =>
  getJson<{ panel: StaffPanelBannerDto[]; login: StaffLoginMediaDto[] }>('/api/staff/banners');

export interface PanelBannerInput {
  mediaId: string;
  alt: string;
  linkUrl: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

export const createPanelBanner = (input: PanelBannerInput) =>
  postAction('/api/staff/banners/panel', input);

export const updatePanelBanner = (id: string, input: PanelBannerInput) =>
  sendAction('PUT', `/api/staff/banners/panel/${id}`, input);

export const setPanelBannerState = (id: string, state: BannerState) =>
  postAction(`/api/staff/banners/panel/${id}/state`, { state });

export const movePanelBanner = (id: string, direction: 'up' | 'down') =>
  postAction(`/api/staff/banners/panel/${id}/move`, { direction });

export const deletePanelBanner = (id: string) =>
  postAction(`/api/staff/banners/panel/${id}/delete`, {});

export const createLoginMedia = (mediaId: string) =>
  postAction('/api/staff/banners/login', { mediaId });

export const setLoginMediaState = (id: string, state: BannerState) =>
  postAction(`/api/staff/banners/login/${id}/state`, { state });

export const moveLoginMedia = (id: string, direction: 'up' | 'down') =>
  postAction(`/api/staff/banners/login/${id}/move`, { direction });

export const deleteLoginMedia = (id: string) =>
  postAction(`/api/staff/banners/login/${id}/delete`, {});

import { z } from 'zod';

import { normalizeText } from '../discussion/discussion';
import type { PublicImageDto } from '../media/delivery';

/**
 * Banners do painel e imagens da tela de login (M5-15). Puro: sem rede nem banco. A imagem é mídia PÚBLICA do M5-07;
 * aqui ficam as regras: texto alternativo obrigatório no banner, link só interno ou https de host permitido, janela
 * de exibição opcional, no máximo 5 imagens de login publicadas. Nada se move sozinho: a navegação entre banners é
 * manual (WCAG 2.2.2).
 */
export const MAX_LOGIN_MEDIA_PUBLISHED = 5;
export const MAX_ALT_LENGTH = 200;
const MAX_LINK_LENGTH = 500;

/** Hosts https permitidos em links de banner: o domínio da marca e seus subdomínios. Ampliar exige PR. */
const BANNER_LINK_HOSTS = ['neurocapacitar.com.br'] as const;

/**
 * Normaliza o link do banner ou recusa (`null`). Aceita: caminho INTERNO (começa com uma única `/`, sem `\\`,
 * sem controle) ou `https://` de host da allowlist (ou subdomínio), sem credencial. Recusa `javascript:`, `data:`,
 * `//host`, `http:`, host estranho, `@` (credencial) e espaços.
 */
export function normalizeBannerLink(input: string): string | null {
  const value = input.trim();
  if (value === '' || value.length > MAX_LINK_LENGTH) return null;
  // Sem espaço, controle (C0 e DEL) nem barra invertida: o navegador os trataria de formas diferentes.
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code <= 0x20 || code === 0x7f || char === '\\') return null;
  }
  if (value.startsWith('/')) {
    if (value.startsWith('//')) return null;
    return value;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const allowed = BANNER_LINK_HOSTS.some((base) => host === base || host.endsWith(`.${base}`));
  return allowed ? url.toString() : null;
}

const text = (max: number) =>
  z
    .string()
    .max(max * 3)
    .transform(normalizeText)
    .pipe(z.string().min(1).max(max));

const link = z
  .string()
  .max(MAX_LINK_LENGTH * 2)
  .transform((value, context) => {
    const normalized = normalizeBannerLink(value);
    if (normalized === null) context.addIssue({ code: 'custom', message: 'invalid_link' });
    return normalized ?? '';
  });

const instant = z.iso.datetime({ offset: true });

export const panelBannerSchema = z
  .strictObject({
    mediaId: z.uuid(),
    alt: text(MAX_ALT_LENGTH),
    linkUrl: link.nullable().optional(),
    startsAt: instant.nullable().optional(),
    endsAt: instant.nullable().optional(),
  })
  .refine(
    (banner) =>
      !banner.startsAt || !banner.endsAt || Date.parse(banner.endsAt) > Date.parse(banner.startsAt),
    { message: 'invalid_window', path: ['endsAt'] },
  );

export const loginMediaSchema = z.strictObject({ mediaId: z.uuid() });
export const bannerStateSchema = z.strictObject({ state: z.enum(['draft', 'published']) });
export const bannerMoveSchema = z.strictObject({ direction: z.enum(['up', 'down']) });

export type BannerState = 'draft' | 'published';

/** Banner como a pessoa logada o vê. */
export interface PanelBannerDto {
  id: string;
  image: PublicImageDto;
  /** Texto alternativo obrigatório. */
  alt: string;
  linkUrl: string | null;
}

/** Imagem decorativa do login como a tela pública a recebe (sem `alt`: é decorativa). */
export interface LoginMediaDto {
  id: string;
  image: PublicImageDto;
}

export interface StaffPanelBannerDto {
  id: string;
  mediaId: string;
  alt: string;
  linkUrl: string | null;
  startsAt: string | null;
  endsAt: string | null;
  state: BannerState;
}

export interface StaffLoginMediaDto {
  id: string;
  mediaId: string;
  state: BannerState;
}

/** O banner PUBLICADO está dentro da janela de exibição agora? (início inclusivo, fim exclusivo) */
export function isInWindow(
  window: { startsAt: Date | null; endsAt: Date | null },
  now: Date,
): boolean {
  if (window.startsAt && window.startsAt.getTime() > now.getTime()) return false;
  if (window.endsAt && window.endsAt.getTime() <= now.getTime()) return false;
  return true;
}

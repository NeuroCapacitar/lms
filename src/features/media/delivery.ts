import type { MediaKind } from './media';
import { EXTENSION_BY_KIND } from './media';

/**
 * Entrega pública de capa e banner (M5-07, ADR 0016). As variantes são SEMÂNTICAS e fixas: largura arbitrária
 * nunca é aceita (cada largura nova é uma transformação única na cota do Images Free). Qualquer falha ou limite
 * da transformação cai para o MASTER estático (`fallback`), então a página degrada, não quebra.
 */
export const IMAGE_VARIANTS = {
  cover_card: { width: 640 },
  cover_hero: { width: 1280 },
  banner_narrow: { width: 840 },
  banner_wide: { width: 1680 },
  login_side: { width: 600 },
} as const;

export type ImageVariantName = keyof typeof IMAGE_VARIANTS;

export function isVariantName(value: string): value is ImageVariantName {
  return Object.hasOwn(IMAGE_VARIANTS, value);
}

/** Chave do objeto PÚBLICO (o master copiado): opaca, estável e com a extensão do tipo real. */
export function publicObjectKey(assetId: string, kind: MediaKind): string {
  return `${assetId}.${EXTENSION_BY_KIND[kind]}`;
}

const trimSlash = (value: string) => value.replace(/\/+$/, '');

/** O master estático (sem transformação): o fallback. */
export function masterUrl(baseUrl: string, publicKey: string): string {
  return `${trimSlash(baseUrl)}/${publicKey}`;
}

/** A variante pelo Images Free (`/cdn-cgi/image/...` do domínio da zona). */
export function variantUrl(baseUrl: string, publicKey: string, variant: ImageVariantName): string {
  const { width } = IMAGE_VARIANTS[variant];
  return `${trimSlash(baseUrl)}/cdn-cgi/image/width=${width},quality=80,format=auto/${publicKey}`;
}

/** Imagem pública como a página a recebe: a variante, o fallback e as dimensões do master. */
export interface PublicImageDto {
  src: string;
  /** `src` e `fallbackSrc` para o `<img>`: se a variante falhar, a tela troca para o master UMA vez. */
  fallbackSrc: string;
  /** Dimensões do MASTER (evitam salto de layout; a variante tem a mesma proporção). */
  width: number;
  height: number;
}

export function toPublicImage(input: {
  baseUrl: string;
  publicKey: string;
  variant: ImageVariantName;
  width: number;
  height: number;
}): PublicImageDto {
  return {
    src: variantUrl(input.baseUrl, input.publicKey, input.variant),
    fallbackSrc: masterUrl(input.baseUrl, input.publicKey),
    width: input.width,
    height: input.height,
  };
}

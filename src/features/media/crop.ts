import { MEDIA_PURPOSES } from './media';

/**
 * Recorte do master no navegador (M5-07): o servidor só recebe a imagem JÁ no tamanho e na proporção do
 * propósito. Aqui fica a parte pura (retângulo de recorte centrado, tamanho de saída e a escada de qualidade),
 * testável sem canvas.
 */
export const CROP_TARGETS = {
  course_cover: { width: 1280, height: 720 },
  course_banner: { width: 1680, height: 420 },
} as const;

export type CroppablePurpose = keyof typeof CROP_TARGETS;

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** O maior retângulo CENTRADO da origem com a proporção do destino. */
export function centerCrop(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): CropRect {
  const targetRatio = targetWidth / targetHeight;
  const sourceRatio = sourceWidth / sourceHeight;
  if (sourceRatio > targetRatio) {
    const sw = Math.round(sourceHeight * targetRatio);
    return { sx: Math.floor((sourceWidth - sw) / 2), sy: 0, sw, sh: sourceHeight };
  }
  const sh = Math.round(sourceWidth / targetRatio);
  return { sx: 0, sy: Math.floor((sourceHeight - sh) / 2), sw: sourceWidth, sh };
}

/**
 * A imagem de origem serve? Precisa ter pelo menos o tamanho MÍNIMO do propósito depois do recorte (a saída
 * nunca é ampliada além do alvo). Devolve o tamanho de saída (o alvo, ou menor se a origem for menor mas ainda
 * acima do mínimo) ou o motivo da recusa.
 */
export function planCrop(
  purpose: CroppablePurpose,
  sourceWidth: number,
  sourceHeight: number,
):
  | { ok: true; crop: CropRect; width: number; height: number }
  | { ok: false; reason: 'too_small' } {
  const target = CROP_TARGETS[purpose];
  const rule = MEDIA_PURPOSES[purpose];
  const crop = centerCrop(sourceWidth, sourceHeight, target.width, target.height);
  if (crop.sw < rule.minWidth || crop.sh < rule.minHeight)
    return { ok: false, reason: 'too_small' };
  const scale = Math.min(1, crop.sw / target.width);
  return {
    ok: true,
    crop,
    width: Math.round(target.width * scale),
    height: Math.round(target.height * scale),
  };
}

/** A escada de qualidade do WebP/JPEG: tenta a melhor e desce até caber no limite do propósito. */
export const QUALITY_STEPS = [0.9, 0.82, 0.72, 0.6, 0.45] as const;

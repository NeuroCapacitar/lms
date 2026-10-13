import { QUALITY_STEPS, planCrop, type CroppablePurpose } from '../../features/media/crop';
import { MEDIA_PURPOSES } from '../../features/media/media';

/**
 * Prepara o MASTER no navegador (M5-07): recorta ao centro na proporção do propósito, reduz ao tamanho alvo e
 * exporta em WebP (ou JPEG se o navegador não exportar WebP), descendo a qualidade até caber no limite. Só esse
 * arquivo sobe; o original da câmera nunca é enviado nem guardado.
 */
type PrepareFailure = 'unreadable' | 'too_small' | 'too_large';

export type PrepareOutcome =
  | { ok: true; blob: Blob; contentType: string; width: number; height: number }
  | { ok: false; failure: PrepareFailure };

async function encode(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function prepareImage(file: File, purpose: CroppablePurpose): Promise<PrepareOutcome> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, failure: 'unreadable' };
  }
  const plan = planCrop(purpose, bitmap.width, bitmap.height);
  if (!plan.ok) {
    bitmap.close();
    return { ok: false, failure: 'too_small' };
  }
  const canvas = document.createElement('canvas');
  canvas.width = plan.width;
  canvas.height = plan.height;
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    return { ok: false, failure: 'unreadable' };
  }
  context.drawImage(
    bitmap,
    plan.crop.sx,
    plan.crop.sy,
    plan.crop.sw,
    plan.crop.sh,
    0,
    0,
    plan.width,
    plan.height,
  );
  bitmap.close();

  const limit = MEDIA_PURPOSES[purpose].maxBytes;
  for (const type of ['image/webp', 'image/jpeg']) {
    for (const quality of QUALITY_STEPS) {
      const blob = await encode(canvas, type, quality);
      // O navegador devolve PNG quando não sabe exportar o tipo pedido: só vale o tipo que saiu de fato.
      if (!blob || blob.type !== type) break;
      if (blob.size <= limit) {
        return { ok: true, blob, contentType: type, width: plan.width, height: plan.height };
      }
    }
  }
  return { ok: false, failure: 'too_large' };
}

import type { MediaAssetDto, MediaPurpose, UploadIntentDto } from '../../features/media/media';
import { postAction } from './action';

/**
 * Cliente do upload de mídia (M5-07): intenção, PUT direto ao R2 pelo endereço pré-assinado e confirmação. A tela
 * só mostra o andamento; quem decide se o arquivo vale é o servidor, na confirmação, sobre os BYTES (200 no PUT não
 * publica nada).
 */
export type UploadFailure =
  | 'forbidden'
  | 'invalid_media'
  | 'not_configured'
  | 'upload_failed'
  | 'unavailable'
  | 'unauthenticated';

export type UploadOutcome =
  | { ok: true; media: MediaAssetDto }
  | { ok: false; failure: UploadFailure; reason?: string };

export async function uploadMedia(
  purpose: MediaPurpose,
  blob: Blob,
  contentType: string,
): Promise<UploadOutcome> {
  const created = await postAction<UploadIntentDto>('/api/media/intents', {
    purpose,
    contentType,
    size: blob.size,
  });
  if (created.result !== 'ok' || !created.data) {
    if (created.result === 'unauthenticated') return { ok: false, failure: 'unauthenticated' };
    if (created.result === 'forbidden') return { ok: false, failure: 'forbidden' };
    if (created.result === 'invalid') {
      return { ok: false, failure: 'invalid_media', reason: reasonOf(created) };
    }
    return {
      ok: false,
      failure: created.result === 'unavailable' ? 'unavailable' : 'not_configured',
    };
  }
  const { id, upload } = created.data;

  try {
    const put = await fetch(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body: blob,
    });
    if (!put.ok) return { ok: false, failure: 'upload_failed' };
  } catch {
    return { ok: false, failure: 'upload_failed' };
  }

  const confirmed = await postAction<{ media: MediaAssetDto }>(`/api/media/${id}/confirm`, {});
  if (confirmed.result === 'ok' && confirmed.data) return { ok: true, media: confirmed.data.media };
  if (confirmed.result === 'invalid') {
    return { ok: false, failure: 'invalid_media', reason: reasonOf(confirmed) };
  }
  return {
    ok: false,
    failure: confirmed.result === 'unavailable' ? 'unavailable' : 'upload_failed',
  };
}

function reasonOf(outcome: {
  error?: { code?: string } & Record<string, unknown>;
}): string | undefined {
  const reason = (outcome.error as { reason?: unknown } | undefined)?.reason;
  return typeof reason === 'string' ? reason : undefined;
}

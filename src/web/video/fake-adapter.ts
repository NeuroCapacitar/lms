import type { PlayerEvent, VideoAdapter } from './adapter';

/**
 * Adapter FALSO (M5-02): eventos roteirizados por uma página estática do próprio Hub
 * (`/fake-video`), para testar o player, o progresso e o autoavanço sem provider real. Só é registrado
 * quando a build tem `VITE_FAKE_VIDEO=1` (Dev e e2e); o servidor nunca emite o provider `fake` (o banco só
 * aceita os seis reais), então em Production ele é inalcançável. A mensagem tem forma própria
 * (`source: 'fake-video'`) e o player valida `origin` e `source` antes de chamar `normalize`.
 */
const FAKE_PROVIDER = 'fake';

export function createFakeAdapter(
  options: { provider?: string; reportsEnded?: boolean; reportsTime?: boolean } = {},
): VideoAdapter {
  const { provider = FAKE_PROVIDER, reportsEnded = true, reportsTime = true } = options;
  return {
    provider,
    capabilities: {
      reportsTime,
      reportsEnded,
      reportsSeek: true,
      resume: true,
      duration: 'player',
    },
    allowedHosts: ['self'],
    buildEmbed({ externalId, startAt }) {
      const params = new URLSearchParams({
        id: externalId,
        start: String(Math.max(0, Math.floor(startAt))),
      });
      return { src: `/fake-video?${params.toString()}`, origin: window.location.origin };
    },
    normalize(event): PlayerEvent | undefined {
      const data = event.data as {
        source?: unknown;
        type?: unknown;
        t?: unknown;
        duration?: unknown;
      } | null;
      if (!data || typeof data !== 'object' || data.source !== 'fake-video') return undefined;
      switch (data.type) {
        case 'ready':
        case 'play':
        case 'pause':
        case 'ratechange':
        case 'error':
          return { type: data.type };
        case 'ended':
          // Só emite o que DECLARA: sem `reportsEnded` o fim do vídeo não é um sinal confiável.
          return reportsEnded ? { type: 'ended' } : undefined;
        case 'timeupdate':
        case 'seeked':
          if (data.type === 'timeupdate' && !reportsTime) return undefined;
          return typeof data.t === 'number' && Number.isFinite(data.t)
            ? { type: data.type, t: data.t }
            : undefined;
        case 'durationchange':
          return typeof data.duration === 'number' && Number.isFinite(data.duration)
            ? { type: 'durationchange', duration: data.duration }
            : undefined;
        default:
          return undefined;
      }
    },
  };
}

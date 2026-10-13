/**
 * Contrato do adapter de vídeo (M5-02, ADR 0015): UM player e UM contrato de progresso para qualquer provider.
 * O adapter só diz o que o provider sabe fazer (`capabilities`, nada é presumido), como montar o embed e como
 * traduzir a mensagem do iframe para eventos NORMALIZADOS. Quem valida a origem da mensagem é o player, nunca
 * o adapter. Não há iframe com URL arbitrária: o `src` só sai de `buildEmbed` e o host precisa estar na
 * allowlist do provider (que também precisa estar em `frame-src` da CSP, conferido por teste).
 */
export type PlayerEvent =
  | { type: 'ready' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'timeupdate'; t: number }
  | { type: 'seeked'; t: number }
  | { type: 'ratechange' }
  | { type: 'ended' }
  | { type: 'error' }
  | { type: 'durationchange'; duration: number };

interface AdapterCapabilities {
  /** O provider emite o tempo de reprodução (sem isto não há progresso por vídeo). */
  reportsTime: boolean;
  /** O provider emite `ended` de forma CONFIÁVEL: só então o autoavanço é permitido. */
  reportsEnded: boolean;
  reportsSeek: boolean;
  /** Aceita começar de uma posição (retomar de onde parou). */
  resume: boolean;
  /** De onde vem a duração: do provider (`api`, gravada no asset) ou revelada pelo player. */
  duration: 'api' | 'player';
}

interface EmbedAsset {
  externalId: string;
  /** Segundos de onde começar (só usado se `capabilities.resume`). */
  startAt: number;
}

interface Embed {
  src: string;
  /** Origem das mensagens do iframe: o player descarta qualquer mensagem de outra origem. */
  origin: string;
}

export interface VideoAdapter {
  readonly provider: string;
  readonly capabilities: AdapterCapabilities;
  /** Hosts permitidos para o iframe deste provider. */
  readonly allowedHosts: readonly string[];
  buildEmbed(asset: EmbedAsset): Embed;
  /** Traduz a mensagem do iframe (`undefined` = não é um evento deste player: ignorar). */
  normalize(event: MessageEvent): PlayerEvent | undefined;
}

/** O embed é `https` (ou `http` só em localhost) e o host está na allowlist do adapter. */
export function isAllowedEmbed(src: string, allowedHosts: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(src, 'https://invalid.local');
  } catch {
    return false;
  }
  if (src.startsWith('/')) return allowedHosts.includes('self');
  const secure =
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'));
  return secure && allowedHosts.includes(url.hostname);
}

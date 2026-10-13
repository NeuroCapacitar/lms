import { z } from 'zod';

/**
 * Providers de vídeo da v1 (ADR 0015) e o contrato das conexões (M5-01). Sem SQL nem Hono. O SEGREDO de uma
 * conexão (token de API da conta do cliente) só existe em claro no servidor, na hora de falar com o
 * provider: nenhum DTO daqui o carrega.
 */
export const VIDEO_PROVIDERS = [
  'jmvstream',
  'panda',
  'cloudflare_stream',
  'mux',
  'youtube',
  'vimeo',
] as const;

export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

export const VIDEO_PROVIDER_LABELS: Record<VideoProvider, string> = {
  jmvstream: 'JMVStream',
  panda: 'Panda Video',
  cloudflare_stream: 'Cloudflare Stream',
  mux: 'Mux',
  youtube: 'YouTube',
  vimeo: 'Vimeo',
};

/** YouTube e Vimeo públicos funcionam SEM credenciais (conexão sem segredo); os demais exigem a da conta. */
export function secretRequired(provider: VideoProvider): boolean {
  return provider !== 'youtube' && provider !== 'vimeo';
}

export type VideoConnectionStatus = 'active' | 'disabled';

const secret = z.string().min(1).max(4096);
const label = z.string().trim().min(1).max(80);

export const createConnectionSchema = z.strictObject({
  provider: z.enum(VIDEO_PROVIDERS),
  label,
  secret: secret.optional(),
});

export const rotateSecretSchema = z.strictObject({ secret });

/** O que a API devolve de uma conexão: NUNCA o segredo, nem cifrado, nem parcial. */
export interface VideoConnectionDto {
  id: string;
  provider: VideoProvider;
  label: string;
  status: VideoConnectionStatus;
  /** Há segredo guardado? (a interface só mostra "configurado", sem valor) */
  configured: boolean;
  /** Versão da chave mestra com que o segredo foi cifrado; `null` sem segredo. */
  keyVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

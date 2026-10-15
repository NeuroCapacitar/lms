import type { VideoConnectionDto, VideoProvider } from '../../features/video/providers';
import type { ProviderAvailabilityDto } from '../../features/video/verification';
import { postAction, sendAction } from './action';
import { getJson } from './http';

/** Cliente da tela "Vídeo" (M5-01, só Admin). O segredo vai UMA vez e nunca é lido de volta. */
export const fetchVideoConnections = async () =>
  (await getJson<{ connections: VideoConnectionDto[] }>('/api/staff/video/connections'))
    .connections;

export const createVideoConnection = async (input: {
  provider: VideoProvider;
  label: string;
  secret?: string;
}) => (await postAction('/api/staff/video/connections', input)).result;

export const rotateVideoSecret = async (id: string, secret: string) =>
  (await sendAction('PUT', `/api/staff/video/connections/${id}/secret`, { secret })).result;

export const setVideoConnectionEnabled = async (id: string, enabled: boolean) =>
  (await postAction(`/api/staff/video/connections/${id}/${enabled ? 'enable' : 'disable'}`, {}))
    .result;

export const rekeyVideoSecrets = async () =>
  await postAction<{ rekeyed: number; alreadyCurrent: number; failed: number }>(
    '/api/staff/video/rekey',
    {},
  );

/** Quais providers este ambiente oferece (M5-03): Production só os verificados; Dev e Staging, todos. */
export const fetchVideoProviders = async () =>
  await getJson<{ environment: string; providers: ProviderAvailabilityDto[] }>(
    '/api/staff/video/providers',
  );

import type { VideoProviderAdapter } from '../../features/video/provider-adapter';
import type { VideoProvider } from '../../features/video/providers';

/**
 * Os adapters REAIS do servidor, um por provider (M5-08 a M5-13 acrescentam o seu aqui, junto da fixture em
 * `activation.test.ts`). Hoje nenhum existe. Estar aqui NÃO ativa o provider em Production: isso é
 * `VERIFIED_PROVIDERS` (M5-03), que exige a evidência da conta real no STATUS.
 */
export const PROVIDER_ADAPTERS: Partial<Record<VideoProvider, VideoProviderAdapter>> = {};

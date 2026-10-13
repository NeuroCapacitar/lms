import type { VideoProvider } from '../../features/video/providers';
import type { VideoAdapter } from './adapter';

/**
 * Os adapters REAIS do cliente, um por provider (M5-08 a M5-13 acrescentam o seu aqui, cada um junto da
 * fixture do contrato em `adapter-contract.test.ts`). Hoje nenhum existe. Estar aqui NÃO ativa o provider:
 * a ativação em Production é a lista `VERIFIED_PROVIDERS` (M5-03), que exige a evidência no STATUS.
 */
export const REAL_ADAPTERS: Partial<Record<VideoProvider, () => VideoAdapter>> = {};

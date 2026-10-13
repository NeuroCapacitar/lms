import { VIDEO_PROVIDERS, type VideoProvider } from './providers';

/**
 * Trava de ativação dos providers de vídeo (M5-03, ADR 0015): um provider só é USÁVEL em Production depois de
 * passar no teste de contrato COM CONTA REAL e de ter a evidência registrada em `docs/implementation/STATUS.md`
 * (entrada `### Verificação de provider — <provider>`). Esta lista é configuração revisada em PR: acrescentar
 * um provider aqui sem a evidência e sem o adapter falha em `src/features/video/verification.test.ts`.
 *
 * Dev e Staging aceitam todos (com o aviso "não verificado") para que o time possa exercitar a conta real
 * ANTES de verificar; Production só aceita os verificados. Ambiente desconhecido é tratado como Production.
 */
export const VERIFIED_PROVIDERS = {
  development: [],
  staging: [],
  production: [],
} as const satisfies Record<VerificationEnvironment, readonly VideoProvider[]>;

type VerificationEnvironment = 'development' | 'staging' | 'production';

type VerifiedLists = Record<VerificationEnvironment, readonly VideoProvider[]>;

/** `CLOUDFLARE_ENV` do build (`dev`, `staging`, `production`) → ambiente da trava; o resto vira Production. */
export function verificationEnvironment(appEnv: string): VerificationEnvironment {
  if (appEnv === 'dev' || appEnv === 'development') return 'development';
  if (appEnv === 'staging') return 'staging';
  return 'production';
}

export function isProviderVerified(
  appEnv: string,
  provider: VideoProvider,
  lists: VerifiedLists = VERIFIED_PROVIDERS,
): boolean {
  return lists[verificationEnvironment(appEnv)].includes(provider);
}

/** Pode ser escolhido/aceito pela API? Production: só verificado. Dev e Staging: todos (com aviso). */
export function isProviderUsable(
  appEnv: string,
  provider: VideoProvider,
  lists: VerifiedLists = VERIFIED_PROVIDERS,
): boolean {
  return (
    verificationEnvironment(appEnv) !== 'production' || isProviderVerified(appEnv, provider, lists)
  );
}

export interface ProviderAvailabilityDto {
  provider: VideoProvider;
  /** Passou no teste de contrato com conta real neste ambiente. */
  verified: boolean;
  /** O seletor pode oferecer este provider (Production: só os verificados). */
  selectable: boolean;
}

export function providerAvailability(
  appEnv: string,
  lists: VerifiedLists = VERIFIED_PROVIDERS,
): ProviderAvailabilityDto[] {
  return VIDEO_PROVIDERS.map((provider) => ({
    provider,
    verified: isProviderVerified(appEnv, provider, lists),
    selectable: isProviderUsable(appEnv, provider, lists),
  }));
}

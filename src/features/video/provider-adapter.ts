import type { VideoProvider } from './providers';

/**
 * Contrato do lado do SERVIDOR de um provider de vídeo (M5-03), o que os adapters M5-08 a M5-13 implementam.
 * Sem SQL, Hono nem SDK: a rede entra por `ProviderTransport` (injetado), para que as fixtures gravadas
 * reproduzam as respostas do provider sem rede. O SEGREDO da conta nunca passa por aqui: quem monta o
 * transporte (já autenticado) é o chamador, e nenhum erro deste contrato pode carregá-lo.
 */
interface ProviderCapabilities {
  /** O provider recebe upload e o Hub pode apagar o que ele mesmo enviou (`managed`). */
  managedUpload: boolean;
  /** A reprodução exige URL/token assinado gerado pelo servidor. */
  signedPlayback: boolean;
  /** O provider restringe a reprodução por domínio. */
  domainRestriction: boolean;
}

/** `managed` = enviado pelo Hub (pode ser apagado); `referenced` = só apontado (NUNCA apagar). */
type AssetOrigin = 'managed' | 'referenced';

type ProviderAssetStatus = 'processing' | 'ready' | 'failed' | 'unavailable';

export interface ProviderStatus {
  status: ProviderAssetStatus;
  durationSeconds?: number;
}

export interface ProviderRequest {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: unknown;
}

export interface ProviderResponse {
  status: number;
  body: unknown;
}

/** Rede do provider; lança em falha de rede ou de tempo esgotado. */
export type ProviderTransport = (request: ProviderRequest) => Promise<ProviderResponse>;

type ReferenceResult =
  | { ok: true; externalId: string }
  | { ok: false; reason: 'invalid_reference' };

/** Falha do provider, com código estável e SEM detalhes do provider nem credenciais na mensagem. */
export class ProviderError extends Error {
  constructor(readonly code: 'provider_unreachable' | 'provider_rejected' | 'provider_malformed') {
    super(code);
    this.name = 'ProviderError';
  }
}

export interface VideoProviderAdapter {
  readonly provider: VideoProvider;
  readonly capabilities: ProviderCapabilities;
  /** Normaliza o que a Staff colou (URL ou ID) para o ID externo, ou rejeita; nunca confia no host da URL. */
  normalizeReference(input: string): ReferenceResult;
  /** Estado de processamento/disponibilidade. Falha do provider vira `ProviderError`. */
  getStatus(transport: ProviderTransport, externalId: string): Promise<ProviderStatus>;
  /** Só existe com `managedUpload`; recusa (`ProviderError('provider_rejected')`) o que não é `managed`. */
  deleteAsset?(
    transport: ProviderTransport,
    asset: { externalId: string; origin: AssetOrigin },
  ): Promise<void>;
}

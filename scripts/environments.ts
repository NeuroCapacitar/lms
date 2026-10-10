/**
 * Tabela do que cada ambiente PODE referenciar. O preflight (scripts/preflight-core.ts)
 * rejeita qualquer artefato cujo Worker, ambiente ou recurso não esteja aqui.
 * Só IDs e nomes de recursos; nunca segredos. Production nunca é implantada por CI.
 */
export type EnvironmentName = 'dev' | 'staging' | 'production';

export interface ExpectedEnvironment {
  /** Valor de CLOUDFLARE_ENV no build; `null` = build sem ambiente (desenvolvimento local). */
  readonly cloudflareEnv: string | null;
  readonly workerName: string;
  /** Recursos permitidos por categoria do artefato (ver RESOURCE_REFERENCES em preflight-core). */
  readonly resources: Readonly<Record<string, readonly string[]>>;
  /** Variáveis (`vars`) permitidas, só nomes. */
  readonly vars: readonly string[];
}

// Os recursos entram aqui quando forem criados (Hyperdrive no M0-04, filas no M4, R2 no M5...).
export const ENVIRONMENTS: Readonly<Record<EnvironmentName, ExpectedEnvironment>> = {
  dev: { cloudflareEnv: null, workerName: 'hub', resources: {}, vars: [] },
  staging: { cloudflareEnv: 'staging', workerName: 'hub-staging', resources: {}, vars: [] },
  production: {
    cloudflareEnv: 'production',
    workerName: 'hub-production',
    resources: {},
    vars: [],
  },
};

export function isEnvironmentName(value: string): value is EnvironmentName {
  return Object.hasOwn(ENVIRONMENTS, value);
}

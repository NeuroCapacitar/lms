/**
 * Tabela do que cada ambiente PODE referenciar. O preflight (scripts/preflight-core.ts)
 * rejeita qualquer artefato cujo Worker, ambiente ou recurso não esteja aqui, e os scripts de
 * banco (scripts/db/guards.ts) só aceitam o host aprovado do ambiente.
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
  /** Host DIRETO (sem pooler) do projeto Neon do ambiente, aprovado para migrações. */
  readonly databaseHost: string;
}

// Os recursos entram aqui quando forem criados (R2 no M5...). Filas (M4-02): uma lane por fila + DLQ; o
// nome leva o ambiente porque Staging e Production dividem a conta Cloudflare.
export const ENVIRONMENTS: Readonly<Record<EnvironmentName, ExpectedEnvironment>> = {
  dev: {
    cloudflareEnv: null,
    workerName: 'hub',
    resources: {
      hyperdrive: ['cda50f48086646dda22bbb4424791e58'],
      queue_producers: ['hub-finance', 'hub-general', 'hub-finance-dlq', 'hub-general-dlq'],
      queue_consumers: ['hub-finance', 'hub-general', 'hub-finance-dlq', 'hub-general-dlq'],
    },
    vars: [
      'APP_BASE_URL',
      'EMAIL_FROM',
      'RESEND_TEMPLATE_MAGIC_LINK',
      'RESEND_TEMPLATE_REAUTH_LINK',
      'RESEND_TEMPLATE_STAFF_INVITATION',
    ],
    databaseHost: 'ep-raspy-shadow-b6hm9l97.c-2.sa-east-1.aws.neon.tech',
  },
  staging: {
    cloudflareEnv: 'staging',
    workerName: 'hub-staging',
    resources: {
      hyperdrive: ['cea4be9d4370457b93f1feb7469d2ceb'],
      queue_producers: [
        'hub-staging-finance',
        'hub-staging-general',
        'hub-staging-finance-dlq',
        'hub-staging-general-dlq',
      ],
      queue_consumers: [
        'hub-staging-finance',
        'hub-staging-general',
        'hub-staging-finance-dlq',
        'hub-staging-general-dlq',
      ],
    },
    vars: [
      'APP_BASE_URL',
      'EMAIL_FROM',
      'RESEND_TEMPLATE_MAGIC_LINK',
      'RESEND_TEMPLATE_REAUTH_LINK',
      'RESEND_TEMPLATE_STAFF_INVITATION',
    ],
    databaseHost: 'ep-cool-queen-b65b1tx5.c-2.sa-east-1.aws.neon.tech',
  },
  production: {
    cloudflareEnv: 'production',
    workerName: 'hub-production',
    resources: {
      hyperdrive: ['f31b83e0d8044d00a9651c81d121bc91'],
      queue_producers: [
        'hub-production-finance',
        'hub-production-general',
        'hub-production-finance-dlq',
        'hub-production-general-dlq',
      ],
      queue_consumers: [
        'hub-production-finance',
        'hub-production-general',
        'hub-production-finance-dlq',
        'hub-production-general-dlq',
      ],
    },
    vars: [
      'APP_BASE_URL',
      'EMAIL_FROM',
      'RESEND_TEMPLATE_MAGIC_LINK',
      'RESEND_TEMPLATE_REAUTH_LINK',
      'RESEND_TEMPLATE_STAFF_INVITATION',
    ],
    databaseHost: 'ep-damp-sound-b6vbovq8.c-2.sa-east-1.aws.neon.tech',
  },
};

export function isEnvironmentName(value: string): value is EnvironmentName {
  return Object.hasOwn(ENVIRONMENTS, value);
}

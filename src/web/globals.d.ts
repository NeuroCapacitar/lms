/** Constantes substituídas pelo Vite no build (ver vite.config.ts). */
declare const __RELEASE_ID__: string;
declare const __APP_ENV__: string;

interface ImportMetaEnv {
  /** DSN público do projeto Sentry do SPA; ausente = Sentry desligado. */
  readonly VITE_SENTRY_DSN?: string;
}

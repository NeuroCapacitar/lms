import lexendDecaLatin from '@fontsource-variable/lexend-deca/files/lexend-deca-latin-wght-normal.woff2?inline';

import { createR2Storage } from '../media/r2-storage';
import { createBrowserRunRenderer } from './browser-run-renderer';
import type { CertificateHandlerDeps } from './certificate-store';

/**
 * O renderer do certificado do ambiente (M7-02): só existe com o binding `BROWSER` E o R2 (os bindings dos buckets).
 * Sem qualquer um, o handler marca o certificado `failed` com `renderer_not_configured` (repetível quando ativar).
 */
export function certificateDeps(env: Env): CertificateHandlerDeps | undefined {
  const storage = createR2Storage(env);
  if (!env.BROWSER || !storage) return undefined;
  return {
    renderer: createBrowserRunRenderer({
      browser: env.BROWSER,
      storage,
      baseUrl: env.APP_BASE_URL,
      fontDataUri: lexendDecaLatin,
    }),
  };
}

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import type { Database } from '../../db/client';
import { withDatabase } from '../../db/client';
import { certificate } from '../../db/schema';
import { hitThrottle } from '../../db/throttle';
import {
  certificateSnapshotSchema,
  type CertificateStatus,
} from '../../features/certificate/certificate';
import {
  certificateMeta,
  publicCodeSchema,
  toPublicDto,
  type PublicCertificateDto,
} from '../../features/certificate/public';
import type { CoursePageDeps } from '../catalog/course-page';
import { injectMeta } from '../catalog/course-page';

/**
 * Validação PÚBLICA do certificado (M7-08), sem sessão. Uma resposta só para tudo o que não é um certificado emitido:
 * código malformado, inexistente, na fila ou com falha. O freio é um limite permissivo por IP (contador no banco);
 * não há cache da revogação (revogar vale na hora). Tráfego anônimo acorda o Neon Free: reavaliar no M9-07.
 */
export const PUBLIC_LOOKUP_LIMIT = { max: 60, windowSeconds: 10 * 60 } as const;

export type PublicLookup =
  | { kind: 'found'; dto: PublicCertificateDto }
  | { kind: 'not_found' }
  | { kind: 'limited' };

/** Procura pelo código e monta o DTO FECHADO (só os campos públicos). */
async function findPublicCertificate(
  db: Database,
  code: string,
): Promise<PublicCertificateDto | null> {
  if (!publicCodeSchema.safeParse(code).success) return null;
  const [row] = await db.select().from(certificate).where(eq(certificate.code, code));
  if (!row) return null;
  const snapshot = certificateSnapshotSchema.safeParse(row.snapshot);
  if (!snapshot.success || !snapshot.data.issuer) return null;
  return toPublicDto({
    status: row.status as CertificateStatus,
    courseTitle: snapshot.data.courseTitle,
    workloadHours: snapshot.data.workloadHours,
    issuedAt: row.readyAt ?? row.createdAt,
    issuerName: snapshot.data.issuer.legalName,
    holderName: snapshot.data.holderName,
  });
}

export async function lookupPublicCertificate(
  db: Database,
  input: { code: string; ip: string },
): Promise<PublicLookup> {
  const hits = await hitThrottle(
    db,
    `certificate-public:ip:${input.ip}`,
    PUBLIC_LOOKUP_LIMIT.windowSeconds,
  );
  if (hits > PUBLIC_LOOKUP_LIMIT.max) return { kind: 'limited' };
  const dto = await findPublicCertificate(db, input.code);
  return dto ? { kind: 'found', dto } : { kind: 'not_found' };
}

const clientIp = (request: Request) => request.headers.get('cf-connecting-ip') ?? 'desconhecido';

const NOT_FOUND = { error: { code: 'not_found' } } as const;

/** `GET /api/public/certificates/:code`: o DTO público, ou 404 IDÊNTICO; 429 no excesso. Sempre `no-store` e `noindex`. */
export function publicCertificateRoutes() {
  const routes = new Hono<{ Bindings: Env }>();
  routes.get('/certificates/:code', async (c) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex');
    const result = await withDatabase(c.env.HYPERDRIVE, (db) =>
      lookupPublicCertificate(db, { code: c.req.param('code'), ip: clientIp(c.req.raw) }),
    );
    if (result.kind === 'limited') return c.json({ error: { code: 'rate_limited' } }, 429);
    return result.kind === 'found' ? c.json(result.dto) : c.json(NOT_FOUND, 404);
  });
  return routes;
}

const CODE_PATH = /^\/certificados\/([^/]+)\/?$/;

/**
 * `/certificados/:code` (M7-08): a SPA com as meta tags da validação (Open Graph, `noindex`), respeitando o modo do
 * nome. Código desconhecido, na fila, malformado ou com falha: meta GENÉRICA e 404, a mesma resposta nos quatro casos.
 * Falha no banco ou limite: a SPA com meta genérica (a tela mostra o erro de carregamento).
 */
export async function serveCertificatePage(
  request: Request,
  env: Env,
  deps: {
    shell: (env: Env, requestUrl: string) => Promise<Response>;
    lookup: (code: string, ip: string) => Promise<PublicLookup>;
    inject?: CoursePageDeps['inject'];
    onError: (error: unknown) => void;
  },
): Promise<Response> {
  const inject = deps.inject ?? injectMeta;
  const shell = await deps.shell(env, request.url);
  const match = CODE_PATH.exec(new URL(request.url).pathname);
  if (!match) return shell;
  let code: string;
  try {
    code = decodeURIComponent(match[1]!);
  } catch {
    return inject(shell, certificateMeta(env.APP_BASE_URL, null, null), 404);
  }
  try {
    const result = await deps.lookup(code, clientIp(request));
    if (result.kind === 'found') {
      return inject(shell, certificateMeta(env.APP_BASE_URL, result.dto, code), 200);
    }
    return inject(
      shell,
      certificateMeta(env.APP_BASE_URL, null, null),
      result.kind === 'limited' ? 429 : 404,
    );
  } catch (error) {
    deps.onError(error);
    return inject(
      await deps.shell(env, request.url),
      certificateMeta(env.APP_BASE_URL, null, null),
      200,
    );
  }
}

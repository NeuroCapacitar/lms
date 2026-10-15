import { and, eq } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { mediaAsset } from '../../db/schema';
import {
  CertificateRenderInputError,
  renderCertificateHtml,
} from '../../features/certificate/render';
import type { ObjectStorage } from '../media/storage';
import {
  CertificateRenderRejectedError,
  CertificateRenderTransientError,
  type CertificateRenderer,
} from './certificate-store';

/**
 * Renderer de produção do certificado (M7-02): HTML controlado → Browser Run `/pdf` → validação → SHA-256 → R2
 * PRIVADO. Segue a ADR 0030: `rejectRequestPattern` bloqueia QUALQUER requisição externa (além da CSP do próprio
 * HTML), `preferCSSPageSize` e `printBackground`. O PDF NÃO é determinístico (carrega a data de criação), então o hash
 * identifica o arquivo GUARDADO e a chave leva o hash: uma nova tentativa nunca sobrescreve um PDF já guardado.
 * Nada daqui foi exercitado contra o Browser Run REAL nesta entrega (o gate é o M7-09, em Staging).
 */
export interface BrowserRunBinding {
  quickAction(action: string, options: Record<string, unknown>): Promise<Response>;
}

export interface BrowserRunRendererDeps {
  browser: BrowserRunBinding;
  storage: ObjectStorage;
  /** Origem pública do app (`APP_BASE_URL`): endereço de validação e QR. */
  baseUrl: string;
  /** Lexend Deca em `data:font/woff2;base64,...` (empacotada no Worker). */
  fontDataUri: string;
  now?: () => Date;
}

/** Limites nossos: o serviço não falha limpo com entrada gigante (ADR 0030). */
const MAX_HTML_BYTES = 1_500_000;
const MAX_PDF_BYTES = 2_000_000;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

const BLOCK_EXTERNAL = { rejectRequestPattern: ['^https?://.*'] };
const PDF_OPTIONS = { preferCSSPageSize: true, printBackground: true };

function base64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Uma página só: conta os objetos `/Type /Page` (sem o `/Pages`). */
function pageCount(pdf: Uint8Array): number {
  return (new TextDecoder('latin1').decode(pdf).match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

/** A imagem privada (assinatura ou fundo) como `data:`, lida do R2 só aqui no servidor. */
async function imageDataUri(
  db: Database,
  storage: ObjectStorage,
  mediaId: string,
  code: string,
): Promise<string> {
  const [asset] = await db
    .select()
    .from(mediaAsset)
    .where(
      and(
        eq(mediaAsset.id, mediaId),
        eq(mediaAsset.purpose, 'certificate_asset'),
        eq(mediaAsset.state, 'ready'),
      ),
    );
  if (!asset?.contentType) throw new CertificateRenderRejectedError(code);
  let bytes: Uint8Array | null;
  try {
    bytes = await storage.read('private', asset.storageKey);
  } catch {
    throw new CertificateRenderTransientError('r2_read_failed');
  }
  if (!bytes) throw new CertificateRenderRejectedError(code);
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new CertificateRenderRejectedError(code);
  return `data:${asset.contentType};base64,${base64(bytes)}`;
}

export function createBrowserRunRenderer(deps: BrowserRunRendererDeps): CertificateRenderer {
  const nowOf = deps.now ?? (() => new Date());
  return {
    async render({ db, certificateId, code, snapshot }) {
      // O que falta no snapshot é recusado ANTES de qualquer leitura do R2 ou chamada ao serviço.
      if (!snapshot.issuer) throw new CertificateRenderRejectedError('issuer_missing');
      if (!snapshot.signatory) throw new CertificateRenderRejectedError('signatory_missing');
      const signatureDataUri = snapshot.signatory?.signatureMediaId
        ? await imageDataUri(
            db,
            deps.storage,
            snapshot.signatory.signatureMediaId,
            'signature_unavailable',
          )
        : null;
      const backgroundDataUri = snapshot.backgroundMediaId
        ? await imageDataUri(db, deps.storage, snapshot.backgroundMediaId, 'background_unavailable')
        : null;

      let html: string;
      try {
        html = renderCertificateHtml({
          snapshot,
          code,
          baseUrl: deps.baseUrl,
          issuedAt: nowOf().toISOString(),
          fontDataUri: deps.fontDataUri,
          signatureDataUri,
          backgroundDataUri,
        });
      } catch (error) {
        if (error instanceof CertificateRenderInputError) {
          throw new CertificateRenderRejectedError(error.code);
        }
        throw error;
      }
      if (new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES) {
        throw new CertificateRenderRejectedError('html_too_large');
      }

      // O serviço devolve a falha como Response (não como exceção): 429 e 5xx são transitórios, o resto, definitivo.
      let response: Response;
      try {
        response = await deps.browser.quickAction('pdf', {
          html,
          pdfOptions: PDF_OPTIONS,
          ...BLOCK_EXTERNAL,
        });
      } catch {
        throw new CertificateRenderTransientError('browser_run_unavailable');
      }
      if (response.status === 429 || response.status >= 500) {
        throw new CertificateRenderTransientError(`browser_run_http_${response.status}`);
      }
      if (!response.ok) {
        throw new CertificateRenderRejectedError(`browser_run_http_${response.status}`);
      }
      const pdf = new Uint8Array(await response.arrayBuffer());
      if (pdf.byteLength === 0 || pdf.byteLength > MAX_PDF_BYTES) {
        throw new CertificateRenderRejectedError('pdf_size_invalid');
      }
      if (new TextDecoder('latin1').decode(pdf.subarray(0, 5)) !== '%PDF-') {
        throw new CertificateRenderRejectedError('not_a_pdf');
      }
      if (pageCount(pdf) !== 1) throw new CertificateRenderRejectedError('pdf_not_one_page');

      const pdfSha256 = await sha256Hex(pdf);
      const pdfKey = `certificates/${certificateId}/${pdfSha256}.pdf`;
      try {
        await deps.storage.put('private', pdfKey, pdf, 'application/pdf');
      } catch {
        throw new CertificateRenderTransientError('r2_put_failed');
      }
      return { pdfKey, pdfSha256 };
    },
  };
}

import { CERTIFICATE_CODE_PATTERN, type CertificateSnapshot } from './certificate';
import { formatCnpj } from './issuer';
import { qrSvg } from './qr';

/**
 * HTML do certificado (M7-02), PURO e DETERMINÍSTICO: o mesmo snapshot gera o mesmo HTML. Regras que valem:
 * (1) TODO dado do snapshot passa por UMA função de escape, nunca é concatenado cru; (2) sem JavaScript, sem `<img>`
 * nem `<link>` remotos, sem `url()` externo: só `data:` (fonte, assinatura) e o QR em SVG local; (3) a própria
 * página carrega uma CSP que proíbe qualquer requisição de rede e script (defesa além do bloqueio do Browser Run).
 * Quem chama (o renderer, M7-02) fornece a fonte e a assinatura já como data URI; este módulo não lê arquivo nem rede.
 */
export class CertificateRenderInputError extends Error {
  constructor(readonly code: string) {
    super(`certificate_render_input:${code}`);
  }
}

/** A única função de escape: cobre `& < > " '` e a crase, valendo para texto e para atributo. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('`', '&#96;');
}

const IMAGE_DATA_URI = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const FONT_DATA_URI = /^data:font\/woff2;base64,[A-Za-z0-9+/]+={0,2}$/;

/** Endereço público de validação: `<origem>/certificados/<código>`. A origem precisa ser http(s) e sem caminho. */
export function certificateValidationUrl(baseUrl: string, code: string): string {
  if (!CERTIFICATE_CODE_PATTERN.test(code)) throw new CertificateRenderInputError('code_invalid');
  let origin: URL;
  try {
    origin = new URL(baseUrl);
  } catch {
    throw new CertificateRenderInputError('base_url_invalid');
  }
  if (origin.protocol !== 'https:' && origin.protocol !== 'http:') {
    throw new CertificateRenderInputError('base_url_invalid');
  }
  return `${origin.origin}/certificados/${code}`;
}

/** "14 de outubro de 2026", no dia de São Paulo (o fuso do produto), em pt-BR. */
export function formatDatePt(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
}

/** Tamanho do nome do titular pelo comprimento: nome longo diminui em vez de estourar a página. */
function nameSizeClass(name: string): 'n1' | 'n2' | 'n3' | 'n4' {
  const length = [...name].length;
  if (length <= 32) return 'n1';
  if (length <= 52) return 'n2';
  if (length <= 80) return 'n3';
  return 'n4';
}

export interface RenderCertificateInput {
  snapshot: CertificateSnapshot;
  code: string;
  /** Origem pública do app (`APP_BASE_URL`), para o endereço de validação e o QR. */
  baseUrl: string;
  /** Data de emissão (ISO). */
  issuedAt: string;
  /** Lexend Deca em `data:font/woff2;base64,...`; sem ela o texto cai em fonte do sistema. */
  fontDataUri?: string | null;
  /** Assinatura em `data:image/(png|jpeg|webp);base64,...`; a assinatura é opcional. */
  signatureDataUri?: string | null;
}

const CSP = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'";

const STYLE = `
@page { size: 297mm 210mm; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { width: 297mm; height: 210mm; font-variant-ligatures: none; font-family: 'Lexend Deca', system-ui, sans-serif; color: #1a1a2e; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { position: relative; width: 297mm; height: 210mm; padding: 16mm 22mm; border: 3mm solid #1f3a5f; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; }
h1 { margin: 0; text-align: center; font-size: 26pt; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: #1f3a5f; }
.lead { text-align: center; font-size: 13pt; margin: 0; }
.holder { text-align: center; font-weight: 600; margin: 4mm 0; overflow-wrap: anywhere; line-height: 1.15; max-height: 42mm; overflow: hidden; }
.n1 { font-size: 36pt; } .n2 { font-size: 28pt; } .n3 { font-size: 22pt; } .n4 { font-size: 17pt; }
.body { text-align: center; font-size: 14pt; line-height: 1.5; margin: 0 auto; max-width: 235mm; max-height: 48mm; overflow: hidden; overflow-wrap: anywhere; }
.course { font-weight: 600; }
.footer { display: flex; justify-content: space-between; align-items: flex-end; gap: 10mm; }
.signature { width: 90mm; text-align: center; font-size: 11pt; }
.signature img { display: block; margin: 0 auto 2mm; max-width: 70mm; max-height: 22mm; }
.signature .line { border-top: 0.3mm solid #1a1a2e; padding-top: 2mm; overflow-wrap: anywhere; }
.signature .role { font-size: 9.5pt; color: #444; }
.issuer { flex: 1; text-align: center; font-size: 9.5pt; color: #444; overflow-wrap: anywhere; }
.validation { width: 52mm; text-align: center; font-size: 8pt; overflow-wrap: anywhere; }
.validation svg { display: block; width: 28mm; height: 28mm; margin: 0 auto 1.5mm; }
`;

/**
 * Monta o HTML A4 paisagem. Recusa o que não pode ser impresso: sem emitente ou signatário no snapshot, ou imagem e
 * fonte fora do formato `data:` esperado (nunca uma URL).
 */
export function renderCertificateHtml(input: RenderCertificateInput): string {
  const { snapshot } = input;
  if (!snapshot.issuer) throw new CertificateRenderInputError('issuer_missing');
  if (!snapshot.signatory) throw new CertificateRenderInputError('signatory_missing');
  if (input.signatureDataUri && !IMAGE_DATA_URI.test(input.signatureDataUri)) {
    throw new CertificateRenderInputError('signature_invalid');
  }
  if (input.fontDataUri && !FONT_DATA_URI.test(input.fontDataUri)) {
    throw new CertificateRenderInputError('font_invalid');
  }
  const url = certificateValidationUrl(input.baseUrl, input.code);

  const e = escapeHtml;
  const hours = snapshot.workloadHours
    ? `, com carga horária de ${snapshot.workloadHours} ${snapshot.workloadHours === 1 ? 'hora' : 'horas'}`
    : '';
  const font = input.fontDataUri
    ? `@font-face { font-family: 'Lexend Deca'; font-weight: 100 900; font-style: normal; src: url(${input.fontDataUri}) format('woff2'); }`
    : '';
  const signature = input.signatureDataUri
    ? `<img src="${input.signatureDataUri}" alt="Assinatura de ${e(snapshot.signatory.name)}">`
    : '';

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>Certificado de conclusão</title>
<style>${font}${STYLE}</style>
</head>
<body>
<main class="page">
<header>
<h1>Certificado de conclusão</h1>
</header>
<section>
<p class="lead">Certificamos que</p>
<p class="holder ${nameSizeClass(snapshot.holderName)}">${e(snapshot.holderName)}</p>
<p class="body">concluiu o curso <span class="course">${e(snapshot.courseTitle)}</span>${e(hours)}, em ${e(formatDatePt(snapshot.completedAt))}.</p>
</section>
<footer class="footer">
<div class="signature">${signature}<div class="line">${e(snapshot.signatory.name)}</div><div class="role">${e(snapshot.signatory.title)}</div></div>
<div class="issuer">Emitido por ${e(snapshot.issuer.legalName)}<br>CNPJ ${e(formatCnpj(snapshot.issuer.cnpj))}<br>em ${e(formatDatePt(input.issuedAt))}</div>
<div class="validation">${qrSvg(url)}Código ${e(input.code)}<br>${e(url)}</div>
</footer>
</main>
</body>
</html>
`;
}

import { CERTIFICATE_CODE_PATTERN, type CertificateSnapshot } from './certificate';
import { formatCnpj } from './issuer';
import {
  FIELD_IDS,
  PAGE,
  defaultLayout,
  fieldOf,
  fitFontSize,
  type CertificateLayout,
  type FieldId,
  type LayoutField,
} from './layout';
import { qrSvg } from './qr';

/**
 * HTML do certificado (M7-02 e M7-03), PURO e DETERMINÍSTICO: o mesmo snapshot gera o mesmo HTML. Regras que valem:
 * (1) TODO dado do snapshot passa por UMA função de escape, nunca é concatenado cru; (2) sem JavaScript, sem `<img>`
 * nem `<link>` remotos, sem `url()` externo: só `data:` (fonte, assinatura, fundo) e o QR em SVG local; (3) a própria
 * página carrega uma CSP que proíbe qualquer requisição de rede e script (defesa além do bloqueio do Browser Run);
 * (4) a posição de cada campo vem do LAYOUT do snapshot (milímetros, validados), nunca de texto livre.
 * Quem chama (o renderer) fornece a fonte, a assinatura e o fundo já como data URI; este módulo não lê arquivo nem rede.
 */
export class CertificateRenderInputError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`certificate_render_input:${code}`);
    this.code = code;
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
  /** Fundo A4 em `data:image/(png|jpeg|webp);base64,...`; opcional. */
  backgroundDataUri?: string | null;
}

const CSP = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'";

const STYLE = `
@page { size: ${PAGE.width}mm ${PAGE.height}mm; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { width: ${PAGE.width}mm; height: ${PAGE.height}mm; font-variant-ligatures: none; font-family: 'Lexend Deca', system-ui, sans-serif; color: #1a1a2e; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { position: relative; width: ${PAGE.width}mm; height: ${PAGE.height}mm; overflow: hidden; }
.bg { position: absolute; left: 0; top: 0; width: ${PAGE.width}mm; height: ${PAGE.height}mm; }
.frame { position: absolute; inset: 0; border: 3mm solid #1f3a5f; }
.f { position: absolute; margin: 0; overflow: hidden; overflow-wrap: anywhere; line-height: 1.25; font-variant-ligatures: none; }
.f.title { text-transform: uppercase; letter-spacing: 0.04em; }
.f.signatory { border-top: 0.3mm solid #1a1a2e; padding-top: 1.5mm; }
.f.signature, .f.qr { display: flex; align-items: center; justify-content: center; }
.f.signature img { max-width: 100%; max-height: 100%; }
.f.qr svg { width: 100%; height: 100%; }
.course { font-weight: 600; }
`;

/** Um número em mm/pt sem notação científica e sem lixo de ponto flutuante. */
const num = (value: number) => String(Math.round(value * 1000) / 1000);

function boxStyle(field: LayoutField): string {
  return `left:${num(field.x)}mm;top:${num(field.y)}mm;width:${num(field.w)}mm;height:${num(field.h)}mm`;
}

function textStyle(field: LayoutField, fontSize: number): string {
  return `${boxStyle(field)};font-size:${num(fontSize)}pt;font-weight:${field.weight ?? 400};color:${field.color ?? '#1a1a2e'};text-align:${field.align ?? 'center'};font-family:'${field.fontFamily ?? 'Lexend Deca'}',system-ui,sans-serif`;
}

/**
 * O TEXTO simples (sem marcação) de cada campo de texto, que serve ao ajuste de corpo; a marcação é montada à parte,
 * sempre com `escapeHtml`. Exportada para o editor medir o estouro com os mesmos textos.
 */
export function plainTextOf(
  id: FieldId,
  data: {
    holderName: string;
    courseTitle: string;
    workloadHours: number | null;
    completedAt: string;
    issuedAt: string;
    issuerName: string;
    issuerCnpj: string;
    signatoryName: string;
    signatoryTitle: string;
    code: string;
    url: string;
  },
): string {
  const hours = data.workloadHours
    ? `, com carga horária de ${data.workloadHours} ${data.workloadHours === 1 ? 'hora' : 'horas'}`
    : '';
  switch (id) {
    case 'title':
      return 'Certificado de conclusão';
    case 'intro':
      return 'Certificamos que';
    case 'holderName':
      return data.holderName;
    case 'body':
      return `concluiu o curso ${data.courseTitle}${hours}, em ${formatDatePt(data.completedAt)}.`;
    case 'signatory':
      return `${data.signatoryName}\n${data.signatoryTitle}`;
    case 'issuer':
      return `Emitido por ${data.issuerName}\nCNPJ ${formatCnpj(data.issuerCnpj)}\nem ${formatDatePt(data.issuedAt)}`;
    case 'code':
      return `Código ${data.code}\n${data.url}`;
    default:
      return '';
  }
}

/**
 * Monta o HTML A4 paisagem. Recusa o que não pode ser impresso: sem emitente ou signatário no snapshot, ou imagem e
 * fonte fora do formato `data:` esperado (nunca uma URL). Sem layout no snapshot, usa o modelo padrão.
 */
export function renderCertificateHtml(input: RenderCertificateInput): string {
  const { snapshot } = input;
  if (!snapshot.issuer) throw new CertificateRenderInputError('issuer_missing');
  if (!snapshot.signatory) throw new CertificateRenderInputError('signatory_missing');
  if (input.signatureDataUri && !IMAGE_DATA_URI.test(input.signatureDataUri)) {
    throw new CertificateRenderInputError('signature_invalid');
  }
  if (input.backgroundDataUri && !IMAGE_DATA_URI.test(input.backgroundDataUri)) {
    throw new CertificateRenderInputError('background_invalid');
  }
  if (input.fontDataUri && !FONT_DATA_URI.test(input.fontDataUri)) {
    throw new CertificateRenderInputError('font_invalid');
  }
  const url = certificateValidationUrl(input.baseUrl, input.code);
  const layout: CertificateLayout = snapshot.layout ?? defaultLayout();

  const e = escapeHtml;
  const data = {
    holderName: snapshot.holderName,
    courseTitle: snapshot.courseTitle,
    workloadHours: snapshot.workloadHours,
    completedAt: snapshot.completedAt,
    issuedAt: input.issuedAt,
    issuerName: snapshot.issuer.legalName,
    issuerCnpj: snapshot.issuer.cnpj,
    signatoryName: snapshot.signatory.name,
    signatoryTitle: snapshot.signatory.title,
    code: input.code,
    url,
  };
  const lines = (value: string) => value.split('\n').map(e).join('<br>');

  const parts: string[] = [];
  for (const id of FIELD_IDS) {
    const field = fieldOf(layout, id);
    if (id === 'signature') {
      const image = input.signatureDataUri
        ? `<img src="${input.signatureDataUri}" alt="Assinatura de ${e(snapshot.signatory.name)}">`
        : '';
      parts.push(`<div class="f signature" style="${boxStyle(field)}">${image}</div>`);
      continue;
    }
    if (id === 'qr') {
      parts.push(`<div class="f qr" style="${boxStyle(field)}">${qrSvg(url)}</div>`);
      continue;
    }
    const plain = plainTextOf(id, data);
    const { fontSize } = fitFontSize(plain, field);
    const style = textStyle(field, fontSize);
    let inner: string;
    if (id === 'body') {
      const hours = data.workloadHours
        ? `, com carga horária de ${data.workloadHours} ${data.workloadHours === 1 ? 'hora' : 'horas'}`
        : '';
      inner = `concluiu o curso <span class="course">${e(data.courseTitle)}</span>${e(hours)}, em ${e(formatDatePt(data.completedAt))}.`;
    } else {
      inner = lines(plain);
    }
    parts.push(`<div class="f ${id}" style="${style}">${inner}</div>`);
  }

  const font = input.fontDataUri
    ? `@font-face { font-family: 'Lexend Deca'; font-weight: 100 900; font-style: normal; src: url(${input.fontDataUri}) format('woff2'); }`
    : '';
  const background = input.backgroundDataUri
    ? `<img class="bg" src="${input.backgroundDataUri}" alt="">`
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
${background}<div class="frame"></div>
${parts.join('\n')}
</main>
</body>
</html>
`;
}

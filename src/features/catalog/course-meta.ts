import { slugSchema } from './catalog';

/**
 * Metadados de compartilhamento da página pública do curso (M2-06). Puro: sem banco nem Worker.
 * Tudo que entra em HTML passa por `escapeHtml`; a URL canônica vem da CONFIGURAÇÃO (`APP_BASE_URL`),
 * nunca do cabeçalho `Host` nem da URL da requisição, que quem chama controla.
 */

const SITE_NAME = 'NeuroCapacitar';
const DEFAULT_TITLE = 'NeuroCapacitar Hub';
export const DEFAULT_DESCRIPTION =
  'Plataforma de cursos da NeuroCapacitar: conteúdo, acompanhamento e certificado.';
/** Imagem estática até existir capa por curso (M5). Caminho relativo à origem canônica. */
const DEFAULT_IMAGE_PATH = '/og-default.png';
export const DESCRIPTION_MAX = 160;

const SLUG_PATH = /^\/cursos\/([^/]+)\/?$/;

/** Escapa o que é seguro dentro de texto e de atributo entre aspas (duplas ou simples). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** O slug do caminho `/cursos/:slug`, se o caminho tem essa forma e o slug é válido; senão `null`. */
export function slugFromPath(pathname: string): string | null {
  const match = SLUG_PATH.exec(pathname);
  if (!match) return null;
  let candidate: string;
  try {
    candidate = decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
  const parsed = slugSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** Origem canônica a partir da configuração (sem caminho, sem barra final). Falha se não for http(s). */
export function canonicalOrigin(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('APP_BASE_URL precisa ser http(s)');
  }
  return url.origin;
}

export interface PageMeta {
  title: string;
  description: string;
  canonical: string;
  image: string;
}

/** Metadados de um curso publicado. `summary` é o texto simples do resumo (já sem HTML). */
export function courseMeta(input: {
  baseUrl: string;
  slug: string;
  title: string;
  summary: string;
}): PageMeta {
  const origin = canonicalOrigin(input.baseUrl);
  return {
    title: `${input.title} | ${SITE_NAME}`,
    description: input.summary.trim() === '' ? DEFAULT_DESCRIPTION : input.summary,
    canonical: `${origin}/cursos/${input.slug}`,
    image: `${origin}${DEFAULT_IMAGE_PATH}`,
  };
}

/** Metadados genéricos (curso inexistente ou indisponível): nada do curso e canônica da home. */
export function genericMeta(baseUrl: string): PageMeta {
  const origin = canonicalOrigin(baseUrl);
  return {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    canonical: `${origin}/`,
    image: `${origin}${DEFAULT_IMAGE_PATH}`,
  };
}

/**
 * As tags que o Worker injeta no `<head>` (descrição, canônica, Open Graph e Twitter). O `<title>` é
 * trocado à parte. Cada valor é escapado; nenhuma tag nasce de texto cru.
 */
export function renderMetaTags(meta: PageMeta): string {
  const description = escapeHtml(meta.description);
  const title = escapeHtml(meta.title);
  const canonical = escapeHtml(meta.canonical);
  const image = escapeHtml(meta.image);
  return [
    `<meta name="description" content="${description}">`,
    `<link rel="canonical" href="${canonical}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:locale" content="pt_BR">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:url" content="${canonical}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
    `<meta name="twitter:image" content="${image}">`,
  ].join('');
}

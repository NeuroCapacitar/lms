import { z } from 'zod';

import type { RichText } from '../content/rich-text';
import type { OfferKind, PublicCourseDto, SequenceMode } from './catalog';

/**
 * Catálogo do aluno (M2-04). O que a pessoa logada enxerga de cada curso: só o publicado (título,
 * resumo e carga horária do currículo publicado) e o resumo da oferta aberta. Sem título interno,
 * criador, datas, estado de rascunho nem id de oferta (a inscrição é do M3-02). Puro: sem banco.
 */

interface CatalogOfferSummary {
  kind: OfferKind;
  priceCents: number;
  accessMonths: number;
  maxInstallments: number;
}

export interface CatalogCourseDto {
  slug: string;
  title: string;
  /** Texto simples tirado da descrição publicada (até `SUMMARY_MAX` caracteres); vazio sem descrição. */
  summary: string;
  workloadHours: number | null;
  sequenceMode: SequenceMode;
  /** `open`: há oferta ativa e currículo publicado. `closed`: inscrições encerradas, sem ação. */
  availability: 'open' | 'closed';
  /** A oferta de destaque quando aberta (a mais barata; gratuita primeiro); `null` quando encerrada. */
  offer: CatalogOfferSummary | null;
}

const SUMMARY_MAX = 200;

/** Texto corrido de um documento rico: blocos separados por espaço, quebra de linha como espaço. */
export function richTextToPlain(value: RichText | null): string {
  if (!value) return '';
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return;
    const item = node as { type?: string; text?: unknown; content?: unknown };
    if (item.type === 'text' && typeof item.text === 'string') {
      parts.push(item.text);
      return;
    }
    if (item.type === 'hardBreak') {
      parts.push(' ');
      return;
    }
    if (Array.isArray(item.content)) for (const child of item.content) walk(child);
    if (item.type !== undefined && item.type !== 'doc') parts.push(' ');
  };
  walk(value);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/** Corta em limite de palavra e acrescenta reticências só quando cortou. */
export function summarize(value: RichText | null, max = SUMMARY_MAX): string {
  const plain = richTextToPlain(value);
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Entre as ofertas abertas, a de destaque: menor preço (gratuita primeiro), depois a de menor prazo. */
function featuredOffer(offers: PublicCourseDto['offers']): CatalogOfferSummary | null {
  const sorted = [...offers].sort(
    (a, b) => a.priceCents - b.priceCents || a.accessMonths - b.accessMonths,
  );
  const first = sorted[0];
  return first
    ? {
        kind: first.kind,
        priceCents: first.priceCents,
        accessMonths: first.accessMonths,
        maxInstallments: first.maxInstallments,
      }
    : null;
}

/**
 * Do DTO público para o do catálogo. Curso sem currículo publicado não tem o que mostrar: `null`
 * (não entra na lista). Oferta pausada, arquivada ou em rascunho já vem fora de `offers`.
 */
export function toCatalogCourse(course: PublicCourseDto): CatalogCourseDto | null {
  if (!course.content) return null;
  const offer = featuredOffer(course.offers);
  return {
    slug: course.slug,
    title: course.content.title,
    summary: summarize(course.content.description),
    workloadHours: course.content.workloadHours,
    sequenceMode: course.sequenceMode,
    availability: offer ? 'open' : 'closed',
    offer,
  };
}

export const CATALOG_FILTERS = ['todos', 'abertos', 'encerrados'] as const;
export type CatalogFilter = (typeof CATALOG_FILTERS)[number];

/**
 * Parâmetros de busca da tela `/cursos`. Valor inválido ou ausente cai no padrão (a URL nunca
 * quebra a tela): texto de até 80 caracteres e um dos filtros.
 */
export const catalogSearchSchema = z.object({
  busca: z.string().max(80).catch('').default(''),
  filtro: z.enum(CATALOG_FILTERS).catch('todos').default('todos'),
});
export type CatalogSearch = z.infer<typeof catalogSearchSchema>;

/** Minúsculas e sem acentos, para a busca não depender de como a pessoa digita. */
export function normalizeForSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

export function filterCatalog(
  courses: CatalogCourseDto[],
  search: CatalogSearch,
): CatalogCourseDto[] {
  const needle = normalizeForSearch(search.busca);
  return courses.filter((course) => {
    if (search.filtro === 'abertos' && course.availability !== 'open') return false;
    if (search.filtro === 'encerrados' && course.availability !== 'closed') return false;
    if (needle === '') return true;
    return normalizeForSearch(`${course.title} ${course.summary}`).includes(needle);
  });
}

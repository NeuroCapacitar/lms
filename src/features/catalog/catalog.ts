import { z } from 'zod';

import type { RichText } from '../content/rich-text';

/**
 * Regras do catálogo (M2-01): Course e Offer. Puro: sem rede nem banco. Os mesmos invariantes estão
 * em CHECK e gatilhos no banco; aqui ficam as mensagens de entrada, as transições e a regra única de
 * "adquirível" (reutilizada pelo catálogo, pela compra e pela oferta gratuita).
 */
const SEQUENCE_MODES = ['guided', 'free'] as const;
export type SequenceMode = (typeof SEQUENCE_MODES)[number];

const COURSE_STATUSES = ['draft', 'published', 'archived'] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

const OFFER_KINDS = ['free', 'paid'] as const;
export type OfferKind = (typeof OFFER_KINDS)[number];

/** Vocabulário de `docs/spec/domain.md` (a tarefa M2-01 dizia `open` e `closed`: ver STATUS). */
const OFFER_STATUSES = ['draft', 'active', 'paused', 'archived'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

const MAX_INSTALLMENTS = 12;
const MAX_ACCESS_MONTHS = 600;

/** Slug: minúsculas, dígitos e hífens entre blocos (3 a 80 caracteres). Igual ao CHECK do banco. */
export const slugSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

const titleSchema = z.string().trim().min(1).max(200);
const offerNameSchema = z.string().trim().min(1).max(120);

/** Corpo de `POST /api/staff/courses`. A sequência pedagógica é escolha obrigatória, sem padrão. */
export const createCourseSchema = z.strictObject({
  slug: slugSchema,
  title: titleSchema,
  sequenceMode: z.enum(SEQUENCE_MODES),
});

/** Corpo de `PATCH /api/staff/courses/:id`: só título e slug (o slug trava na primeira publicação). */
export const updateCourseSchema = z
  .strictObject({ slug: slugSchema.optional(), title: titleSchema.optional() })
  .refine((value) => value.slug !== undefined || value.title !== undefined, {
    message: 'nada para alterar',
  });

export const courseStatusBodySchema = z.strictObject({ status: z.enum(COURSE_STATUSES) });
export const offerStatusBodySchema = z.strictObject({ status: z.enum(OFFER_STATUSES) });

/** Termos comerciais de uma oferta já normalizados (o que o banco guarda). */
export interface OfferTerms {
  kind: OfferKind;
  priceCents: number;
  accessMonths: number;
  maxInstallments: number;
}

/**
 * Confere as regras comerciais: gratuita custa 0 e parcela em 1; paga custa mais de 0 centavos e
 * parcela de 1 a 12 sem juros; TODA oferta tem prazo em meses (1 a 600), sem vitalício. Devolve a
 * lista de problemas (vazia = válido).
 */
export function validateOfferTerms(terms: OfferTerms): string[] {
  const problems: string[] = [];
  if (!Number.isSafeInteger(terms.priceCents) || terms.priceCents < 0) {
    problems.push('priceCents');
  } else if (terms.kind === 'free' && terms.priceCents !== 0) {
    problems.push('priceCents');
  } else if (terms.kind === 'paid' && terms.priceCents <= 0) {
    problems.push('priceCents');
  }
  if (
    !Number.isInteger(terms.accessMonths) ||
    terms.accessMonths < 1 ||
    terms.accessMonths > MAX_ACCESS_MONTHS
  ) {
    problems.push('accessMonths');
  }
  const maxInstallments = terms.kind === 'free' ? 1 : MAX_INSTALLMENTS;
  if (
    !Number.isInteger(terms.maxInstallments) ||
    terms.maxInstallments < 1 ||
    terms.maxInstallments > maxInstallments
  ) {
    problems.push('maxInstallments');
  }
  return problems;
}

const priceCents = z.number().int().min(0).max(100_000_000);
const accessMonths = z.number().int().min(1).max(MAX_ACCESS_MONTHS);
const installments = z.number().int().min(1).max(MAX_INSTALLMENTS);

/** Corpo de `POST /api/staff/courses/:id/offers`. */
export const createOfferSchema = z
  .strictObject({
    name: offerNameSchema,
    kind: z.enum(OFFER_KINDS),
    priceCents: priceCents.default(0),
    accessMonths,
    maxInstallments: installments.default(1),
  })
  .superRefine((value, context) => {
    for (const field of validateOfferTerms(value)) {
      context.addIssue({ code: 'custom', path: [field], message: 'invalid' });
    }
  });

/**
 * Corpo de `PATCH /api/staff/courses/:id/offers/:offerId`: nome e termos comerciais. A modalidade
 * (`kind`) não muda por aqui: para trocar gratuita por paga cria-se outra oferta. A combinação com a
 * modalidade existente é conferida contra a oferta guardada.
 */
export const updateOfferSchema = z
  .strictObject({
    name: offerNameSchema.optional(),
    priceCents: priceCents.optional(),
    accessMonths: accessMonths.optional(),
    maxInstallments: installments.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'nada para alterar' });

const COURSE_TRANSITIONS: Record<CourseStatus, readonly CourseStatus[]> = {
  draft: ['published', 'archived'],
  published: ['archived'],
  archived: ['published'],
};

/** Curso publicado nunca volta a rascunho (o banco também recusa); arquivar não apaga direitos. */
export function canTransitionCourse(from: CourseStatus, to: CourseStatus): boolean {
  return COURSE_TRANSITIONS[from].includes(to);
}

const OFFER_TRANSITIONS: Record<OfferStatus, readonly OfferStatus[]> = {
  draft: ['active', 'archived'],
  active: ['paused', 'archived'],
  paused: ['active', 'archived'],
  archived: [],
};

/** `archived` é terminal. Pausar e reativar é livre; arquivar encerra a oferta para sempre. */
export function canTransitionOffer(from: OfferStatus, to: OfferStatus): boolean {
  return OFFER_TRANSITIONS[from].includes(to);
}

/**
 * Regra ÚNICA de "adquirível": uma Offer `active` de um Course `published` que TEM currículo
 * publicado (M2-02). Reutilizada pelo catálogo, pela oferta gratuita (M3-02) e pela compra (M6).
 */
export function isOfferAcquirable(input: {
  courseStatus: CourseStatus;
  offerStatus: OfferStatus;
  hasPublishedCurriculum: boolean;
}): boolean {
  return (
    input.courseStatus === 'published' &&
    input.offerStatus === 'active' &&
    input.hasPublishedCurriculum
  );
}

/** Oferta como o público/aluno a vê: só termos comerciais, sem IDs internos de autoria nem status. */
export interface PublicOfferDto {
  id: string;
  name: string;
  kind: OfferKind;
  priceCents: number;
  accessMonths: number;
  maxInstallments: number;
}

/**
 * Curso para o público/aluno: SEM título interno, criador, datas de autoria nem estado de rascunho.
 * `acquirable` separa visibilidade (o curso aparece) de disponibilidade (há oferta ativa e currículo
 * publicado). `content` são os textos publicados (nulo enquanto o currículo não foi publicado).
 */
export interface PublicCourseDto {
  id: string;
  slug: string;
  sequenceMode: SequenceMode;
  acquirable: boolean;
  content: { title: string; description: RichText | null; workloadHours: number | null } | null;
  offers: PublicOfferDto[];
}

/** Oferta para a Staff: tudo, inclusive o estado. */
export interface StaffOfferDto extends PublicOfferDto {
  status: OfferStatus;
  currency: 'BRL';
  createdAt: string;
  updatedAt: string;
}

/** Curso para a Staff: tudo, inclusive título interno e se já foi publicado alguma vez. */
export interface StaffCourseDto {
  id: string;
  slug: string;
  title: string;
  sequenceMode: SequenceMode;
  status: CourseStatus;
  firstPublishedAt: string | null;
  /** Versão do currículo publicado (0 = nunca publicado). */
  publishedVersion: number;
  createdAt: string;
  updatedAt: string;
  offers: StaffOfferDto[];
}

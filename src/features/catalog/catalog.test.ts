import { describe, expect, it } from 'vitest';

import {
  canTransitionCourse,
  canTransitionOffer,
  createCourseSchema,
  createOfferSchema,
  isOfferAcquirable,
  slugSchema,
  updateCourseSchema,
  updateOfferSchema,
  validateOfferTerms,
  type CourseStatus,
  type OfferStatus,
} from './catalog';

describe('validateOfferTerms', () => {
  const paid = { kind: 'paid', priceCents: 19_700, accessMonths: 12, maxInstallments: 12 } as const;
  const free = { kind: 'free', priceCents: 0, accessMonths: 6, maxInstallments: 1 } as const;

  it('aceita oferta paga (1 a 12 parcelas) e gratuita (preço 0, 1 parcela)', () => {
    expect(validateOfferTerms(paid)).toEqual([]);
    expect(validateOfferTerms({ ...paid, maxInstallments: 1 })).toEqual([]);
    expect(validateOfferTerms(free)).toEqual([]);
  });

  it('recusa preço negativo, fracionado, gratuita com preço e paga sem preço', () => {
    expect(validateOfferTerms({ ...paid, priceCents: -1 })).toEqual(['priceCents']);
    expect(validateOfferTerms({ ...paid, priceCents: 19.5 })).toEqual(['priceCents']);
    expect(validateOfferTerms({ ...paid, priceCents: 0 })).toEqual(['priceCents']);
    expect(validateOfferTerms({ ...free, priceCents: 100 })).toEqual(['priceCents']);
  });

  it('toda oferta tem prazo em meses (1 a 600): sem zero, sem vitalício, sem fração', () => {
    for (const accessMonths of [0, -3, 1.5, 601, Number.NaN]) {
      expect(validateOfferTerms({ ...paid, accessMonths }), String(accessMonths)).toEqual([
        'accessMonths',
      ]);
    }
    expect(validateOfferTerms({ ...free, accessMonths: 1 })).toEqual([]);
  });

  it('parcelas de 1 a 12, e a gratuita só 1', () => {
    for (const maxInstallments of [0, 13, 2.5]) {
      expect(validateOfferTerms({ ...paid, maxInstallments })).toEqual(['maxInstallments']);
    }
    expect(validateOfferTerms({ ...free, maxInstallments: 2 })).toEqual(['maxInstallments']);
  });
});

describe('schemas de entrada', () => {
  it('slug: minúsculas, dígitos e hífens entre blocos, 3 a 80 caracteres', () => {
    for (const ok of ['protea-r', 'curso-01', 'abc', 'a'.repeat(80)]) {
      expect(slugSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of [
      'ab',
      'Curso',
      'curso_1',
      '-curso',
      'curso-',
      'cur--so',
      'curso 1',
      'á-curso',
      'a'.repeat(81),
    ]) {
      expect(slugSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('criar curso exige a sequência pedagógica (sem padrão) e recusa campo extra', () => {
    const base = { slug: 'curso-um', title: '  Curso um  ', sequenceMode: 'guided' };
    expect(createCourseSchema.parse(base).title).toBe('Curso um');
    expect(createCourseSchema.safeParse({ slug: 'curso-um', title: 'x' }).success).toBe(false);
    expect(createCourseSchema.safeParse({ ...base, sequenceMode: 'qualquer' }).success).toBe(false);
    expect(createCourseSchema.safeParse({ ...base, status: 'published' }).success).toBe(false);
    expect(createCourseSchema.safeParse({ ...base, title: '   ' }).success).toBe(false);
  });

  it('editar curso exige ao menos um campo', () => {
    expect(updateCourseSchema.safeParse({}).success).toBe(false);
    expect(updateCourseSchema.safeParse({ title: 'Novo' }).success).toBe(true);
    expect(updateCourseSchema.safeParse({ title: 'Novo', kind: 'paid' }).success).toBe(false);
  });

  it('criar oferta: aplica os padrões, lista os campos inválidos e recusa moeda ou status no corpo', () => {
    const free = createOfferSchema.parse({ name: 'Gratuita', kind: 'free', accessMonths: 3 });
    expect(free).toMatchObject({ priceCents: 0, maxInstallments: 1 });
    const bad = createOfferSchema.safeParse({
      name: 'Paga',
      kind: 'paid',
      priceCents: 0,
      accessMonths: 12,
      maxInstallments: 1,
    });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues.map((issue) => issue.path[0])).toEqual(['priceCents']);
    for (const extra of [{ currency: 'USD' }, { status: 'active' }]) {
      expect(
        createOfferSchema.safeParse({ name: 'x', kind: 'free', accessMonths: 3, ...extra }).success,
      ).toBe(false);
    }
  });

  it('editar oferta não troca a modalidade e exige ao menos um campo', () => {
    expect(updateOfferSchema.safeParse({}).success).toBe(false);
    expect(updateOfferSchema.safeParse({ kind: 'paid' }).success).toBe(false);
    expect(updateOfferSchema.safeParse({ priceCents: 9_900 }).success).toBe(true);
  });
});

describe('transições e disponibilidade', () => {
  it('curso: publicado nunca volta a rascunho; arquivar e republicar é permitido', () => {
    const allowed: [CourseStatus, CourseStatus][] = [
      ['draft', 'published'],
      ['draft', 'archived'],
      ['published', 'archived'],
      ['archived', 'published'],
    ];
    for (const [from, to] of allowed)
      expect(canTransitionCourse(from, to), `${from}>${to}`).toBe(true);
    for (const [from, to] of [
      ['published', 'draft'],
      ['archived', 'draft'],
      ['draft', 'draft'],
    ] as [CourseStatus, CourseStatus][]) {
      expect(canTransitionCourse(from, to), `${from}>${to}`).toBe(false);
    }
  });

  it('oferta: arquivada é terminal; pausar e reativar é livre', () => {
    expect(canTransitionOffer('draft', 'active')).toBe(true);
    expect(canTransitionOffer('active', 'paused')).toBe(true);
    expect(canTransitionOffer('paused', 'active')).toBe(true);
    for (const from of ['draft', 'active', 'paused'] as OfferStatus[]) {
      expect(canTransitionOffer(from, 'archived')).toBe(true);
    }
    for (const to of ['draft', 'active', 'paused', 'archived'] as OfferStatus[]) {
      expect(canTransitionOffer('archived', to)).toBe(false);
    }
    expect(canTransitionOffer('draft', 'paused')).toBe(false);
    expect(canTransitionOffer('active', 'draft')).toBe(false);
  });

  it('adquirível: só oferta ativa de curso publicado', () => {
    const courses: CourseStatus[] = ['draft', 'published', 'archived'];
    const offers: OfferStatus[] = ['draft', 'active', 'paused', 'archived'];
    for (const courseStatus of courses) {
      for (const offerStatus of offers) {
        expect(
          isOfferAcquirable({ courseStatus, offerStatus }),
          `${courseStatus}/${offerStatus}`,
        ).toBe(courseStatus === 'published' && offerStatus === 'active');
      }
    }
  });
});

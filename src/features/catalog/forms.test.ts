import { describe, expect, it } from 'vitest';

import { courseFormSchema, offerFormSchema, offerFormToInput } from './forms';

const issues = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => result.error?.issues.map((issue) => `${String(issue.path[0])}: ${issue.message}`) ?? [];

describe('courseFormSchema', () => {
  it('aceita um curso válido e dá mensagens em português', () => {
    expect(
      courseFormSchema.safeParse({ title: ' Curso ', slug: 'curso-um', sequenceMode: 'guided' })
        .success,
    ).toBe(true);
    const bad = courseFormSchema.safeParse({
      title: ' ',
      slug: 'Mau Slug',
      sequenceMode: undefined,
    });
    expect(bad.success).toBe(false);
    expect(issues(bad)).toEqual([
      'title: Informe o título interno.',
      expect.stringContaining('slug: Use só letras minúsculas'),
      'sequenceMode: Escolha como as aulas se liberam.',
    ]);
  });
});

describe('offerFormSchema', () => {
  const paid = {
    name: 'Anual',
    kind: 'paid',
    price: '197,00',
    accessMonths: 12,
    maxInstallments: 12,
  };
  const free = { name: 'Gratuita', kind: 'free', price: '', accessMonths: 3, maxInstallments: 1 };

  it('paga e gratuita válidas; o preço vai em centavos inteiros', () => {
    expect(offerFormSchema.safeParse(paid).success).toBe(true);
    expect(offerFormSchema.safeParse(free).success).toBe(true);
    expect(offerFormToInput(offerFormSchema.parse(paid))).toEqual({
      name: 'Anual',
      kind: 'paid',
      priceCents: 19_700,
      accessMonths: 12,
      maxInstallments: 12,
    });
    expect(offerFormToInput(offerFormSchema.parse(free)).priceCents).toBe(0);
  });

  it('recusa preço inválido, gratuita com preço ou parcelas, prazo e parcelas fora da faixa', () => {
    expect(issues(offerFormSchema.safeParse({ ...paid, price: '' }))).toEqual([
      'price: Informe um preço maior que zero (ex.: 197,00).',
    ]);
    expect(offerFormSchema.safeParse({ ...paid, price: '0,00' }).success).toBe(false);
    expect(offerFormSchema.safeParse({ ...paid, price: 'abc' }).success).toBe(false);
    expect(issues(offerFormSchema.safeParse({ ...free, price: '10,00' }))).toEqual([
      'price: A oferta gratuita não tem preço.',
    ]);
    expect(issues(offerFormSchema.safeParse({ ...free, maxInstallments: 3 }))).toEqual([
      'maxInstallments: A oferta gratuita não parcela: use 1.',
    ]);
    expect(offerFormSchema.safeParse({ ...paid, accessMonths: 0 }).success).toBe(false);
    expect(offerFormSchema.safeParse({ ...paid, accessMonths: 601 }).success).toBe(false);
    expect(offerFormSchema.safeParse({ ...paid, maxInstallments: 13 }).success).toBe(false);
    expect(issues(offerFormSchema.safeParse({ ...paid, accessMonths: Number.NaN }))).toEqual([
      'accessMonths: Informe o prazo de acesso em meses.',
    ]);
    expect(issues(offerFormSchema.safeParse({ ...paid, kind: undefined }))).toContain(
      'kind: Escolha gratuita ou paga.',
    );
  });
});

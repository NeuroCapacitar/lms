import { z } from 'zod';

import { parseBrlToCents } from './money';

/**
 * Esquemas dos formulários do Course Builder (M2-03), com as mensagens em português que a pessoa
 * lê. São a PRIMEIRA validação (rápida, na tela); o servidor valida tudo de novo e o banco ainda
 * tem os CHECKs. O preço é digitado em reais e só o servidor o recebe em centavos.
 */
export const courseFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Informe o título interno.')
    .max(200, 'No máximo 200 caracteres.'),
  slug: z
    .string()
    .min(3, 'O endereço precisa ter ao menos 3 caracteres.')
    .max(80, 'No máximo 80 caracteres.')
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      'Use só letras minúsculas, números e hífens entre os blocos (ex.: protea-r).',
    ),
  sequenceMode: z.enum(['guided', 'free'], { error: 'Escolha como as aulas se liberam.' }),
});
export type CourseFormValues = z.infer<typeof courseFormSchema>;

/** Só título e endereço (editáveis depois de criado; a sequência não muda). */
export const courseMetaFormSchema = courseFormSchema.pick({ title: true, slug: true });
export type CourseMetaFormValues = z.infer<typeof courseMetaFormSchema>;

export const offerFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Informe o nome da oferta.')
      .max(120, 'No máximo 120 caracteres.'),
    kind: z.enum(['free', 'paid'], { error: 'Escolha gratuita ou paga.' }),
    /** Em reais, como se digita (`197,00`). Vazio vale para a oferta gratuita. */
    price: z.string(),
    accessMonths: z
      .number({ error: 'Informe o prazo de acesso em meses.' })
      .int('Use um número inteiro de meses.')
      .min(1, 'O prazo é de pelo menos 1 mês.')
      .max(600, 'O prazo é de no máximo 600 meses.'),
    maxInstallments: z
      .number({ error: 'Informe o número máximo de parcelas.' })
      .int('Use um número inteiro.')
      .min(1, 'No mínimo 1 parcela.')
      .max(12, 'No máximo 12 parcelas.'),
  })
  .superRefine((value, context) => {
    const cents = value.price.trim() === '' ? 0 : parseBrlToCents(value.price);
    if (value.kind === 'paid' && (cents === null || cents <= 0)) {
      context.addIssue({
        code: 'custom',
        path: ['price'],
        message: 'Informe um preço maior que zero (ex.: 197,00).',
      });
    }
    if (value.kind === 'free' && cents !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['price'],
        message: 'A oferta gratuita não tem preço.',
      });
    }
    if (value.kind === 'free' && value.maxInstallments !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['maxInstallments'],
        message: 'A oferta gratuita não parcela: use 1.',
      });
    }
  });
export type OfferFormValues = z.infer<typeof offerFormSchema>;

/** Dos valores do formulário para o que o servidor recebe (preço em centavos inteiros). */
export function offerFormToInput(values: OfferFormValues) {
  return {
    name: values.name,
    kind: values.kind,
    priceCents: values.price.trim() === '' ? 0 : (parseBrlToCents(values.price) ?? 0),
    accessMonths: values.accessMonths,
    maxInstallments: values.maxInstallments,
  };
}

/** Mensagens por campo para erros que só o servidor sabe (ele lista `fields` inválidos). */
export const SERVER_FIELD_MESSAGES: Record<string, string> = {
  priceCents: 'Preço inválido para esta modalidade.',
  accessMonths: 'Prazo inválido (de 1 a 600 meses).',
  maxInstallments: 'Parcelas inválidas para esta modalidade.',
  name: 'Nome inválido.',
};

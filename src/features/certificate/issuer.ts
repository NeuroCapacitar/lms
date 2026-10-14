import { z } from 'zod';

/**
 * Emitente e signatário do certificado (M7-06), parte PURA. O emitente (razão social e CNPJ) é global; o signatário
 * (nome, cargo e a imagem da assinatura) é POR CURSO, sem fallback global. O CNPJ é validado pelos dígitos
 * verificadores; todo texto é normalizado em NFC e recusa caracteres de controle, zero-width e de direção (bidi),
 * que enganariam quem lê o PDF. A assinatura é mídia PRIVADA: aqui só existe o id dela.
 */

/** Faixas proibidas (pontos de código): controle, C1, hífen suave, zero-width, marcas de direção (bidi), separadores de linha e BOM. */
const UNSAFE_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0xfeff, 0xfeff],
];

export function hasUnsafeCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (UNSAFE_RANGES.some(([from, to]) => code >= from && code <= to)) return true;
  }
  return false;
}

/** Só os dígitos de um CNPJ (14); qualquer outra coisa vira `null`. */
export function normalizeCnpj(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replaceAll(/\D/g, '');
  return digits.length === 14 ? digits : null;
}

/** CNPJ válido: 14 dígitos, não todos iguais, e os dois dígitos verificadores conferem. */
export function isValidCnpj(raw: unknown): boolean {
  const digits = normalizeCnpj(raw);
  if (!digits || /^(\d)\1{13}$/.test(digits)) return false;
  const check = (length: number) => {
    const weights =
      length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + weight * Number(digits[index]), 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(12) === Number(digits[12]) && check(13) === Number(digits[13]);
}

export function formatCnpj(digits: string): string {
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

const text = (min: number, max: number) =>
  z
    .string()
    .transform((value) => value.normalize('NFC').trim().replaceAll(/\s+/g, ' '))
    .pipe(z.string().min(min).max(max))
    .refine((value) => !hasUnsafeCharacters(value));

/** Corpo do cadastro do emitente. O CNPJ chega com ou sem máscara e é guardado só com os 14 dígitos. */
export const issuerInputSchema = z.strictObject({
  legalName: text(3, 200),
  cnpj: z
    .string()
    .refine((value) => isValidCnpj(value))
    .transform((value) => normalizeCnpj(value)!),
});
export type IssuerInput = z.infer<typeof issuerInputSchema>;

/** Corpo do cadastro do signatário de UM curso. `signatureMediaId` é uma mídia `certificate_asset` pronta, ou `null`. */
export const signatoryInputSchema = z.strictObject({
  name: text(2, 120),
  title: text(2, 120),
  signatureMediaId: z.uuid().nullable(),
});
export type SignatoryInput = z.infer<typeof signatoryInputSchema>;

export interface IssuerDto {
  legalName: string;
  /** Só dígitos. */
  cnpj: string;
  /** Com máscara, para exibir. */
  cnpjFormatted: string;
  updatedAt: string;
}

export interface SignatoryDto {
  courseId: string;
  name: string;
  title: string;
  signatureMediaId: string | null;
  updatedAt: string;
}

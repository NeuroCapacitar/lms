import { z } from 'zod';

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** Texto livre de uma linha: sem caracteres de controle (quebra de linha, tabulação, nulo...). */
const singleLine = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !/\p{Cc}/u.test(value), 'sem caracteres de controle');

/**
 * Corpo de `PATCH /api/me/profile`. Só os campos editáveis; qualquer outro (`email`, `role`,
 * `userId`...) faz a validação FALHAR, em vez de ser ignorado em silêncio. Vazio também falha.
 * `certificateName` aceita `null` (ou texto vazio) para limpar.
 */
export const profilePatchSchema = z
  .strictObject({
    displayName: singleLine(1, 80),
    certificateName: z.union([z.literal('').transform(() => null), z.null(), singleLine(3, 120)]),
    theme: z.enum(THEMES),
    autoAdvance: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'nenhum campo informado');

export type ProfilePatch = z.infer<typeof profilePatchSchema>;

/** Resposta de `GET/PATCH /api/me/profile`: nunca traz dado de autenticação nem o ID do usuário. */
export interface ProfileDto {
  displayName: string;
  certificateName: string | null;
  /** O nome do certificado já foi confirmado (M7). Alterar o nome zera a confirmação. */
  certificateNameConfirmed: boolean;
  theme: Theme;
  autoAdvance: boolean;
}

/** Formulário da tela de perfil: mesmas regras do servidor, com mensagens em português. */
export const profileFormSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Informe o nome que aparece para você.')
    .max(80, 'Use no máximo 80 caracteres.')
    .refine((value) => !/\p{Cc}/u.test(value), 'Use só uma linha de texto.'),
  certificateName: z.union([
    z.literal(''),
    z
      .string()
      .trim()
      .min(3, 'Use pelo menos 3 caracteres, ou deixe em branco.')
      .max(120, 'Use no máximo 120 caracteres.')
      .refine((value) => !/\p{Cc}/u.test(value), 'Use só uma linha de texto.'),
  ]),
  theme: z.enum(THEMES),
  autoAdvance: z.boolean(),
});

export type ProfileFormValues = z.infer<typeof profileFormSchema>;

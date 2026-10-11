import { z } from 'zod';

import { normalizeEmail } from './email';

/** Tamanho da senha (mínimo proposto: 12; confirmar com o responsável). O máximo evita abuso de CPU. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Limites do login por senha, por janela de 10 minutos (PROPOSTOS; confirmar com o responsável).
 * O hash da senha custa ~80 a 125 ms de CPU no Worker (ADR 0029): o freio é também proteção de custo.
 */
export const PASSWORD_LIMITS = {
  perEmail: { max: 10, windowSeconds: 10 * 60 },
  perIp: { max: 20, windowSeconds: 10 * 60 },
} as const;

/** Início do login com Google: só limite por IP (não envia e-mail nem gasta CPU de hash). */
export const GOOGLE_START_LIMIT = { max: 20, windowSeconds: 10 * 60 } as const;

/** Corpo de `POST /api/auth/password/sign-in`. O Turnstile entra como `captchaToken`. */
export const passwordSignInSchema = z.strictObject({
  email: z.string().max(254).transform(normalizeEmail).pipe(z.email()),
  // Sem mínimo aqui: uma senha curta só deve falhar como "credenciais inválidas", igual às demais.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  captchaToken: z.string().min(1).max(2048),
});

/** Corpo de `POST /api/me/security/password` (definir ou trocar a senha da própria conta). */
export const setPasswordSchema = z.strictObject({
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});

/** Corpos vazios (`google/start`, `google/link`, `google/unlink`, `password/remove`). */
export const emptyBodySchema = z.strictObject({});
